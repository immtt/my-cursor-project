#!/usr/bin/env python3
"""对 sys_suggest / manual_route 按 (排线日期, 运单号) 去重并创建唯一索引。可从项目根目录执行：./scripts/dedupe_import_tables.py"""
import os
import sys

# 保证以 backend 为根导入 app
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.join(_ROOT, "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)

from app.db.import_dedupe import dedupe_import_tables_and_apply_unique
from app.db.session import engine


def main() -> None:
    stats = dedupe_import_tables_and_apply_unique(engine)
    print(stats)


if __name__ == "__main__":
    main()
