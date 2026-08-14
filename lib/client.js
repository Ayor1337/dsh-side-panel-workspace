/*!
 * dsh-plugin-side-drawer —— 浏览器（client）半。
 *
 * 由 client-modules 以 <script> 方式加载（/plugins/<id>/client.js），
 * 必须自包含（无 import）。工厂里 require 的词仅为 shell 静态模块种子（"react" 等）。
 *
 * UI 合同：
 *  - 开关按钮注册在 "conversation.session.header.utilities"（聊天页右上角会话工具区，追加性席位）；
 *  - 抽屉注册在 "details"（官方右侧栏）priority:-1 —— 阴影官方 DetailsPanel 而不销毁其注册，
 *    展开 = ctx.layout.openDetails()（中栏自动让位，聊天文字不被遮挡），折叠 = closeDetails()；
 *    折叠时根节点 display:none 隐藏而不卸载（两个标签页保活，终端会话不断连）；
 *  - 终端：xterm.js 渲染（/drawer/vendor/xterm.{mjs,css} 由宿主路由提供，动态 import，无构建），
 *    宿主 /drawer/terminal/* 路由，100ms 轮询增量输出，逐键发送（onData）；
 *  - 浏览器：地址栏 + 后退/前进/刷新 + iframe（sandbox/referrerPolicy 加固）+ 新窗口打开，
 *    localStorage 记住上次网址。
 *  - 资源管理器：左侧文件内容显示区 + 右侧工作区文件树（根=当前会话 cwd，懒加载，
 *    文件夹左键展开/折叠）；点击文件开文件标签（单例）；宿主 /drawer/fs/{list,read} 路由。
 * 全部取 DSH 主题变量（--dsw-*）。
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-side-drawer",
	factory: (require) => {
		const React = require("react");
		const { useState, useEffect, useRef, useCallback } = React;
		const e = React.createElement;

		/* ── 样式（data-plugin 标记，模块卸载时由 loader 回收） ─────────── */
		const CSS = [
			".sdw_root{display:flex;flex-direction:column;height:100%;width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base,#fff);border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));color:var(--dsw-alias-label-primary,#1f2328);font-family:system-ui,-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;overflow:hidden}", /* 背景与对话页一致（聊天列为 --dsw-alias-bg-base），头部标签栏随根容器 */
			".sdw_head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));flex:none}",
			".sdw_tabs{display:flex;align-items:center;gap:4px;min-width:0;flex-wrap:wrap}",
			".sdw_chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;cursor:pointer;max-width:180px}",
			".sdw_chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
			".sdw_chipOn,.sdw_chipOn:hover{background:var(--dsw-alias-bg-layer-2,#ececec);color:var(--dsw-alias-label-primary,#1f2328)}",
			".sdw_chipName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".sdw_chipX{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;flex:none;opacity:.65}",
			".sdw_chipX:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.1));opacity:1}",
			".sdw_plus{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;padding:0;flex:none}",
			".sdw_plus:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1f2328)}",
			".sdw_menuwrap{position:relative;display:inline-flex;flex:none}",
			".sdw_menu{position:absolute;left:0;top:calc(100% + 4px);z-index:10;min-width:160px;padding:4px;background:var(--dsw-alias-bg-layer-2,#fafafa);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.28)}",
			".sdw_menuItem{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#1f2328);font:inherit;font-size:13px;cursor:pointer;text-align:left}",
			".sdw_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
			".sdw_menuItem:disabled{opacity:.4;cursor:default;background:transparent}",
			".sdw_menuR{left:auto;right:0}",
			".sdw_home{flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:0 24px;min-height:0}",
			".sdw_homeItem{display:flex;align-items:center;gap:10px;width:100%;max-width:520px;margin:0 auto;padding:12px 14px;border:0;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#f5f5f5);color:var(--dsw-alias-label-primary,#1f2328);font:inherit;font-size:14px;cursor:pointer;text-align:left}",
			".sdw_homeItem:hover{background:var(--dsw-alias-bg-layer-2,#ececec)}",
			".sdw_body{flex:1;min-height:0;display:flex;flex-direction:column}",
			".sdw_pane{flex:1;min-height:0;display:flex;flex-direction:column}",
			".sdw_term,.sdw_browser{display:flex;flex-direction:column;flex:1;min-height:0}",
			".sdw_out{position:relative;flex:1;min-height:0;background:var(--dsw-alias-bg-base,#fff)}", /* 与对话页同色（聊天列为 --dsw-alias-bg-base），覆盖启动期与边缘空隙 */
			".sdw_termView{position:absolute;inset:0;box-sizing:border-box;padding:4px 8px;overflow:hidden}",
			".sdw_measure{position:absolute;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none;font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace}", /* 字号须与 TERM_FONT_SIZE 保持一致 */
			".sdw_err{position:absolute;left:8px;right:8px;top:8px;z-index:2;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:8px;background:var(--dsw-alias-bg-layer-2,#fafafa);color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12px;line-height:17px}",
			".sdw_noteFloat{position:absolute;left:8px;top:8px;z-index:1;color:var(--dsw-alias-label-tertiary,#8a9199);font-size:12px;padding:4px}",
			".sdw_navbar{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));flex:none}",
			".sdw_addr{flex:1;min-width:0;height:28px;box-sizing:border-box;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f0f0f0);color:var(--dsw-alias-label-primary,#1f2328);padding:0 14px;font:inherit;font-size:12px;text-align:center;outline:none}",
			".sdw_addr:focus{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary,#3b82f6)}",
			".sdw_addr::placeholder{color:var(--dsw-alias-label-tertiary,#8a9199)}",
			".sdw_btn{display:inline-flex;align-items:center;justify-content:center;height:28px;box-sizing:border-box;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;cursor:pointer;flex:none}",
			".sdw_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
			".sdw_btn:disabled{opacity:.4;cursor:default;background:transparent}",
			".sdw_nav{width:26px;height:26px;padding:0;color:var(--dsw-alias-label-tertiary,#8a9199)}",
			".sdw_nav svg{display:block}",
			".sdw_frame{flex:1;min-height:0;width:100%;border:0;background:#fff}",
			".sdw_start{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-tertiary,#8a9199)}",
			".sdw_startTitle{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328)}",
			".sdw_startSub{font-size:12px}",
			".sdw_toggle{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;padding:0}",
			".sdw_toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1f2328)}",
			".sdw_toggleOn,.sdw_toggleOn:hover{color:var(--dsw-alias-state-business-primary,#3b82f6)}",
			".sdw_toggle svg{display:block}",
			/* 隐藏宿主 details 栏拖拽手柄的悬浮 pill（保留拖拽本身）；依赖宿主打包 class 名，dsh 改版可能失效 */
			".pI_x6G_handle[data-side=details]:after{display:none!important}",
			/* ── 资源管理器（左内容 + 右树） ── */
			".sdw_explorer{display:flex;flex:1;min-height:0;min-width:0}",
			".sdw_explorerLeft{flex:1;min-width:0;display:flex;flex-direction:column}",
			".sdw_fileView{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}",
			".sdw_fileBar{display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));font-size:11px;color:var(--dsw-alias-label-tertiary,#8a9199);flex:none}",
			".sdw_fileBarPath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".sdw_fileBarMeta{flex:none}",
			".sdw_pre{flex:1;min-height:0;margin:0;padding:8px 12px;overflow:auto;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace;color:var(--dsw-alias-label-primary,#1f2328);white-space:pre}",
			".sdw_explorerRight{width:230px;flex:none;min-width:0;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}",
			".sdw_tree{flex:1;min-height:0;overflow:auto;padding:4px 0}",
			".sdw_treeRow{display:flex;align-items:center;gap:4px;width:100%;box-sizing:border-box;padding:2px 8px 2px 0;border:0;background:transparent;color:var(--dsw-alias-label-primary,#1f2328);font:inherit;font-size:12px;cursor:pointer;text-align:left;min-width:0}",
			".sdw_treeRow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
			".sdw_treeCaret{display:inline-flex;align-items:center;justify-content:center;width:10px;height:10px;flex:none;color:var(--dsw-alias-label-tertiary,#8a9199);transition:transform .12s}",
			".sdw_treeCaretOpen{transform:rotate(90deg)}",
			".sdw_treeName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
			".sdw_treeNote{padding:6px 10px;color:var(--dsw-alias-label-tertiary,#8a9199);font-size:12px}",
			".sdw_treeErr{color:var(--dsw-alias-state-error-primary,#e5484d)}"
		].join("");
		const CSS_TAG = "dsh-plugin-side-drawer/drawer.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-side-drawer";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/* ── 图标（内联 SVG） ─────────────────────────────────────────── */
		const iconPanel = () => e("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
			e("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.3 }),
			e("path", { d: "M10.5 2.5v11", stroke: "currentColor", strokeWidth: 1.3 }));
		const iconBack = () => e("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": true },
			e("path", { d: "M8.75 2.5 4.75 7l4 4.5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
		const iconForward = () => e("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": true },
			e("path", { d: "M5.25 2.5 9.25 7l-4 4.5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
		const iconRefresh = () => e("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": true },
			e("path", { d: "M11.9 7A4.9 4.9 0 1 1 10.6 3.5", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" }),
			e("path", { d: "M11.9 1.6v2.4H9.5", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" }));
		const iconTerminal = (size) => e("svg", { width: size ?? 13, height: size ?? 13, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
			e("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.2 }),
			e("path", { d: "M4.5 6l2 2-2 2", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" }),
			e("path", { d: "M8 10.5h3.5", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" }));
		const iconGlobe = (size) => e("svg", { width: size ?? 13, height: size ?? 13, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
			e("circle", { cx: 8, cy: 8, r: 6.2, stroke: "currentColor", strokeWidth: 1.2 }),
			e("path", { d: "M1.8 8h12.4M8 1.8c-3.7 3.9-3.7 8.5 0 12.4 3.7-3.9 3.7-8.5 0-12.4z", stroke: "currentColor", strokeWidth: 1.2 }));
		const iconOverflow = () => e("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "currentColor", "aria-hidden": true },
			e("circle", { cx: 7, cy: 2.8, r: 1.1 }),
			e("circle", { cx: 7, cy: 7, r: 1.1 }),
			e("circle", { cx: 7, cy: 11.2, r: 1.1 }));
		const iconPlus = () => e("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": true },
			e("path", { d: "M7 3v8M3 7h8", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }));
		const iconX = () => e("svg", { width: 10, height: 10, viewBox: "0 0 10 10", fill: "none", "aria-hidden": true },
			e("path", { d: "M2.5 2.5l5 5M7.5 2.5l-5 5", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" }));
		const iconCaret = () => e("svg", { width: 10, height: 10, viewBox: "0 0 10 10", fill: "none", "aria-hidden": true },
			e("path", { d: "M3.5 2 7 5l-3.5 3", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" }));
		const iconFolder = (size) => e("svg", { width: size ?? 14, height: size ?? 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
			e("path", { d: "M1.8 4.2c0-.77.63-1.4 1.4-1.4h3l1.6 1.8h5c.77 0 1.4.63 1.4 1.4v6c0 .77-.63 1.4-1.4 1.4H3.2c-.77 0-1.4-.63-1.4-1.4V4.2z", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" }));
		const iconFile = (size) => e("svg", { width: size ?? 14, height: size ?? 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
			e("path", { d: "M4 1.8h5.2L12.5 5v8.2c0 .55-.45 1-1 1h-7.5c-.55 0-1-.45-1-1V2.8c0-.55.45-1 1-1z", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" }),
			e("path", { d: "M9.2 1.8V5h3.3", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" }));

		/* ── xterm 终端约定（vendor 路由由宿主半提供，见 lib/index.js） ── */
		const XTERM_CSS_TAG = "dsh-plugin-side-drawer/xterm.css";
		const TERM_FONT = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace";
		const TERM_FONT_SIZE = 14;
		const TERM_LINE_HEIGHT = TERM_FONT_SIZE * 1.2; // 行高近似（与 .sdw_measure 字体一致）
		const TERM_PAD_X = 16; // .sdw_termView 左右 padding 合计
		const TERM_PAD_Y = 8; // 上下 padding 合计
		const POLL_MS = 100;

		const clampNum = (value, min, max) => Math.min(max, Math.max(min, Math.trunc(value)));

		/* 注入 xterm.css（data-plugin 标记防重复），返回加载完成的 Promise；
		   必须在 term.open 之前完成加载，否则行列测量全错（open 后样式表晚到不会触发重测） */
		let xtermCssReady = null;
		function ensureXtermCss() {
			if (xtermCssReady !== null) return xtermCssReady;
			if (document.querySelector("link[data-plugin-css=" + JSON.stringify(XTERM_CSS_TAG) + "]") !== null) {
				xtermCssReady = Promise.resolve();
				return xtermCssReady;
			}
			xtermCssReady = new Promise((resolve) => {
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = "/drawer/vendor/xterm.css";
				link.dataset.plugin = "dsh-plugin-side-drawer";
				link.dataset.pluginCss = XTERM_CSS_TAG;
				link.onload = () => resolve();
				link.onerror = () => resolve(); // 失败交由后续 import() 的错误路径统一提示（常见情形两者同缺）
				document.head.appendChild(link);
			});
			return xtermCssReady;
		}

		/* 从 DSH 主题变量读取 xterm 配色（CSS 变量不能直接传给 xterm theme，需取计算值）。
		   注意：DSH ThemePresenter 将 --dsw-* token 写在 <body> 内联样式与 body / body[data-ds-dark-theme]
		   样式表规则上（非 :root），必须读 body 的计算样式——读 documentElement 永远只能得到兜底色 */
		function readTermTheme() {
			const style = getComputedStyle(document.body ?? document.documentElement);
			const pick = (name, fallback) => {
				const value = style.getPropertyValue(name).trim();
				return value !== "" ? value : fallback;
			};
			return {
				/* xterm v6 的 css.toColor 对 alpha≠255 的颜色直接抛错回退默认黑，不能用 "transparent"；
				   背景必须给不透明色，取对话页同款的 --dsw-alias-bg-base（主题切换由下方 observer 重读） */
				background: pick("--dsw-alias-bg-base", "#ffffff"),
				foreground: pick("--dsw-alias-label-primary", "#1f2328"),
				cursor: pick("--dsw-alias-state-business-primary", "#3b82f6"),
				cursorAccent: pick("--dsw-alias-bg-base", "#ffffff"),
				selectionBackground: "rgba(128,128,128,.3)"
			};
		}

		/* ── 终端标签页（xterm.js 渲染，逐键输入，折叠保活） ─────────── */
		function TerminalPane({ getCwd, visible }) {
			const [alive, setAlive] = useState(false);
			const [starting, setStarting] = useState(true);
			const [error, setError] = useState(null);
			const sessionRef = useRef(null);
			const seqRef = useRef(0);
			const boxRef = useRef(null);     // xterm 挂载容器
			const measureRef = useRef(null); // 隐藏测量元素（与 xterm 同字体）
			const termRef = useRef(null);    // xterm Terminal 实例
			const sendQueueRef = useRef(Promise.resolve()); // 输入串行链：逐键 POST 依序发出，防并发在途乱序到达 pty
			const tickInFlightRef = useRef(false);          // 输出拉取单飞：防同 seq 并发拉取导致重复写入

			const api = useCallback(async (path, body) => {
				const init = body === undefined
					? { cache: "no-store" }
					: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" };
				const res = await fetch(path, init);
				const data = await res.json();
				if (!res.ok || data?.ok === false) throw new Error(data?.error ?? "HTTP " + res.status);
				return data;
			}, []);

			/* 隐藏测量：100 个 "0" 求字符宽，行高按 fontSize*1.2；容器隐藏（宽 0）时返回 null */
			const measure = useCallback(() => {
				const box = boxRef.current;
				const span = measureRef.current;
				if (box === null || span === null) return null;
				const width = box.clientWidth - TERM_PAD_X;
				const height = box.clientHeight - TERM_PAD_Y;
				if (width <= 0 || height <= 0) return null;
				const charWidth = span.getBoundingClientRect().width / 100;
				if (!(charWidth > 0)) return null;
				return {
					cols: clampNum(Math.floor(width / charWidth), 20, 240),
					rows: clampNum(Math.floor(height / TERM_LINE_HEIGHT), 5, 100)
				};
			}, []);

			/* 拉取一轮增量输出（xterm 原生处理 ANSI/控制序列，无需剥离）。
			   单飞：并发两轮会以相同 seq 拿到相同增量并重复写入终端，故在途时直接跳过 */
			const tick = useCallback(async () => {
				const id = sessionRef.current;
				if (id === null || tickInFlightRef.current) return;
				tickInFlightRef.current = true;
				try {
					const data = await api("/drawer/terminal/output?id=" + id + "&seq=" + seqRef.current);
					if (sessionRef.current !== id) return; // 期间会话已重启，丢弃旧数据
					const term = termRef.current;
					if (data.alive === false) {
						setAlive(false);
						if (term !== null) term.write("\r\n— [会话已结束，可关闭标签后新建] —\r\n");
						return;
					}
					if (typeof data.seq === "number") seqRef.current = data.seq;
					if (data.dropped === true && term !== null) term.write("\r\n[输出过长，早期内容已丢弃]\r\n");
					if (term !== null && typeof data.data === "string" && data.data !== "") term.write(data.data);
				} catch { /* 网络瞬断，下轮重试 */ }
				finally { tickInFlightRef.current = false; }
			}, [api]);

			/* 逐键发送（xterm onData 直挂）：POST 挂到 promise 链尾串行发出——浏览器连接池
			   （每域 6 socket）会让并发 POST 走不同连接，到达宿主顺序可不保证，串行化杜绝
			   按键字节乱序写入 pty；成功后立即补一轮输出 tick，降低回显延迟 */
			const send = useCallback((text) => {
				const id = sessionRef.current;
				if (id === null) return;
				sendQueueRef.current = sendQueueRef.current.then(async () => {
					if (sessionRef.current !== id) return; // 排队期间会话已重启/卸载，丢弃过期按键
					try {
						await api("/drawer/terminal/input", { id, data: text });
						tick();
					} catch (err) {
						setError(err instanceof Error ? err.message : String(err));
					}
				});
			}, [api, tick]);

			const spawn = useCallback(async () => {
				setStarting(true);
				setError(null);
				sessionRef.current = null; // 使排队/在途的旧会话输入立即失效（send 链按 id 比对丢弃）
				try {
					const size = measure();
					const data = await api("/drawer/terminal/spawn", {
						cols: size?.cols ?? 80,
						rows: size?.rows ?? 24,
						cwd: getCwd()
					});
					sessionRef.current = data.id;
					seqRef.current = 0;
					const term = termRef.current;
					if (term !== null) { term.reset(); term.focus(); }
					setAlive(true);
				} catch (err) {
					sessionRef.current = null;
					setAlive(false);
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setStarting(false);
				}
			}, [api, getCwd, measure]);

			/* 挂载引导：注入 xterm.css → 动态 import → open → spawn；监听统一登记与清理 */
			useEffect(() => {
				let disposed = false;
				let resizeTimer = 0;
				let resizeObserver = null;
				let themeObserver = null;
				let term = null;
				/* 折叠不再杀会话：仅页面卸载（刷新/关闭）时经 sendBeacon 回收宿主会话（NFR3） */
				const onPageHide = () => {
					try {
						navigator.sendBeacon("/drawer/terminal/kill", new Blob(["{}"], { type: "application/json" }));
					} catch { /* 忽略 */ }
				};
				window.addEventListener("pagehide", onPageHide);
				const boot = async () => {
					let Terminal;
					try {
						// CSS 与 ESM 并行加载、两者就绪后才 open（CSS 晚到会导致 xterm 行列测量全错）
						const [mod] = await Promise.all([import("/drawer/vendor/xterm.mjs"), ensureXtermCss()]);
						({ Terminal } = mod);
					} catch {
						if (!disposed) {
							setStarting(false);
							setError("终端组件加载失败：请在插件目录执行 pnpm install（安装 @xterm/xterm），然后刷新页面。");
						}
						return;
					}
					if (disposed) return;
					term = new Terminal({
						fontSize: TERM_FONT_SIZE,
						fontFamily: TERM_FONT,
						scrollback: 2000,
						cursorBlink: true,
						theme: readTermTheme()
					});
					termRef.current = term;
					term.open(boxRef.current);
					term.onData((data) => { send(data); }); // 本地不回显，依赖 pty 回环（readline 原生历史/补全）
					/* 主题跟随：DSH ThemePresenter 切换主题时改写 <html> 的 style.colorScheme 与
					   <body> 的 data-ds-dark-theme 属性 / 内联 --dsw-* token —— 两个节点都观察，重读变量 */
					themeObserver = new MutationObserver(() => {
						const t = termRef.current;
						if (t !== null) t.options.theme = readTermTheme();
					});
					const themeWatch = { attributes: true, attributeFilter: ["class", "style", "data-ds-dark-theme"] };
					themeObserver.observe(document.documentElement, themeWatch);
					if (document.body !== null) themeObserver.observe(document.body, themeWatch);
					/* 尺寸跟随：容器 ResizeObserver（debounce 150ms），本地重排 + 同步 pty */
					resizeObserver = new ResizeObserver(() => {
						clearTimeout(resizeTimer);
						resizeTimer = setTimeout(() => {
							if (disposed) return;
							const size = measure();
							const t = termRef.current;
							if (size === null || t === null) return;
							t.resize(size.cols, size.rows);
							const id = sessionRef.current;
							if (id !== null) {
								api("/drawer/terminal/resize", { id, cols: size.cols, rows: size.rows }).catch(() => { /* 忽略 */ });
							}
						}, 150);
					});
					resizeObserver.observe(boxRef.current);
					await spawn();
				};
				boot();
				return () => {
					disposed = true;
					clearTimeout(resizeTimer);
					if (resizeObserver !== null) resizeObserver.disconnect();
					if (themeObserver !== null) themeObserver.disconnect();
					window.removeEventListener("pagehide", onPageHide);
					/* 卸载（关标签/插件卸载）= 杀掉本标签自己的会话；pagehide beacon 的杀全部仍兜底刷新场景 */
					const ownId = sessionRef.current;
					if (ownId !== null) api("/drawer/terminal/kill", { id: ownId }).catch(() => { /* 忽略 */ });
					if (term !== null) { try { term.dispose(); } catch { /* 忽略 */ } }
					termRef.current = null;
					sessionRef.current = null;
				};
			}, [api, measure, send, spawn]);

			/* 轮询增量输出：折叠/切页（visible=false）停轮询，重新可见立即 tick 按 seq 拉齐 */
			useEffect(() => {
				if (!alive || !visible) return;
				let stopped = false;
				const guarded = async () => { if (!stopped) await tick(); };
				guarded();
				const timer = setInterval(guarded, POLL_MS);
				return () => { stopped = true; clearInterval(timer); };
			}, [alive, visible, tick]);

			/* 重新可见时聚焦终端，键盘立即可用 */
			useEffect(() => {
				if (visible && termRef.current !== null) termRef.current.focus();
			}, [visible]);

			return e("div", { className: "sdw_term" },
				e("div", { className: "sdw_out" },
					e("div", { ref: boxRef, className: "sdw_termView" }),
					e("span", { ref: measureRef, className: "sdw_measure", "aria-hidden": true }, "0".repeat(100)),
					starting ? e("div", { className: "sdw_noteFloat" }, "正在启动 shell…") : null,
					error !== null ? e("div", { className: "sdw_err" }, error) : null));
		}

		/* ── 浏览器标签页（地址栈导航 + 网址记忆 + iframe 加固） ───────── */
		const BROWSER_URL_KEY = "dsh-side-drawer:browser-url";
		function BrowserPane() {
			const [url, setUrl] = useState("");
			const [frame, setFrame] = useState("");
			const [reloadSeq, setReloadSeq] = useState(0);
			const stackRef = useRef([]);  // 地址栈（仅记录地址栏导航；iframe 内部跨域跳转不可感知）
			const indexRef = useRef(-1); // 栈指针
			const [canBack, setCanBack] = useState(false);
			const [canFwd, setCanFwd] = useState(false);
			const [menuOpen, setMenuOpen] = useState(false);
			/* 菜单外点击 / Escape 关闭浮层 */
			useEffect(() => {
				if (!menuOpen) return;
				const onDown = (ev) => {
					if (!(ev.target instanceof Element) || ev.target.closest(".sdw_menuwrap") === null) setMenuOpen(false);
				};
				const onKey = (ev) => { if (ev.key === "Escape") setMenuOpen(false); };
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [menuOpen]);

			const syncNav = () => {
				setCanBack(indexRef.current > 0);
				setCanFwd(indexRef.current < stackRef.current.length - 1);
			};

			/* 挂载时恢复上次网址并自动加载 */
			useEffect(() => {
				let saved = "";
				try { saved = localStorage.getItem(BROWSER_URL_KEY) ?? ""; } catch { /* 存储不可用 */ }
				if (saved === "") return;
				stackRef.current = [saved];
				indexRef.current = 0;
				setUrl(saved);
				setFrame(saved);
				setCanBack(false);
				setCanFwd(false);
			}, []);

			const show = (target) => { setFrame(target); setUrl(target); };

			/* 地址栏导航：截掉指针之后的前进分支再压栈，并写入记忆 */
			const navigate = (target) => {
				const stack = stackRef.current.slice(0, indexRef.current + 1);
				stack.push(target);
				stackRef.current = stack;
				indexRef.current = stack.length - 1;
				show(target);
				syncNav();
				try { localStorage.setItem(BROWSER_URL_KEY, target); } catch { /* 忽略 */ }
			};

			const go = (ev) => {
				ev.preventDefault();
				const text = url.trim();
				if (text === "") return;
				const target = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text;
				navigate(target);
			};

			const back = () => {
				if (indexRef.current <= 0) return;
				indexRef.current -= 1;
				show(stackRef.current[indexRef.current]);
				syncNav();
			};
			const forward = () => {
				if (indexRef.current >= stackRef.current.length - 1) return;
				indexRef.current += 1;
				show(stackRef.current[indexRef.current]);
				syncNav();
			};
			/* 刷新：跨域 iframe 不允许 reload()，用 key 翻转重建 */
			const reload = () => setReloadSeq((n) => n + 1);

			const openExternal = () => {
				setMenuOpen(false);
				try { window.open(frame, "_blank", "noopener"); } catch { /* 弹窗被拦截 */ }
			};

			return e("div", { className: "sdw_browser" },
				e("form", { className: "sdw_navbar", onSubmit: go },
					e("button", { type: "button", className: "sdw_btn sdw_nav", title: "后退", "aria-label": "后退", disabled: !canBack, onClick: back }, iconBack()),
					e("button", { type: "button", className: "sdw_btn sdw_nav", title: "前进", "aria-label": "前进", disabled: !canFwd, onClick: forward }, iconForward()),
					e("button", { type: "button", className: "sdw_btn sdw_nav", title: "刷新", "aria-label": "刷新", disabled: frame === "", onClick: reload }, iconRefresh()),
					e("input", {
						className: "sdw_addr",
						value: url,
						onChange: (ev) => setUrl(ev.target.value),
						placeholder: "输入网址，如 example.com",
						spellCheck: false,
						autoFocus: true,
						"aria-label": "网址"
					}),
					e("span", { className: "sdw_menuwrap" },
						e("button", {
							type: "button",
							className: "sdw_btn sdw_nav",
							title: "更多",
							"aria-label": "更多",
							"aria-expanded": menuOpen,
							onClick: () => setMenuOpen(!menuOpen)
						}, iconOverflow()),
						menuOpen ? e("div", { className: "sdw_menu sdw_menuR", role: "menu" },
							e("button", {
								type: "button",
								className: "sdw_menuItem",
								role: "menuitem",
								disabled: frame === "",
								onClick: openExternal
							}, "新窗口打开")) : null)),
				frame !== ""
					? e("iframe", {
						key: reloadSeq,
						className: "sdw_frame",
						src: frame,
						title: "浏览器内容",
						sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox",
						referrerPolicy: "no-referrer"
					})
					: e("div", { className: "sdw_start" },
						iconGlobe(28),
						e("div", { className: "sdw_startTitle" }, "开始浏览"),
						e("div", { className: "sdw_startSub" }, "在上方输入网址打开页面")));
		}

		/* ── 资源管理器：文件树（懒加载，文件夹左键展开/折叠） ───────── */
		/* fs 路由共用请求：GET + JSON 校验，失败抛错（树与文件视图共用） */
		const fetchJson = async (path) => {
			const res = await fetch(path, { cache: "no-store" });
			const data = await res.json();
			if (!res.ok || data?.ok === false) throw new Error(data?.error ?? "HTTP " + res.status);
			return data;
		};
		function FileTree({ cwd, onOpenFile }) {
			const [root, setRoot] = useState(null);      // { path, entries, error } | null
			const [expanded, setExpanded] = useState(() => new Set());
			const [children, setChildren] = useState(() => new Map()); // path -> { entries, error } | { loading }
			const rootPathRef = useRef(null);  // 当前根路径：cwd 切换后丢弃晚到的旧响应
			const inFlightRef = useRef(new Set()); // 在途请求路径：防快速连续展开重复请求

			const load = useCallback(async (path) => {
				if (inFlightRef.current.has(path)) return;
				inFlightRef.current.add(path);
				const put = (value) => {
					if (rootPathRef.current === path) setRoot({ path, ...value });
					else setChildren((prev) => { const next = new Map(prev); next.set(path, value); return next; });
				};
				try {
					const data = await fetchJson("/drawer/fs/list?path=" + encodeURIComponent(path));
					put({ entries: data.entries ?? [], error: null });
				} catch (err) {
					put({ entries: [], error: err instanceof Error ? err.message : String(err) });
				} finally {
					inFlightRef.current.delete(path);
				}
			}, []);

			/* cwd 变化（会话/工作区切换）：重置整棵树并从新根加载（AC8） */
			useEffect(() => {
				rootPathRef.current = cwd;
				setRoot(null);
				setExpanded(new Set());
				setChildren(new Map());
				if (typeof cwd === "string" && cwd !== "") load(cwd);
			}, [cwd, load]);

			const toggle = (path) => {
				const isOpen = expanded.has(path);
				setExpanded((prev) => {
					const next = new Set(prev);
					if (isOpen) next.delete(path); else next.add(path);
					return next;
				});
				if (!isOpen) {
					/* 展开即重新请求（旧数据保留展示、完成后覆盖）——终端里新建的条目重展开可见（AC7） */
					setChildren((prev) => {
						const next = new Map(prev);
						if (!next.has(path)) next.set(path, { loading: true });
						return next;
					});
					load(path);
				}
			};

			const renderChildren = (path, depth) => {
				const value = children.get(path);
				if (value === undefined) return null;
				const pad = { paddingLeft: depth * 12 + 20 };
				if (value.loading === true) return e("div", { className: "sdw_treeNote", style: pad }, "加载中…");
				if (value.error !== null) return e("div", { className: "sdw_treeNote sdw_treeErr", style: pad }, value.error);
				return value.entries.map((entry) => renderEntry(entry, depth));
			};
			/* 行缩进 12px/层；文件行比目录行多让 14px（caret 10 + gap 4），名称起点对齐 */
			const renderEntry = (entry, depth) => {
				if (entry.dir) {
					const isOpen = expanded.has(entry.path);
					return e("div", { key: entry.path },
						e("button", {
							type: "button",
							className: "sdw_treeRow",
							style: { paddingLeft: depth * 12 + 6 },
							title: entry.name,
							"aria-expanded": isOpen,
							onClick: () => toggle(entry.path)
						},
							e("span", { className: "sdw_treeCaret" + (isOpen ? " sdw_treeCaretOpen" : "") }, iconCaret()),
							iconFolder(),
							e("span", { className: "sdw_treeName" }, entry.name)),
						isOpen ? renderChildren(entry.path, depth + 1) : null);
				}
				return e("button", {
					type: "button",
					className: "sdw_treeRow",
					style: { paddingLeft: depth * 12 + 20 },
					title: entry.name,
					onClick: () => onOpenFile(entry.path, entry.name)
				},
					iconFile(),
					e("span", { className: "sdw_treeName" }, entry.name));
			};

			if (typeof cwd !== "string" || cwd === "") {
				return e("div", { className: "sdw_treeNote" }, "当前会话无工作目录");
			}
			if (root === null) return e("div", { className: "sdw_treeNote" }, "加载中…");
			if (root.error !== null) return e("div", { className: "sdw_treeNote sdw_treeErr" }, root.error);
			return e("div", { className: "sdw_tree" },
				root.entries.length === 0
					? e("div", { className: "sdw_treeNote" }, "空目录")
					: root.entries.map((entry) => renderEntry(entry, 0)));
		}

		/* ── 资源管理器：左侧文件内容视图 ─────────────────────────── */
		function FileView({ path }) {
			const [state, setState] = useState({ phase: "loading", data: null, error: null });

			useEffect(() => {
				let disposed = false;
				setState({ phase: "loading", data: null, error: null });
				(async () => {
					try {
						const data = await fetchJson("/drawer/fs/read?path=" + encodeURIComponent(path));
						if (!disposed) setState({ phase: "done", data, error: null });
					} catch (err) {
						if (!disposed) setState({ phase: "error", data: null, error: err instanceof Error ? err.message : String(err) });
					}
				})();
				return () => { disposed = true; };
			}, [path]);

			const sizeText = (n) => {
				if (n < 1024) return n + " B";
				if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
				return (n / 1024 / 1024).toFixed(1) + " MB";
			};

			return e("div", { className: "sdw_fileView" },
				state.phase === "done" && state.data !== null && state.data.binary !== true
					? e("div", { className: "sdw_fileBar" },
						e("span", { className: "sdw_fileBarPath", title: path }, path),
						e("span", { className: "sdw_fileBarMeta" },
							state.data.truncated === true ? "仅显示前 1MB / " + sizeText(state.data.size) : sizeText(state.data.size)))
					: null,
				state.phase === "loading" ? e("div", { className: "sdw_start" }, "正在读取…")
					: state.phase === "error" ? e("div", { className: "sdw_err" }, state.error)
						: state.data.binary === true ? e("div", { className: "sdw_start" },
							iconFile(28),
							e("div", { className: "sdw_startSub" }, "不支持预览（二进制文件）"))
							: e("pre", { className: "sdw_pre" }, state.data.content ?? ""));
		}

		/* ── 资源管理器标签页（左内容 + 右树；explorer=空态，file=文件内容） ── */
		function ExplorerPane({ kind, file, cwd, onOpenFile }) {
			return e("div", { className: "sdw_explorer" },
				e("div", { className: "sdw_explorerLeft" },
					kind === "file" && file !== null
						? e(FileView, { path: file.path })
						: e("div", { className: "sdw_start" },
							iconFolder(28),
							e("div", { className: "sdw_startTitle" }, "资源管理器"),
							e("div", { className: "sdw_startSub" }, "从右侧树中选择文件"))),
				e("div", { className: "sdw_explorerRight" },
					e(FileTree, { cwd, onOpenFile })));
		}

		/* ── 抽屉面板（details 槽，priority -1 阴影官方 DetailsPanel） ── */
		function DrawerPanel({ subscribe, actions, getCwd, subscribeCwd }) {
			const [open, setOpen] = useState(actions.isOpen());
			const [cwd, setCwd] = useState(() => getCwd());
			const [tabs, setTabs] = useState(() => [{ key: "t1", kind: "terminal" }]);
			const [activeKey, setActiveKey] = useState("t1");
			const [menuOpen, setMenuOpen] = useState(false);
			const [everOpened, setEverOpened] = useState(open);
			const nextKeyRef = useRef(2);
			useEffect(() => subscribe(() => setOpen(actions.isOpen())), [subscribe, actions]);
			/* cwd 变化（会话/工作区切换）→ 通知各资源管理器标签的树重建 */
			useEffect(() => subscribeCwd(() => setCwd(getCwd())), [subscribeCwd, getCwd]);
			useEffect(() => { if (open) setEverOpened(true); }, [open]);
			/* 菜单外点击 / Escape 关闭浮层 */
			useEffect(() => {
				if (!menuOpen) return;
				const onDown = (ev) => {
					if (!(ev.target instanceof Element) || ev.target.closest(".sdw_menuwrap") === null) setMenuOpen(false);
				};
				const onKey = (ev) => { if (ev.key === "Escape") setMenuOpen(false); };
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [menuOpen]);
			/* 首次展开前不渲染主体（避免页面加载即 spawn shell）；
			   展开过后折叠只 display:none 隐藏，所有 Pane 保持挂载（终端会话不断连） */
			if (!everOpened) return null;

			/* 终端标签名取 cwd 末级目录（对齐终端应用习惯），取不到回退"终端" */
			const cwdName = () => {
				const cwd = getCwd();
				if (typeof cwd !== "string" || cwd === "") return "终端";
				const parts = cwd.split(/[\\/]/).filter(Boolean);
				return parts.length > 0 ? parts[parts.length - 1] : "终端";
			};
			/* 标签标题/图标：terminal 取 cwd 末级名；browser/explorer 固定名；file 取文件名 */
			const tabTitle = (tab) => tab.kind === "terminal" ? cwdName()
				: tab.kind === "browser" ? "浏览器"
					: tab.kind === "explorer" ? "资源管理器" : tab.name;
			const tabIcon = (tab) => tab.kind === "terminal" ? iconTerminal(13)
				: tab.kind === "browser" ? iconGlobe(13)
					: tab.kind === "explorer" ? iconFolder(13) : iconFile(13);
			const addTab = (kind) => {
				setMenuOpen(false);
				if (kind === "browser" || kind === "explorer") {
					const existing = tabs.find((t) => t.kind === kind);
					if (existing !== undefined) { setActiveKey(existing.key); return; } // 浏览器/资源管理器单例：已存在只切换
				}
				const key = "t" + nextKeyRef.current++;
				setTabs((prev) => [...prev, { key, kind }]);
				setActiveKey(key);
			};
			/* 点击树中文件：按 path 查重（文件标签单例 D4/AC4），已有只聚焦，否则新开并激活 */
			const openFile = (path, name) => {
				const existing = tabs.find((t) => t.kind === "file" && t.path === path);
				if (existing !== undefined) { setActiveKey(existing.key); return; }
				const key = "t" + nextKeyRef.current++;
				setTabs((prev) => [...prev, { key, kind: "file", path, name }]);
				setActiveKey(key);
			};
			/* 关标签：终端会话由 TerminalPane 卸载时的 cleanup 负责 kill（无需父级感知 id） */
			const closeTab = (key) => {
				const idx = tabs.findIndex((t) => t.key === key);
				const next = tabs.filter((t) => t.key !== key);
				if (key === activeKey) {
					const neighbor = next[Math.min(idx, next.length - 1)];
					setActiveKey(neighbor !== undefined ? neighbor.key : null);
				}
				setTabs(next);
			};

			return e("div", {
				className: "sdw_root",
				style: open ? undefined : { display: "none" },
				role: "complementary",
				"aria-label": "侧边抽屉",
				"aria-hidden": !open
			},
				e("header", { className: "sdw_head" },
					e("nav", { className: "sdw_tabs", role: "tablist" },
						tabs.map((tab) =>
							e("button", {
								key: tab.key,
								type: "button",
								role: "tab",
								"aria-selected": activeKey === tab.key,
								className: "sdw_chip" + (activeKey === tab.key ? " sdw_chipOn" : ""),
								onClick: () => setActiveKey(tab.key)
							},
								tabIcon(tab),
								e("span", { className: "sdw_chipName" }, tabTitle(tab)),
								e("span", {
									className: "sdw_chipX",
									role: "button",
									"aria-label": "关闭标签",
									onClick: (ev) => { ev.stopPropagation(); closeTab(tab.key); }
								}, iconX()))),
						e("span", { className: "sdw_menuwrap" },
							e("button", {
								type: "button",
								className: "sdw_plus",
								title: "新建标签",
								"aria-label": "新建标签",
								"aria-expanded": menuOpen,
								onClick: () => setMenuOpen(!menuOpen)
							}, iconPlus()),
							menuOpen ? e("div", { className: "sdw_menu", role: "menu" },
								e("button", { type: "button", className: "sdw_menuItem", role: "menuitem", onClick: () => addTab("terminal") }, iconTerminal(), "终端"),
								e("button", { type: "button", className: "sdw_menuItem", role: "menuitem", onClick: () => addTab("browser") }, iconGlobe(), "浏览器"),
								e("button", { type: "button", className: "sdw_menuItem", role: "menuitem", onClick: () => addTab("explorer") }, iconFolder(), "资源管理器")) : null))),
				e("div", { className: "sdw_body" },
					tabs.length === 0 ? e("div", { className: "sdw_home" },
						e("button", { type: "button", className: "sdw_homeItem", onClick: () => addTab("terminal") }, iconTerminal(16), "终端"),
						e("button", { type: "button", className: "sdw_homeItem", onClick: () => addTab("browser") }, iconGlobe(16), "浏览器"),
						e("button", { type: "button", className: "sdw_homeItem", onClick: () => addTab("explorer") }, iconFolder(16), "资源管理器")) : null,
					tabs.map((tab) =>
						e("div", { key: tab.key, className: "sdw_pane", style: { display: activeKey === tab.key ? "flex" : "none" } },
							tab.kind === "terminal"
								? e(TerminalPane, { getCwd, visible: open && activeKey === tab.key })
								: tab.kind === "browser"
									? e(BrowserPane, { visible: open && activeKey === tab.key })
									: e(ExplorerPane, {
										kind: tab.kind,
										file: tab.kind === "file" ? { path: tab.path, name: tab.name } : null,
										cwd,
										onOpenFile: openFile
									})))));
		}

		/* ── 右上角开关按钮（会话头部右侧工具区） ─────────────────────── */
		function ToggleButton({ subscribe, actions }) {
			const [open, setOpen] = useState(actions.isOpen());
			useEffect(() => subscribe(() => setOpen(actions.isOpen())), [subscribe, actions]);
			return e("button", {
				type: "button",
				className: "sdw_toggle" + (open ? " sdw_toggleOn" : ""),
				title: open ? "收起侧边抽屉" : "展开侧边抽屉",
				"aria-label": open ? "收起侧边抽屉" : "展开侧边抽屉",
				"aria-expanded": open,
				onClick: actions.toggle
			}, iconPanel());
		}

		/* ── 插件注册 ───────────────────────────────────────────────── */
		const inject = ["slots", "sessions"];
		function apply(ctx) {
			const layout = ctx.get("layout");

			/* 模块级展开状态 + pub/sub（按钮与面板分属两棵渲染树，不能共享 React context） */
			let open = false;
			const listeners = new Set();
			const subscribe = (fn) => {
				listeners.add(fn);
				return () => { listeners.delete(fn); };
			};
			const actions = {
				isOpen: () => open,
				toggle() {
					open = !open;
					try {
						if (open) layout?.openDetails(); else layout?.closeDetails();
					} catch { /* 布局服务异常时抽屉仍切换，只是不改变栏宽 */ }
					for (const fn of [...listeners]) fn();
				},
				closeDrawer() { if (open) actions.toggle(); },
				openDrawer() { if (!open) actions.toggle(); }
			};

			/* 当前会话 cwd（终端工作目录 / 资源管理器树根），跟随会话/工作区切换；
			   cwd 变化时经 subscribeCwd 通知各资源管理器标签的树重建（AC8） */
			let currentCwd;
			const cwdListeners = new Set();
			const refreshCwd = () => {
				let next;
				try {
					const snap = ctx.sessions.list.getSnapshot();
					const id = snap.current;
					next = id !== undefined ? snap.byId[id]?.cwd : undefined;
				} catch {
					next = undefined;
				}
				if (next !== currentCwd) {
					currentCwd = next;
					for (const fn of [...cwdListeners]) fn();
				}
			};
			refreshCwd();
			ctx.effect(() => ctx.sessions.list.subscribe(refreshCwd), "side-drawer: sessions cwd");
			const getCwd = () => currentCwd;
			const subscribeCwd = (fn) => {
				cwdListeners.add(fn);
				return () => { cwdListeners.delete(fn); };
			};

			ctx.slots.inject("conversation.session.header.utilities", () => {
				const dispose = ctx.slots.register(
					{
						name: "conversation.session.header.utilities",
						id: "side-drawer-toggle",
						order: 500,
						label: "侧边抽屉",
						inject: () => ({ subscribe, actions })
					},
					ToggleButton);
				return () => { dispose(); };
			});
			ctx.slots.inject("details", () => {
				const dispose = ctx.slots.register(
					{
						name: "details",
						priority: -1,
						label: "侧边抽屉",
						inject: () => ({ subscribe, actions, getCwd, subscribeCwd })
					},
					DrawerPanel);
				return () => { dispose(); };
			});
		}

		return { apply, inject };
	}
});
