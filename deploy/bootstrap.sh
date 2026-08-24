#!/usr/bin/env bash
# Première installation de NULLNODE sur le VPS. Idempotent : relançable.
#
#   sudo bash deploy/bootstrap.sh
#
# Ne touche pas à nginx : la config est dans deploy/nginx.conf.example, à
# installer une fois et à recharger à la main.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/llm-chat}
ETC_DIR=${ETC_DIR:-/etc/llm-chat}
VAR_DIR=${VAR_DIR:-/var/lib/llm-chat}
SERVICE_USER=${SERVICE_USER:-llmchat}
REPO=${REPO:-https://github.com/qentinalouviers-sys/X}
BRANCH=${BRANCH:-main}

die() { echo "✕ $*" >&2; exit 1; }
step() { echo; echo "▸ $*"; }

[[ $EUID -eq 0 ]] || die "à lancer avec sudo"
command -v node >/dev/null || die "node absent (apt install nodejs / nvm)"
command -v git  >/dev/null || die "git absent"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
(( NODE_MAJOR >= 20 )) || die "node >= 20 requis (trouvé $(node -v))"

step "Utilisateur de service"
id -u "$SERVICE_USER" &>/dev/null || useradd -r -s /usr/sbin/nologin "$SERVICE_USER"

step "Répertoires"
mkdir -p "$APP_DIR" "$ETC_DIR" "$VAR_DIR"
# Le service écrit son secret de session dans VAR_DIR.
chown "$SERVICE_USER": "$VAR_DIR"
# ETC_DIR reste à root, mais le groupe du service doit pouvoir le traverser,
# sinon le service ne lit aucun secret et refuse de démarrer.
chown "root:$SERVICE_USER" "$ETC_DIR"
chmod 750 "$ETC_DIR"

step "Code source"
# git refuse d'opérer en root sur un dépôt appartenant à quelqu'un d'autre.
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [[ -d $APP_DIR/.git ]]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout -B deploy "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
# Le build tourne sous le compte de service, donc il lui faut le répertoire.
# Sans risque à l'exécution : ProtectSystem=strict remonte tout en lecture
# seule pour le service, ReadWritePaths mis à part.
chown -R "$SERVICE_USER": "$APP_DIR"

step "Secrets"
# Saisis à la main, jamais en argument : l'historique du shell les garderait.
if [[ ! -s $ETC_DIR/api-key ]]; then
  read -rsp "  Clé API de llama-server : " key; echo
  [[ -n $key ]] || die "clé vide"
  printf '%s' "$key" > "$ETC_DIR/api-key"
fi
if [[ ! -s $ETC_DIR/password ]]; then
  read -rsp "  Mot de passe d'accès à l'app : " pw; echo
  read -rsp "  Confirmer : " pw2; echo
  [[ -n $pw && $pw == "$pw2" ]] || die "mots de passe vides ou différents"
  (( ${#pw} >= 12 )) || echo "  ⚠ moins de 12 caractères sur un service exposé à Internet"
  printf '%s' "$pw" > "$ETC_DIR/password"
fi
# Lisibles par le service, modifiables par root seul.
chown "root:$SERVICE_USER" "$ETC_DIR"/api-key "$ETC_DIR"/password
chmod 640 "$ETC_DIR"/api-key "$ETC_DIR"/password

step "Build du front"
# Deux pièges ici :
#  - `npm --prefix <dir> ci` résout le lockfile depuis le répertoire courant
#    et non depuis --prefix, d'où le cd explicite ;
#  - sudo réinitialise le PATH (secure_path), donc le compte de service
#    prendrait un autre node que celui vérifié plus haut — fatal avec nvm.
NODE_BIN=$(dirname "$(command -v node)")
sudo -u "$SERVICE_USER" env \
  PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" \
  HOME="$VAR_DIR" npm_config_cache="$VAR_DIR/.npm" \
  sh -c "cd '$APP_DIR/web' && npm ci --no-audit --no-fund && npm run build"
[[ -f $APP_DIR/web/dist/index.html ]] || die "build absent"

step "Service systemd"
install -m 644 "$APP_DIR/deploy/llm-chat.service" /etc/systemd/system/llm-chat.service
systemctl daemon-reload
systemctl enable --now llm-chat

bash "$APP_DIR/deploy/healthcheck.sh"

cat <<TXT

  Installation terminée.

  Il reste à faire une fois, à la main :
    1. cp $APP_DIR/deploy/nginx.conf.example /etc/nginx/sites-available/x.eviatek.fr
       ln -s /etc/nginx/sites-available/x.eviatek.fr /etc/nginx/sites-enabled/
       nginx -t && systemctl reload nginx
    2. Vérifier que le port 3000 n'est PAS joignable publiquement :
       ss -lntp | grep 3000     # doit afficher 127.0.0.1:3000

  Mises à jour ultérieures : sudo bash $APP_DIR/deploy/update.sh
TXT
