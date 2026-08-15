# 错误处理（宿主半）

> 路由错误如何被拦截、格式化并返回给浏览器半。核心契约：所有响应都是
> `{ ok: boolean, error?: string, ... }` 的 JSON；错误文案为中文、可操作。

---

## 统一包装：guard

每个路由必须包在 `guard` 内（`lib/index.js:181-191`），它做两件事：

1. **同源校验**（`isSameOrigin`，`lib/index.js:160-172`）：`Sec-Fetch-Site` 非
   `same-origin`/`none`，或 `Origin` host 与请求 host 不符 → `403 {ok:false,error:"forbidden"}`。
   **这是防局域网任意终端访问/文件读取的安全边界，任何路由不得绕过。**
2. **异常兜底**：handler 抛错 → `500 {ok:false, error: <message>}`（`instanceof Error` 取
   `.message`，否则 `String()`）。宿主进程永不因单请求崩溃。

## 响应辅助：respond

`respond(res, status, payload)`（`lib/index.js:136-139`）统一写 `JSON_HEADERS`
（`content-type: application/json; charset=utf-8` + `cache-control: no-store`）。
所有 JSON 响应必须经它，禁止手工 `writeHead`/`end` 拼 JSON（vendor 原始字节流是唯一例外）。

## 状态码矩阵（按路由类型）

| 场景 | 状态码 | 示例 |
|------|--------|------|
| 成功 | 200 | `{ok:true, ...}` |
| 方法不允许（GET 路由收到非 GET 等） | 405 | `{ok:false, error:"method not allowed"}` |
| 参数非法（相对路径、q 超长、body 缺字段） | 400 | `{ok:false, error:"path 必须是绝对路径"}` |
| 资源不存在 / 目标类型不符 | 404 | `{ok:false, error:"文件不存在：<path>"}` |
| 跨站请求 | 403 | `{ok:false, error:"forbidden"}`（guard 统一） |
| 资源上限（会话数满） | 429 | `{ok:false, error:"终端会话已达上限（8）"}` |
| 依赖不可用 / 未捕获异常 | 500 | `{ok:false, error:"node-pty 不可用：请确认 profile 依赖树中存在 node-pty"}` |

## 校验顺序约定

每个路由内部按固定顺序执行（见 `host-fs-routes.md` 的"通用路由模式"）：

1. **method 检查**（非预期方法 → 405）；
2. **参数解析**：`new URL(req.url ?? "/", "http://localhost")`，绝对路径 / 长度等静态校验 → 400；
3. **存在性**：`stat` 失败 → 404（不区分"不存在"与"无权限"，统一 404）；
4. **类型**：list 要目录、read 要文件 → 不符 404；
5. **业务上限**：会话数 ≥ `MAX_SESSIONS` → 429；
6. 执行业务 → `respond(res, 200, ...)`。

## 请求体读取

- `readBody(req, limit = 16 * 1024)`（`lib/index.js:141-157`）：超限 reject + `req.destroy()`，
  防止超大 body 拖垮宿主。
- **JSON.parse 容错**：spawn/kill 等路由把解析失败当"空 body → 默认值"
  （`try { body = JSON.parse(...) } catch { /* 空 / 非法 body → 默认值 */ }`）；
  input/resize 必须的字段在解析后逐个 `typeof` 校验。任何解析失败都不得让路由崩溃。

## 可选依赖失败 = 明确错误，不是崩溃

本项目两处"可能缺失的依赖"都以**错误响应 + 可操作提示**处理，宿主进程保持存活：

- `node-pty` 缺失 → spawn 返回 500 + "请确认 profile 依赖树中存在 node-pty"（`loadPty` 返回 null）；
- `@xterm/xterm` 未安装 → vendor 路由 404 + "请在插件目录执行 pnpm install"（`loadVendor` 返回 null）。

## 反模式

- **吞掉所有错误**：`catch {}` 后仍返回 200 —— 客户端无法感知失败（例：output 轮询的
  `catch { /* 网络瞬断，下轮重试 */ }` 只在轮询场景可接受，且必须可自愈）。
- **错误信息泄漏内部细节**：不要把堆栈、pty 输出、文件内容拼进 error 文案。
- **超时/无界资源**：`readBody` 不设上限、`fs.readFile` 整读大文件（必须 `open()` 部分读，
  见 `host-fs-routes.md` 的 Wrong/Correct 示例）。
- **手工拼 JSON 响应**：漏掉 `content-type` 或 `cache-control: no-store`。
