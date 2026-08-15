# 类型与运行时防御（浏览器半）

> **本项目是纯 JavaScript，没有 TypeScript，也没有构建步骤**——"类型安全"靠
> 边界校验 + 防御式运行时检查 + 注释契约实现。不要在 client.js 中引入 TS/flow/JSDoc 类型
> 注解强制工具（无构建步骤，JSDoc 类型注解仅作注释用，不校验）。

---

## 边界校验：不可信输入只出现在边界

本项目的输入边界只有两个：

1. **宿主 HTTP 响应**（`fetchJson` / `api`，`lib/client.js:271-279, 589-594`）：
   统一校验 `res.ok` 与 `data?.ok === false`，失败即 throw 服务端 `error` 文案——
   之后所有代码都信任 `ok:true` 分支里的字段形状（契约见 `../backend/host-fs-routes.md`）。
2. **用户输入**（地址栏、搜索框）：使用前归一化——地址补协议（`/^[a-z][a-z0-9+.-]*:/i`
   无匹配则前置 `https://`，`BrowserPane:517`）；搜索词 `trim()` 后校验长度再发请求。

## 数值防御

- 宿主传回的 cols/rows 等数值先 `clampNum`（`lib/client.js:214`）再使用：
  `clampNum(Math.floor(width / charWidth), 20, 240)`——边界值（0、NaN、越界）都被钳制，
  不产生非法请求参数。
- 宿主侧同款：`clamp = (value, min, max) => Math.min(max, Math.max(min, Math.trunc(Number(value)) || 0))`
  （`lib/index.js:89`）——`Number()` 归一 + `|| 0` 兜底 NaN。
- 字符串拼接查询参数必须 `encodeURIComponent`（`FileTree:649, 682`）。

## 错误归一化

`err instanceof Error ? err.message : String(err)` 是**唯一**的错误转文案写法
（client.js 出现 5+ 处，如 `TerminalPane:331`、`FileTree:652`）——fetch 网络错误、throw
字符串、非 Error 对象都能稳定转成可展示文案。禁止直接 `err.message`（非 Error 会崩）或
`JSON.stringify(err)`。

## 表驱动查找（代替分支链）

- 扩展名 → highlight 语言：`HLJS_LANG` 映射表（`lib/client.js:597-607`），查不到返回 null
  （不调用 highlightAuto，防超大文件开销）。
- 扩展名 → 类别图标：`FILE_ICON_GROUPS` 顺序表（`lib/client.js:172-182`），未知回退
  `iconFile()`。
- 宿主 vendor 表：`loadVendor` 的 `table`（`lib/index.js:68-72`）。
- 新增映射先查表，禁止在渲染函数里堆 `if/else if` 扩展名分支。

## 可选链与空值

- `data?.ok`、`state.data?.content`、`t?.options` 风格可选链 + `??` 兜底是全项目一致写法；
- 布尔标志的"真值判定"要精确：`data.truncated === true` / `data.binary !== true`
  （`FileView:829, 861`）——宿主契约里这些字段可能缺失（binary 时无 content），
  不要写成 `if (data.content)` 这类真假值混用。

## 反模式

- **信任未校验 payload**：跳过 `fetchJson` 直接 `fetch().then(r => r.json())` 后取字段
  （服务端 500 的 `{ok:false}` 会被当成成功数据）。
- **裸 `err.message`** / 把 Error 塞进 state 直接渲染。
- **魔法数字散落**：尺寸/上限（160/480/20/240/100/2000）必须提为区段常量。
- **给 JS 文件加 TS 类型标注工具链**：破坏"无构建步骤"这一核心约束。
