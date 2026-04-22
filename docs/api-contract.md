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
  - 可选 **`store_name`**：拼载门店**子串**（与库中 `stores` 文本做 `LIKE` 匹配，含多店逗号串）。
  - `page` 默认 `1`，须 ≥1；`page_size` 仅 **`20`** 或 **`50`**，默认 **`20`**；非法组合返回 **400**。
  - 返回：`{ "items": [...], "total": n, "page": 1, "page_size": 20 }`（非数组）
  - `items[]` 每条除行数据外含 **`sort_order`**：当前筛选与排序下**连续序号 1…total**（与分页一致，**非**主键 `id`）；`id` 仍保留作内部引用。

**按排线日期查当前有效导入行**（与 `import-batch` 同属 **`app/main.py`**；不限定 `batch_id`，仅 **`is_active=1`** 的行）：

- `GET /api/import-active?dataset_type=system|manual&route_date_from=YYYY-MM-DD&route_date_to=YYYY-MM-DD&page=1&page_size=20|50`
  - 可选 **`warehouse_name`**：始发仓库精确匹配。
  - 可选 **`store_name`**：拼载门店**子串**（同上）。
  - 闭区间：排线日期 **≥ `route_date_from` 且 ≤ `route_date_to`**；须 **`route_date_from` ≤ `route_date_to`**，否则 **400**。
  - 分页参数与 **`import-batch`** 相同。
- 返回：与 **`import-batch`** 相比额外含 **`warehouse_options`**（见下）`{ "items", "total", "page", "page_size", "warehouse_options" }`。

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

请求体（`route_date_from` ≤ `route_date_to`，闭区间；单日可起止填同一天）：

```json
{
  "route_date_from": "2026-04-20",
  "route_date_to": "2026-04-22",
  "match_threshold": 0.5
}
```

返回包含：
- `run_batch_id`
- `route_date_from` / `route_date_to`
- `calc.failures`：失败门店结构化数组 `[{store, reason, retry_count}]`
- 区间内**逐日**执行比对，写入/更新各日 `compare_result`；`result_count` 为区间内产出的明细行数合计。

### 3) 获取结果概览

- `GET /api/compare/overview?route_date_from=2026-04-20&route_date_to=2026-04-20`（可选 `warehouse_name=始发仓库` 精确过滤）
- `route_date_from` 不得晚于 `route_date_to`，否则 **400**。

响应除 `total` / 各状态计数 / `avg_*` 外，还包含**汇总差**（在筛选结果集上对 `compare_result` 的差值**求和**；无差值行不参与该项求和，全无时为 0）与**总车次差**（区间内、同筛选下有效系统运单数 − 有效手工运单数）及 `route_date_from` / `route_date_to`：

- `total_trip_diff`：总车次差（单数）
- `total_volume_diff`：总体积差（m³，系统−手工 之和）
- `total_distance_diff`：总公里差（km 之和）
- `total_duration_diff`：总时长差（分钟之和，整数）

### 4) 获取结果明细

- `GET /api/compare/results?route_date_from=2026-04-20&route_date_to=2026-04-20&match_status=full`（`match_status` 可选）
- `route_date_from` 不得晚于 `route_date_to`，否则 **400**。

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

- `GET /api/compare/export?route_date_from=2026-04-20&route_date_to=2026-04-22`（可选 `warehouse_name`）
- 闭区间内与「结果明细」同一筛选逻辑；单日时 `route_date_from` 与 `route_date_to` 可相同。

### 7) 差异分析：一店多车（按门店分组）

- `GET /api/diff-analysis/multi-vehicle-stores?route_date_from=2026-04-20&route_date_to=2026-04-22&dataset_type=all`（`dataset_type`：`all` | `system` | `manual`；可选 **`warehouse_name`** 始发仓库精确匹配；单日可 `route_date_from` 与 `route_date_to` 相同；`from > to` 时 400）
- 闭区间内**逐日**统计后合并为 `items`；每条含 **`route_date`**（该条对应的排线日 `YYYY-MM-DD`）。
- `dataset_type=system` / `manual`：仅该侧**当日**有效运单 `is_active=1`；对拼载门店，若该侧有 **≥2 个不同运单** 经过该店，则返回一组运单（`item_seq` 按 `waybill_no` 排序自 1 起）。
- `dataset_type=all`：**不合并两侧**。手工、系统**各自**判断一店多车（同侧该店在当日 ≥2 个运单才返回）。同店可得到 **最多两条** `items`（先手工、后系统），不会把「1 车手工 + 1 车系统」凑成 2 车。
- 响应另含（与 `items` 同区间与仓库筛选，用于趋势图与下拉）：
  - **`warehouse_options`**：`route_date_from`～`to` 内有效行**始发仓库**去重，有序列表。
  - **`vehicle_diff`**：**车辆差异**，与 `dataset_type` 无关；在相同 `route_date_from`～`route_date_to` 与 `warehouse_name` 下，对 `sys_suggest` / `manual_route` 中 `is_active=1` 的行按 **`vehicle_type`（车型）** 分组，统计各组**行数**（即车次数，每行一运单）。用于系统与手工两侧对比：
    - `by_vehicle_type`：`{ "vehicle_type", "system_count", "manual_count", "diff" }` 列表（`diff` = `system_count` − `manual_count`）；车型空串展示为「（未填）」。
    - `system_total` / `manual_total`：两侧车次数合计。
    - **`total_vehicle_diff`**：`system_total` − `manual_total`，即**总车辆差异**（与排线概览里「总车次差」同口径：系统侧车次数减手工侧车次数）。
  - **`trend_by_day`**：区间内**每一个自然日**一行；**系统侧、手工侧**在一店多车判据下，当日「多车店」的**门店个数**（同 `items` 的合并规则与仓库筛选，但**不按** `dataset_type` 再过滤——始终两条序列便于对比）：
    - `system_multi_vehicle_store_count`：仅看系统建议数据时，当日满足一店多车的**门店**数（与只选 `dataset_type=system` 时 `items` 的「店」条数一致）。
    - `manual_multi_vehicle_store_count`：仅看手工时同理。

```json
{
  "items": [
    {
      "store_name": "某店",
      "route_date": "2026-04-22",
      "waybills": [
        { "item_seq": 1, "waybill_no": "运单A", "dataset_type": "manual" },
        { "item_seq": 2, "waybill_no": "运单B", "dataset_type": "manual" }
      ]
    }
  ],
  "vehicle_diff": {
    "by_vehicle_type": [
      {
        "vehicle_type": "4.2米",
        "system_count": 12,
        "manual_count": 10,
        "diff": 2
      }
    ],
    "system_total": 12,
    "manual_total": 10,
    "total_vehicle_diff": 2
  },
  "warehouse_options": ["华东仓"],
  "trend_by_day": [
    {
      "route_date": "2026-04-20",
      "system_multi_vehicle_store_count": 0,
      "manual_multi_vehicle_store_count": 1
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
