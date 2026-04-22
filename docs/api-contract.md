# 智能排线 API 契约（MVP）

## 错误码

- `BAD_REQUEST`：参数错误
- `NOT_FOUND`：资源不存在（如无效的 `compare_result_id`）
- `IMPORT_VALIDATION_FAILED`：导入校验失败
- `GAODE_CALC_FAILED`：高德补算失败
- `COMPARE_EXECUTE_FAILED`：比对执行失败

## 接口列表

### 1) 导入数据

- `POST /api/import/{dataset_type}`
- `dataset_type`: `system` | `manual`
- `multipart/form-data`: `file`
- Header: `x-operator`（可选，默认 system）

**标准模板下载**（与导入列一致，含「导入数据」「填写说明」两个工作表）：

- `GET /api/import-template?dataset_type=system|manual`
- 必填列含：**车辆类型**（如 4.2米标箱 / 4.2米高栏）；系统建议另含预计公里数、预计时效。

返回：

```json
{
  "batch_id": "a1b2c3d4e5f6",
  "total_rows": 100,
  "success_rows": 96,
  "failed_rows": 4,
  "errors": [{"row": 8, "reason": "配送体积不能为负数"}],
  "same_day_deactivated": 3
}
```

**去重与当日快照**：同一 `dataset_type` 下，以 **`route_date` + 运单号（`waybill_no`）** 为业务键；已存在则 **更新** 该行（`batch_id` / `import_operator` / `imported_at` 随本次导入刷新），不存在则 **新增**。**导入成功且本批有有效行时**，对**本次成功解析到的各排线日期**分别：将该日期下、未出现在**本批 Excel** 中的运单行 `is_active` 置为 **0**（删除标记，仅**系统表 / 手工表**各自处理，不跨表）。`same_day_deactivated` 为本次被置 0 的总行数（可含多日期之和）。

**本批导入行查询**（与模板同类：**独立路径** `/import-batch`，勿用 `/import/rows`；实现放在 **`app/main.py`** 与 `/health` 同应用，避免进程未重载时缺路由）：

- `GET /api/import-batch?dataset_type=system|manual&batch_id=<batch_id>&page=1&page_size=20|50`
  - `page` 默认 `1`，须 ≥1；`page_size` 仅 **`20`** 或 **`50`**，默认 **`20`**；非法组合返回 **400**。
- 返回：`{ "items": [...], "total": n, "page": 1, "page_size": 20 }`（非数组）

**按排线日期查当前有效导入行**（与 `import-batch` 同属 **`app/main.py`**；不限定 `batch_id`，仅 **`is_active=1`** 的行）：

- `GET /api/import-active?dataset_type=system|manual&route_date_from=YYYY-MM-DD&route_date_to=YYYY-MM-DD&page=1&page_size=20|50`
  - 闭区间：排线日期 **≥ `route_date_from` 且 ≤ `route_date_to`**；须 **`route_date_from` ≤ `route_date_to`**，否则 **400**。
  - 分页参数与 **`import-batch`** 相同。
- 返回：与 **`import-batch`** 相同结构 `{ "items", "total", "page", "page_size" }`。

**手动排线补算预估里程/时效**（**`manual_route`** 中 `is_active=1` 的全部参与行；**含此前已成功** `calc_status=1` 的行，结果 **覆盖** 写入；与 **`POST /api/compare/run`** 内 `calc` 同源逻辑，**不执行比对**）：

- `POST /api/manual/backfill`
- `Content-Type: application/json`

请求体 **二选一**（不可同时传）：

```json
{ "batch_id": "<导入接口返回的 batch_id>" }
```

或：

```json
{
  "route_date_from": "2026-04-01",
  "route_date_to": "2026-04-30"
}
```

响应（与 **`compare/run`** 返回中的 **`calc`** 结构一致）：

```json
{
  "updated": 1,
  "failed": 0,
  "failures": []
}
```

- `failures` 中每项形如 `{ "store": "...", "reason": "...", "retry_count": n }`。
- 区间内或该 `batch_id` 下无有效手动行时 **`updated`/`failed` 均为 0**，仍 **200**。
- 未传 `batch_id` 且未同时传 `route_date_from`+`route_date_to`，或两类都传，返回 **422**；`route_date_from` > `route_date_to` 返回 **422**。

### 2) 执行比对

- `POST /api/compare/run`
- Header: `x-operator`（可选，默认 system）

请求体：

```json
{
  "route_date": "2026-04-20",
  "match_threshold": 0.5
}
```

返回包含：
- `run_batch_id`
- `calc.failures`：失败门店结构化数组 `[{store, reason, retry_count}]`

### 3) 获取结果概览

- `GET /api/compare/overview?route_date=2026-04-20`（可选 `warehouse_name=始发仓库` 精确过滤）

响应除 `total` / 各状态计数 / `avg_*` 外，还包含**汇总差**（在筛选结果集上对 `compare_result` 的差值**求和**；无差值行不参与该项求和，全无时为 0）与**总车次差**（当日同筛选下有效系统运单数 − 有效手工运单数）：

- `total_trip_diff`：总车次差（单数）
- `total_volume_diff`：总体积差（m³，系统−手工 之和）
- `total_distance_diff`：总公里差（km 之和）
- `total_duration_diff`：总时长差（分钟之和，整数）

