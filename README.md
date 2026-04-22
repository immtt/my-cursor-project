# 智能排线项目

用于“货车智能装载及运输排线”业务的数据导入、路径计算、比对分析与结果展示。

## 项目结构

- `docs/`：需求文档、接口文档、技术方案
- `backend/`：后端服务代码
- `frontend/`：前端页面代码
- `scripts/`：数据处理与运维脚本

## 启动方式

### 后端（FastAPI）

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

启动后访问：

- 健康检查：`http://127.0.0.1:8000/health`
- API文档：`http://127.0.0.1:8000/docs`

### 前端（静态页面）

```bash
cd frontend
python3 -m http.server 5173
```

启动后访问：

- 页面入口：`http://127.0.0.1:5173`

比对结果页「地图」使用高德 JS API 2.0。浏览器控制台执行一次  
`localStorage.setItem('amap_web_key','你的Web端Key')`  
后刷新，即可在路线地图页渲染轨迹（与后端 REST Key 不同）。

## Git 分支规范

- `main`：生产环境分支，保持稳定，禁止直接提交
- `dev`：开发主分支，用于集成测试
- `feat-xxx`：功能分支，从 `dev` 拉出
- `fix-xxx`：缺陷修复分支，从 `dev` 拉出
- `refactor-xxx`：重构分支，从 `dev` 拉出

示例：

- `feat-user-login`
- `fix-login-button`
- `refactor-api-request`

## 提交信息规范

提交格式必须为：

`类型: 描述内容`

允许类型：

- `feat`：新增功能
- `fix`：修复 bug
- `style`：格式化
- `refactor`：重构
- `docs`：更新文档
- `chore`：构建/依赖
- `test`：测试

示例：

- `feat: 完成用户登录模块`
- `fix: 修复表单验证失效`
- `style: 格式化代码`

## 当前MVP功能

- Excel导入（系统建议/手动排线）
- 手动排线里程与时效补算（含地址缓存）
- 按日期执行比对与结果概览
- 结果查询、状态筛选、CSV导出

