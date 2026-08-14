# 调研记录：DSH 0.1.0-rc.6 插件与 Web 前端扩展机制

来源：通读 npm 安装的 @deepseek-ai/dsh 与 web profile（C:\Users\ayor\.dsh\profiles\web）内全部相关包
（含已安装的参考插件 dsh-plugin-trellis-status-card）。

## 1. out-of-tree 插件形态（参考：dsh-plugin-trellis-status-card）

- 双半结构：宿主 `lib/index.js`（cordis 插件，export apply/inject）+ 浏览器 `lib/client.js`
  （`window.__ModuleLoader__.load({ id, factory: (require) => ... })` 自包含脚本）。
- `package.json`：`dsh.bundle.patch: "./cordis.patch.yml"` + `dsh.client.platform: "web"` 双声明；
  exports 暴露 `.` / `./client` / `./package.json`。
- `cordis.patch.yml`：`- insert: [{ id, name, inject: [webServer] }]` 插入宿主行。
- 安装：跨盘 junction 挂入 `profiles/web/node_modules/<pkg>` + 在 `dsh.profile.bundles` 末尾追加包名；
  不写 dependencies（否则 pnpm install 会重建并损坏 junction）。
- 宿主路由示例：`ctx.effect(() => ctx.webServer.register({ kind: "exact", path, handler }), label)`，
  handler 为 Node 原生 (req, res)。
- 浏览器半工厂内 `require` 只能用 shell 静态模块种子（"react" 等），**不能跨插件 require**。
- 客户端服务示例：`inject: ["slots", "sessions"]`；sessions.list 快照含 current 与 byId[id].cwd。

## 2. 槽位系统（dsh-client-ui-slots / SlotCore 源码证据）

- 布局插件声明 `root`（single）→ `sidebar`、`conversation`、`details`、`conversation.empty`、
  `shell.overlay`（list，click-through 浮动层）。
- ui-conversation 声明会话内槽：`conversation.session`、`conversation.session.header`、
  `conversation.session.header.actions`（list）、`conversation.session.header.utilities`（list，右对齐）、
  `conversation.view`、`conversation.chat.node`（keyed）、`conversation.composer.*`、
  `conversation.input.*`、`conversation.hero.*` 等；DetailsPanel 占用 `details` 并声明
  `conversation.details.tool`（single）子槽。
- **priority 阴影（关键证据，SlotCore.register）**：single/keyed/list 槽按 (priority, 注册序) 排序，
  同一 priority 的二次注册抛错（"already has a registration ... register at a different priority to
  shadow it (lowest renders)"）；不同 priority 允许共存，`entriesOfSlot` 只渲染每 cell 优先级最低者。
  被阴影条目**不销毁**：其 children 声明、store 挂载、inject 全部保留；渲染崩溃可 abdicate 退位到下一幸存者。
- `details` 槽规格：single/scope=session，owner share 为空；折叠时零宽但不卸载（AppFrame 契约）。

## 3. details 栏当前闲置（功能损失评估）

- ChatView 读取 `useStore(s => s.selection?.callId)` 并下传 selectedCallId，但**没有任何代码调用**
  注入的 `openDetails(target)`（全局搜索仅 3 处：布局实现、conversation 注入定义、runner 目录文档）。
- 工具行点击（ui-tool ToolCall）只调 `inspectCall(callId)` → trajectory 视图（对话栏内标签页，
  trajectory 包自带内部详情分栏，不使用 details 列）。
- 结论：0.1.0-rc.6 中 details 面板实际只渲染空态文案；以 priority:-1 阴影无功能损失。

## 4. 终端能力调研

- `ctx.terminals`（dsh-terminal）为 **Agent 专属围栏**：spawn/startSend/read/kill 全部要求传"确切的
  live Agent"作为 owner，静态插件拿不到 Agent → 不可用。
- dsh-terminal-bash 为行导向（不支持 alternate buffer 全屏程序），且依赖 sandbox/subprocess 世界。
- 决策：宿主半直接用 `node-pty`，输出环形缓冲 + HTTP 轮询协议。
  客户端无 xterm（web-frontend vendor 无 xterm 包）→ 自绘流式文本终端。
- **勘误（2026-08-14 v2 实证）**：此前认为"node-pty 位于 profile 共享 node_modules"**不成立**
  —— profile 的 node_modules 只有两个插件 junction，node-pty 实为 `@deepseek-ai/dsh` 主包的
  **嵌套依赖**；且 dsh 进程**不导出 `DSH_HOME` 环境变量**（仅内部按 `$DSH_HOME` > `~/.dsh` 解析）。
  可靠解析锚点：`process.argv[1]`（dsh 入口脚本，位于 dsh 包内）→ `$DSH_HOME`/`~/.dsh` profile
  → 插件自身目录。

## 5. 布局常量（dsh-client-ui-layout columns）

CENTER_MIN=640、SIDEBAR_MIN=264、SIDEBAR_MAX=420、SIDEBAR_DEFAULT=280、SIDEBAR_COLLAPSED=56、
SIDEBAR_AUTO_COLLAPSE=1024、DETAILS_MIN=300、DETAILS_MAX=520、DETAILS_DEFAULT=360。
让步链：中心≥640 优先，details 先缩（≥300）再自动关闭；sidebar 不让步。
`ctx.layout` 公开面仅 `toggleSidebar() / openDetails() / closeDetails()`，无宽度订阅。

## 6. 客户端事件目录（dsh-cordis-client-runner）

approval/requested、connection/reset、locale/change、question/requested、slots/changed、step/end、
step/start、theme/change、turn/end、turn/start —— 无 details/selection 事件。
