# 技术设计：右侧抽屉插件（dsh-plugin-side-drawer）

## 1. 总体结构（双半插件，参照 dsh-plugin-trellis-status-card）

| 文件 | 职责 |
|---|---|
| `lib/index.js` | 宿主半：cordis 插件，`inject: [webServer]`，node-pty 终端会话管理 + `/drawer/terminal/*` HTTP 路由 |
| `lib/client.js` | 浏览器半：`window.__ModuleLoader__.load` 自包含工厂（工厂内仅 `require("react")`，不可跨插件 require），注册抽屉 UI |
| `cordis.patch.yml` | 宿主行插入补丁（id: side-drawer, inject: [webServer]） |
| `package.json` | `dsh.bundle.patch` + `dsh.client.platform: "web"` 双声明 |

## 2. 抽屉落位（关键决策）

- Web 布局为三栏 AppFrame：`sidebar | conversation | details`。
  `details` 是唯一"右侧、打开时挤压中栏"的区域（让步链：中心≥640px，details 先让步、再自动关闭），
  天然满足"展开后聊天文字不被遮挡"。
- `details` 槽为 single 类，被 ui-conversation 的 DetailsPanel 占用。槽核心（SlotCore）支持
  **priority 阴影**：注册到不同 priority 不冲突，priority 最低者渲染，被阴影条目及其子槽声明、
  store 挂载全部保留不销毁。因此以 `priority: -1` 注册 DrawerPanel 遮蔽 DetailsPanel，不破坏任何现有注册。
- 当前版本（0.1.0-rc.6）中 details 面板实际闲置（工具行点击走 trajectory 视图，selection 通道无写入方），
  阴影无功能损失（详见 research）。
- 展开 = `ctx.layout.openDetails()`；折叠 = `ctx.layout.closeDetails()`。
  折叠时 details 列零宽但组件不卸载（AppFrame 契约），面板按自身 open 状态渲染 null。

## 3. 状态同步（按钮 ⇄ 面板）

- 开关按钮注册在 `conversation.session.header.utilities`（list 槽，右上角会话工具区），
  与 details 面板分属两棵渲染树，无法共享 React context。
- 采用 apply 闭包内的模块级 pub/sub（listeners Set + subscribe/actions 经 inject 注入两个组件）。
  展开状态为内存态，默认折叠，不持久化。

## 4. 终端协议（HTTP 轮询，单会话模型）

- 路由（webServer exact 路由，JSON）：
  - `POST /drawer/terminal/spawn` {cols,rows,cwd} → {id}（幂等：已有会话则返回现 id）
  - `POST /drawer/terminal/input` {id,data} → 200
  - `GET  /drawer/terminal/output?id=&seq=` → {seq,data}
  - `POST /drawer/terminal/resize` {id,cols,rows}
  - `POST /drawer/terminal/kill` {id}
- 宿主：`node-pty`（自 profile 共享 node_modules 解析，README 注明隐式依赖关系）；
  输出环形缓冲（上限 1MB，超限丢头并标记 truncated）；
  shell：win32 → pwsh（回退 powershell.exe），posix → $SHELL（回退 bash）。
- 客户端：readonly textarea 渲染输出流（剥离 ANSI 转义序列）+ 透明文字输入框捕获按键
  逐字节发送（Enter→\r、退格→\x7f、方向键→ESC 序列、Ctrl+C→\x03），150ms 轮询增量输出。
- 安全：校验 `Sec-Fetch-Site` / `Origin`，拒绝跨站调用（防局域网任意代码执行）。

## 5. 浏览器标签页

- 地址栏 + iframe + 刷新/新窗口打开按钮。拒绝内嵌（X-Frame-Options/CSP）的站点给出提示。
- dsh web 运行在 http://127.0.0.1 上，无 https 混合内容限制问题。

## 6. 安装 / 更新 / 回滚

- 安装：junction 挂入 `profiles/web/node_modules` + `dsh.profile.bundles` 追加条目（跨盘 junction 方式，
  不写 dependencies，避免 pnpm 重建损坏 junction）。
- 插件集合与宿主半变更需重启 dsh web；仅浏览器半变更刷新页面即可（client.js 每次请求重新读盘）。
- 回滚：删除 junction 与 bundles 条目，重启即恢复原状。

## 7. 已知取舍

- 终端为流式文本渲染（无 xterm 网格），全屏交互程序（vim/top）不支持——与官方 dsh-terminal-bash
  "不支持 alternate buffer"同级的取舍；后续可换 xterm 升级。
- 浏览器 v1 不做代理重写，拒绝内嵌的站点只能新窗口打开。