### 4) 获取结果明细

- `GET /api/compare/results?route_date=2026-04-20&match_status=full`

响应行项须包含 `id`（即 `compare_result.id`），供路线地图入口使用。每行还包含 `diff_stores`（两侧对称差集、逗号拼接）以及分侧字段 `diff_stores_system`（仅系统有）、`diff_stores_manual`（仅手工有），供前端在「不同门店」列用标签区分展示。

### 5) 单行路线地图（结果行联动）

- `GET /api/compare/route-map/{compare_result_id}`
- `compare_result_id`：整数，与明细接口中每行的 `id` 一致。

成功响应字段与研发设计文档 `docs/智能排线研发开发设计文档_V1.1.md` §5.5 一致，核心结构如下：

```json
{
  "route_date": "2026-04-20",
  "match_status": "full",
  "store_match_rate": 100.0,
  "match_score": 1.0,
  "sys_waybill_no": "SYS001",
  "manual_waybill_no": "MAN001",
  "sys_volume": 9.5,
  "manual_volume": 10.0,
  "warehouse_name": "仓库1",
  "system": {
    "available": true,
    "polyline": null,
    "path": [[116.1, 39.9], [116.2, 39.95]],
    "markers": [
      {"seq": 0, "name": "仓库1", "lng": 116.1, "lat": 39.9, "kind": "warehouse"}
    ],
    "visit_order": ["门店甲", "门店乙"]
  },
  "manual": {
    "available": true,
    "polyline": null,
    "path": [],
    "markers": [],
    "visit_order": ["门店甲", "门店乙"]
  },
  "style": {
    "system_line_color": "#1677FF",
    "manual_line_color": "#FF4D4F"
  }
}
```

说明：`system` / `manual` 表示单侧；`available=false` 时该侧无轨迹，前端仅绘制另一侧（见 PRD §9.1 M-05、M-06）。`path` 为道路级折线点列（`[lng,lat]`），与 `polyline` 可二选一或同时返回；同时存在时建议前端优先使用 `path`。`visit_order` 为门店访问顺序（不含仓库）；手动侧与落库的 `delivery_store_order` 一致（缺省时为拼载 CSV 顺序），系统侧为导入 CSV 顺序。`markers` 中门店的 `seq` 与 `visit_order` 一致。`store_match_rate` 为门店匹配率（百分比数值，如 `100` 表示 100%）；`match_score` 为 0～1 匹配度小数。`sys_volume` / `manual_volume` 为对应侧配送体积（m³），单侧无数据时为 `null`。

### 6) 导出结果

- `GET /api/compare/export?route_date=2026-04-20`

### 7) 差异分析：一店多车（按门店分组）

- `GET /api/diff-analysis/multi-vehicle-stores?route_date=2026-04-22&dataset_type=all`（`dataset_type`：`all` 合并系统+手动当日有效行 | `system` | `manual`）
- `dataset_type`：`all` 为两侧合并；`system` / `manual` 与导入类型一致，仅该侧**当日有效**运单行 `is_active=1`。
- 在指定 `route_date` 上，对拼载门店做「一店多车」判断：某门店若只出现在 1 个运单中，**不返回**；若出现在 2 个及以上不同运单中，则按门店聚合一组运单。组内 `item_seq` 为同一门店下、按 `waybill_no` 与 `dataset_type` 排序后的序号 1 起。每条 `waybill` 带 **`dataset_type`**：`system`（系统建议）| `manual`（手工排线），标识该运单行来源侧；`dataset_type=all` 时同一运单可能来自不同侧，以字段区分。

```json
{
  "items": [
    {
      "store_name": "某店",
      "waybills": [
        { "item_seq": 1, "waybill_no": "运单A", "dataset_type": "system" },
        { "item_seq": 2, "waybill_no": "运单B", "dataset_type": "manual" }
      ]
    }
  ]
}
```

### 8) 客户列表导入（客户基础资料 + 门店坐标）

- `POST /api/customer-list/import` — `multipart/form-data` 字段 `file`（.xlsx）；Query：`data_source`（可选，默认 `客户列表导入`，写入 `customer_profile.import_source` 与 `store_coordinate.data_source`）。

首行表头需包含至少：**客户代码**、**客户名称**、**收货坐标**；工作表名优先为「客户列表」，否则用第一个工作表。

- 按 **客户代码** 对表 `customer_profile` **insert 或全量更新**各列（与导出的客户列表列一致时最佳）。
- 对每一行：若 **客户名称** 非空且 **收货坐标** 可解析为「经度,纬度」（可中文逗号），则按**客户名称** = `store_coordinate.store_name` 执行 **upsert**（有则改经纬度，无则新增）。

成功响应约：

```json
{
  "message": "import finished",
  "data_rows": 392,
  "customer_profile_upserted": 392,
  "store_coordinate_inserted": 380,
  "store_coordinate_updated": 0,
  "store_coordinate_skipped": 12,
  "store_coordinate_error_rows": 0,
  "errors_sample": []
}
```

- `store_coordinate_skipped`：无客户名称、无收货坐标、或本行不需写坐标。`errors_sample` 最多 30 条解析/校验失败行说明。
