/**
 * Espace d'administration : création de comptes et liens magiques.
 *
 * Rendu côté serveur, formulaires HTML natifs, aucun script inline — la CSP
 * les interdit, et cette page doit rester utilisable même si le bundle du
 * chat est cassé. Le seul JavaScript est /admin.js, purement décoratif
 * (bouton copier) : tout fonctionne sans lui.
 */
import { mailerConfig, sendMail } from './mailer.js';
import {
  createUser, deleteUser, issueInvite, listUsers, revokeInvite, revokeSessions, setDisabled,
} from './users.js';

/* Le lien émis n'est jamais mis en query string : il finirait dans les logs
   du reverse proxy et l'historique du navigateur. On le garde en mémoire le
   temps d'un affichage. */
let lastIssued = null;
const ISSUED_TTL_MS = 5 * 60 * 1000;

const MESSAGES = {
  created: ['ok', 'Compte créé, lien émis ci-dessous.'],
  created_sent: ['ok', 'Compte créé, lien envoyé par e-mail.'],
  issued: ['ok', 'Nouveau lien émis.'],
  issued_sent: ['ok', 'Nouveau lien émis et envoyé par e-mail.'],
  deleted: ['ok', 'Compte supprimé.'],
  disabled: ['ok', 'Compte désactivé, ses sessions sont fermées.'],
  enabled: ['ok', 'Compte réactivé.'],
  revoked: ['ok', 'Sessions fermées.'],
  link_revoked: ['ok', 'Lien annulé.'],
  mail_failed: ['warn', "Compte à jour, mais l'envoi e-mail a échoué. Copiez le lien ci-dessous."],
  no_email: ['warn', "Aucune adresse e-mail sur ce compte : copiez le lien ci-dessous."],
  no_smtp: ['warn', "SMTP non configuré : copiez le lien ci-dessous."],
  bad_input: ['err', 'Saisie refusée.'],
  not_found: ['err', 'Compte introuvable.'],
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const when = (ts) =>
  ts ? new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function inviteState(user) {
  if (!user.invite) return ['none', 'aucun lien'];
  if (user.invite.usedAt) return ['used', `activé le ${when(user.invite.usedAt)}`];
  if (Date.now() > user.invite.expiresAt) return ['stale', 'lien expiré'];
  return ['live', `lien valide jusqu'au ${when(user.invite.expiresAt)}`];
}

/* ------------------------------------------------------------------ rendu */

export function renderAdmin({ message, baseUrl, smtpReady }) {
  const users = listUsers();
  const flash = MESSAGES[message];

  if (lastIssued && Date.now() - lastIssued.at > ISSUED_TTL_MS) lastIssued = null;

  const rows = users.length
    ? users.map((u) => {
        const [state, label] = inviteState(u);
        return `
    <tr class="${u.disabled ? 'off' : ''}">
      <td>
        <span class="who">${esc(u.label)}</span>
        ${u.disabled ? '<span class="tag off">désactivé</span>' : ''}
        <span class="sub">${u.email ? esc(u.email) : '<i>sans e-mail</i>'}</span>
      </td>
      <td><span class="tag ${state}">${esc(label)}</span></td>
      <td class="num">${esc(when(u.lastSeenAt))}</td>
      <td class="act">
        ${form(u.id, 'invite', 'nouveau lien')}
        ${u.invite && !u.invite.usedAt ? form(u.id, 'revoke-link', 'annuler le lien') : ''}
        ${form(u.id, 'revoke', 'fermer les sessions')}
        ${form(u.id, u.disabled ? 'enable' : 'disable', u.disabled ? 'réactiver' : 'désactiver')}
        ${form(u.id, 'delete', 'supprimer', 'Supprimer définitivement ce compte ?')}
      </td>
    </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">Aucun compte invité.</td></tr>';

  const issuedBlock = lastIssued
    ? `
  <section class="box issued">
    <div class="bar"><span class="brand">// LIEN POUR ${esc(lastIssued.label.toUpperCase())}</span></div>
    <div class="body">
      <p class="hint">Usage unique, valable 7 jours. Visible ici 5 minutes puis effacé —
        seule son empreinte est conservée, il ne peut pas être réaffiché.</p>
      <div class="copy">
        <input id="magic" type="text" readonly value="${esc(lastIssued.link)}">
        <button type="button" id="copy" data-target="magic">copier</button>
      </div>
    </div>
  </section>`
    : '';

  return TEMPLATE
    .replace('<!--FLASH-->', flash ? `<p class="flash ${flash[0]}">${esc(flash[1])}</p>` : '')
    .replace('<!--ISSUED-->', issuedBlock)
    .replace('<!--ROWS-->', rows)
    .replace('<!--COUNT-->', String(users.length))
    .replace(/<!--SMTP-->/g, smtpReady
      ? '<span class="tag live">SMTP prêt</span>'
      : '<span class="tag stale">SMTP non configuré — les liens se copient à la main</span>')
    .replace('<!--SENDBOX-->', smtpReady
      ? '<label class="check"><input type="checkbox" name="send" value="1" checked> envoyer le lien par e-mail</label>'
      : '')
    .replace('<!--BASE-->', esc(baseUrl));
}

const form = (id, op, label, confirm) => `
        <form method="POST" action="/admin/action">
          <input type="hidden" name="op" value="${op}">
          <input type="hidden" name="id" value="${esc(id)}">
          <button type="submit"${confirm ? ` data-confirm="${esc(confirm)}"` : ''} class="${op === 'delete' ? 'danger' : ''}">${label}</button>
        </form>`;

/* ------------------------------------------------------------------ actions */

/** @returns {Promise<string>} le code de message à afficher après redirection */
export async function handleAdminAction(form, baseUrl) {
  const op = String(form.get('op') || '');

  if (op === 'create') {
    let user;
    try {
      user = createUser({ label: form.get('label'), email: form.get('email') });
    } catch {
      return 'bad_input';
    }
    return deliver(user.id, form.get('send') === '1', baseUrl, 'created');
  }

  const id = String(form.get('id') || '');
  switch (op) {
    case 'invite':      return deliver(id, form.get('send') === '1', baseUrl, 'issued');
    case 'revoke-link': return revokeInvite(id) ? 'link_revoked' : 'not_found';
    case 'revoke':      return revokeSessions(id) ? 'revoked' : 'not_found';
    case 'disable':     return setDisabled(id, true) ? 'disabled' : 'not_found';
    case 'enable':      return setDisabled(id, false) ? 'enabled' : 'not_found';
    case 'delete':
      if (lastIssued?.id === id) lastIssued = null;
      return deleteUser(id) ? 'deleted' : 'not_found';
    default:            return 'bad_input';
  }
}

/** Émet un lien, l'expose à l'écran, et tente l'envoi si demandé. */
async function deliver(id, wantsMail, baseUrl, okCode) {
  const token = issueInvite(id);
  if (!token) return 'not_found';

  const user = listUsers().find((u) => u.id === id);
  const link = `${baseUrl}/auth/magic?t=${encodeURIComponent(token)}`;
  lastIssued = { id, label: user.label, link, at: Date.now() };

  if (!wantsMail) return okCode;
  if (!user.email) return 'no_email';
  if (!mailerConfig()) return 'no_smtp';

  try {
    await sendMail({
      to: user.email,
      subject: 'Votre accès à NULLNODE',
      text: [
        `Bonjour ${user.label},`,
        '',
        'Voici votre lien d\'accès. Il fonctionne une seule fois et expire dans 7 jours :',
        '',
        link,
        '',
        "Une fois ouvert, l'accès reste actif 30 jours sur cet appareil.",
        'Si vous n\'avez rien demandé, ignorez ce message : le lien restera inutilisé.',
        '',
      ].join('\n'),
    });
    // On efface le lien de l'écran : il est parti par e-mail, l'afficher en
    // plus ne ferait qu'élargir sa surface d'exposition.
    lastIssued = null;
    return `${okCode}_sent`;
  } catch (err) {
    console.warn(`[admin] envoi e-mail échoué pour ${user.email}: ${err.message}`);
    return 'mail_failed';
  }
}

export const ADMIN_CLIENT_JS = `/* Purement décoratif : la page fonctionne sans. */
document.addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) { e.preventDefault(); return; }
  if (btn.id !== 'copy') return;
  var input = document.getElementById(btn.dataset.target);
  if (!input) return;
  input.select();
  var done = function () { btn.textContent = 'copié'; setTimeout(function () { btn.textContent = 'copier'; }, 1500); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(input.value).then(done, function(){});
  else { try { document.execCommand('copy'); done(); } catch (_) {} }
});
`;

const TEMPLATE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#04070a">
<title>NULLNODE // ADMIN</title>
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<style>
:root{
  color-scheme:dark;
  --void:#04070a;--pit:#070b10;--panel:#0a1017;--raise:#0e1620;--line:#17242f;
  --fg:#b9cec6;--dim:#63796f;--faint:#35473f;
  --acc:#22e07a;--acc2:#2ad4ff;--warn:#ffb340;--danger:#ff3b58;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{
  margin:0;min-height:100dvh;padding:1.2rem .8rem 3rem;
  background:var(--void);color:var(--fg);font:13px/1.6 var(--mono);
  background-image:linear-gradient(rgba(34,224,122,.022) 1px,transparent 1px),
    linear-gradient(90deg,rgba(34,224,122,.022) 1px,transparent 1px);
  background-size:34px 34px;
}
body::after{content:"";position:fixed;inset:0;z-index:9;pointer-events:none;mix-blend-mode:multiply;
  background:repeating-linear-gradient(to bottom,transparent 0 2px,rgba(0,0,0,.2) 3px 4px),
    radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.6) 100%)}
main{max-width:64rem;margin:0 auto;position:relative;z-index:1}
a{color:var(--acc2)}
.box{border:1px solid var(--line);background:var(--panel);margin-bottom:1rem;position:relative}
.box::before,.box::after{content:"";position:absolute;width:12px;height:12px;border-color:var(--acc);opacity:.55}
.box::before{top:-1px;left:-1px;border-top:1px solid;border-left:1px solid}
.box::after{bottom:-1px;right:-1px;border-bottom:1px solid;border-right:1px solid}
.bar{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:.55rem .8rem}
.brand{color:var(--acc);letter-spacing:.2em;font-size:11px;text-shadow:0 0 10px currentColor}
.bar .right{margin-left:auto;display:flex;gap:.8rem;align-items:center}
.body{padding:.9rem .8rem}
.hint{margin:0 0 .8rem;font-size:11px;color:var(--faint);line-height:1.7}
.flash{margin:0 0 1rem;padding:.55rem .75rem;font-size:11.5px;border:1px solid}
.flash.ok{color:var(--acc);border-color:rgba(34,224,122,.35);background:rgba(34,224,122,.07)}
.flash.warn{color:var(--warn);border-color:rgba(255,179,64,.35);background:rgba(255,179,64,.07)}
.flash.err{color:var(--danger);border-color:rgba(255,59,88,.35);background:rgba(255,59,88,.07)}
label.f{display:block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin-bottom:.35rem}
input[type=text],input[type=email]{
  width:100%;padding:.55rem .6rem;font:15px var(--mono);color:var(--fg);
  background:var(--void);border:1px solid var(--line);outline:none}
input:focus{border-color:rgba(34,224,122,.55)}
.grid{display:grid;gap:.8rem;grid-template-columns:1fr}
@media(min-width:38rem){.grid{grid-template-columns:1fr 1fr auto;align-items:end}}
button{
  font:11px var(--mono);letter-spacing:.12em;text-transform:uppercase;cursor:pointer;
  padding:.5rem .7rem;color:var(--fg);background:var(--raise);border:1px solid var(--line);
  transition:border-color .12s,color .12s}
button:hover{border-color:var(--acc);color:var(--acc)}
button.primary{color:var(--acc);border-color:rgba(34,224,122,.45);background:rgba(34,224,122,.08)}
button.danger:hover{border-color:var(--danger);color:var(--danger)}
.check{display:flex;align-items:center;gap:.4rem;font-size:11px;color:var(--dim);margin-top:.7rem}
table{width:100%;border-collapse:collapse}
th{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);text-align:left;
  padding:.45rem .6rem;border-bottom:1px solid var(--line);font-weight:400;white-space:nowrap}
td{padding:.6rem;border-bottom:1px solid var(--line);vertical-align:top}
tr.off .who{color:var(--faint);text-decoration:line-through}
.who{display:block;color:var(--fg)}
.sub{display:block;font-size:11px;color:var(--faint);margin-top:.15rem}
.num{font-size:11px;color:var(--dim);white-space:nowrap}
.empty{color:var(--faint);text-align:center;padding:1.6rem}
.tag{display:inline-block;font-size:10px;letter-spacing:.1em;padding:.1rem .4rem;border:1px solid;margin-right:.3rem}
.tag.live{color:var(--acc);border-color:rgba(34,224,122,.35)}
.tag.used{color:var(--dim);border-color:var(--line)}
.tag.stale,.tag.none{color:var(--warn);border-color:rgba(255,179,64,.3)}
.tag.off{color:var(--danger);border-color:rgba(255,59,88,.3)}
.act{display:flex;flex-wrap:wrap;gap:.3rem}
.act form{margin:0}
.act button{padding:.3rem .5rem;font-size:10px;letter-spacing:.06em}
.copy{display:flex;gap:.4rem}
.copy input{font-size:12px;color:var(--acc)}
.issued{border-color:rgba(34,224,122,.4)}
.foot{font-size:10px;letter-spacing:.12em;color:var(--faint);text-align:center;margin-top:1.4rem}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
</head>
<body>
<main>
  <div class="bar" style="border:0;padding-left:0">
    <span class="brand">NULLNODE // ADMIN</span>
    <span class="right">
      <!--SMTP-->
      <a href="/">← terminal</a>
    </span>
  </div>

  <!--FLASH-->
  <!--ISSUED-->

  <section class="box">
    <div class="bar"><span class="brand">// NOUVEAU COMPTE</span></div>
    <div class="body">
      <p class="hint">
        Un compte invité n'a pas de mot de passe : l'accès se fait par lien magique, à usage
        unique et valable 7 jours. Une fois ouvert, la session dure 30 jours sur l'appareil utilisé.
      </p>
      <form method="POST" action="/admin/action">
        <input type="hidden" name="op" value="create">
        <div class="grid">
          <div><label class="f" for="label">Nom</label>
            <input id="label" name="label" type="text" required maxlength="60" autocomplete="off" placeholder="Alice"></div>
          <div><label class="f" for="email">E-mail (optionnel)</label>
            <input id="email" name="email" type="email" maxlength="254" autocomplete="off" placeholder="alice@exemple.fr"></div>
          <div><button class="primary" type="submit">Créer et émettre un lien</button></div>
        </div>
        <!--SENDBOX-->
      </form>
    </div>
  </section>

  <section class="box">
    <div class="bar">
      <span class="brand">// COMPTES</span>
      <span class="right"><span class="tag used"><!--COUNT--> invité(s)</span></span>
    </div>
    <table>
      <thead><tr><th>Compte</th><th>Accès</th><th>Vu le</th><th>Actions</th></tr></thead>
      <tbody><!--ROWS--></tbody>
    </table>
  </section>

  <p class="foot">SEUL L'ADMINISTRATEUR ACCÈDE À CETTE PAGE · <!--BASE--></p>
</main>
<script src="/admin.js"></script>
</body>
</html>`;
