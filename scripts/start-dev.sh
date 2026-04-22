#!/usr/bin/env bash
# 在本机同时启动后端与前端，供浏览器验收（需在项目根目录或任意目录执行本脚本）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck source=/dev/null
source .venv/bin/activate
pip install -q -r requirements.txt

cleanup() {
  kill "${BACK_PID:-0}" "${FRONT_PID:-0}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACK_PID=$!

cd "$ROOT/frontend"
python3 -m http.server 5173 --bind 127.0.0.1 &
FRONT_PID=$!

echo ""
echo "已启动（按 Ctrl+C 结束两个服务）："
echo "  前端  http://127.0.0.1:5173"
echo "  后端  http://127.0.0.1:8000/docs"
echo ""
wait
