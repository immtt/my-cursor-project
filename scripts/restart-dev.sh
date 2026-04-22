#!/usr/bin/env bash
# 先释放默认前后端端口，再启动与 start-dev.sh 相同的环境（适合改代码后立刻验收）
set -e
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "释放端口 ${BACKEND_PORT}（后端）、${FRONTEND_PORT}（前端）…"
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
  fi
done
sleep 1
exec "$ROOT/scripts/start-dev.sh"
