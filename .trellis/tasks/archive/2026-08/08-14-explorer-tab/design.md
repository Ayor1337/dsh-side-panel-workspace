# 设计：资源管理器标签页（文件树 + 内容预览）

## 架构与边界

```
浏览器半 (lib/client.js)                          宿主半 (lib/index.js)
─────────────────────────                      ─────────────────────────
DrawerPanel（现有标签系统）                     webServer 路由（现有同源 guard）
 ├ TerminalPane / BrowserPane（现有）
 └ ExplorerPane（新增，kind: explorer | file）
     ├ FileView  左侧：空态 / 文件内容 <pre>      GET /drawer/fs/list?path=
     └ FileTree  右侧：懒加载树（左键展开/折叠）   GET /drawer/fs/read?path=
```

- 宿主半只做"读"：列目录、读文件。无写入、无缓存、无会话状态（与终端不同的最简形态）。
- 客户端半复用现有标签系统（`tabs` state / chip / 关闭按钮），新增 `explorer`、`file` 两种
  kind；`file` 携带 `{path, name}`。
- 树组件为纯客户端状态（展开集合 + 按路径缓存子项列表），无持久化（PRD 范围外）。

## 宿主 API 契约

### GET /drawer/fs/list?path=<abs>

- 校验：`path` 为绝对路径、`stat` 为目录，否则 400。
- 读取：`readdir(path, { withFileTypes: true })`；对每个条目 `entry.isDirectory()` 判定类型
  （symbolic link 按 `stat` 目标判定，失败按普通文件处理）。
- 排序：目录优先，再按 `name.localeCompare(other, undefined, {sensitivity:"base"})`。
- 响应 200：`{ ok:true, path, entries:[{ name, path, dir }] }`（`path` 为子项绝对路径，
  供后续 list/read 与前端标签寻址）。
- 错误：读目录失败 → 500 `{ ok:false, error }`（含权限不足时的友好信息）。

### GET /drawer/fs/read?path=<abs>

- 校验：`path` 为绝对路径、`stat` 为普通文件，否则 400。
- 大小上限：`MAX_READ = 1MB`。`stat.size > MAX_READ` → 只读前 1MB，`truncated:true`。
- 二进制检测：读取内容前 8000 字节，含 `0x00`（NUL）→ `binary:true`（此时不返回 content，
  前端只显示提示，避免传输/渲染乱码）。
- 响应 200：`{ ok:true, path, size, truncated, binary, content }`（content 为 UTF-8 字符串；
  binary 时省略）。
- 错误：读失败 → 500 `{ ok:false, error }`。

### 安全

- 两个路由与现有路由一样包在同源校验 `guard` 内（防跨站/局域网攻击）。
- 路径穿越：`path` 必须绝对且存在；list 限目录、read 限文件。宿主**不设工作区根限制**——
  威胁模型与现有 `/drawer/terminal/spawn` 一致（该路由已允许任意存在的绝对路径 cwd 执行
  命令，同源插件间信任边界本不存在）。UI 层天然只暴露树内路径（用户只能点击树）。
- 防护资源滥用：1MB 读上限 + 无递归全量列目录（仅按需单层），杜绝超大目录拖垮宿主。

## 客户端组件设计

### FileTree（新增）

- Props：`{ getCwd, onOpenFile }`。
- 状态：`expanded:Set<path>`、`nodes:Map<path, {entries, loading, error}>`、根目录条目。
- 数据流：挂载/cwd 变化 → 重置并 `load(root)`；展开文件夹 → 未缓存则 `load(dirPath)` 置入
  `nodes`；折叠仅从 `expanded` 移除（缓存保留，重新展开走新请求——AC7 依赖此行为：
  缓存不用于重新展开，保证新条目可见）。等等——重新展开走新请求会覆盖缓存；折叠时不移除
  缓存但展开时仍重新请求，等价于"每次展开都刷新"，缓存仅避免同屏重复渲染重复请求。
  简化：展开时总是重新请求（KISS，满足 AC7），无需 nodes 缓存；但展开状态要保留已加载
  数据用于渲染。实现上：`expanded` 集合 + `data:Map<path,{entries|error}>`，展开时置
  loading 后请求更新。折叠不清数据（显示无关，展开时会刷新）。
