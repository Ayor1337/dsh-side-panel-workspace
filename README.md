# dsh-plugin-side-drawer

DSH Web 插件：在聊天页右侧添加一个**抽屉**，内含**终端**与**浏览器**两个功能。
抽屉默认折叠，由聊天页右上角的按钮控制；展开时占用官方右侧 `details` 栏，
聊天列自动让位，**文字不会被抽屉遮挡**。

## 功能

- 右上角开关按钮（会话头部右侧工具区，追加性席位），默认折叠
- 展开 = `ctx.layout.openDetails()`：官方三栏布局让位，中栏（聊天）变窄，无遮挡
- **终端标签页**：xterm.js 真终端（ANSI 颜色 / 控制序列、逐键输入、shell 原生历史与回显），
  真实 shell（Windows 下 pwsh，回退 powershell.exe；POSIX 下 $SHELL/bash）；
  chip 风格标签 + `+` 菜单新建，**支持多开**（每标签一个独立 shell，上限 8 个会话，标签名取工作目录名）；
  面板尺寸变化自动同步 pty；工作目录跟随当前会话的工作区
- **折叠不断连**：折叠/切换标签页只隐藏不卸载，终端会话与输出保持；页面刷新会话重建
- **浏览器标签页**：地址栏 + 后退/前进/刷新 + iframe 内嵌（sandbox / referrerPolicy 加固）
  + 记住上次网址（重开抽屉自动恢复）+ 新窗口打开（拒绝内嵌的站点兜底）
- 明 / 暗主题自适应（全部使用 DSH 主题变量，终端配色跟随主题切换）；
  仅新增 `@xterm/xterm` 一个依赖（浏览器半经宿主路由动态加载，无构建步骤）

## 工作原理（DSH 双面插件）

1. **宿主半** `lib/index.js`：懒加载 `node-pty` 管理终端会话（多会话模型：每标签一个、上限 8、每会话 1MB 输出环形缓冲），
   通过 `webServer` 注册 `/drawer/terminal/{spawn,input,output,resize,kill}` JSON 路由，
   以及 `/drawer/vendor/xterm.{mjs,css}` 静态路由（从插件 `node_modules/@xterm/xterm` 读盘分发）；
   所有路由校验 `Sec-Fetch-Site` / `Origin`，拒绝跨站调用；
2. **浏览器半** `lib/client.js`：由 `client-modules` 以 `/plugins/<id>/client.js` 提供，
   以 `priority: -1` 阴影方式注册进官方 `details` 槽（**不销毁**官方 DetailsPanel 及其子槽声明，
   详见任务工件 design.md），开关按钮注册进 `conversation.session.header.utilities`；
   终端经动态 `import("/drawer/vendor/xterm.mjs")` 加载 xterm.js，100ms 轮询增量输出；
3. **清单** `package.json`：`dsh.bundle.patch`（加入 bundle 层）与 `dsh.client`（浏览器名单）双声明；
4. **补丁** `cordis.patch.yml`：插入宿主行 `side-drawer`（`inject: [webServer]`）。

## 安装

> 前置：无论哪种方式，都需要先在**插件目录执行一次 `pnpm install`**（安装 `@xterm/xterm`，
> 供宿主 vendor 路由向浏览器分发；未安装时终端页会显示修复提示，其余功能不受影响）。

### 标准方式（插件与 profile 在同一磁盘时）

```bash
pnpm install   # 在插件目录执行一次
dsh plugin --profile web add <插件目录>
# dsh plugin 是 pnpm 转发器，会自动维护 dsh.profile.bundles
```

### 本机（跨盘：profile 在 C:，插件在 E:）

pnpm v10 在 Windows 上处理跨盘 `link:`/`file:` 依赖存在缺陷（会损坏 junction），
本机采用"手动 junction + 不声明依赖"方式：

