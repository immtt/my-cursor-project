# 数据字典（MVP）

## 表：sys_suggest
- `route_date`：排线日期
- `waybill_no`：系统运单号
- `route_line`：归属线路
- `warehouse_name`：始发仓库
- `stores`：拼载门店（逗号分隔）
- `volume`：配送体积
- `load_rate`：装载率
- `est_distance`：预计公里数
- `est_duration`：预计时效
- `route_polyline`：道路级路径折线（高德编码或约定 JSON），供路线地图与 `GET /api/compare/route-map/{id}` 同源；可为空
- `batch_id`：导入批次号
- `is_active`：是否生效（1/0）

## 表：manual_route
- 同 `sys_suggest` 主字段
- `est_distance`：高德补算后里程
- `est_duration`：高德补算后时效
- `route_polyline`：补算成功时写入的道路级折线，与里程时效同源
- `calc_status`：0待计算/1已计算/2失败
- `batch_id`：导入批次号
- `is_active`：是否生效（1/0）

## 表：address_cache
- `address_name`：地址名称
- `address_type`：warehouse/store
- `longitude`、`latitude`：坐标缓存

## 表：compare_result
- `id`：主键；结果明细与路线地图接口路径参数 `compare_result_id` 对应该字段
- `match_status`：full/partial/none
- `store_match_rate`：门店匹配率
- `match_score`：匹配度（0~1）
- `volume_diff`：体积差异（系统-手动）
- `line_consistent`：线路一致性（0/1）
- `est_distance_diff`：里程差异
- `est_duration_diff`：时效差异

## 表：import_audit_log
- 导入批次、类型、日期、操作人、成功失败统计

## 表：compare_run_log
- 比对批次、日期、操作人、耗时、结果数

## 表：gaode_calc_failure_log
- 失败门店、失败原因、重试次数、最后重试时间
