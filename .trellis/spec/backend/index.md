# Backend（宿主半）开发指南

> 本仓库唯一后端代码是 `lib/index.js` —— DSH webServer 插件宿主行。无数据库、无独立服务进程、
> 无持久化；所有"服务端"能力都以 HTTP 路由形式挂在 dsh 宿主进程内。

---

## 概览

宿主半以单个 ESM 模块（`lib/index.js`）存在，经 `cordis.patch.yml` 以 `side-drawer` 行注册
（`inject: [webServer]`）。职责：

- node-pty 终端会话管理（多会话、每会话 1MB 输出环形缓冲、上限 8）
- `/drawer/terminal/*`、`/drawer/fs/*`、`/drawer/vendor/*` HTTP 路由
- 从插件自身 `node_modules` 读盘分发第三方资源（xterm.js / highlight.js），无构建步骤

浏览器半（`lib/client.js`）是唯一的调用方，任何路由契约改动必须两端同步。

---

## 规范索引

| 规范 | 内容 | 状态 |
|------|------|------|
| [目录结构](./directory-structure.md) | 仓库布局、lib/index.js 内部组织 | Active |
| [错误处理](./error-handling.md) | guard / respond / `{ok:false,error}` 契约、状态码矩阵 | Active |
| [日志规范](./logging-guidelines.md) | 宿主零日志约定、dev 脚本例外 | Active |
| [Host FS 路由](./host-fs-routes.md) | `/drawer/fs/*` API 契约、校验矩阵、通用路由模式 | Active |
| [质量规范](./quality-guidelines.md) | 冒烟测试、禁止模式、评审清单 | Active |

> 模板自带的 `database-guidelines.md` 已删除：本项目无数据库，不存在 ORM / 迁移 / 表命名约定。

---

## 开发前检查清单

- [ ] 改动路由：`lib/client.js` 的调用方（`api` / `fetchJson`）与新契约是否同步（含错误文案）？
- [ ] 新增资源上限常量：是否集中定义在文件顶部 `MAX_*`，并与浏览器半的提示/阈值一致？
- [ ] 新第三方资源：是否走 `loadVendor` 表 + `/drawer/vendor/<name>` 路由，缺失时 404 并提示
      `pnpm install`？
- [ ] 是否保持 ESM + 零新增依赖（新增依赖必须有理由并写进代码注释）？

---

## 质量检查

- [ ] `node --check lib/index.js` 语法通过
- [ ] `node verify-host.mjs` 全链路冒烟通过（真实 spawn shell：多会话隔离、上限、kill 语义、
      vendor 分发）
- [ ] 路由安全：所有新路由包在 `guard`（同源校验）内，方法校验、参数校验齐全

---

**语言**：本目录文档使用中文（与代码注释、README 一致）。
