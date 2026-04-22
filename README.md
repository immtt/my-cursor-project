# 智能排线项目

用于“货车智能装载及运输排线”业务的数据导入、路径计算、比对分析与结果展示。

## 项目结构

- `docs/`：需求文档、接口文档、技术方案；**排错**见 [`docs/报错记录与排错指南.md`](docs/报错记录与排错指南.md)
- `backend/`：后端服务代码
- `frontend/`：前端页面代码
- `scripts/`：数据处理与运维脚本

## 本地预览（浏览器打开页面）

**一键启动（推荐）**：在项目根目录执行（会占用当前终端，Ctrl+C 可同时停掉前后端）：

```bash
./scripts/start-dev.sh
```

**改代码后要重新验收**：先释放端口再起服务（适合替换旧进程）：

```bash
./scripts/restart-dev.sh
```

环境变量（可选）：`BACKEND_PORT`（默认 8080）、`FRONTEND_PORT`（默认 5173）。

然后浏览器打开 **[http://127.0.0.1:5173](http://127.0.0.1:5173)**。脚本已将前后端绑定 **0.0.0.0**，也可用 **本机局域网 IP:5173** 访问；前端会自动用**同一主机名**请求 **:8080** 接口，避免 `Failed to fetch`。

**若页面提示连不上后端**：在同一主机上新标签打开 `http://<当前页主机>:8080/health`（本机即 [http://127.0.0.1:8080/health](http://127.0.0.1:8080/health)），应看到 `{"status":"ok"}`。  
默认后端端口为 **8080**。脚本启动后会自动检测 `/health`。

---

或分两个终端手动启动：

1. **终端 A — 后端**（导入、比对、结果接口；不启动则前端会报连不上 API）  
   ```bash
   cd backend
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
   ```

2. **终端 B — 前端**  
   ```bash
   cd frontend
   python3 -m http.server 5173
   ```

3. 用浏览器打开：**[http://127.0.0.1:5173](http://127.0.0.1:5173)**  
   - 顶部导航可切换：数据导入、比对、结果等。  
   - 路线地图：先在「比对结果」里查询出表格，再点某一行的 **「地图」**。

4. 地图轨迹：Key 与安全密钥在 `frontend/amap-config.js`；修改后 **强制刷新**（Cmd+Shift+R / Ctrl+Shift+R）。

## 启动方式

### 后端（FastAPI）

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

启动后访问：

- 健康检查：`http://127.0.0.1:8080/health`
- API文档：`http://127.0.0.1:8080/docs`

### 前端（静态页面）

```bash
cd frontend
python3 -m http.server 5173
```

启动后访问：

- 页面入口：`http://127.0.0.1:5173`

比对结果页「地图」使用高德 JS API 2.0，Key 与安全密钥见 `frontend/amap-config.js`（`index.html` 已引用）。  
也可用浏览器 `localStorage.amap_web_key` / `localStorage.amap_security_js_code` 临时覆盖。

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

