/**
 * Comptes invités et liens magiques.
 *
 * Un fichier JSON, pas une base : le service reste sans dépendance et le
 * volume attendu se compte en dizaines d'entrées. Écriture atomique
 * (tmp + rename) pour qu'un arrêt brutal ne laisse jamais un fichier tronqué.
 *
 * L'administrateur n'est PAS dans ce fichier : il s'authentifie avec le mot
 * de passe maître (APP_PASSWORD). Ici on ne stocke que les invités.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours pour cliquer le lien
const MAX_USERS = 200;                      // garde-fou, pas une limite produit

let FILE = null;
let state = { version: VERSION, users: [] };

export function initUserStore(file) {
  FILE = file;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (Array.isArray(parsed?.users)) state = { version: VERSION, users: parsed.users };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[users] fichier illisible (${err.code}), on repart à vide`);
    persist();
  }
  return state.users.length;
}

function persist() {
  if (!FILE) return;
  const tmp = `${FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error(`écriture impossible dans ${FILE}: ${err.message}`);
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

function timingSafeEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ lecture */

export function listUsers() {
  return state.users.map((u) => ({
    ...u,
    invite: u.invite ? { expiresAt: u.invite.expiresAt, usedAt: u.invite.usedAt } : null,
  }));
}

export function findUser(id) {
  return state.users.find((u) => u.id === id) ?? null;
}

/** Le porteur d'une session est-il toujours autorisé ? */
export function isSessionValid(payload) {
  if (payload?.role === 'admin') return true;
  const user = findUser(payload?.sub);
  if (!user || user.disabled) return false;
  // L'époque permet de révoquer d'un coup toutes les sessions d'un compte
  // sans invalider celles de tout le monde.
  return user.sessionEpoch === payload.epoch;
}

export function touch(id) {
  const user = findUser(id);
  if (!user) return;
  const now = Date.now();
  // Une écriture par requête serait absurde : on ne persiste qu'à l'heure.
  if (now - (user.lastSeenAt || 0) < 3600_000) return;
  user.lastSeenAt = now;
  persist();
}

/* ------------------------------------------------------------- modification */

export function createUser({ label, email }) {
  const clean = String(label || '').trim().slice(0, 60);
  if (!clean) throw new Error('nom vide');
  if (state.users.length >= MAX_USERS) throw new Error(`limite de ${MAX_USERS} comptes atteinte`);

  const mail = normalizeEmail(email);
  if (email && !mail) throw new Error('adresse e-mail invalide');
  if (mail && state.users.some((u) => u.email === mail)) throw new Error('cette adresse a déjà un compte');

  const user = {
    id: `usr_${crypto.randomBytes(9).toString('hex')}`,
    label: clean,
    email: mail,
    role: 'user',
    createdAt: Date.now(),
    lastSeenAt: null,
    disabled: false,
    sessionEpoch: 1,
    invite: null,
  };
  state.users.push(user);
  persist();
  return user;
}

export function deleteUser(id) {
  const before = state.users.length;
  state.users = state.users.filter((u) => u.id !== id);
  if (state.users.length === before) return false;
  persist();
  return true;
}

export function setDisabled(id, disabled) {
  const user = findUser(id);
  if (!user) return false;
  user.disabled = Boolean(disabled);
  // Couper l'accès doit fermer les sessions ouvertes, sinon désactiver ne
  // sert à rien pendant les 30 jours de validité du cookie.
  if (user.disabled) user.sessionEpoch += 1;
  persist();
  return true;
}

export function revokeSessions(id) {
  const user = findUser(id);
  if (!user) return false;
  user.sessionEpoch += 1;
  persist();
  return true;
}

/* --------------------------------------------------------- liens magiques */

/**
 * Émet un lien à usage unique. Le secret n'est jamais stocké en clair : le
 * fichier ne contient que son empreinte, donc une copie du fichier ne permet
 * pas de fabriquer un lien valide.
 */
export function issueInvite(id, ttlMs = INVITE_TTL_MS) {
  const user = findUser(id);
  if (!user) return null;
  const secret = crypto.randomBytes(32).toString('base64url');
  user.invite = {
    hash: sha256(secret).toString('hex'),
    expiresAt: Date.now() + ttlMs,
    usedAt: null,
  };
  user.disabled = false;
  persist();
  return `${user.id}.${secret}`;
}

export function revokeInvite(id) {
  const user = findUser(id);
  if (!user?.invite) return false;
  user.invite = null;
  persist();
  return true;
}

/** Consomme un jeton. Retourne le compte, ou une raison d'échec. */
export function consumeInvite(token) {
  if (typeof token !== 'string' || token.length > 200) return { error: 'invalide' };
  const dot = token.indexOf('.');
  if (dot < 0) return { error: 'invalide' };

  const user = findUser(token.slice(0, dot));
  const secret = token.slice(dot + 1);
  if (!user || !user.invite) return { error: 'invalide' };
  if (user.disabled) return { error: 'compte désactivé' };

  if (!timingSafeEqual(sha256(secret), Buffer.from(user.invite.hash, 'hex'))) {
    return { error: 'invalide' };
  }
  if (user.invite.usedAt) return { error: 'lien déjà utilisé' };
  if (Date.now() > user.invite.expiresAt) return { error: 'lien expiré' };

  user.invite.usedAt = Date.now();
  user.lastSeenAt = Date.now();
  persist();
  return { user };
}

/* ---------------------------------------------------------------- utilitaires */

export function normalizeEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  // Volontairement permissif : le seul but est d'éviter les entrées absurdes
  // et les injections d'en-tête SMTP, pas de valider la RFC 5322.
  if (v.length > 254 || /[\s,;:<>"\\]/.test(v)) return null;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(v) ? v : null;
}
