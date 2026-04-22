# 智能排线项目

用于“货车智能装载及运输排线”业务的数据导入、路径计算、比对分析与结果展示。

## 项目结构

- `docs/`：需求文档、接口文档、技术方案
- `backend/`：后端服务代码
- `frontend/`：前端页面代码
- `scripts/`：数据处理与运维脚本

## 启动方式

当前项目处于初始化阶段，尚未接入具体技术栈。

后续可按如下方式扩展：

1. 在 `backend/` 初始化后端工程（Python/Java）
2. 在 `frontend/` 初始化前端工程（React/Vue）
3. 在 `docs/` 维护 PRD、接口定义与发布记录

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

