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

sleep 2
if curl -sf "http://127.0.0.1:8000/health" >/dev/null; then
  echo "后端健康检查: OK（http://127.0.0.1:8000/health）"
else
  echo ""
  echo "【警告】无法访问 http://127.0.0.1:8000/health ，前端导入/比对将失败。"
  echo "  · 查看上方 uvicorn 是否报错；"
  echo "  · Mac 常见：端口 8000 被「隔空播放接收器」占用 → 系统设置 → 通用 → 隔空播放与接力 → 关闭；"
  echo "  · 或结束占用进程后重新运行本脚本。"
  echo ""
fi

cd "$ROOT/frontend"
python3 -m http.server 5173 --bind 127.0.0.1 &
FRONT_PID=$!

echo ""
echo "已启动（按 Ctrl+C 结束两个服务）："
echo "  前端  http://127.0.0.1:5173"
echo "  后端  http://127.0.0.1:8000/docs"
echo ""
wait
