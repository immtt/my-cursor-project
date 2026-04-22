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
  "errors": [{"row": 8, "reason": "配送体积不能为负数"}]
}
```

**本批导入行查询**（与模板同类：**独立路径** `/import-batch`，勿用 `/import/rows`；实现放在 **`app/main.py`** 与 `/health` 同应用，避免进程未重载时缺路由）：

- `GET /api/import-batch?dataset_type=system|manual&batch_id=<batch_id>&page=1&page_size=20|50`
  - `page` 默认 `1`，须 ≥1；`page_size` 仅 **`20`** 或 **`50`**，默认 **`20`**；非法组合返回 **400**。
- 返回：`{ "items": [...], "total": n, "page": 1, "page_size": 20 }`（非数组）

**按排线日期查当前有效导入行**（与 `import-batch` 同属 **`app/main.py`**；不限定 `batch_id`，仅 **`is_active=1`** 的行）：

- `GET /api/import-active?dataset_type=system|manual&route_date_from=YYYY-MM-DD&route_date_to=YYYY-MM-DD&page=1&page_size=20|50`
  - 闭区间：排线日期 **≥ `route_date_from` 且 ≤ `route_date_to`**；须 **`route_date_from` ≤ `route_date_to`**，否则 **400**。
  - 分页参数与 **`import-batch`** 相同。
- 返回：与 **`import-batch`** 相同结构 `{ "items", "total", "page", "page_size" }`。

**手动排线按批次补算预估里程/时效**（仅 **`manual_route`** 中 `is_active=1` 且 `calc_status` 待补算/失败重试的行；与 **`POST /api/compare/run`** 内 `calc` 同源逻辑，**不执行比对**）：

- `POST /api/manual/backfill`
- `Content-Type: application/json`

请求体：

```json
{ "batch_id": "<导入接口返回的 batch_id>" }
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
- 该 `batch_id` 下无待补算行时 **`updated`/`failed` 均为 0**，仍 **200**。
- `batch_id` 缺失或全空白返回 **400**。

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

- `GET /api/compare/overview?route_date=2026-04-20`

### 4) 获取结果明细

- `GET /api/compare/results?route_date=2026-04-20&match_status=full`

响应行项须包含 `id`（即 `compare_result.id`），供路线地图入口使用。

### 5) 单行路线地图（结果行联动）

- `GET /api/compare/route-map/{compare_result_id}`
- `compare_result_id`：整数，与明细接口中每行的 `id` 一致。

成功响应字段与研发设计文档 `docs/智能排线研发开发设计文档_V1.1.md` §5.5 一致，核心结构如下：

```json
{
  "route_date": "2026-04-20",
  "match_status": "full",
  "sys_waybill_no": "SYS001",
  "manual_waybill_no": "MAN001",
  "warehouse_name": "仓库1",
  "system": {
    "available": true,
    "polyline": null,
    "path": [[116.1, 39.9], [116.2, 39.95]],
    "markers": [
      {"seq": 0, "name": "仓库1", "lng": 116.1, "lat": 39.9, "kind": "warehouse"}
    ]
  },
  "manual": {
    "available": true,
    "polyline": null,
    "path": [],
    "markers": []
  },
  "style": {
    "system_line_color": "#1677FF",
    "manual_line_color": "#FF4D4F"
  }
}
```

说明：`system` / `manual` 表示单侧；`available=false` 时该侧无轨迹，前端仅绘制另一侧（见 PRD §9.1 M-05、M-06）。`path` 为道路级折线点列（`[lng,lat]`），与 `polyline` 可二选一或同时返回；同时存在时建议前端优先使用 `path`。

### 6) 导出结果

- `GET /api/compare/export?route_date=2026-04-20`
