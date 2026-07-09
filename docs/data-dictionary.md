# 数据字典（MVP）

## 表：sys_suggest
- `route_date`：排线日期
- `waybill_no`：系统运单号
- `route_line`：归属线路
- `warehouse_name`：始发仓库
- `stores`：拼载门店（逗号分隔）
- `volume`：配送体积
- `load_rate`：装载率
- `est_distance`：预计公里数（可为空）
- `est_duration`：预计时效（可为空）

## 表：manual_route
- 同 `sys_suggest` 主字段
- `est_distance`：高德补算后里程
- `est_duration`：高德补算后时效
- `calc_status`：0待计算/1已计算/2失败

## 表：address_cache
- `address_name`：地址名称
- `address_type`：warehouse/store
- `longitude`、`latitude`：坐标缓存

## 表：compare_result
- `match_status`：full/partial/none
- `store_match_rate`：门店匹配率
- `volume_diff_rate`：体积差异率
- `line_consistent`：线路一致性（0/1）
- `est_distance_diff`：里程差异
- `est_duration_diff`：时效差异
