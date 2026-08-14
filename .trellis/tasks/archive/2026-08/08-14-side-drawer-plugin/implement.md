# 实施计划：右侧抽屉插件

## 执行顺序

1. **骨架**：`package.json`、`cordis.patch.yml`（已完成）
2. **宿主半 `lib/index.js`**：node-pty 加载（解析失败降级报错）、终端会话状态机（spawn/input/output/resize/kill）、
   同源校验、webServer 路由注册
3. **浏览器半 `lib/client.js`**：
   - 样式注入（data-plugin 标记的 style 标签，全用 --dsw-* 主题变量）
   - 开关按钮（`conversation.session.header.utilities`）
   - DrawerPanel（`details` 槽 priority:-1，标签页：终端 / 浏览器，收起按钮）
   - 终端 UI（输出渲染 + 按键输入 + 轮询）
   - 浏览器 UI（地址栏 + iframe + 新窗口）
4. **README.md**：安装 / 更新 / 卸载 / 限制说明
5. **安装**：junction + bundles 登记
6. **验证**：
   - `node --check lib/index.js`、`node --check lib/client.js`（语法）
   - `dsh --dump-config --profile web` 确认 side-drawer 宿主行注入
   - 重启 dsh web 后按 AC1–AC7 手测（重启会打断当前 GUI 会话，须用户同意后执行）
7. **交付说明**：告知用户重启与验证步骤

## 检查门

- 宿主半不崩溃：无 node-pty 时路由返回明确 500 提示而非宿主进程崩溃
- 浏览器半不破坏官方注册：仅用 priority 阴影 + 追加性席位，不替换任何产品条目
- 清理：所有注册/监听均返回 disposer（effect / register 返回值 / subscribe 返回值）

---

# v2 执行清单（2026-08-14）

前置：`package.json` 加 `@xterm/xterm` 依赖并在插件目录 `pnpm install`（主会话已完成则跳过）。

1. **宿主半 `lib/index.js`**：新增 `GET /drawer/vendor/xterm.mjs` 与 `/drawer/vendor/xterm.css`
   静态路由（读盘 + 内存缓存 + 同源 guard + 缺失 404）；现有 5 个终端路由不动。
2. **浏览器半 `lib/client.js`**：
   - TerminalPane 重写：懒加载 xterm（CSS link + 动态 import）→ spawn → onData 逐键发送 →
     轮询增量 term.write；ResizeObserver 尺寸同步；主题读取 + MutationObserver 跟随；
     删除 stripAnsi / MAX_VIEW / 旧 textarea UI；
   - DrawerPanel：`display:none` 隐藏式保活（不再 return null）；轮询 visible 感知；
     kill 改挂 window pagehide；
   - BrowserPane：后退/前进/刷新（key 翻转重建 iframe）+ 地址栈；localStorage 网址记忆恢复；
     iframe sandbox + referrerPolicy。
3. **验证脚本**：verify-host.mjs 增加 vendor 路由断言；verify-client.mjs 确认现有断言仍过。
4. **README.md**：功能、安装（+pnpm install）、已知限制（删除"折叠即关会话""剥离 ANSI"，
   新增"逐键输入经 HTTP 回环""iframe 历史仅跟踪地址栏"等取舍）更新。
5. **验证命令**：`node --check lib/index.js lib/client.js`；`node verify-host.mjs`；
   `node verify-client.mjs`。

## v2 检查门

- 宿主不崩溃：xterm vendor 文件缺失时 404 + 客户端错误卡片（提示 pnpm install），宿主无恙。
- 浏览器半不破坏官方注册：priority 阴影与追加性席位不变；所有注册/监听仍返回 disposer。
- 传输协议不变：/drawer/terminal/* 五路由签名与行为保持（verify-host 全链路须过）。
- 主题：明暗切换后终端前景色跟随（MutationObserver 重读 --dsw-*）。
- 手测（需用户重启 dsh web）：AC8–AC11。
