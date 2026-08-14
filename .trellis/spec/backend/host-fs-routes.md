# Host File-System Routes (宿主只读文件路由)

> 资源管理器标签页的宿主半 API 契约。实现位于 `lib/index.js`。

## Scenario: /drawer/fs/list 与 /drawer/fs/read

### 1. Scope / Trigger

- 浏览器半无文件系统访问能力，树状图（列目录）与文件预览（读内容）必须经宿主路由代理。
- 契约属跨层（client fetch ↔ host route ↔ node fs），任何改动需同步两端。

### 2. Signatures

```
GET /drawer/fs/list?path=<absolute-path>
GET /drawer/fs/read?path=<absolute-path>
```

- 注册方式与所有 `/drawer/*` 路由一致：`ctx.webServer.register({ kind: "exact", path, handler })`，
  包在 `guard`（同源校验）内；方法非 GET 一律 405。
- 宿主**只读**：无写入、无会话状态、无缓存。

### 3. Contracts

**list 响应 200**：

```json
{ "ok": true, "path": "<dir>", "entries": [{ "name": "x", "path": "<abs>", "dir": true }] }
```

- `dir`：目录判定。符号链接按 `stat` 目标判定（失败/悬空按普通文件）。
- 排序：目录优先，再按 `name.localeCompare(name, undefined, { sensitivity: "base" })`。

**read 响应 200**：

```json
{ "ok": true, "path": "<file>", "size": 1924267, "truncated": true, "binary": false, "content": "..." }
```

- `size`：文件真实大小；`truncated`：`size > MAX_READ`（1MB）时只读前 1MB。
- `binary`：前 8000 字节含 NUL（`0x00`）→ true，此时**不返回 content 字段**（前端只显示提示）。
- 读取用 `open()` 部分读（`FileHandle.read` 循环至 `length` 或 `bytesRead === 0`），
  绝不 `readFile` 整个大文件。

### 4. Validation & Error Matrix

| 条件 | 状态 | 响应 |
|------|------|------|
| `path` 非绝对路径 | 400 | `{ok:false, error:"path 必须是绝对路径"}` |
| 文件/目录不存在 | 404 | `{ok:false, error:"文件不存在：<path>"}` / `"目录不存在：<path>"` |
| list 目标是文件 | 404 | 同上（目录不存在） |
| read 目标是目录 | 404 | 同上（文件不存在） |
| 跨站请求（Sec-Fetch-Site 非 same-origin/none 或 Origin host 不符） | 403 | `{ok:false, error:"forbidden"}`（guard 统一处理） |
| 读/列目录时 fs 异常 | 500 | guard 捕获 → `{ok:false, error:<message>}` |

- 错误一律 `{ok:false, error}` 中文文案，前端 `fetchJson` 直接展示。

### 5. Good/Base/Bad Cases

- Good：正常目录列条目（含隐藏文件与 node_modules，不排除——PRD D3）；正常文本返回 content。
- Base：空目录 → `entries: []`；空文件 → `content: ""`（NUL 检测对空 buffer 恒 false）。
- Bad：路径穿越/伪造——宿主**不设工作区根限制**。威胁模型与 `/drawer/terminal/spawn`
  （接受任意绝对 cwd）一致：同源插件间信任边界本不存在（终端已可执行任意命令）；
  UI 层天然只暴露树内路径。

### 6. Tests Required

- 行为级验证（mock `ctx.webServer.register` 抓 handler + mock req/res）：
  - list 根目录：200，目录优先排序断言；
  - read 文本：content 正确、binary=false；
  - read 二进制（如 `process.execPath`）：binary=true、content 字段缺失；
  - read >1MB 文件：`truncated:true`、content 长度恰为 1048576；
  - 不存在/相对路径/list 文件：404/400/404；
  - 跨站 `sec-fetch-site: cross-site`：403。

### 7. Wrong vs Correct

#### Wrong

```js
// 整个文件读入内存——超大文件拖垮宿主
const buf = await readFile(filePath);
```

#### Correct

```js
const length = Math.min(info.size, MAX_READ);
const handle = await open(filePath, "r");
try {
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
        const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
    }
    // ...
} finally {
    await handle.close();
}
```

---

## Scenario: /drawer/fs/search（文件名递归搜索）

### 1. Scope / Trigger

- 搜索栏需要全工作区按文件名匹配，浏览器半无递归列目录能力，必须宿主代理。
- 不排除 node_modules/隐藏目录（PRD D2）；性能由命中上限保护。

### 2. Signature

```
GET /drawer/fs/search?root=<absolute-dir>&q=<1-100 chars>
```

### 3. Contract

响应 200：

```json
{ "ok": true, "root": "<dir>", "q": "<query>", "truncated": false,
  "entries": [{ "name": "client.js", "path": "<abs>", "dir": false }] }
```

- 广度优先遍历（队列），结果先浅后深；`name.toLowerCase().includes(q.toLowerCase())` 命中。
- 命中 `MAX_SEARCH`（200）立即停止并 `truncated:true`。
- 符号链接目录跳过（防环）；单个目录 `readdir` 失败跳过该子树继续。

### 4. Validation & Error Matrix

| 条件 | 状态 | 响应 |
|------|------|------|
| `root` 非绝对路径 | 400 | `{ok:false, error:"root 必须是绝对路径"}` |
| `root` 不存在/非目录 | 404 | `{ok:false, error:"目录不存在：<root>"}` |
| `q` 为空或 >100 字符（trim 后） | 400 | `{ok:false, error:"q 长度须为 1-100 字符"}` |
| 跨站请求 | 403 | guard 统一 `{ok:false, error:"forbidden"}` |

### 5. Good/Base/Bad Cases

- Good：深目录命中（含 node_modules 内文件），`truncated:false`。
- Base：无命中 → `entries: []`；海量命中 → 恰 200 条 + `truncated:true`。
- Bad：符号链接环 → 因链接目录不入队，不会死循环。

### 6. Tests Required

- mock 行为级验证：正常命中（大小写不敏感）、空结果、q 空/超长 400、root 相对 400、
  大目录（node_modules 搜常见子串）200 条 + truncated、跨站 403。

---

## 约定：新增宿主路由的通用模式

- 所有路由：`route(path, guard(async (req, res) => {...}))`，先判 method（405），再解析
  `new URL(req.url ?? "/", "http://localhost")`，校验参数后 `respond(res, status, payload)`。
- 参数校验顺序：绝对路径 → stat 存在性 → 类型（list 要目录 / read 要文件）。
- 常量上限集中定义在文件顶部（`MAX_READ`、`MAX_SESSIONS`、`MAX_OUTPUT`、`MAX_SEARCH`）。
- vendor 分发约定：新第三方资源进 `loadVendor` 表 + `route("/drawer/vendor/<name>", ...)`
  注册，文件缺失回 404 并提示 pnpm install（见 highlight.min.js 与 xterm 两例）。
