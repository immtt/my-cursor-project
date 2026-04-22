#!/usr/bin/env python3
"""从 store_coordinate、store_pair_distance 删除 region 列（若存在）；MySQL 下调整唯一索引与列注释。

ORM 已无 region；老库需执行本脚本一次。SQLite 3.35+ 支持 DROP COLUMN。

用法：
  cd backend && ./.venv/bin/python ../scripts/migrate_store_coordinate_drop_region.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv
from sqlalchemy import inspect, text

load_dotenv(BACKEND / ".env")

from app.db.session import engine  # noqa: E402


def main() -> None:
    insp = inspect(engine)
    dialect = engine.dialect.name

    with engine.begin() as conn:
        if insp.has_table("store_coordinate"):
            cols = {c["name"] for c in insp.get_columns("store_coordinate")}
            if "region" in cols:
                if dialect == "sqlite":
                    conn.execute(text("ALTER TABLE store_coordinate DROP COLUMN region"))
                else:
                    conn.execute(text("ALTER TABLE store_coordinate DROP COLUMN `region`"))
                print("已删除列 store_coordinate.region")
            else:
                print("列 store_coordinate.region 已不存在，跳过删除。")

            if dialect == "mysql":
                conn.execute(
                    text(
                        """
                        ALTER TABLE store_coordinate
                          MODIFY COLUMN id int NOT NULL AUTO_INCREMENT COMMENT '主键',
                          MODIFY COLUMN store_name varchar(300) NOT NULL COMMENT '门店名称（唯一，与排线导入中拼载门店一致）',
                          MODIFY COLUMN longitude double NOT NULL COMMENT '经度（与 Excel 坐标列一致）',
                          MODIFY COLUMN latitude double NOT NULL COMMENT '纬度（与 Excel 坐标列一致）',
                          MODIFY COLUMN data_source varchar(120) NULL COMMENT '坐标数据来源说明（如导入文件名）',
                          MODIFY COLUMN created_at datetime NULL COMMENT '创建时间',
                          MODIFY COLUMN updated_at datetime NULL COMMENT '更新时间'
                        """
                    )
                )
                print("已更新 store_coordinate 列注释（MySQL）。")
        else:
            print("表 store_coordinate 不存在，跳过 store_coordinate。")

        if insp.has_table("store_pair_distance"):
            pair_cols = {c["name"] for c in insp.get_columns("store_pair_distance")}
            if "region" in pair_cols:
                if dialect == "mysql":
                    try:
                        conn.execute(text("ALTER TABLE store_pair_distance DROP INDEX uq_store_pair_region_from_to"))
                    except Exception as exc:
                        print("删除旧索引 uq_store_pair_region_from_to（若不存在可忽略）:", exc)
                    conn.execute(text("ALTER TABLE store_pair_distance DROP COLUMN `region`"))
                    print("已删除列 store_pair_distance.region 及旧唯一索引")
                    try:
                        conn.execute(
                            text(
                                "ALTER TABLE store_pair_distance ADD UNIQUE KEY uq_store_pair_from_to (store_from, store_to)"
                            )
                        )
                        print("已添加唯一索引 uq_store_pair_from_to (store_from, store_to)")
                    except Exception as exc:
                        print("添加 uq_store_pair_from_to 失败（可能已存在或存在重复店对）:", exc)
                else:
                    conn.execute(text("ALTER TABLE store_pair_distance DROP COLUMN region"))
                    print("已删除列 store_pair_distance.region（SQLite）；若唯一约束需调整请自行重建表。")
            else:
                print("列 store_pair_distance.region 已不存在，跳过删除。")

            if dialect == "mysql":
                conn.execute(
                    text(
                        """
                        ALTER TABLE store_pair_distance
                          MODIFY COLUMN id int NOT NULL AUTO_INCREMENT COMMENT '主键',
                          MODIFY COLUMN store_from varchar(300) NOT NULL COMMENT '起点门店（对应表头「客户1」）',
                          MODIFY COLUMN store_to varchar(300) NOT NULL COMMENT '终点门店（对应表头「客户2」）',
                          MODIFY COLUMN distance_km double NOT NULL COMMENT '仓店距离（千米）',
                          MODIFY COLUMN created_at datetime NULL COMMENT '创建时间'
                        """
                    )
                )
                print("已更新 store_pair_distance 列注释（MySQL）。")
        else:
            print("表 store_pair_distance 不存在，跳过 store_pair_distance。")

    print("完成。DATABASE_URL:", engine.url.render_as_string(hide_password=True))


if __name__ == "__main__":
    main()
