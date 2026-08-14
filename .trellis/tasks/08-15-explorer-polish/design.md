# 设计：资源管理器优化（语法高亮/文件图标/搜索/面包屑/树宽拖动）

## 架构与边界

```
浏览器半 (lib/client.js)                              宿主半 (lib/index.js)
─────────────────────────                          ──────────────────────────
ExplorerPane（新增工具栏/折叠/拖动宽度 state）       vendor 路由 + highlight.min.js（UMD）
 ├ Toolbar（file 模式：面包屑 + 折叠按钮）           GET /drawer/fs/search?root=&q=（递归搜索）
 ├ FileView（高亮渲染，hljs 加载失败降级 plaintext）
 └ FileTree（+ 搜索框/结果列表、类别图标）           GET /drawer/fs/list、/drawer/fs/read（不变）
```

- 搜索为宿主新路由（浏览器无递归列目录能力）；高亮为纯客户端（内容已由 read 返回）。
- 宽度/折叠状态在 ExplorerPane 内部（标签页级，刷新回默认，不持久化——与既有约定一致）。

## 宿主扩展

### vendor 分发 highlight.js（D1）

- `package.json` 新增依赖 `@highlightjs/cdn-assets`（官方 CDN 构建产物包，研究确认含
  UMD `highlight.min.js`；npm 主包 `highlight.js` 无浏览器裸用产物）。
- `loadVendor` 表新增：`"highlight.min.js": ["../node_modules/@highlightjs/cdn-assets/highlight.min.js", "text/javascript; charset=utf-8"]`。
- 客户端加载：`await import("/drawer/vendor/highlight.min.js")` 后取 `globalThis.hljs`
  （UMD 在浏览器原生 ESM 中无 exports/module，走全局挂载分支）；取不到则降级纯文本。
- 语言映射表（扩展名 → hljs 语言 id，全部落在 common 37 语言集内）：
  `js/jsx/mjs/cjs→javascript`、`ts→typescript`、`tsx→typescript`、`json→json`、
  `css→css`、`scss→scss`、`html/htm/xhtml→xml`、`xml/svg→xml`、`md/markdown→markdown`、
  `py→python`、`sh→bash`、`bash→bash`、`yml/yaml→yaml`、`ini/toml→ini`、`sql→sql`、
  `java→java`、`go→go`、`rs→rust`、`c/h→c`、`cpp/cc/cxx/hpp→cpp`、`kt→kotlin`、
  `lua→lua`、`rb→ruby`、`php→php`。未匹配 → plaintext（不调用高亮）。

### GET /drawer/fs/search（D2）

- 参数：`root`（绝对路径、必须存在且为目录）、`q`（1–100 字符，trim 后非空）。
- 行为：递归 `readdir({withFileTypes:true})` 广度优先；符号链接目录跳过（防环）；
  条目 `name.toLowerCase()` 含 `q.toLowerCase()` → 命中推入；累计 200 条立即停止并置
  `truncated:true`；读目录失败跳过该子树（继续搜索）。
- 响应 200：`{ ok:true, root, q, truncated, entries:[{ name, path, dir }] }`。
- 校验错误：root 非绝对/不存在/非目录 → 400/404；q 空 → 400。包同源 guard、405 处理，
  与 list/read 同风格。
- 契约写入 `.trellis/spec/backend/host-fs-routes.md`（实现阶段）。

## 客户端改造

### 语法高亮（FileView 改造，FR1）

- 文件顶部模块级：`HLJS_LANG` 映射表；`loadHljs()` 惰性 import + 缓存 Promise。
- `FileView` 渲染分支：phase done 且非 binary 时，按 `fileExt(path)` 查映射；
  有语言 → 尝试 `hljs.highlight(content, { language })`（hljs 未就绪则先 await loadHljs，
  失败回退纯文本）；`result.value` 作为 children 传入 `<pre className="sdw_pre">`。
- 高亮主题自写（CSS 数组追加，取 --dsw-* 变量 + fallback）：
  `.sdw_pre .hljs-keyword/.hljs-string/.hljs-comment/.hljs-number/.hljs-title/
  .hljs-attr/.hljs-literal/.hljs-built_in/.hljs-type/.hljs-params/.hljs-meta` 约 10 个
  token 类，颜色映射：keyword→business-primary、string→success/绿、comment→label-tertiary、
  number→warning/橙等；明暗自动适配（变量随主题切换）。
- 文件头注释"UI 合同"补资源管理器高亮说明。

### 文件类别图标（FR2）

