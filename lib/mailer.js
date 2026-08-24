/**
 * Client SMTP minimal : EHLO, STARTTLS, AUTH, un message texte. Rien de plus.
 *
 * Écrit à la main pour ne pas introduire de dépendance côté serveur. Ce n'est
 * pas un MTA : pas de file d'attente, pas de réessai, pas de DKIM. Il s'appuie
 * sur un relais authentifié (Gmail, Mailgun, Fastmail…) qui, lui, signe.
 *
 * Si SMTP_HOST n'est pas défini, l'envoi est simplement indisponible et
 * l'interface d'administration se rabat sur la copie manuelle du lien.
 */
import net from 'node:net';
import tls from 'node:tls';

const TIMEOUT_MS = 20_000;

export function mailerConfig() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host,
    port,
    // 465 est du TLS implicite; 587 et 25 démarrent en clair puis STARTTLS.
    implicitTls: process.env.SMTP_TLS === 'implicit' || port === 465,
    user: process.env.SMTP_USER?.trim() || null,
    pass: process.env.SMTP_PASS?.trim() || null,
    from: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || null,
    fromName: process.env.SMTP_FROM_NAME?.trim() || 'NULLNODE',
  };
}

/** Les en-têtes sont séparés par CRLF : tout CR/LF injecté forge un en-tête. */
const headerSafe = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();

/** RFC 2047 — un sujet non-ASCII passerait en octets bruts sinon. */
function encodeHeader(value) {
  const clean = headerSafe(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function buildMessage({ from, fromName, to, subject, text }) {
  const body = String(text)
    .replace(/\r?\n/g, '\r\n')
    // Dot-stuffing : une ligne réduite à "." terminerait le message.
    .replace(/^\./gm, '..');
  return [
    `From: ${encodeHeader(fromName)} <${headerSafe(from)}>`,
    `To: <${headerSafe(to)}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    'Auto-Submitted: auto-generated',
    '',
    body,
    '',
  ].join('\r\n');
}

/** Dialogue SMTP ligne à ligne, en ignorant les continuations `250-`. */
function conversation(socket) {
  let buffer = '';
  let pending = null;

  const flush = () => {
    if (!pending) return;
    let idx;
    while ((idx = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // "250-EXTENSION" annonce une suite; "250 OK" clôt la réponse.
      if (/^\d{3}-/.test(line)) continue;
      const match = /^(\d{3})[ ]?(.*)$/.exec(line);
      const { resolve, reject } = pending;
      pending = null;
      if (!match) return reject(new Error(`réponse SMTP illisible: ${line}`));
      return resolve({ code: Number(match[1]), text: match[2] });
    }
  };

  socket.on('data', (chunk) => { buffer += chunk.toString('utf8'); flush(); });

  return {
    read() {
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        flush();
      });
    },
    async send(line, expect) {
      if (line !== null) socket.write(`${line}\r\n`);
      const res = await this.read();
      if (expect && !expect.includes(res.code)) {
        const shown = line?.startsWith('AUTH') ? 'AUTH …' : line;
        throw new Error(`SMTP ${res.code} sur « ${shown ?? 'connexion'} » : ${res.text}`);
      }
      return res;
    },
    get buffered() { return buffer; },
    setSocket(next) {
      buffer = '';
      next.on('data', (chunk) => { buffer += chunk.toString('utf8'); flush(); });
      socket = next;
    },
  };
}

export async function sendMail({ to, subject, text }) {
  const cfg = mailerConfig();
  if (!cfg) throw new Error('SMTP non configuré');
  if (!cfg.from) throw new Error('SMTP_FROM manquant');

  let socket = cfg.implicitTls
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port });

  socket.setTimeout(TIMEOUT_MS);

  const done = new Promise((_, reject) => {
    socket.once('error', reject);
    socket.once('timeout', () => { socket.destroy(); reject(new Error('délai SMTP dépassé')); });
  });

  const run = async () => {
    await new Promise((resolve, reject) => {
      socket.once(cfg.implicitTls ? 'secureConnect' : 'connect', resolve);
      socket.once('error', reject);
    });

    const chat = conversation(socket);
    await chat.send(null, [220]);
    await chat.send(`EHLO ${hostname()}`, [250]);

    if (!cfg.implicitTls) {
      await chat.send('STARTTLS', [220]);
      socket = tls.connect({ socket, servername: cfg.host });
      await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
      socket.setTimeout(TIMEOUT_MS);
      chat.setSocket(socket);
      await chat.send(`EHLO ${hostname()}`, [250]);
    }

    if (cfg.user && cfg.pass) {
      // AUTH LOGIN : le plus largement accepté des relais.
      await chat.send('AUTH LOGIN', [334]);
      await chat.send(Buffer.from(cfg.user, 'utf8').toString('base64'), [334]);
      await chat.send(Buffer.from(cfg.pass, 'utf8').toString('base64'), [235]);
    }

    await chat.send(`MAIL FROM:<${headerSafe(cfg.from)}>`, [250]);
    await chat.send(`RCPT TO:<${headerSafe(to)}>`, [250, 251]);
    await chat.send('DATA', [354]);
    socket.write(buildMessage({ ...cfg, to, subject, text }));
    await chat.send('.', [250]);
    await chat.send('QUIT').catch(() => {});
  };

  try {
    await Promise.race([run(), done]);
  } finally {
    socket.destroy();
  }
}

function hostname() {
  return headerSafe(process.env.SMTP_EHLO || 'localhost') || 'localhost';
}
