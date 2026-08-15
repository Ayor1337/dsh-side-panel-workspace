# Hook 规范（浏览器半）

> 本项目**没有自定义 hook**——共享逻辑以 factory 闭包辅助函数 + 内联 effect 承载
> （单文件规模下抽取自定义 hook 是过度工程）。本文件记录 React 内置 hooks 的实际用法约定。

---

## 允许使用的 hooks

仅 `useState` / `useEffect` / `useRef` / `useCallback`（`lib/client.js:26`）。不引入
useMemo/useReducer/useContext/第三方 hooks。

## useState：初始化

- 非平凡初始值用**初始化函数**，避免每次渲染重算：
  `useState(() => new Set())`、`useState(() => new Map())`（`FileTree`，`lib/client.js:632-633`）、
  `useState(() => actions.isOpen())`（`DrawerPanel:942`）。
- 复合状态用单一对象：`FileView` 的 `{ phase, data, error, html }`（`lib/client.js:820`）——
  四态（loading/done/error）切换必须整体替换，避免散落多个布尔互相矛盾。

## useRef：异步协调（不用来触发渲染）

ref 是跨异步边界"当前值"的唯一手段，本项目高频使用，四类用途：

| 用途 | 例子 | 位置 |
|------|------|------|
| 会话/请求标识 | `sessionRef`（当前终端会话 id）、`rootPathRef`（树根路径） | client.js:263, 634 |
| 序号/游标 | `seqRef`（输出增量游标）、`nextKeyRef`（标签 key） | client.js:264, 949 |
| 单飞/串行护栏 | `tickInFlightRef`（轮询单飞）、`sendQueueRef`（输入串行链）、`inFlightRef`（防重复请求） | client.js:269-270, 635 |
| 清理句柄 | `dragCleanupRef`（拖动中卸载兜底） | client.js:881 |

## 异步陈旧响应防护（最高频 bug 来源）

任何 async 回调在 `setState` 前必须验证自己仍"有效"：

- **disposed 标志**：effect 内 `let disposed = false`，cleanup 置 true；boot/加载回调
  检查后再 setState（`TerminalPane:363,388`、`FileView:824,843`）。
- **ref 当前值比对**：响应到达时校验 `sessionRef.current === id`（`TerminalPane:305`）、
  `rootPathRef.current === path`（`FileTree:645`）、`searchSeqRef.current === seq`
  （`FileTree:683-687`）——不匹配即丢弃。
- **排队任务的会话校验**：`send` 串行链里 `sessionRef.current !== id` 时丢弃过期按键
  （`TerminalPane:326`）。

## useEffect：清理纪律（每 effect 必须有 cleanup）

- **事件监听**：`document` 级 `mousedown`/`keydown`（菜单外点击/Escape）、`window pagehide`
  （终端回收 beacon）——返回移除函数（`BrowserPane:476-488`、`TerminalPane:369-374`）。
- **观察者**：`ResizeObserver`（尺寸同步）、`MutationObserver`（主题跟随）——
  cleanup `disconnect()`（`TerminalPane:409-423, 428-432`）。
- **定时器**：`setInterval` 轮询、`setTimeout` 防抖——cleanup `clearTimeout/clearInterval`
  （`TerminalPane:443-450`、`FileTree:669-691`）。
- **副作用回收**：终端标签卸载 = 杀掉**自己**的会话（`TerminalPane:433-435`）；
  折叠/切页**不**卸载（见 `component-guidelines.md` 的 Mistake 一节）。

## 轮询 effect 模式（终端输出 100ms 轮询）

```js
useEffect(() => {
    if (!alive || !visible) return;   // 隐藏即停，重新可见立即拉齐
    let stopped = false;
    const guarded = async () => { if (!stopped) await tick(); };
    guarded();
    const timer = setInterval(guarded, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
}, [alive, visible, tick]);
```

要点：`stopped` 标志防卸载后仍在途 tick 写入；`tick` 内部另加单飞（`tickInFlightRef`）防
手动 tick 与 interval tick 并发取同一 seq。

## 防抖模式

- 搜索输入 300ms 防抖 + 请求序号丢弃晚到响应（`FileTree:669-691`）；
- 容器尺寸 150ms 防抖后 `term.resize` + POST resize（`TerminalPane:409-422`）。

## useCallback：依赖纪律

- 供 effect 依赖的稳定函数一律 `useCallback`（`api`/`measure`/`tick`/`send`/`spawn`/`load`），
  依赖数组写全（如 `tick` 依赖 `[api]`，`send` 依赖 `[api, tick]`，`spawn` 依赖
  `[api, getCwd, measure]`）。
- 非组件函数（`fetchJson`、`loadHljs`、`clampNum`、`toggle`、`addTab`）留在 factory 闭包内，
  不需要 useCallback。

## 反模式

- **setState 于卸载后**：无 disposed 检查的 async 回调（表现：切换标签/会话后闪现旧数据）。
- **effect 无 cleanup**：监听器/定时器泄漏（表现：菜单关了还响应、隐藏后仍轮询）。
- **把异步协调值放进 useState**：会话 id/序号放 state 会引发多余重渲染与陈旧闭包，
  必须用 ref。
- **自定义 hook 抽取**：单文件项目里把 2-3 处相似逻辑抽成 `useXxx` 反而增加间接层；
  先以 factory 辅助函数复用，重复到第 3 处再考虑。