- 新增 `iconFileFor(ext)`：返回 { icon, } 或直接函数式 `fileIcon(ext)` 组件选择器：
  - js/jsx/ts/tsx/mjs → JS/TS 徽标（黄色底 JS 字样的简化 SVG 色块）
  - json → 花括号徽标；css/scss/less → 样式徽标；html/htm/xml/svg → 标签徽标
  - md → 下箭头 M 徽标；py → 蓝黄蛇形简化；sh/bash → 终端提示符徽标
  - 图片（png/jpg/jpeg/gif/svg/webp/ico）与媒体（mp3/mp4/mov/avi）→ 图片/媒体徽标
  - ini/toml/yaml/yml/env/conf → 齿轮徽标；无匹配 → 现有 `iconFile`
  - 实现为带类别色的内联 SVG（色值固定，明暗均可读；约 10 个函数，体积可控）。
- `FileTree.renderEntry` 文件行改用 `fileIcon(entry.name)`；目录行保持 `iconFolder`。
- 搜索结果列表同样使用类别图标。

### 搜索栏（FileTree 改造，FR3）

- FileTree 顶部渲染 `.sdw_treeSearch` 输入框（占位"搜索文件名"）。
- state：`query`、`results`（null=未搜索 / []+done=无结果 / 数组）、`searching`。
- 防抖：`useEffect([query])` setTimeout 300ms；空 query → 清 results 恢复树。
- 请求 `fetchJson("/drawer/fs/search?root=&q=")`；结果替换树区域渲染：
  `.sdw_treeRow`（文件 → 类别图标 + name + 父目录小字；目录 → iconFolder，仅展示不可点击）；
  点击文件 → `onOpenFile(entry.path, entry.name)`；`truncated` → 列表底部提示
  "仅显示前 200 条匹配"。
- 搜索激活时树的主体（懒加载树）不渲染；清空输入恢复（树的 expanded/children 状态保留）。

### 工具栏与树宽拖动（ExplorerPane 改造，FR4/FR5）

- ExplorerPane 新增 state：`treeVisible`（默认 true）、`treeWidth`（默认 230）。
- `kind==="file"` 时渲染 `.sdw_toolbar`（整宽，标签栏下第一行）：
  - 左侧 `.sdw_crumbs`：`path` 按 `/[\\/]/` 分段渲染为 `段 + ▸` 文本链（纯显示，
    title=完整路径，超长省略号截断、末段加粗）；盘符根（如 `E:`）作首段。
  - 右侧 `.sdw_btn`：折叠/展开图标（iconCaret 旋转或双箭头 SVG），title/aria-label
    随状态切换，点击 `setTreeVisible(!treeVisible)`。
- 树区域：`treeVisible === false` → 不渲染右侧树容器（左侧内容占满）；`true` → 渲染
  `.sdw_explorerRight`（`style={{ width: treeWidth }}`）。
- 拖动：树左边界放 `.sdw_treeResizer`（4px，cursor:col-resize，hover 高亮）。
  mousedown → 记录 startX/startWidth，`document` 挂 mousemove（`treeWidth =
  clamp(startWidth + dx, 160, 480)` 直接写 ref DOM style，`user-select:none`）→ mouseup
  卸载并 setState 持久。折叠时 resizer 一并隐藏。
- `.sdw_explorerRight` 宽度由 style 控制，删除 CSS 中固定 `width:230px`（保留 fallback）。
- FileView 原 `.sdw_fileBar` 仅保留 size/截断 meta（移除 path 文本——面包屑已承载路径）。

### 复用与兼容

- 复用：`fetchJson`、`.sdw_btn`、`.sdw_treeRow`、`guard/respond`、vendor 缓存模式、
  `onOpenFile` 单例逻辑。不改终端/浏览器代码与既有路由行为。
- 高亮与图标均为纯增量；未安装依赖时：hljs 降级纯文本（AC7）、图标为自绘 SVG 无外部依赖。

## 回滚

- 改动仍限于 `lib/index.js` / `lib/client.js` / `package.json`（+lockfile）；
  revert 对应提交即回滚；无持久化状态残留。

## 取舍记录

- **自写高亮主题 vs 引入官方 github/github-dark 双主题切换**：选自写（~15 行，
  --dsw-* 变量明暗自动适配，省去主题切换逻辑与两个 css 分发）。
- **搜索命中即停（200 条）**：全工作区含 node_modules 递归可能遍历数万条目；200 条
  上限保证宿主毫秒~百毫秒级返回，超限以 truncated 提示而非静默丢弃。
- **宽度/折叠状态不共享**：每个 ExplorerPane 独立（KISS）；跨标签同步无用户需求，
  且会引入模块级状态。
- **搜索结果目录项不可点击**：定位树节点需要祖先链展开（额外状态机），收益低；
  文件点击已覆盖主要场景，范围外记录于 PRD。
