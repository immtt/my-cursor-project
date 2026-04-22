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
