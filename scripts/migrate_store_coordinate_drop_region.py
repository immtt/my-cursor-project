#!/usr/bin/env python3
"""从 store_coordinate 删除 region 列（若存在）；MySQL 下同步列中文注释。

模型已移除 region；老库需执行本脚本一次。SQLite 3.35+ 支持 DROP COLUMN。

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
    if not insp.has_table("store_coordinate"):
        print("表 store_coordinate 不存在，跳过。")
        return

    cols = {c["name"] for c in insp.get_columns("store_coordinate")}
    dialect = engine.dialect.name

    with engine.begin() as conn:
        if "region" in cols:
            if dialect == "sqlite":
                conn.execute(text("ALTER TABLE store_coordinate DROP COLUMN region"))
            else:
                conn.execute(text("ALTER TABLE store_coordinate DROP COLUMN `region`"))
            print("已删除列 store_coordinate.region")
        else:
            print("列 store_coordinate.region 已不存在，跳过删除。")

        if dialect == "mysql":
            # 与 ORM comment= 一致，便于 DataGrip 等展示
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

            if insp.has_table("store_pair_distance"):
                conn.execute(
                    text(
                        """
                        ALTER TABLE store_pair_distance
                          MODIFY COLUMN id int NOT NULL AUTO_INCREMENT COMMENT '主键',
                          MODIFY COLUMN region varchar(80) NOT NULL COMMENT 'Excel 工作表名称（用于区分导入批次，非地理行政区划）',
                          MODIFY COLUMN store_from varchar(300) NOT NULL COMMENT '起点门店（对应表头「客户1」）',
                          MODIFY COLUMN store_to varchar(300) NOT NULL COMMENT '终点门店（对应表头「客户2」）',
                          MODIFY COLUMN distance_km double NOT NULL COMMENT '店间距离（千米）',
                          MODIFY COLUMN created_at datetime NULL COMMENT '创建时间'
                        """
                    )
                )
                print("已更新 store_pair_distance 列注释（MySQL）。")

    print("完成。DATABASE_URL:", engine.url.render_as_string(hide_password=True))


if __name__ == "__main__":
    main()
