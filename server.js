#!/usr/bin/env node
/**
 * Static file server + streaming proxy to a local llama-server.
 *
 *   GET  /              -> web/dist (SPA fallback), behind the session cookie
 *   ANY  /api/<path>    -> <UPSTREAM>/<path>, Authorization injected server-side
 *   GET|POST /auth/*    -> login / logout
 *
 * Zero runtime dependencies on purpose: the whole thing is node: builtins.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  COOKIE_NAME, clearCookie, hashPassword, issueSession, loadPassword, loadSessionSecret,
  loginBlocked, readCookie, recordFailure, recordSuccess, sessionCookie, verifyPassword, verifySession,
} from './lib/auth.js';
import { clientIp, isSecureRequest, securityHeaders } from './lib/security.js';
import { ADMIN_CLIENT_JS, handleAdminAction, renderAdmin } from './lib/admin.js';
import { mailerConfig } from './lib/mailer.js';
import { consumeInvite, initUserStore, isSessionValid, touch } from './lib/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------------------- config */

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const UPSTREAM = new URL(process.env.LLM_UPSTREAM || 'http://127.0.0.1:8080');
const WEB_DIR = path.resolve(__dirname, process.env.WEB_DIR || 'web/dist');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const AUTH_DISABLED = process.env.AUTH_DISABLED === '1';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1_000_000);
const USERS_FILE = process.env.USERS_FILE || path.join(os.homedir(), '.llm-chat-users.json');
// Les liens partent par e-mail : mieux vaut une base explicite qu'un en-tête
// Host, que le client contrôle.
const BASE_URL = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '') || null;

const API_KEY = resolveApiKey();
const CREDENTIAL = loadPassword();
const SESSION_SECRET = loadSessionSecret();
const LOGIN_PAGE = fs.readFileSync(path.join(__dirname, 'lib/login.html'), 'utf8');
const USER_COUNT = initUserStore(USERS_FILE);

// `node server.js --hash-password 'secret'` -> APP_PASSWORD_HASH value
if (process.argv[2] === '--hash-password') {
  const pw = process.argv[3];
  if (!pw) { console.error('usage: node server.js --hash-password <mot-de-passe>'); process.exit(1); }
  console.log(hashPassword(pw));
  process.exit(0);
}

if (!AUTH_DISABLED && !CREDENTIAL) {
  console.error(
    'Aucun mot de passe configuré.\n' +
    '  - définissez APP_PASSWORD / APP_PASSWORD_HASH, ou écrivez le mot de passe dans ~/.llm-chat-password\n' +
    '  - ou lancez avec AUTH_DISABLED=1 si le service est strictement inaccessible depuis Internet.'
  );
  process.exit(1);
}

function resolveApiKey() {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY.trim();
  const file = process.env.LLM_API_KEY_FILE || path.join(os.homedir(), '.qwen38-api-key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    console.warn(`[warn] no API key: set LLM_API_KEY or create ${file}`);
    return '';
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/* ---------------------------------------------------------------- proxy */

// Hop-by-hop headers must not be forwarded. `accept-encoding` is dropped on
// purpose: a gzip stream would be buffered by the compressor and kill SSE.
// `cookie` is dropped so the session never reaches llama-server.
const STRIP_REQUEST_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'authorization', 'accept-encoding',
  'content-length', 'cookie',
]);

// llama-server runs with --parallel 1: a second generation would silently sit
// in a queue. One in flight at a time, server-side, whatever the client does.
let generating = false;

