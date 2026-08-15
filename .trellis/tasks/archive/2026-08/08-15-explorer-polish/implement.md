# 执行计划：资源管理器优化（语法高亮/文件图标/搜索/面包屑/树宽拖动）

平台为 DSH inline 工作流（主会话直接改码，加载 `trellis-before-dev` 而非 JSONL 注入）。

## 实现前检查

- [ ] 加载 `trellis-before-dev`，读取 `.trellis/spec/backend/index.md`（host-fs-routes.md）
      与 `.trellis/spec/frontend/index.md`（component-guidelines.md）。
- [ ] 基线确认：工作区干净（基线 `6fead23`）。

## 有序实现清单

1. **依赖**：`pnpm add @highlightjs/cdn-assets`（package.json + lockfile）；
   验证 `node_modules/@highlightjs/cdn-assets/highlight.min.js` 存在。
2. **宿主 `lib/index.js`**：
   - `loadVendor` 表新增 `highlight.min.js` 映射（UMD，javascript 类型）。
   - 新增 `GET /drawer/fs/search`：参数校验（root 绝对+目录存在、q 1–100）；
     广度优先递归（`readdir` withFileTypes，符号链接目录跳过）；命中 200 即停
     `truncated:true`；读失败子树跳过；同源 guard + 405。
   - 验证：`node --check` + mock 脚本（mock ctx 抓 handler：正常命中、深目录、
     空结果、q 非法、root 非法、200 上限）。
3. **客户端 CSS**（追加）：
   - `.sdw_toolbar/.sdw_crumbs/.sdw_crumb/.sdw_crumbSep`（工具栏/面包屑）；
   - `.sdw_treeSearch`（搜索框）、`.sdw_searchMeta`（结果小字）、`.sdw_treeResizer`；
   - `.sdw_pre .hljs-*` 高亮 token 主题（--dsw-* 变量）；删除 `.sdw_explorerRight`
     固定 230px（改 fallback）。
   - 验证：`node --check`。
4. **客户端高亮（FileView 改造）**：
   - 模块级 `HLJS_LANG` 映射表（ext→lang）+ `loadHljs()` 惰性 import
     （`import("/drawer/vendor/highlight.min.js")` → `globalThis.hljs`，缓存 Promise）；
   - FileView：done 且非 binary → 有映射语言则高亮渲染（失败降级纯文本）；
     fileBar 仅保留 size/截断 meta（移除 path 文本）。
5. **客户端文件类别图标**：约 10 个 `fileIcon(ext)` 内联 SVG（JS/TS、JSON、样式、
   网页、MD、Python、Shell、图片媒体、配置、默认）；`FileTree.renderEntry` 文件行
   与搜索结果列表换用类别图标。
6. **客户端搜索栏（FileTree 改造）**：`.sdw_treeSearch` 输入框 + 300ms 防抖 +
   `fetchJson("/drawer/fs/search?...")`；结果列表（类别图标、目录不可点击、
   父目录小字、truncated 提示、无结果提示）；清空恢复树。
7. **客户端工具栏 + 折叠 + 拖动（ExplorerPane 改造）**：
   - state `treeVisible`/`treeWidth`；file 模式渲染 `.sdw_toolbar`（面包屑分段纯显示
     + 右侧折叠按钮，aria 随状态）；树容器按 `treeVisible` 渲染、`style.width=treeWidth`；
   - `.sdw_treeResizer` mousedown 拖动（document 级 mousemove/mouseup，clamp 160–480，
     直接 DOM 更新 + 结束时 setState）；折叠时隐藏 resizer。
8. **spec 固化**：`host-fs-routes.md` 补 `/drawer/fs/search` 契约；
   `component-guidelines.md` 补高亮降级约定与拖动交互约定。
9. **回归自查**：左键展开/折叠、单例标签、cwd 跟随、二进制提示、主题切换不受影响。

## 验证命令

```bash
node --check lib/index.js
node --check lib/client.js
pnpm install --frozen-lockfile   # 依赖安装后
```

## 手测清单（映射验收标准）

| 验收 | 操作 | 预期 |
|------|------|------|
| AC1 | 打开 .js/.json/.css/.md 与 .txt | 前者语法着色、后者纯文本；明暗切换配色清晰 |
| AC2 | 展开含多类型的目录 | .js/.json/.png/.md 图标各异，未知类型默认图标 |
| AC3 | 树顶搜索框输入子串（含 node_modules 内文件名） | 出结果列表；点文件开标签；清空恢复树；无结果显示提示 |
| AC4 | 文件标签页 | 标签栏下工具栏：面包屑路径分段 + 折叠按钮切换树显隐；explorer 标签无此栏 |
| AC5 | 拖动树左边界 | 宽度变化、160–480 限制、内容区自适应 |
| AC6 | 回归旧功能 | 展开/折叠、单例聚焦、cwd 跟随、二进制提示正常 |
| AC7 | 临时移除 node_modules 或模拟 vendor 404 | 文件仍纯文本预览、无报错 |

## 风险文件与回滚点

- `lib/index.js`、`lib/client.js`、`package.json`、`pnpm-lock.yaml`：提交粒度
  第 1–2 步一个 commit（依赖+宿主+search）、第 3–7 步一个 commit（客户端）；
  回滚 = revert 对应提交。
- 风险点：hljs UMD 全局挂载（取 `globalThis.hljs` 兜底）；拖动时高频事件（直接 DOM
  更新避免 setState 抖动）；搜索大目录（200 上限提前终止）；面包屑超长路径（ellipsis）。

## 后续检查（Phase 3）

- 完成后 `trellis-check` 质量门 → spec 更新 → 提交 → 用户手测 → 归档 + journal。
