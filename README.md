# llm-chat

Interface de chat pour un `llama-server` local, servie sur le LAN.
React + Vite en front, un proxy Node sans dépendance en back.

Pensée autour de la contrainte réelle du poste : **~5,8 tok/s en génération**.
Tout ce qui compte (streaming, Stop, compteurs live, garde-fous de contexte)
existe parce qu'une réponse de 1000 tokens prend trois minutes.

```
server.js                       proxy + fichiers statiques, 0 dépendance
web/                            front Vite + React + Tailwind -> web/dist
launchd/com.yohan.llmchat.plist LaunchAgent prêt à l'emploi
```

## Prérequis

- Node ≥ 20 sur le Mac (`brew install node`)
- `llama-server` qui écoute déjà sur `127.0.0.1:8080`
- La clé API dans `~/.qwen38-api-key`

## Installation

```bash
git clone <ce-repo> ~/llm-chat
cd ~/llm-chat
npm run setup          # installe les deps du front + build web/dist
npm start              # http://<ip-du-mac>:3000
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

## Endpoints

| Front            | Upstream                | |
|------------------|-------------------------|---|
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
- Pas d'authentification : n'exposez pas le port 3000 hors du LAN.