---

# v2 设计：终端 xterm 化 + 折叠不断连 + 浏览器增强（2026-08-14）

依据 research/xterm-browser-loading.md（xterm 6.0.0 `lib/xterm.mjs` 自包含 ESM 已验证）。

## 8. xterm.js 交付（无构建步骤）

- 宿主半新增静态路由（同源 guard 复用、内存缓存、缺失 404）：
  `GET /drawer/vendor/xterm.mjs` / `GET /drawer/vendor/xterm.css`，
  从 `new URL("../node_modules/@xterm/xterm/...", import.meta.url)` 读盘（junction 真实路径可靠）。
- 客户端首次进入终端页：注入 `<link rel=stylesheet href=/drawer/vendor/xterm.css>`
  （data-plugin 标记防重复）→ `await import("/drawer/vendor/xterm.mjs")` 取 `Terminal`。
  CSS 必须先行加载，否则 xterm 行列测量全错。加载失败 → 错误卡片提示 pnpm install（不保留
  textarea 回退模式，避免双套渲染维护）。

## 9. 终端交互与渲染

- 输出：轮询增量 `term.write(data)`（xterm 原生处理 ANSI/控制序列）；删除 stripAnsi 与
  MAX_VIEW 切片；`scrollback: 2000`；宿主 1MB 环形缓冲不变；`dropped` 时写一行截断提示。
- 输入：`term.onData(d => send(d))` 逐字节经现有 POST /input；本地不回显，依赖 pty 回环；
  shell readline 原生提供历史/补全回显/Ctrl+C。`send()` 成功后立即额外 tick 一轮输出，
  轮询间隔 150ms → 100ms（回显 ≈ RTT + 一次 fetch）。**传输协议不变**。
- 尺寸：ResizeObserver（debounce 150ms）+ 隐藏测量元素（等宽 span 100 字符求 charWidth，
  行高 = fontSize×1.2）→ cols/rows clamp(20-240/5-100) → `term.resize` + POST /resize；
  spawn 携带初始 cols/rows。±1 列误差为已知取舍。
- 主题：容器背景走 CSS 变量；xterm theme `background:'transparent'`，前景/光标色从
  `getComputedStyle(document.body)` 读 `--dsw-*`（**DSH 的 token 只定义在 `body` / `body[data-ds-dark-theme]`
  选择器上，读 documentElement 恒为兜底色**——check 阶段实证修复）；MutationObserver 同时观察
  `<html>` 与 `<body>`（attributeFilter 含 data-ds-dark-theme）重读并 `term.options.theme` 赋值（保 FR7）。
- 并发护栏（check 阶段实证修复）：输入 `send` 走 promise 链串行化（防连接池并发在途乱序到达 pty）；
  输出 `tick` 单飞守卫（防同 seq 并发拉取重复写屏）；xterm.css 与 import 用 Promise.all 双就绪才 open
  （防样式表晚到导致测量错误）。

## 10. 折叠不断连（keep-alive）

- DrawerPanel 不再 `if (!open) return null`：根 div `display:none` 隐藏（AppFrame 契约：
  details 零宽不卸载），两个 Pane 保持挂载。
- 轮询 effect 依赖 `visible`（open 且当前 tab）：隐藏停轮询，重开立即 tick 按 seq 拉齐
  （宿主缓冲兜底 ≤1MB）。
- kill 时机：组件 unmount → 改为 `window` pagehide → sendBeacon kill（NFR3 刷新重建不变）；
  重启按钮照旧 kill+spawn。

## 11. 浏览器页增强

- 导航：组件内地址栈（数组+指针，仅记录地址栏导航；iframe 内部跨域跳转不可感知——已知限制）；
  后退/前进/刷新按钮；刷新用 `<iframe key={reloadSeq}>` 重建（跨域 reload() 被禁）。
- 记忆：`localStorage["dsh-side-drawer:browser-url"]`，导航写入，挂载恢复并自动加载。
- 安全：`sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"`
  + `referrerPolicy="no-referrer"`。取舍：个别站点 sandbox 下异常 → 新窗口兜底；
  allow-same-origin+allow-scripts 对同源页无防护，但内嵌站均跨域（dsh 在 127.0.0.1），可接受。

## 12. 依赖与安装变更

- `package.json` +`dependencies: { "@xterm/xterm": "^6.0.0" }`（纯 JS 无原生编译）；
  README 安装步骤增加"插件目录执行一次 `pnpm install`"；prd NFR1 修订。
- 回滚：恢复 v1 文件 + 移除依赖 + 重启 dsh web；junction 安装方式不变。
