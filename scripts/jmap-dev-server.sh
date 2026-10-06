#!/usr/bin/env bash
# Local Stalwart server for developing and testing Calino's JMAP support.
# Rootless podman, state in a throwaway directory, bound to 127.0.0.1 only.
#
#   scripts/jmap-dev-server.sh up      start (and bootstrap on first run)
#   scripts/jmap-dev-server.sh down    stop and remove the container, keep data
#   scripts/jmap-dev-server.sh reset   stop, delete the data directory, start fresh
#   scripts/jmap-dev-server.sh env     print the connection settings
#
# Overrides: JMAP_DEV_PORT (18080), JMAP_DEV_NAME (calino-stalwart),
# JMAP_DEV_DATA (.jmap-dev-data), JMAP_DEV_USER, JMAP_DEV_PASSWORD.
# The test user's credentials are fixed, local-only values. See docs/JMAP_TESTING.md.
set -euo pipefail

PORT="${JMAP_DEV_PORT:-18080}"
NAME="${JMAP_DEV_NAME:-calino-stalwart}"
IMAGE="${JMAP_DEV_IMAGE:-docker.io/stalwartlabs/stalwart:latest}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${JMAP_DEV_DATA:-$ROOT/.jmap-dev-data}"
DOMAIN="example.org"
# Pinned password of the temporary bootstrap admin. Stalwart replaces it with a
# generated permanent admin at the end of bootstrap and returns that secret only
# once, so the script keeps it in $DATA/admin-secret (mode 600, git-ignored).
RECOVERY_PASSWORD="calino-dev-recovery"
ADMIN_SECRET_FILE="$DATA/admin-secret"
USER_NAME="${JMAP_DEV_USER:-alice}"
USER_PASSWORD="${JMAP_DEV_PASSWORD:-calino-dev-alice}"
BASE="http://127.0.0.1:$PORT"

# JMAP call as the temporary bootstrap admin or the permanent one.
jmap() { # <user> <password> <using-json-array> <methodCalls-json>
  curl -sf -u "$1:$2" -H 'Content-Type: application/json' "$BASE/jmap/" \
    -d "{\"using\":$3,\"methodCalls\":$4}"
}

wait_http() {
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$BASE/.well-known/jmap" && return 0
    sleep 1
  done
  echo "Stalwart did not answer on $BASE" >&2
  return 1
}

running() { podman container exists "$NAME" 2>/dev/null; }

up() {
  df -h "$ROOT" | tail -1
  mkdir -p "$DATA"
  if ! running; then
    podman run -d --name "$NAME" \
      -p "127.0.0.1:$PORT:8080" \
      -e "STALWART_RECOVERY_ADMIN=admin:$RECOVERY_PASSWORD" \
      -v "$DATA:/opt/stalwart:Z" "$IMAGE" >/dev/null
  else
    podman start "$NAME" >/dev/null 2>&1 || true
  fi
  wait_http

  # A fresh data directory starts in bootstrap mode; finish it once.
  if [ ! -s "$ADMIN_SECRET_FILE" ]; then
    echo "Completing Stalwart bootstrap..."
    local reply
    reply=$(jmap admin "$RECOVERY_PASSWORD" '["urn:ietf:params:jmap:core","urn:stalwart:jmap"]' \
      "[[\"x:Bootstrap/set\",{\"update\":{\"singleton\":{\"serverHostname\":\"localhost\",\"defaultDomain\":\"$DOMAIN\",\"requestTlsCertificate\":false,\"generateDkimKeys\":false}}},\"a\"]]")
    (
      umask 077
      printf '%s' "$reply" | python3 -I -c 'import json,sys
print(json.load(sys.stdin)["methodResponses"][0][1]["updated"]["singleton"]["secret"])' >"$ADMIN_SECRET_FILE"
    )
    podman restart "$NAME" >/dev/null
    wait_http
  fi
  ensure_user
  print_env
}

# Create the test user if it does not exist yet. Idempotent.
ensure_user() {
  local using='["urn:ietf:params:jmap:core","urn:stalwart:jmap"]'
  local admin="admin@$DOMAIN"
  local ADMIN_PASSWORD
  ADMIN_PASSWORD=$(<"$ADMIN_SECRET_FILE")
  local domain_id
  domain_id=$(jmap "$admin" "$ADMIN_PASSWORD" "$using" '[["x:Account/get",{"ids":null},"a"]]' |
    python3 -I -c 'import json,sys
d=json.load(sys.stdin)["methodResponses"][0][1]["list"]
print(next(a["domainId"] for a in d if a["name"]=="admin"))')
  local existing
  existing=$(jmap "$admin" "$ADMIN_PASSWORD" "$using" '[["x:Account/get",{"ids":null},"a"]]' |
    python3 -I -c 'import json,sys
n=sys.argv[1]
d=json.load(sys.stdin)["methodResponses"][0][1]["list"]
print(any(a["name"]==n for a in d))' "$USER_NAME")
  if [ "$existing" = "True" ]; then return 0; fi
  echo "Creating test user $USER_NAME@$DOMAIN..."
  jmap "$admin" "$ADMIN_PASSWORD" "$using" \
    "[[\"x:Account/set\",{\"create\":{\"u\":{\"@type\":\"User\",\"name\":\"$USER_NAME\",\"domainId\":\"$domain_id\",\"credentials\":{\"0\":{\"@type\":\"Password\",\"secret\":\"$USER_PASSWORD\"}}}}},\"a\"]]" >/dev/null
}

print_env() {
  cat <<EOF
Stalwart is up.
  server:   $BASE
  JMAP:     $BASE/.well-known/jmap
  CalDAV:   $BASE/dav/cal/
  user:     $USER_NAME@$DOMAIN
  password: $USER_PASSWORD
  admin:    admin@$DOMAIN (secret in $ADMIN_SECRET_FILE)
EOF
}

case "${1:-}" in
up) up ;;
down) podman rm -f "$NAME" >/dev/null 2>&1 || true ;;
reset)
  podman rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$DATA"
  up
  ;;
env) print_env ;;
*)
  sed -n '2,13p' "$0"
  exit 1
  ;;
esac