- 交互：文件夹行**左键**点击 → toggle 展开/折叠（用户明确要求左键，无需箭头图标双击逻辑；
  行前加三角形指示箭头图标，纯视觉）；文件行左键点击 → `onOpenFile(path, name)`。
- 选中态：当前文件标签对应的路径高亮（可选增强，见实现步骤）。
- 错误态：条目区显示错误文案与重试（重新点击展开即重试）。

### ExplorerPane（新增，kind: explorer | file）

- 布局：`.sdw_explorer { display:flex; }` → `.sdw_explorerLeft { flex:1; min-width:0; }`
  + `.sdw_explorerRight { width:220px; border-left:1px; overflow:auto; }`。
- `kind==="explorer"`：左侧空态（iconFolder + "从右侧树中选择文件"）。
- `kind==="file"`：挂载时 `read(path)`；左侧显示：
  - 加载中：居中"正在读取…"；
  - `binary`：提示"不支持预览（二进制文件）"；
  - 成功：`<pre>`（等宽字体、white-space:pre-wrap、word-break:break-all、可滚动），
    顶部信息条显示路径 + 大小 + 截断提示（`truncated` 时"仅显示前 1MB"）。
  - 失败：错误文案。
- 右侧：`<FileTree getCwd onOpenFile={...}/>`（每个标签页各自一棵树，展开状态独立——
  KISS，PRD 已列"跨标签同步展开状态"为范围外）。

### DrawerPanel 集成（修改现有）

- `addTab` 扩展：`explorer` 单例（与 browser 相同逻辑：已存在只切换）；`file` 单例按
  `t.path` 查重（D4：已存在只聚焦）。
- 打开文件回调：`openFile(path, name)` → 查重 → 新增 `{key, kind:"file", path, name}`
  并激活。**回调来源是树**：树在每个 ExplorerPane 内，因此 openFile 需上抛到 DrawerPanel
  的 tabs 层（通过 props 传入）。
- 标签渲染：`kind==="explorer"` → chip 标题"资源管理器" + 文件夹图标；
  `kind==="file"` → chip 标题为文件名 + 文件图标；关闭按钮沿用现有 `closeTab`。
- "+"菜单新增"资源管理器"项（iconFolder）。
- 布局：explorer/file 标签内容为 `ExplorerPane`（`.sdw_pane` 内、与终端/浏览器同级、
  `display: active? flex:none` 保活切换——与现有机制一致；保活意味着文件内容不重读，
  与浏览器标签行为一致）。

## 复用与兼容

- 复用现有：`api` fetch 模式、错误文案样式（`.sdw_err`）、空态样式（`.sdw_start`）、
  chip/菜单/按钮样式、同源 guard、`respond`、`clamp` 等宿主工具。
- 新增 CSS 全部取 `--dsw-*` 变量并带 fallback（与现有样式同款）。
- 不修改现有路由与标签行为；新代码以增量方式插入（终端/浏览器功能零影响）。
- 无构建步骤：纯原生 JS + React.createElement（与现有一致）。

## 回滚

- 全部改动在 `lib/index.js` / `lib/client.js` 两个文件内增量完成，git revert 单提交即回滚。
- 无持久化（无 localStorage/宿主状态），卸载插件或回滚后零残留。

## 取舍记录

- **每标签一棵树 vs 共享树状态**：选择每标签独立树。共享需把展开状态提升到抽屉级并同步
  多实例，复杂度高而收益低（PRD 已列范围外）。
- **展开总是重新请求 vs 缓存复用**：选择重新请求。目录内容变化（终端里增删文件）后
  重新展开即可见（AC7），代价是每次展开一次轻量 list 请求。
- **1MB 读上限**：文本预览场景足够；限制宿主内存与传输。
