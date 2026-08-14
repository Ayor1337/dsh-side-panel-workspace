# 调研记录：xterm.js 6.x 浏览器无构建加载

日期：2026-08-14 · 结论：**`@xterm/xterm@6.0.0` 的 `lib/xterm.mjs` 是自包含 ESM 单文件，浏览器可直接动态 import，无需任何构建步骤。**

## 证据

- `npm view @xterm/xterm`：version 6.0.0，`main: lib/xterm.js`（CJS），`module: lib/xterm.mjs`，
  无 `browser` 字段、无 UMD dist。
- 解包 `xterm-6.0.0.tgz` 实测：
  - `lib/xterm.mjs` 340KB，`grep -c "^import\|from '\./"` = **0**（无任何静态/相对导入，自包含）；
  - 导出形式 `export{Dl as Terminal,...}`；
  - `css/xterm.css` 8KB（xterm 渲染必须加载此 CSS，否则行列测量全错）。
- 经典 `<script>` 内使用动态 `import()` 在 Chrome/Edge/Firefox 均合法 → client.js 保持
  自包含单文件形态，用 `await import("/drawer/vendor/xterm.mjs")` 加载即可。

## 插件接入方式（v2 采用）

- 宿主半提供静态路由从插件 `node_modules/@xterm/xterm/` 读盘：
  `GET /drawer/vendor/xterm.mjs`（text/javascript）与 `GET /drawer/vendor/xterm.css`（text/css）。
  junction 安装下 `import.meta.url` 为插件真实路径，`new URL("../node_modules/...", import.meta.url)` 可靠。
- 客户端：注入 `<link rel=stylesheet>`（data-plugin 标记防重复）→ `import()` 取 `Terminal`。
- 不引入 `@xterm/addon-fit`（addon ESM 无法保证无外部导入）；cols/rows 由客户端
  ResizeObserver + 隐藏测量元素手动计算（±1 列误差可接受）。
- 运行时改主题：`term.options.theme = {...}` 支持；颜色值需从 `getComputedStyle` 读
  `--dsw-*` 变量（CSS 变量不能直接传给 xterm theme）。

## 注意

- xterm 6.0.0 要求较新浏览器（ES2022+），dsh web 为本地现代浏览器壳，无兼容问题。
- 若未来升级 xterm 大版本，需重新验证 `lib/xterm.mjs` 自包含性（grep 检查 import 语句数）。
