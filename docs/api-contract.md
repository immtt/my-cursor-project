# 智能排线 API 契约（MVP）

## 错误码

- `BAD_REQUEST`：参数错误
- `IMPORT_VALIDATION_FAILED`：导入校验失败
- `GAODE_CALC_FAILED`：高德补算失败
- `COMPARE_EXECUTE_FAILED`：比对执行失败

## 接口列表

### 1) 导入数据

- `POST /api/import/{dataset_type}`
- `dataset_type`: `system` | `manual`
- `multipart/form-data`: `file`

返回：

```json
{
  "total_rows": 100,
  "success_rows": 96,
  "failed_rows": 4,
  "errors": [{"row": 8, "reason": "配送体积不能为负数"}]
}
```

### 2) 执行比对

- `POST /api/compare/run`

请求体：

```json
{
  "route_date": "2026-04-20",
  "match_threshold": 0.5
}
```

### 3) 获取结果概览

- `GET /api/compare/overview?route_date=2026-04-20`

### 4) 获取结果明细

- `GET /api/compare/results?route_date=2026-04-20&match_status=full`

### 5) 导出结果

- `GET /api/compare/export?route_date=2026-04-20`
