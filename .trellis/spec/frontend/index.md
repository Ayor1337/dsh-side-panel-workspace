# Frontend（浏览器半）开发指南

> 浏览器半编码规范：唯一前端代码是 `lib/client.js` —— 一个**自包含经典脚本**
> （`window.__ModuleLoader__.load({ id, factory })`），无 JSX、无 TS、无构建步骤。

---

## 概览

client.js 通过 `package.json` 的 `dsh.client` 声明被发现，以 `<script>` 方式加载
（`/plugins/<id>/client.js`）。UI 合同：

- 开关按钮注册在 `conversation.session.header.utilities` 席位；
- 抽屉以 `priority: -1` 阴影注册进官方 `details` 槽（不销毁官方 DetailsPanel 注册）；
- 终端 / 浏览器 / 资源管理器三种标签页 + 首页空态。

所有与宿主的数据交换经 `/drawer/*` HTTP 路由（契约见 `../backend/host-fs-routes.md` 与
`../backend/error-handling.md`）。

---

## 规范索引

| 规范 | 内容 | 状态 |
|------|------|------|
| [目录结构](./directory-structure.md) | client.js 单文件内部组织、命名 | Active |
| [组件规范](./component-guidelines.md) | 组件模式、跨渲染树通信、主题变量、vendor 加载 | Active |
| [Hook 规范](./hook-guidelines.md) | useState/useEffect/useRef/useCallback 实际用法、清理纪律 | Active |
| [状态管理](./state-management.md) | 状态分层：组件局部 / apply 闭包 pub-sub / ref / 宿主状态 | Active |
| [类型与运行时防御](./type-safety.md) | 纯 JS 无 TS：边界校验、clamp、错误归一化 | Active |
| [质量规范](./quality-guidelines.md) | 可访问性、禁止模式、冒烟与手工 QA 清单 | Active |

---

## 开发前检查清单

- [ ] 新 UI 是否保持"折叠不卸载"（`everOpened` 门 + `display:none`）？终端会话不被误杀？
- [ ] 新样式是否只用 `--dsw-*` 主题变量（带兜底色）？class 是否 `sdw_` 前缀？
- [ ] 新交互的监听器/观察者/定时器是否都有 cleanup？
- [ ] 新宿主路由的客户端调用是否与后端契约/错误文案同步？

---

## 质量检查

- [ ] `node --check lib/client.js` 语法通过
- [ ] `node verify-client.mjs` 冒烟通过（details priority -1、utilities 席位注册）
- [ ] 改动仅 client.js 时，刷新页面即可验证；涉及宿主需重启 `dsh web`
- [ ] 明/暗主题各过一遍（终端配色、高亮、抽屉底色跟随）

---

**语言**：本目录文档使用中文（与代码注释、README 一致）；`component-guidelines.md` 为早期
英文撰写，内容同等有效。
