#!/usr/bin/env bash
# 在本机同时启动后端与前端，供浏览器验收（需在项目根目录或任意目录执行本脚本）
# 默认 8080：Mac 上 8000 常被「隔空播放接收器」占用，导致前端连不上后端。
set -e
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
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

# 0.0.0.0：本机 127.0.0.1 与局域网 IP 均可访问，避免用手机/局域网打开前端时仍连 127.0.0.1 失败
uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" &
BACK_PID=$!

sleep 2
if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null; then
  echo "后端健康检查: OK（本机 http://127.0.0.1:${BACKEND_PORT}/health ，局域网请用本机 IP 同端口）"
else
  echo ""
  echo "【警告】无法访问 http://127.0.0.1:${BACKEND_PORT}/health ，前端导入/比对将失败。"
  echo "  · 查看上方 uvicorn 是否报错；可改端口：BACKEND_PORT=9000 ./scripts/start-dev.sh（并设置 window.__API_ORIGIN__）"
  echo "  · 或结束占用进程后重新运行本脚本。"
  echo ""
fi

cd "$ROOT/frontend"
python3 -m http.server "$FRONTEND_PORT" --bind 0.0.0.0 &
FRONT_PID=$!

echo ""
echo "已启动（按 Ctrl+C 结束两个服务）："
echo "  前端  http://127.0.0.1:${FRONTEND_PORT}（局域网请把 127.0.0.1 换成本机 IP）"
echo "  后端  http://127.0.0.1:${BACKEND_PORT}/docs"
echo ""
wait
