#!/usr/bin/env bash
# Mise à jour de NULLNODE : pull, rebuild, redémarrage, vérification.
#
#   sudo bash /opt/llm-chat/deploy/update.sh
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/llm-chat}
VAR_DIR=${VAR_DIR:-/var/lib/llm-chat}
SERVICE_USER=${SERVICE_USER:-llmchat}
BRANCH=${BRANCH:-claude/local-llm-chat-app-u681zj}

die() { echo "✕ $*" >&2; exit 1; }
step() { echo; echo "▸ $*"; }

[[ $EUID -eq 0 ]] || die "à lancer avec sudo"
[[ -d $APP_DIR/.git ]] || die "$APP_DIR n'est pas un clone git — lancez bootstrap.sh"

git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
PREVIOUS=$(git -C "$APP_DIR" rev-parse HEAD)

step "Récupération de $BRANCH"
git -C "$APP_DIR" fetch origin "$BRANCH"
git -C "$APP_DIR" checkout -B deploy "origin/$BRANCH"
chown -R "$SERVICE_USER": "$APP_DIR"
git -C "$APP_DIR" --no-pager log --oneline "$PREVIOUS..HEAD" | sed 's/^/  /' || true

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
[[ -f $APP_DIR/web/dist/index.html ]] || die "build absent, service laissé tel quel"

step "Unité systemd"
# Le fichier peut avoir changé avec la mise à jour.
if ! cmp -s "$APP_DIR/deploy/llm-chat.service" /etc/systemd/system/llm-chat.service; then
  install -m 644 "$APP_DIR/deploy/llm-chat.service" /etc/systemd/system/llm-chat.service
  systemctl daemon-reload
  echo "  unité mise à jour"
fi

step "Redémarrage"
systemctl restart llm-chat

if ! bash "$APP_DIR/deploy/healthcheck.sh"; then
  echo
  echo "✕ Le service ne répond pas. Retour à $PREVIOUS."
  git -C "$APP_DIR" checkout -B deploy "$PREVIOUS"
  sudo -u "$SERVICE_USER" env \
    PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" \
    HOME="$VAR_DIR" npm_config_cache="$VAR_DIR/.npm" \
    sh -c "cd '$APP_DIR/web' && npm run build" || true
  systemctl restart llm-chat
  die "rollback effectué — voir: journalctl -u llm-chat -n 50"
fi
