# 质量规范（宿主半）

> 无 lint/typecheck 框架（无 eslint/prettier/tsc 配置）。质量门 = 语法检查 + 冒烟测试 +
> 人工核对安全/资源边界。

---

## 验证手段

| 手段 | 命令 | 覆盖 |
|------|------|------|
| 语法检查 | `node --check lib/index.js` | ESM 语法 |
| 宿主冒烟 | `node verify-host.mjs` | 路由注册、vendor 200/类型、**真实 spawn shell 全链路**：多会话隔离、各自回显、kill-by-id、第 9 个会话 429、kill `{}` 杀全部 |
| 客户端冒烟 | `node verify-client.mjs` | client.js 在 VM 沙箱中注册 `details`（priority -1）与 utilities 席位 |

冒烟测试是**行为级**断言（mock `ctx.webServer.register` 抓 handler + mock req/res），
不依赖真实 dsh 进程；`verify-host.mjs` 会真实 spawn shell，需要 `node-pty` 可用。

## 必须遵守的模式（Required Patterns）

- 所有常量上限（`MAX_*`）集中定义在文件顶部（`lib/index.js:21-24`）。
- 每个路由包 `guard`（同源 403 + 异常兜底 500），内部先 method 校验（405）。
- 资源上限必须存在且可触发：会话 8、输出 1MB、读 1MB、搜索 200 条、body 16KB。
- 大文件/大输出用**部分读 + 环形缓冲**，绝不整读入内存。
- 错误文案中文、可操作（告诉用户怎么办：装依赖 / 换路径 / 已达上限）。
- 可选依赖（node-pty、vendor 文件）缺失时返回明确错误，宿主不崩溃。
- ESM 语法、注释中文、模块级可变状态仅限 `terminals` / `vendorCache` / pty 懒加载标记。

## 禁止模式（Forbidden Patterns）

- **无上限的资源操作**：整文件 `readFile`、无界 `readBody`、会话不设上限。
- **跨站可访问**：路由不经 `guard`、或响应头带 CORS 放行（本项目**从不**设置
  `Access-Control-Allow-*`；同源是唯一信任边界）。
- **急切引入可选依赖**：`import node-pty` 静态引入、或破坏 `loadPty` 的三基准解析。
- **宿主崩溃路径**：路由 handler 顶层抛未捕获异常（guard 兜底是最后防线，不能依赖）、
  未捕获的 Promise rejection。
- **状态泄漏跨会话**：kill 后仍引用 `proc`（`onData` 必须校验 `terminals.get(id) === session`，
  `lib/index.js:405-407`）。
- **路由代码输出日志**（见 `logging-guidelines.md`）。

## 代码评审清单

- [ ] 安全：所有新路由在 guard 内？无 CORS 头？参数绝对路径校验？符号链接目录不递归（防环）？
- [ ] 资源：每个新 I/O 点有上限？超限行为明确（429/截断/truncated）且客户端可感知？
- [ ] 契约：响应符合 `{ok,error}` 契约？错误文案中文可操作？与 `lib/client.js` 调用方同步？
- [ ] 生命周期：会话在 onExit / kill / pagehide 全路径清理，无泄漏？
- [ ] `node --check` + `node verify-host.mjs` 通过。
