#!/usr/bin/env bash
# Vérifie qu'une instance locale répond correctement, y compris l'authentification.
set -uo pipefail

BASE=${BASE:-http://127.0.0.1:3000}
PASSWORD_FILE=${PASSWORD_FILE:-/etc/llm-chat/password}
TRIES=${TRIES:-15}

echo
echo "▸ Vérification de $BASE"

for i in $(seq 1 "$TRIES"); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$BASE/" || echo 000)
  [[ $code != 000 ]] && break
  sleep 1
done

fail=0
check() { # libellé attendu obtenu
  if [[ $3 == "$2" ]]; then echo "  ✓ $1 → $3"
  else echo "  ✕ $1 → $3 (attendu $2)"; fail=1; fi
}

check "app protégée (302 vers /auth/login)" 302 \
  "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/")"
check "API protégée (401)" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/health")"
check "écran de connexion (200)" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/auth/login")"
check "manifest PWA public (200)" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/manifest.webmanifest")"
check "espace admin protégé (302)" 302 \
  "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/admin")"

# En-tête de sécurité représentatif du reste.
if curl -s -I --max-time 5 "$BASE/auth/login" | grep -qi 'content-security-policy'; then
  echo "  ✓ en-tête CSP → présent"
else
  echo "  ✕ en-tête CSP → absent"; fail=1
fi

# Lien vers le modèle : informatif, jamais bloquant. Après un reboot du Mac,
# llama-server met ~2 min à charger 11 Go et répond 503 pendant ce temps.
printf '  · lien vers llama-server → '
if [[ -r $PASSWORD_FILE ]]; then
  # Le serveur applique .trim() au mot de passe, pas curl : un fichier créé
  # avec `echo` embarque un \n et l'authentification échouerait ici seulement.
  # On recopie la valeur nettoyée dans un fichier 0600 plutôt que de la passer
  # en argument, où `ps` la rendrait visible.
  sess=$(mktemp); pwfile=$(mktemp)
  chmod 600 "$sess" "$pwfile"
  trap 'rm -f "$sess" "$pwfile"' EXIT
  printf '%s' "$(tr -d '\r\n' < "$PASSWORD_FILE")" > "$pwfile"

  login=$(curl -s -c "$sess" -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" \
    --data-urlencode "password@$pwfile" --max-time 5 || echo 000)

  if [[ $login != 303 ]]; then
    echo "non testé (connexion refusée : HTTP $login — mot de passe hors $PASSWORD_FILE ?)"
  else
    up=$(curl -s -b "$sess" -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/health" || echo 000)
    case "$up" in
      200) echo "prêt" ;;
      503) echo "modèle en cours de chargement (normal après un reboot du Mac)" ;;
      *)   echo "INJOIGNABLE (HTTP $up) — vérifier Tailscale et llama-server" ;;
    esac
  fi
else
  echo "non testé (mot de passe illisible depuis ce compte)"
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "  Service en ligne et protégé."
else
  echo "  ✕ Vérifications en échec — journalctl -u llm-chat -n 50"
fi
exit $fail
