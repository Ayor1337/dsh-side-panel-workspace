# 目录结构（浏览器半）

> 前端是**单文件** `lib/client.js`（约 1180 行）。没有 src/、没有组件目录、没有构建产物——
> 这是 DSH client-modules 的自包含脚本契约决定的（无 import/export，无构建步骤）。

---

## 单文件解剖（按出现顺序，`lib/client.js`）

| 区段 | 行号参考 | 内容 |
|------|----------|------|
| 文件头注释 | 1-21 | UI 合同：注册席位、终端/浏览器/资源管理器行为、主题约定 |
| `window.__ModuleLoader__.load({ id, factory })` | 22-24 | 唯一入口；`id: "dsh-plugin-side-drawer"` |
| factory 开头 | 25-27 | `const React = require("react")` + 解构 hooks + `const e = React.createElement` |
| CSS 区 | 30-135 | `CSS` 字符串数组（`sdw_` 前缀）→ 注入 `<style data-plugin>`（防重复标记） |
| 图标区 | 138-203 | 内联 SVG 工厂（`iconXxx()`）、`FILE_ICON_GROUPS` 扩展名类别表 |
| 常量与共享辅助 | 206-256 | xterm 约定（字体/字号/POLL_MS）、`clampNum`、`ensureXtermCss`、`readTermTheme` |
| 各 Pane 组件 | 259-1102 | `TerminalPane` → `BrowserPane` → `FileTree` → `FileView` → `ExplorerPane` → `DrawerPanel` → `ToggleButton` |
| 注册区 | 1104-1178 | `inject = ["slots","sessions"]`、`apply(ctx)`：布局/展开状态/cwd pub-sub、两个 `ctx.slots.inject` |
| 结尾 | 1180-1181 | `return { apply, inject }` |

**新代码放哪里**：新标签页类型 → 在 `DrawerPanel` 之前新增 Pane 函数 + `addTab`/`tabTitle`/
`tabIcon` 分支；新图标 → 图标区加 `iconXxx()` 工厂；新宿主 GET → 复用 `fetchJson`；
新宿主 POST → 复用 TerminalPane 的 `api` 模式（可提升为 factory 级共享）。

---

## 命名约定

- **CSS class**：全部 `sdw_` 前缀（`sdw_root`、`sdw_chip`、`sdw_treeRow`…），避免与宿主样式
  冲突；状态后缀 `On`/`Open`/`Fold`（如 `sdw_chipOn`、`sdw_treeCaretOpen`）。
- **插件标记**：注入的 `<style>`/`<link>`/`<script>` 一律带 `data-plugin="dsh-plugin-side-drawer"`
  （loader 卸载时回收），样式另加 `data-plugin-css` 防重复（`CSS_TAG` / `XTERM_CSS_TAG`）。
- **常量**：区段内顶部定义，全大写（`POLL_MS`、`TERM_FONT_SIZE`、`TREE_MIN_WIDTH`、
  `HLJS_LANG`、`FILE_ICON_GROUPS`）。
- **组件**：PascalCase（`DrawerPanel`、`TerminalPane`）；普通函数/变量 camelCase。

---

## 组织约定

- **自上而下依赖**：辅助函数定义在使用它的组件之前（`fetchJson` → `FileTree`/`FileView`；
  `loadHljs` → `FileView`），组件间只经 props 通信，无跨组件全局变量。
- **共享请求辅助**：GET+JSON 校验用 factory 级 `fetchJson`（`lib/client.js:589-594`）；
  TerminalPane 的 POST 用其内部 `api`（`lib/client.js:271-279`）。禁止在组件里内联重复的
  fetch + 校验代码块。
- **props 契约**：槽注册组件只收 `inject()` 返回值（`subscribe`/`actions`/`getCwd`…）；
  可见性等生命周期标志（`visible`）作为普通 prop 下传。

---

## 反模式

- **新增第二个 client 文件 / 顶层 import**：破坏自包含契约（`import()` 只能用于
  `/drawer/vendor/*` 动态加载，见 `component-guidelines.md`）。
- **JSX / TS 语法**：无构建步骤，`React.createElement`（`e`）是唯一渲染方式。
- **样式硬编码颜色**：只用 `--dsw-*` 变量 + 兜底（明暗自适应）；唯一例外是
  `FILE_ICON_GROUPS` 的类别色（固定品牌色，图标场景可接受）。
