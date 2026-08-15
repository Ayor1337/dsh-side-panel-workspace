# 目录结构（宿主半）

> 后端代码如何组织：单文件宿主行 + 配套清单/补丁/验证脚本，无多包、无 src 目录。

---

## 仓库布局

| 路径 | 职责 |
|------|------|
| `package.json` | 双面声明：`dsh.bundle.patch`（宿主行补丁层）+ `dsh.client`（浏览器半）+ 依赖（`@xterm/xterm`、`@highlightjs/cdn-assets`） |
| `cordis.patch.yml` | 宿主行插入补丁：`- insert: { id: side-drawer, inject: [webServer] }` |
| `lib/index.js` | **宿主半（唯一后端代码）**：路由 + 终端会话管理 |
| `lib/client.js` | 浏览器半（前端规范见 `../frontend/`，非后端职责） |
| `scripts/apply-details-width.mjs` | 宿主补丁脚本：放宽 details 栏宽度上限（幂等、可重放） |
| `verify-host.mjs` | 宿主半冒烟测试（mock webServer + 真实 spawn shell 全链路） |
| `verify-client.mjs` | 浏览器半冒烟测试（VM 沙箱加载 client.js 断言注册行为） |

---

## lib/index.js 内部组织（按出现顺序）

1. **文件头注释**：职责清单 + 依赖说明 + 安全声明（见 `lib/index.js` 顶部 15 行）。
2. **imports**：仅 Node 内置模块（`node:module` / `node:fs/promises` / `node:os` / `node:path`）；
   第三方依赖一律懒加载（见 loadPty）。
3. **常量集中区**：`MAX_OUTPUT` / `MAX_SESSIONS` / `MAX_READ` / `MAX_SEARCH` / `JSON_HEADERS`
   全部在文件顶部（`lib/index.js:21-25`）。新增上限常量必须放这里。
4. **模块级状态**：`terminals` Map（会话表）、`vendorCache` Map、`ptyModule`/`ptyLoadTried`
   懒加载标记。模块级状态只有这三类，路由内不存全局变量。
5. **辅助函数**（按依赖顺序）：`loadPty` → `loadVendor` → `clamp` → `resolveCwd` →
   `shellCandidates` → `killTerminal` → `respond` → `readBody` → `isSameOrigin`。
6. **`apply(ctx)`**：`export const inject = ["webServer"]` + `export function apply(ctx)`，
   内部先定义 `route` / `guard` 两个包装器，再逐一注册路由。
7. **路由注册顺序约定**：vendor 静态 → fs 只读 → terminal 会话（spawn/input/output/resize/kill）。

---

## 命名与组织约定

- **路由前缀**：全部 `/drawer/*`，资源类 `/drawer/vendor/<name>`；新路由不得使用其他前缀。
- **会话 id**：`"term-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)`
  （`lib/index.js:402`），客户端只透传，不解析格式。
- **常量命名**：`MAX_<NOUN>`（上限）、`JSON_HEADERS`（公共响应头）；语义注释必须中文。
- **vendor 表驱动**：新第三方资源在 `loadVendor` 的 `table` 中加一行（相对路径 + content-type），
  再注册对应 `route`；文件缺失返回 null → 路由回 404 + `pnpm install` 提示（`lib/index.js:66-84`）。
- **会话生命周期集中管理**：spawn 时 `onData` 挂环形缓冲、`onExit` 清理 map；
  杀会话只经 `killTerminal`（缺省 id = 杀全部，pagehide 回收语义）。

---

## 何时拆分文件

当前规模（约 500 行）保持单文件。拆分信号（出现两个再拆）：

- 新增第二类资源分发（非 xterm/highlight 家族）且表驱动不再合适；
- 会话状态逻辑超过路由注册逻辑的一半。

拆分时保持 `apply(ctx)` 入口不变，路由注册仍集中在入口模块。

---

## 反模式

- **急切引入 node-pty**：`lib/index.js:39-58` 的懒加载三基准解析（`process.argv[1]` →
  `$DSH_HOME` profile → `import.meta.url`）是本项目解决跨盘 junction 安装的关键，不得改为
  静态 import。
- **模块级可变状态散落**：除 `terminals` / `vendorCache` / `ptyModule` 外不得新增模块级变量。
- **把宿主逻辑塞进 client.js**：浏览器半无 Node 能力，任何 fs/pty 能力必须经宿主路由代理。
