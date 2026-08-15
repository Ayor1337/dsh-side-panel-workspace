# 状态管理（浏览器半）

> 无状态库（无 Redux/Zustand/React Query）、无 React Context 跨树共享。
> 状态分四层，各层职责明确，禁止越层。

---

## 状态分层

| 层 | 存放内容 | 载体 | 例子 |
|----|----------|------|------|
| 1. 组件局部 UI 状态 | 仅本组件渲染需要 | `useState` | 标签数组/激活 key（DrawerPanel）、地址栏与导航栈（BrowserPane）、树展开集合与搜索（FileTree）、树宽与可见性（ExplorerPane）、加载 phase（FileView） |
| 2. apply 闭包共享状态 | **跨渲染树**（不同 slot 根）必须共享的值 | 闭包变量 + pub/sub，经 slot `inject()` 注入 | 抽屉 open 状态（ToggleButton ↔ DrawerPanel）、当前会话 cwd（DrawerPanel → 各资源管理器标签树） |
| 3. 异步协调状态 | 不触发渲染的游标/句柄/护栏 | `useRef` | 会话 id、seq、单飞标志、防抖 timer、拖动清理（见 `hook-guidelines.md`） |
| 4. 宿主侧状态 | pty 会话、环形缓冲、vendor 缓存 | 宿主 `lib/index.js` 模块级 Map | 客户端**不镜像**，只持有 id/seq 引用 |

## 跨渲染树共享（层 2）—— 唯一允许的"全局"状态

按钮与抽屉分属两个 slot 渲染树，React context 无法跨越（`lib/client.js:1109` 注释明示），
故用 apply 闭包 + 监听器集合：

```js
// apply 闭包
let open = false;
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const actions = { isOpen: () => open, toggle() { open = !open; /* ... */ for (const fn of [...listeners]) fn(); } };

// 组件侧：useState 初始化 + useEffect 订阅，把外部值转成局部状态
const [open, setOpen] = useState(actions.isOpen());
useEffect(() => subscribe(() => setOpen(actions.isOpen())), [subscribe, actions]);
```

- 变更必须**同时**改值 + 通知（`toggle` 内先改 `open` 再遍历快照 `[...listeners]`）；
- 订阅函数必须返回退订（组件卸载不漏 listener）；
- cwd 同理：`ctx.sessions.list.subscribe(refreshCwd)` 更新闭包值，`subscribeCwd` 通道通知
  树重建（`lib/client.js:1131-1153`）。**闭包值本身不会触发 React 重渲染**——必须经
  `useEffect` 订阅转成 state（这是本项目反复踩过的坑，见 `component-guidelines.md` 的
  "apply-level value with change notification" 一节）。

## 宿主状态（层 4）契约

- 宿主是终端会话的唯一事实源：spawn 返回 id，客户端持 `sessionRef`/`seqRef` 增量拉取
  （`/drawer/terminal/output?id=&seq=`），**不得**在 React state 里存会话对象。
- 会话死活用响应的 `alive` 字段传达（output 返回 `{alive:false}` 即写提示文本），
  客户端不猜测。
- 页面刷新/关闭 = `pagehide` sendBeacon 杀全部（`lib/client.js:369-373`）；
  关标签 = 组件卸载 cleanup 杀自己的会话（`lib/client.js:433-435`）。

## 服务端状态（宿主 GET 路由）

- 无客户端缓存层：所有 fetch 带 `cache: "no-store"`（`api`/`fetchJson`）。
- 文件树"展开即重取"（见 `component-guidelines.md` 的 Lazy Tree Conventions）——
  旧数据仅作展示，不当作缓存命中。

## 刻意不持久化的状态

- 抽屉折叠/展开、标签列表：刷新后回到默认折叠（README 已知限制）——不要为它加
  localStorage/sessionStorage，除非产品需求明确要求。

## 反模式

- **React Context 跨 slot 树**：两个槽的渲染根不共享 Provider 树，context 必失效。
- **镜像宿主状态到 useState**：终端输出/文件树全量存 state 会造成无谓重渲染与陈旧数据。
- **ref 触发渲染 / state 承载游标**：见 `hook-guidelines.md` 反模式。
- **组件间直接改别人状态**：兄弟组件共享只经 props 回调（`onOpenFile`/`onUrlChange`）。
