"""开发环境：在 ASGI 层为所有 HTTP 响应补上 CORS 头，避免 POST/上传等场景下浏览器误报无 ACAO。"""


class DevCorsASGIMiddleware:
    """比 CORSMiddleware 更靠外：拦截 OPTIONS，并在任意 http.response.start 上 setdefault ACAO。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if scope["method"] == "OPTIONS":
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [
                        (b"access-control-allow-origin", b"*"),
                        (
                            b"access-control-allow-methods",
                            b"DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT",
                        ),
                        (b"access-control-allow-headers", b"*"),
                        (b"access-control-max-age", b"600"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return

        async def send_with_cors(message):
            if message["type"] == "http.response.start":
                hdrs = list(message.get("headers") or [])
                keys = {h[0].lower() for h in hdrs}
                if b"access-control-allow-origin" not in keys:
                    hdrs.append((b"access-control-allow-origin", b"*"))
                if b"access-control-allow-methods" not in keys:
                    hdrs.append(
                        (
                            b"access-control-allow-methods",
                            b"DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT",
                        )
                    )
                if b"access-control-allow-headers" not in keys:
                    hdrs.append((b"access-control-allow-headers", b"*"))
                message = {**message, "headers": hdrs}
            await send(message)

        await self.app(scope, receive, send_with_cors)
