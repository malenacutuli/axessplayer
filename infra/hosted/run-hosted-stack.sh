#!/usr/bin/env bash
# Bring up the four read/write plane services bound to the HOSTED mobile schema (not local Docker pg, not
# sample scenarios). Sources the gitignored hosted env (DATABASE_URL, DB_OPTIONS=search_path=mobile,public,
# ECONOMY_SERVICE_SECRET) and starts each service on the port the consumer/Studio vite proxies expect.
# Logs to /tmp/axp-hosted-*.log. Secrets are never echoed. No em dashes.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
ENV_FILE="infra/hosted/.env.hosted"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${DATABASE_URL:?}"; : "${DB_OPTIONS:?}"; : "${ECONOMY_SERVICE_SECRET:?}"
export NODE_ENV=development

start() { # name port relpath
  local name="$1" port="$2" path="$3"
  local pid; pid="$(lsof -ti tcp:"$port" 2>/dev/null | head -1 || true)"
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; sleep 0.5; fi
  PORT="$port" HOST=127.0.0.1 nohup node --import tsx "$path" >"/tmp/axp-hosted-$name.log" 2>&1 &
  echo "  $name -> :$port (pid $!)"
}

echo "Starting hosted-bound stack (mobile schema):"
start content  8093 services/content/src/serve.ts
start economy  8091 services/economy/src/serve.ts
start decision 8092 services/decision/src/serve.ts
start manifest 8094 services/manifest/src/serve.ts
sleep 2
echo "Health:"
for p in 8091 8092 8093 8094; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/healthz" 2>/dev/null || echo 000)"
  echo "  :$p /healthz -> $code"
done
