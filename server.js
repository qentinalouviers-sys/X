#!/usr/bin/env node
/**
 * Static file server + transparent streaming proxy to a local llama-server.
 *
 *   GET  /              -> web/dist (SPA fallback on index.html)
 *   ANY  /api/<path>    -> <UPSTREAM>/<path>, with Authorization injected server-side
 *
 * Zero runtime dependencies on purpose: the whole thing is node:http.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const UPSTREAM = new URL(process.env.LLM_UPSTREAM || 'http://127.0.0.1:8080');
const WEB_DIR = path.resolve(__dirname, process.env.WEB_DIR || 'web/dist');
const API_KEY = resolveApiKey();

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

/* ------------------------------------------------------------------ proxy */

// Hop-by-hop headers must not be forwarded. `accept-encoding` is dropped on
// purpose: a gzip stream would be buffered by the compressor and kill SSE.
const STRIP_REQUEST_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'authorization', 'accept-encoding',
  'content-length',
]);

function proxy(req, res) {
  const upstreamPath = req.url.slice('/api'.length) || '/';
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
      // Belt and braces against any intermediary buffering the SSE body.
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
    res.writeHead(offline ? 502 : 500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: err.code || 'proxy_error', message: err.message, upstream: UPSTREAM.origin } }));
  });

  // The browser aborting (Stop button, tab closed, wifi drop) must free the
  // llama-server slot immediately -- it runs with --parallel 1.
  const abort = () => { if (!upstreamReq.destroyed) upstreamReq.destroy(); };
  res.on('close', () => { if (!res.writableFinished) abort(); });
  req.on('aborted', abort);

  req.pipe(upstreamReq);
}

/* ----------------------------------------------------------------- static */

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
    // SPA fallback
    filePath = path.join(WEB_DIR, 'index.html');
    stat = await fsp.stat(filePath).catch(() => null);
    if (!stat) {
      return send(res, 404, `Build introuvable (${WEB_DIR}). Lancez: npm run setup`);
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const immutable = urlPath.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/* ----------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  req.socket.setNoDelay(true);
  res.setTimeout(0);

  if (req.url === '/api' || req.url.startsWith('/api/')) return proxy(req, res);
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
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