function proxy(req, res) {
  const upstreamPath = req.url.slice('/api'.length) || '/';
  const isGeneration = upstreamPath.startsWith('/v1/chat/completions') || upstreamPath.startsWith('/completion');

  if (isGeneration) {
    if (generating) {
      return json(res, 429, { error: { code: 'busy', message: 'Une génération est déjà en cours (--parallel 1).' } });
    }
    generating = true;
    res.on('close', () => { generating = false; });
  }

  if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) {
    return json(res, 413, { error: { code: 'too_large', message: 'Requête trop volumineuse.' } });
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  headers['accept-encoding'] = 'identity';
  headers.host = UPSTREAM.host;
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;

  const upstreamReq = http.request(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || 80,
      method: req.method,
      path: upstreamPath,
      headers,
      // A 1000-token answer takes ~3 min at 5.8 tok/s. No timeouts anywhere.
      timeout: 0,
    },
    (upstreamRes) => {
      const out = { ...upstreamRes.headers };
      delete out.connection;
      delete out['transfer-encoding'];
      delete out['keep-alive'];
      delete out['set-cookie'];
      if (String(out['content-type'] || '').includes('text/event-stream')) {
        out['cache-control'] = 'no-cache, no-transform';
        out['x-accel-buffering'] = 'no';
      }
      res.writeHead(upstreamRes.statusCode || 502, out);
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      upstreamRes.on('data', (chunk) => res.write(chunk));
      upstreamRes.on('end', () => res.end());
      upstreamRes.on('error', () => res.destroy());
    }
  );

  upstreamReq.setNoDelay(true);
  upstreamReq.setTimeout(0);

  upstreamReq.on('error', (err) => {
    if (res.headersSent) return res.destroy();
    const offline = err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ENOTFOUND';
    json(res, offline ? 502 : 500, {
      error: { code: err.code || 'proxy_error', message: err.message, upstream: UPSTREAM.origin },
    });
  });

  // The browser aborting (Stop button, tab closed, wifi drop) must free the
  // llama-server slot immediately -- it runs with --parallel 1.
  const abort = () => { if (!upstreamReq.destroyed) upstreamReq.destroy(); };
  res.on('close', () => { if (!res.writableFinished) abort(); });
  req.on('aborted', abort);

  let received = 0;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) { abort(); req.destroy(); }
  });
  req.pipe(upstreamReq);
}

/* ---------------------------------------------------------------- static */

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let filePath = path.join(WEB_DIR, urlPath);
  if (!filePath.startsWith(WEB_DIR)) return send(res, 403, 'Forbidden');

  let stat = await fsp.stat(filePath).catch(() => null);
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    stat = await fsp.stat(filePath).catch(() => null);
  }
  if (!stat) {
    filePath = path.join(WEB_DIR, 'index.html'); // SPA fallback
    stat = await fsp.stat(filePath).catch(() => null);
    if (!stat) return send(res, 404, `Build introuvable (${WEB_DIR}). Lancez: npm run setup`);
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': cachePolicy(urlPath),
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}

/* ------------------------------------------------------------------ auth */

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Only same-origin absolute paths, never `//evil.com`. */
function safeNext(value) {
  return typeof value === 'string' && /^\/(?!\/)[^\s]*$/.test(value) ? value : '/';
}