```powershell
# 0) 插件目录执行一次 pnpm install（安装 @xterm/xterm）
pnpm install

# 1) 创建跨盘 junction
cmd /c mklink /J "C:\Users\ayor\.dsh\profiles\web\node_modules\dsh-plugin-side-drawer" "E:\Projects\workspace-deepseek-plugin"

# 2) 在 C:\Users\ayor\.dsh\profiles\web\package.json 的 dsh.profile.bundles 末尾追加：
#    "dsh-plugin-side-drawer"
#    （不写入 dependencies，否则 pnpm install 会重建并损坏 junction）
```

> 隐式依赖说明：宿主半依赖 `node-pty`，它是 **dsh 主包的嵌套依赖**
> （`@deepseek-ai/dsh/node_modules/node-pty`）。注意 dsh 进程不导出 `DSH_HOME` 环境变量
> （仅内部按 `$DSH_HOME` > `~/.dsh` 解析），因此宿主半的解析基准依次为：
> dsh 入口脚本路径（`process.argv[1]`，最可靠）→ `$DSH_HOME`（缺省 `~/.dsh`）profile
> → 插件自身目录。全部失败时终端页给出明确错误提示，宿主进程不受影响。
> `@xterm/xterm` 则由插件自身 node_modules 提供（junction 指向插件真实路径，
> 宿主 vendor 路由从那里读盘），不占用 profile 依赖树。

## 宿主补丁：放宽 details 栏宽度上限

宿主把 details 栏宽钳制在 300–520px（`dsh-client-ui-layout` 的 `setDetails` / `computeColumns` 两处），
插件无 API 可改。全局 dsh 为 npm 平铺安装（非 pnpm 管理，无法用 pnpm patch），
故提供可重放的补丁脚本：

```bash
node scripts/apply-details-width.mjs        # 上限改为 900（默认）
node scripts/apply-details-width.mjs 1200   # 指定其他上限
```

脚本幂等、可重复执行；**dsh 升级覆盖后需重跑一次**。改完**重启 `dsh web`** 生效，
之后拖分隔条即可在 300–900px 间调整抽屉宽度，聊天列正常让位。

## 启用与更新

- 插件集合的变更在**重启 `dsh web`** 后生效（元数据在启动时扫描并缓存）。
- **宿主半（`lib/index.js`）的改动需要重启 `dsh web`**；仅浏览器半（`lib/client.js`）改动时刷新页面即可。
- 更新插件代码：直接改本仓库文件（junction 实时生效）。

## 卸载

```powershell
cmd /c rmdir "C:\Users\ayor\.dsh\profiles\web\node_modules\dsh-plugin-side-drawer"
# 并从 profile package.json 的 dsh.profile.bundles 中移除 "dsh-plugin-side-drawer"
```

## 已知限制

- 逐键输入经 HTTP 回环（100ms 轮询 + POST 回传），回显延迟略高于本地终端；传输层为 HTTP 轮询（无 SSE/WebSocket）。
- 终端尺寸 cols/rows 为客户端近似测量（±1 列误差），极端等宽字体渲染差异下折行可能差 1 列。
- 终端会话上限 8 个；任一浏览器页面刷新/关闭都会回收宿主侧**全部**终端会话（pagehide 统一兜底），其他窗口的终端标签重开后需重建。
- 浏览器 iframe 的后退/前进仅跟踪**地址栏导航**（iframe 内部跨域跳转不可感知）；
  被 X-Frame-Options / CSP 拒绝的站点仍只能新窗口打开（不做代理重写）。
- 抽屉状态不跨刷新持久化：刷新后回到折叠默认，终端会话由 pagehide 回收、重开后重建。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `package.json` | 双面声明（dsh.bundle.patch / dsh.client）+ @xterm/xterm 依赖声明 |
| `cordis.patch.yml` | 宿主行插入补丁（side-drawer + webServer 注入） |
| `lib/index.js` | 宿主半（node-pty 会话 + /drawer/terminal/* 路由 + /drawer/vendor/* 静态分发） |
| `lib/client.js` | 浏览器半（抽屉面板 + 开关按钮 + xterm 终端 / 浏览器 UI） |
