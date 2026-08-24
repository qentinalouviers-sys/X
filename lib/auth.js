/**
 * Authentification : mot de passe maître (administrateur) ou lien magique
 * (invités) -> cookie de session signé.
 *
 * Sans dépendance. Le modèle de menace : ce service est joignable depuis
 * Internet et seules les personnes invitées doivent pouvoir s'en servir.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days: no re-login on the iPhone
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

/* ------------------------------------------------------------ credentials */

export function loadPassword() {
  const hash = process.env.APP_PASSWORD_HASH?.trim();
  if (hash) return { kind: 'scrypt', value: hash };

  const plain =
    process.env.APP_PASSWORD?.trim() ||
    readFileQuiet(process.env.APP_PASSWORD_FILE || path.join(os.homedir(), '.llm-chat-password'));

  if (plain) return { kind: 'plain', value: plain };
  return null;
}

function readFileQuiet(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** `scrypt$<salt-hex>$<key-hex>` — what `npm run hash-password` prints. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(candidate, credential) {
  if (!credential || typeof candidate !== 'string' || !candidate) return false;

  if (credential.kind === 'scrypt') {
    const [, saltHex, keyHex] = credential.value.split('$');
    if (!saltHex || !keyHex) return false;
    let derived;
    try {
      derived = crypto.scryptSync(candidate, Buffer.from(saltHex, 'hex'), 32);
    } catch {
      return false;
    }
    return timingSafeEqual(derived, Buffer.from(keyHex, 'hex'));
  }

  // Digest both sides first so timingSafeEqual never sees mismatched lengths
  // (which would leak the password length through an exception).
  return timingSafeEqual(sha256(candidate), sha256(credential.value));
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

function timingSafeEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* --------------------------------------------------------------- sessions */

/** Persisted so that a server restart does not log every device out. */
export function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return Buffer.from(process.env.SESSION_SECRET, 'utf8');

  const file = process.env.SESSION_SECRET_FILE || path.join(os.homedir(), '.llm-chat-session-secret');
  const existing = readFileQuiet(file);
  if (existing) return Buffer.from(existing, 'hex');

  const secret = crypto.randomBytes(32);
  try {
    fs.writeFileSync(file, secret.toString('hex'), { mode: 0o600 });
  } catch (err) {
    console.warn(`[warn] session secret not persisted (${err.code}): sessions reset on restart`);
  }
  return secret;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * @param claims {sub, role, epoch} — qui porte la session. `epoch` suit celle
 * du compte, ce qui permet de révoquer les sessions d'un invité sans toucher
 * au secret global ni déconnecter les autres.
 */
export function issueSession(secret, claims = {}) {
  const payload = b64(JSON.stringify({
    sub: claims.sub ?? 'admin',
    role: claims.role ?? 'admin',
    epoch: claims.epoch ?? 0,
    exp: Date.now() + SESSION_TTL_MS,
  }));
  const sig = b64(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Retourne les revendications signées, ou null. Ne dit rien de l'état du
 *  compte : c'est au magasin d'utilisateurs de trancher (voir isSessionValid). */
export function verifySession(token, secret) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  if (!timingSafeEqual(Buffer.from(sig, 'base64url'), expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- cookies */

export function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function sessionCookie(token, secure) {
  const attrs = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearCookie(secure) {
  const attrs = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export const COOKIE_NAME = COOKIE;

/* ---------------------------------------------------- brute-force limiter */

const attempts = new Map();

export function loginBlocked(ip) {
  const entry = attempts.get(ip);
  if (!entry) return 0;
  const remaining = entry.until - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function recordFailure(ip) {
  const entry = attempts.get(ip) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    // Exponential: 1 min, 2, 4, 8... capped at an hour.
    const factor = Math.min(2 ** (entry.count - MAX_ATTEMPTS), 60);
    entry.until = Date.now() + LOCKOUT_MS * factor;
  }
  attempts.set(ip, entry);
}

export function recordSuccess(ip) {
  attempts.delete(ip);
}
