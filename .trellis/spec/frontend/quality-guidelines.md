# 质量规范（浏览器半）

> 无 lint/test 框架（无 jest/vitest/eslint 配置）。质量门 = 语法检查 + 冒烟测试 +
> 手工 QA 清单（含可访问性）。

---

## 验证手段

| 手段 | 命令 | 覆盖 |
|------|------|------|
| 语法检查 | `node --check lib/client.js` | 经典脚本语法 |
| 冒烟测试 | `node verify-client.mjs` | VM 沙箱加载 client.js：`load` id、`inject` 数组、`details` 注册 priority **必须为 -1**、utilities 席位注册、`inject()` 存在 |
| 手工 QA | 见下方清单 | 真实浏览器行为 |

## 必须遵守的模式（Required Patterns）

- **可访问性**：
  - 纯图标按钮必须有 `title` + `aria-label`（开关、后退/前进/刷新、关闭标签、新建…）；
  - 抽屉根 `role="complementary"` + 折叠时 `aria-hidden`（`DrawerPanel:1032-1034`）；
  - 标签栏 `role="tablist"/"tab"` + `aria-selected`；菜单 `role="menu"/"menuitem"` +
    `aria-expanded`（菜单外点击与 Escape 关闭，`BrowserPane:476-488`）；
  - 树节点 `aria-expanded`；分隔条 `role="separator"` + `aria-orientation`。
- **主题**：所有颜色用 `--dsw-*` 变量 + 兜底值；从 JS 读 token 用 `getComputedStyle(document.body)`
  并观察 `<html>`+`<body>` 双节点（详见 `component-guidelines.md` 的 Convention 一节）。
- **折叠不卸载**：`everOpened` 门 + `display:none` 隐藏，隐藏时停轮询，页面卸载才杀会话。
- **可选依赖降级**：highlight.js 加载失败 → 纯文本预览；xterm 加载失败 → 明确错误提示，
  绝不让核心功能整体不可用。
- **fetch 统一走 `fetchJson`/`api`**（校验 `ok` 契约），`cache: "no-store"`。

## 禁止模式（Forbidden Patterns）

- **JSX / 顶层 import/export**：破坏无构建自包含契约（`component-guidelines.md`）。
- **硬编码颜色**（除 `FILE_ICON_GROUPS` 固定类别色）：明暗主题下必然有一个不可读。
- **泄漏监听器/定时器**：effect 无 cleanup（菜单关了仍响应、隐藏仍轮询 = 判失败）。
- **卸载杀会话**：折叠/切页触发 kill（`component-guidelines.md` Mistake 一节）；
  唯一合法 kill 点是：关标签（cleanup 杀自己的会话）与 `pagehide`（杀全部）。
- **无防护的逐键 POST**：终端输入必须走 `sendQueueRef` 串行链（连接池并发会乱序写 pty）。
- **把非 `sdw_` 前缀 class 注入样式**：与宿主样式冲突。

## 手工 QA 清单（改动涉及对应功能时逐项过）

- [ ] 抽屉：展开/折叠按钮状态同步、聊天列让位、折叠后再展开终端会话存活
- [ ] 终端：新建（多开 ≤8）、逐键输入回显、Ctrl+C、窗口 resize 行列跟随、明/暗主题切换配色
- [ ] 浏览器：地址栏导航、后退/前进/刷新（跨域 iframe key 重建）、新窗口打开、拒绝内嵌提示
- [ ] 资源管理器：树懒加载展开/折叠、cwd 切换树重建、搜索防抖与 200 条截断提示、
      文件预览（文本高亮 / 二进制提示 / >1MB truncated）、树宽拖动 160–480、折叠树按钮
- [ ] 标签：关闭激活/非激活标签的邻居聚焦、资源管理器/文件标签单例语义
- [ ] 页面刷新：会话全部回收、抽屉回到折叠默认（预期行为，非 bug）

## 代码评审清单

- [ ] 每个 effect 有 cleanup；每个 async 回调有 disposed/ref 陈旧防护
- [ ] 新样式全部 `--dsw-*` + `sdw_` 前缀；新交互有 aria 属性
- [ ] 与宿主契约同步（路径、字段名、错误文案）
- [ ] `node --check` + `node verify-client.mjs` 通过
