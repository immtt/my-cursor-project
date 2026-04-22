#!/usr/bin/env python3
"""
将本地数据库表结构与代码中的 ORM 对齐。

1) MySQL：若 `DATABASE_URL` 中的库不存在，则先 `CREATE DATABASE`（utf8mb4），再 create_all。
2) 所有库：执行 SQLAlchemy create_all（只建缺失的表）。

读取 backend/.env 中的 DATABASE_URL。

说明：create_all 不会给已有表加新列（SQLite 另有 ensure_sqlite_schema 补 vehicle_type）。
MySQL 表结构过旧时需自行 ALTER 或删表/删库后重跑本脚本。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(BACKEND / ".env")

raw_url = os.getenv("DATABASE_URL", "sqlite:///./smart_route.db")
from sqlalchemy.engine.url import URL, make_url

url = make_url(raw_url)

if url.drivername.startswith("mysql") and url.database:
    server_url = URL.create(
        drivername=url.drivername,
        username=url.username,
        password=url.password,
        host=url.host,
        port=url.port or 3306,
        query=url.query,
    )
    server_engine = create_engine(server_url)
    with server_engine.connect() as conn:
        conn.execute(
            text(
                f"CREATE DATABASE IF NOT EXISTS `{url.database}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        )
        conn.commit()
    server_engine.dispose()

import app.models.entities  # noqa: F401  — 注册 ORM
from app.db.session import Base, engine, ensure_sqlite_schema


def main() -> None:
    safe = engine.url.render_as_string(hide_password=True)
    print("连接:", safe)
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_schema()
    print("完成：库已就绪，表结构与当前模型一致（仅创建缺失表）。")


if __name__ == "__main__":
    main()