function loginPage(res, { error = '', next = '/', status = 200 } = {}) {
  const html = LOGIN_PAGE
    .replace('<!--ERROR-->', error ? `<p class="error">${escapeHtml(error)}</p>` : '')
    .replace('<!--NEXT-->', escapeHtml(next));
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function handleAuth(req, res, secure) {
  const { pathname, searchParams } = new URL(req.url, 'http://x');

  if (pathname === '/auth/login' && req.method === 'GET') {
    return loginPage(res, { next: safeNext(searchParams.get('next')) });
  }

  if (pathname === '/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req, secure)) return send(res, 403, 'Origine refusée');
    const ip = clientIp(req, TRUST_PROXY);
    const blocked = loginBlocked(ip);
    if (blocked) {
      return loginPage(res, {
        status: 429,
        error: `Trop de tentatives. Réessayez dans ${Math.ceil(blocked / 1000)} s.`,
      });
    }

    const body = await readBody(req).catch(() => '');
    const form = new URLSearchParams(body);
    const next = safeNext(form.get('next'));

    if (!verifyPassword(form.get('password') || '', CREDENTIAL)) {
      recordFailure(ip);
      console.warn(`[auth] échec de connexion depuis ${ip}`);
      return loginPage(res, { status: 401, error: 'Mot de passe incorrect.', next });
    }

    recordSuccess(ip);
    return startSession(res, { sub: 'admin', role: 'admin', epoch: 0 }, next, secure);
  }

  // Lien magique : la seule voie d'entrée des comptes invités.
  if (pathname === '/auth/magic' && req.method === 'GET') {
    const ip = clientIp(req, TRUST_PROXY);
    if (loginBlocked(ip)) {
      return loginPage(res, { status: 429, error: 'Trop de tentatives. Réessayez plus tard.' });
    }
    const { user, error } = consumeInvite(searchParams.get('t') || '');
    if (error) {
      recordFailure(ip);
      console.warn(`[auth] lien magique refusé depuis ${ip}: ${error}`);
      return loginPage(res, {
        status: 401,
        error: `Lien ${error}. Demandez-en un nouveau à l'administrateur.`,
      });
    }
    recordSuccess(ip);
    console.log(`[auth] session ouverte pour ${user.label} (${user.id}) depuis ${ip}`);
    return startSession(res, { sub: user.id, role: 'user', epoch: user.sessionEpoch }, '/', secure);
  }

  // Le front a besoin de savoir s'il doit afficher l'entrée d'administration.
  if (pathname === '/auth/whoami' && req.method === 'GET') {
    const session = sessionOf(req);
    if (!session) return json(res, 401, { error: { code: 'unauthorized' } });
    return json(res, 200, { role: session.role, sub: session.sub });
  }

  if (pathname === '/auth/logout') {
    res.writeHead(req.method === 'POST' ? 204 : 303, {
      'set-cookie': clearCookie(secure),
      'cache-control': 'no-store',
      ...(req.method === 'POST' ? {} : { location: '/auth/login' }),
    });
    return res.end();
  }

  return send(res, 404, 'Not Found');
}

/* ----------------------------------------------------------------- admin */

async function handleAdmin(req, res, session, secure) {
  if (session.role !== 'admin') {
    // 404 plutôt que 403 : inutile de confirmer l'existence de la page à un
    // compte invité.
    return send(res, 404, 'Not Found');
  }

  const { pathname, searchParams } = new URL(req.url, 'http://x');

  if (pathname === '/admin.js' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(ADMIN_CLIENT_JS);
  }

  if (pathname === '/admin' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(renderAdmin({
      message: searchParams.get('m') || '',
      baseUrl: baseUrlOf(req, secure),
      smtpReady: Boolean(mailerConfig()),
    }));
  }

  if (pathname === '/admin/action' && req.method === 'POST') {
    if (!sameOrigin(req, secure)) return send(res, 403, 'Origine refusée');
    const body = await readBody(req, 8192).catch(() => '');
    const message = await handleAdminAction(new URLSearchParams(body), baseUrlOf(req, secure));
    res.writeHead(303, { location: `/admin?m=${encodeURIComponent(message)}`, 'cache-control': 'no-store' });
    return res.end();
  }

  return send(res, 404, 'Not Found');
}

function startSession(res, claims, next, secure) {
  res.writeHead(303, {
    location: next,
    'set-cookie': sessionCookie(issueSession(SESSION_SECRET, claims), secure),
    'cache-control': 'no-store',
  });
  res.end();
}

/**
 * Revendications signées ET toujours honorées par le magasin de comptes : une
 * signature valide ne suffit pas, sinon désactiver un compte n'aurait aucun
 * effet avant l'expiration du cookie, soit trente jours.
 */
function sessionOf(req) {
  if (AUTH_DISABLED) return { sub: 'admin', role: 'admin', epoch: 0 };
  const claims = verifySession(readCookie(req.headers.cookie, COOKIE_NAME), SESSION_SECRET);
  if (!claims || !isSessionValid(claims)) return null;
  if (claims.role !== 'admin') touch(claims.sub);
  return claims;
}

/** URL publique, pour les liens envoyés par e-mail. */
function baseUrlOf(req, secure) {
  if (BASE_URL) return BASE_URL;
  const host = String(
    (TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || ''
  ).split(',')[0].trim();
  // Un Host bricolé ne doit pas pouvoir fabriquer un lien vers un autre domaine.
  if (!/^[a-z0-9.\-]+(:\d+)?$/i.test(host)) return '';
  return `${secure ? 'https' : 'http'}://${host}`;
}

/** SameSite=Strict couvre déjà le CSRF; ceci est une seconde barrière. */
function sameOrigin(req, secure) {
  const origin = req.headers.origin;
  if (!origin) return true; // les navigateurs l'omettent sur une navigation simple
  const expected = baseUrlOf(req, secure);
  return Boolean(expected) && origin === expected;
}

/* ---------------------------------------------------------------- helpers */

/** Hashed bundles never change; icons rarely; the shell and the SW never cache. */
function cachePolicy(urlPath) {
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (urlPath.startsWith('/icons/')) return 'public, max-age=86400';
  return 'no-store';
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function json(res, code, payload) {
  if (res.headersSent) return res.destroy();
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

/* ----------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  req.socket.setNoDelay(true);
  res.setTimeout(0);

  const secure = isSecureRequest(req, TRUST_PROXY);
  const base = securityHeaders({ secure });
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (code, headers) => writeHead(code, { ...base, ...(headers || {}) });

  const { pathname } = new URL(req.url, 'http://x');

  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('User-agent: *\nDisallow: /\n');
  }

  // The manifest and icons carry nothing sensitive, and serving them to an
  // anonymous visitor is what makes the login screen itself installable.
  const isPublicAsset =
    pathname === '/manifest.webmanifest' ||
    pathname.startsWith('/icons/') ||
    pathname === '/favicon.ico';

  if (isPublicAsset && (req.method === 'GET' || req.method === 'HEAD')) {
    return serveStatic(req, res).catch((err) => send(res, 500, String(err)));
  }

  if (pathname.startsWith('/auth/')) {
    return handleAuth(req, res, secure).catch((err) => send(res, 400, String(err.message)));
  }

  const session = sessionOf(req);
  if (!session) {
    // XHR gets a status the front can act on; a browser navigation gets the form.
    if (pathname.startsWith('/api/')) {
      return json(res, 401, { error: { code: 'unauthorized', message: 'Session expirée.' } });
    }
    res.writeHead(302, { location: `/auth/login?next=${encodeURIComponent(req.url)}`, 'cache-control': 'no-store' });
    return res.end();
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/admin.js') {
    return handleAdmin(req, res, session, secure).catch((err) => send(res, 500, String(err.message)));
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) return proxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  serveStatic(req, res).catch((err) => send(res, 500, String(err)));
});

server.requestTimeout = 0;   // node >=18 defaults to 5 min, which would cut long generations
server.headersTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 72_000;

server.listen(PORT, HOST, () => {
  console.log(`[llm-chat] http://${HOST}:${PORT}  ->  ${UPSTREAM.origin}`);
  console.log(`[llm-chat] static: ${WEB_DIR}`);
  console.log(`[llm-chat] api key: ${API_KEY ? 'loaded' : 'MISSING'}`);
  console.log(`[llm-chat] auth: ${AUTH_DISABLED ? '*** DÉSACTIVÉE ***' : `active (${CREDENTIAL.kind})`}`);
  console.log(`[llm-chat] trust proxy: ${TRUST_PROXY ? 'oui' : 'non'}`);
  console.log(`[llm-chat] comptes invités: ${USER_COUNT} (${USERS_FILE})`);
  console.log(`[llm-chat] smtp: ${mailerConfig() ? `${mailerConfig().host}:${mailerConfig().port}` : 'non configuré'}`);
  if (AUTH_DISABLED && HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn('[llm-chat] ATTENTION: aucune authentification et écoute sur toutes les interfaces.');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
