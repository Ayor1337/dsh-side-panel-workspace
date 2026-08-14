# 执行计划：资源管理器标签页（文件树 + 内容预览）

平台为 DSH inline 工作流（主会话直接改码，加载 `trellis-before-dev` 而非 JSONL 注入）。

## 实现前检查

- [ ] 加载 `trellis-before-dev` 技能，读取 `.trellis/spec/frontend/index.md` 与
      `.trellis/spec/backend/index.md` 中相关规范（quality/type-safety/hook 等）。
- [ ] 确认工作区干净（当前干净，基线 commit `b1fad42`）。

## 有序实现清单

1. **宿主：`lib/index.js` 新增 `/drawer/fs/list` 与 `/drawer/fs/read`**
   - 常量：`MAX_READ = 1 << 20`。
   - `list`：绝对路径 + `stat` 目录校验；`readdir({withFileTypes:true})`；
     目录优先 + `localeCompare` 排序；返回 `{ok,path,entries:[{name,path,dir}]}`。
   - `read`：绝对路径 + `stat` 文件校验；超 1MB 截断读；前 8000 字节 NUL 检测；
     返回 `{ok,path,size,truncated,binary,content}`。
   - 两路由均包 `guard`（同源校验）、405 处理，与现有路由风格一致。
   - 验证：`node --check lib/index.js`。

2. **客户端：`lib/client.js` CSS 与图标**
   - CSS 追加：`.sdw_explorer/.sdw_explorerLeft/.sdw_explorerRight/.sdw_tree/.sdw_treeRow/`
     `.sdw_treeCaret/.sdw_fileView/.sdw_pre` 等（取 --dsw-* 变量 + fallback）。
   - 图标：`iconFolder`（打开/关闭文件夹用同一图标 + caret 旋转）、`iconFile`。
   - 验证：`node --check lib/client.js`。

3. **客户端：`FileTree` 组件**
   - 状态：`expanded:Set`、`data:Map<path,{entries}|{error}>`、`rootEntries`、加载态。
   - `load(path)`（fetch `/drawer/fs/list?path=`）；cwd 变化（`getCwd()` 依赖）→ 重置并
     重载根；展开 = 置 expanded + 请求（每次展开都重新请求，满足 AC7）；折叠 = 移出 expanded。
   - 行渲染：目录行左键 toggle；文件行左键 `onOpenFile(path,name)`；行前 caret（▶/▼）
     与图标；错误行显示文案，再点重试。
   - 验证：手测 AC1/AC2/AC7/AC8。

4. **客户端：`ExplorerPane` 组件（kind: explorer | file）**
   - 左侧 `FileView`：空态（"从右侧树中选择文件"）/ 读取中 / 二进制提示 / 截断提示 /
     `<pre>` 内容 / 错误；右侧 `FileTree`（通过 props 拿 `getCwd` 与 `onOpenFile`）。
   - 验证：手测 AC3/AC5/AC6。

5. **客户端：`DrawerPanel` 集成**
   - "+"菜单加"资源管理器"（单例，与 browser 同逻辑）；标签渲染分支加 explorer/file
     （chip 标题/图标）；`closeTab` 不变。
   - `openFile(path,name)`：按 path 查重（D4，已存在只聚焦），否则新增 `{kind:"file",path,name}`
     并激活；`ExplorerPane` 的树回调经 props 接到该函数。
   - 验证：手测 AC3/AC4/AC10。

## 验证命令

```bash
node --check lib/index.js
node --check lib/client.js
pnpm install --frozen-lockfile   # 若依赖缺失（本项目无构建步骤）
```

## 手测清单（映射验收标准）

| 验收 | 操作 | 预期 |
|------|------|------|
| AC1 | 打开抽屉 → "+" → 资源管理器 | 左侧空态提示，右侧树根=当前会话 cwd，含隐藏文件/node_modules 条目 |
| AC2 | 左键点文件夹行两次 | 展开显示子项 → 折叠 |
| AC3 | 左键点文件 | 新标签（文件名）激活，左内容右树 |
| AC4 | 再点同一文件 | 不新增，聚焦已有标签 |
| AC5 | 点二进制文件（如 .png/.exe） | 左侧"不支持预览"，无乱码 |
| AC6 | 点 >1MB 文本文件 | 显示前 1MB + 截断提示，不卡死 |
| AC7 | 终端新建文件 → 折叠再展开父目录 | 新条目可见 |
| AC8 | 切换会话 | 树根切换 |
| AC9 | 切换明暗主题 | 配色正常 |
| AC10 | 关闭文件/资源管理器标签 | chip 关闭按钮生效 |

## 风险文件与回滚点

- `lib/index.js`、`lib/client.js`：全部改动在这两个文件，git 提交粒度建议
  第 1 步一个 commit、第 2–5 步一个 commit；回滚 = revert 对应提交。
- 风险点：树请求并发（快速连续展开）→ 展开状态置 loading 防重复请求；
  大目录渲染（根目录数千条目）→ 单层列表渲染量可控，如卡顿再加虚拟化（本期不做）。

## 后续检查（Phase 3）

- 完成编码后运行 `trellis-check` 技能做质量门；通过后 spec 更新（如新增约定）与 commit。
