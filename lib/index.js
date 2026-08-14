/**
 * dsh-plugin-side-drawer —— 宿主（Node）半。
 *
 * 职责：
 *  1. 以 node-pty 管理多个终端会话（每浏览器标签一个，上限 MAX_SESSIONS），输出环形缓冲（1MB/会话）；
 *  2. 通过 webServer 注册 /drawer/terminal/* JSON 路由（spawn/input/output/resize/kill）；
 *  3. 提供 /drawer/vendor/* 静态路由，向浏览器半分发 @xterm/xterm 的 ESM 与 CSS；
 *  4. 提供 /drawer/fs/* 只读路由（list/read），供资源管理器浏览工作区文件（1MB 读上限 + 二进制检测）。
 *
 * 依赖：node-pty 复用 profile 依赖树（懒加载；缺失时返回明确错误而非崩溃）；
 * @xterm/xterm 为本插件自带依赖（pnpm install 后存在于插件 node_modules，缺失时 404）。
 * 安全：所有路由校验 Sec-Fetch-Site / Origin，拒绝跨站调用（防局域网任意命令执行）。
 */
import { createRequire } from "node:module";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const MAX_OUTPUT = 1 << 20; // 输出环形缓冲上限（1MB/会话）
const MAX_SESSIONS = 8; // 同时存活的终端会话上限（防资源失控）
const MAX_READ = 1 << 20; // 文件预览读取上限（1MB，防超大文件拖垮宿主/传输）
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

let ptyModule = null;
let ptyLoadTried = false;

/**
 * 懒加载 node-pty（CJS 包）。
 * node-pty 实为 dsh 主包的嵌套依赖（@deepseek-ai/dsh/node_modules/node-pty）；
 * 注意 dsh 进程并不导出 DSH_HOME 环境变量（它把 $DSH_HOME 只当作可选覆盖项，内部按
 * "$DSH_HOME > ~/.dsh" 解析 harness home）。因此解析基准依次尝试：
 * dsh 入口脚本（process.argv[1]，位于 dsh 包内，最可靠锚点）
 * → profile 目录（$DSH_HOME，缺省 ~/.dsh）→ 模块自身位置（同盘安装场景）。
 * 全部失败返回 null（路由给出明确错误，宿主不崩溃）。
 */
function loadPty() {
	if (!ptyLoadTried) {
		ptyLoadTried = true;
		const bases = [];
		if (typeof process.argv[1] === "string" && process.argv[1] !== "") bases.push(process.argv[1]);
		const home = process.env.DSH_HOME;
		const dshHome = typeof home === "string" && home !== "" ? home : join(homedir(), ".dsh");
		bases.push(join(dshHome, "profiles", "web", "_loader.js"));
		bases.push(import.meta.url);
		for (const base of bases) {
			try {
				ptyModule = createRequire(base)("node-pty");
				break;
			} catch {
				/* 下一个基准 */
			}
		}
	}
	return ptyModule;
}

/**
 * vendor 静态资源（@xterm/xterm 的 ESM / CSS）。
 * 从插件自带 node_modules 读盘（junction 安装下 import.meta.url 为插件真实路径，可靠），
 * 内容内存缓存（只读一次）；文件缺失（未 pnpm install）返回 null，路由回 404，宿主不崩。
 */
const vendorCache = new Map(); // name -> { content: Buffer, type: string } | null
async function loadVendor(name) {
	if (vendorCache.has(name)) return vendorCache.get(name);
	const table = {
		"xterm.mjs": ["../node_modules/@xterm/xterm/lib/xterm.mjs", "text/javascript; charset=utf-8"],
		"xterm.css": ["../node_modules/@xterm/xterm/css/xterm.css", "text/css; charset=utf-8"]
	};
	const entry = table[name];
	let value = null;
	if (entry !== undefined) {
		try {
			value = { content: await readFile(new URL(entry[0], import.meta.url)), type: entry[1] };
		} catch {
			value = null; // 文件缺失 → 404
		}
	}
	vendorCache.set(name, value);
	return value;
}

/** 会话表：id → 会话；shell 退出或被 kill 时移除。 */
const terminals = new Map(); // id -> { id, proc, chunks: string[], size: number, dropped: boolean }

const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.trunc(Number(value)) || 0));

/** 校验请求 cwd：绝对路径且存在才采用，否则回退宿主进程 cwd。 */
async function resolveCwd(requested) {
	if (typeof requested === "string" && isAbsolute(requested)) {
		try {
			const info = await stat(requested);
			if (info.isDirectory()) return requested;
		} catch {
			/* 目录不存在 → 忽略参数 */
		}
	}
	return process.cwd();
}

/** 候选 shell：win32 → pwsh/powershell；posix → $SHELL/bash/sh。 */
function shellCandidates() {
	if (process.platform === "win32") {
		return [["pwsh.exe", ["-NoLogo"]], ["powershell.exe", ["-NoLogo"]]];
	}
	const shell = process.env.SHELL;
	return shell ? [[shell, []]] : [["bash", []], ["sh", []]];
}

function killSession(t) {
	try {
		t.proc.kill();
	} catch {
		/* 已退出 */
	}
}

/** 杀指定会话；id 缺省（如 pagehide beacon 的空 body）时杀全部。 */
function killTerminal(id) {
	if (typeof id === "string" && id !== "") {
		const t = terminals.get(id);
		if (t !== undefined) {
			terminals.delete(id);
			killSession(t);
		}
		return;
	}
	const all = [...terminals.values()];
	terminals.clear();
	for (const t of all) killSession(t);
}

function respond(res, status, payload) {
	res.writeHead(status, JSON_HEADERS);
	res.end(JSON.stringify(payload));
}

function readBody(req, limit = 16 * 1024) {
	return new Promise((resolve, reject) => {
		const parts = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error("request body too large"));
				req.destroy();
				return;
			}
			parts.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
		req.on("error", reject);
	});
}

/** 同源校验：拒绝跨站请求（防局域网内任意终端访问）。 */
function isSameOrigin(req) {
	const site = req.headers["sec-fetch-site"];
	if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;
	const origin = req.headers.origin;
	if (typeof origin === "string" && origin !== "") {
		try {
			if (new URL(origin).host !== (req.headers.host ?? "")) return false;
		} catch {
			return false;
		}
	}
	return true;
}

/** Required service: the profile's web server (same seam as the reference plugin). */
export const inject = ["webServer"];
export function apply(ctx) {
	const route = (path, handler) => ctx.effect(
		() => ctx.webServer.register({ kind: "exact", path, handler }),
		"side-drawer: " + path
	);
	const guard = (handler) => async (req, res) => {
		if (!isSameOrigin(req)) {
			respond(res, 403, { ok: false, error: "forbidden" });
			return;
		}
		try {
			await handler(req, res);
		} catch (error) {
			respond(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	};

	// GET /drawer/vendor/xterm.mjs 与 /drawer/vendor/xterm.css —— 向浏览器半分发 @xterm/xterm（无构建步骤）
	const vendorRoute = (name) => guard(async (req, res) => {
		if (req.method !== "GET") {
			respond(res, 405, { ok: false, error: "method not allowed" });
			return;
		}
		const file = await loadVendor(name);
		if (file === null) {
			respond(res, 404, { ok: false, error: "vendor 文件缺失：请在插件目录执行 pnpm install" });
			return;
		}
		res.writeHead(200, { "content-type": file.type, "cache-control": "no-store" });
		res.end(file.content);
	});
	route("/drawer/vendor/xterm.mjs", vendorRoute("xterm.mjs"));
	route("/drawer/vendor/xterm.css", vendorRoute("xterm.css"));

	// GET /drawer/fs/list?path= —— 列单层目录（目录优先 + 名称排序；符号链接按目标判定）
	route("/drawer/fs/list", guard(async (req, res) => {
		if (req.method !== "GET") {
			respond(res, 405, { ok: false, error: "method not allowed" });
			return;
		}
		const url = new URL(req.url ?? "/", "http://localhost");
		const dirPath = url.searchParams.get("path") ?? "";
		if (!isAbsolute(dirPath)) {
			respond(res, 400, { ok: false, error: "path 必须是绝对路径" });
			return;
		}
		let info = null;
		try {
			info = await stat(dirPath);
		} catch {
			/* 目录不存在 */
		}
		if (info === null || !info.isDirectory()) {
			respond(res, 404, { ok: false, error: "目录不存在：" + dirPath });
			return;
		}
		const entries = [];
		for (const entry of await readdir(dirPath, { withFileTypes: true })) {
			const child = join(dirPath, entry.name);
			let dir = entry.isDirectory();
			if (entry.isSymbolicLink()) {
				try {
					dir = (await stat(child)).isDirectory();
				} catch {
					dir = false; // 悬空链接按普通文件
				}
			}
			entries.push({ name: entry.name, path: child, dir });
		}
		entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
		respond(res, 200, { ok: true, path: dirPath, entries });
	}));

	// GET /drawer/fs/read?path= —— 读文本文件（>1MB 截断；前 8KB 含 NUL 判为二进制，不返回内容）
	route("/drawer/fs/read", guard(async (req, res) => {
		if (req.method !== "GET") {
			respond(res, 405, { ok: false, error: "method not allowed" });
			return;
		}
		const url = new URL(req.url ?? "/", "http://localhost");
		const filePath = url.searchParams.get("path") ?? "";
		if (!isAbsolute(filePath)) {
			respond(res, 400, { ok: false, error: "path 必须是绝对路径" });
			return;
		}
		let info = null;
		try {
			info = await stat(filePath);
		} catch {
			/* 文件不存在 */
		}
		if (info === null || !info.isFile()) {
			respond(res, 404, { ok: false, error: "文件不存在：" + filePath });
			return;
		}
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
			const binary = buffer.subarray(0, 8000).includes(0);
			respond(res, 200, {
				ok: true,
				path: filePath,
				size: info.size,
				truncated: info.size > MAX_READ,
				binary,
				content: binary ? undefined : buffer.toString("utf8")
			});
		} finally {
			await handle.close();
		}
	}));

	// POST /drawer/terminal/spawn —— 总是新建会话（多开），上限 MAX_SESSIONS
	route("/drawer/terminal/spawn", guard(async (req, res) => {
		if (req.method !== "POST") {
			respond(res, 405, { ok: false, error: "method not allowed" });
			return;
		}
		if (terminals.size >= MAX_SESSIONS) {
			respond(res, 429, { ok: false, error: "终端会话已达上限（" + MAX_SESSIONS + "）" });
			return;
		}
		const pty = loadPty();
		if (pty === null) {
			respond(res, 500, { ok: false, error: "node-pty 不可用：请确认 profile 依赖树中存在 node-pty" });
			return;
		}
		let body = {};
		try {
			body = JSON.parse(await readBody(req));
		} catch {
			/* 空 / 非法 body → 默认值 */
		}
		const cwd = await resolveCwd(body.cwd);
		const cols = clamp(body.cols, 20, 240) || 80;
		const rows = clamp(body.rows, 5, 100) || 24;
		let proc = null;
		for (const [file, args] of shellCandidates()) {
			try {
				proc = pty.spawn(file, args, {
					name: "xterm-256color",
					cols,
					rows,
					cwd,
					env: process.env
				});
				break;
			} catch {
				/* 尝试下一个候选 shell */
			}
		}
		if (proc === null) {
			respond(res, 500, { ok: false, error: "无法启动 shell（pwsh/powershell/bash 均不可用）" });
			return;
		}
		const id = "term-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
		const session = { id, proc, chunks: [], size: 0, dropped: false };
		terminals.set(id, session);
		proc.onData((data) => {
			// 会话可能已被 kill 并从 map 移除，晚到的输出直接丢弃
			if (terminals.get(id) !== session) return;
			session.chunks.push(data);
			session.size += data.length;
			while (session.size > MAX_OUTPUT && session.chunks.length > 1) {
				session.size -= session.chunks.shift().length;
				session.dropped = true;
			}
		});
		proc.onExit(() => {
			if (terminals.get(id) === session) terminals.delete(id);
		});
		respond(res, 200, { ok: true, id, cwd });
	}));

	// POST /drawer/terminal/input - 写入原始字节（回车符、Ctrl+C 字节等），按 body.id 寻址会话
	route("/drawer/terminal/input", guard(async (req, res) => {
		if (req.method !== "POST") {
			respond(res, 405, { ok: false, error: "method not allowed" });
			return;
		}
		const body = JSON.parse(await readBody(req));
		const t = typeof body.id === "string" ? terminals.get(body.id) : undefined;
		if (t === undefined) {
			respond(res, 404, { ok: false, error: "no session" });
			return;
		}
		if (typeof body.data !== "string") {
			respond(res, 400, { ok: false, error: "data required" });
			return;
		}
		t.proc.write(body.data);
		respond(res, 200, { ok: true });
	}));

	// GET /drawer/terminal/output?id=&seq= —— 返回该会话 seq 之后的增量输出
	route("/drawer/terminal/output", guard(async (req, res) => {
		if (req.method !== "GET") {
			respond(res, 405, { ok: false, error: "method not allowed" });
			return;
		}
		const url = new URL(req.url ?? "/", "http://localhost");
		const t = terminals.get(url.searchParams.get("id") ?? "");
		if (t === undefined) {
			respond(res, 200, { alive: false, seq: 0, data: "" });
			return;
		}
		const start = Math.max(0, Number(url.searchParams.get("seq") ?? 0) || 0);
		const parts = [];
		let offset = 0;
		for (const chunk of t.chunks) {
			const end = offset + chunk.length;
			if (end > start) parts.push(chunk.slice(Math.max(0, start - offset)));
			offset = end;
		}
		respond(res, 200, { alive: true, seq: t.size, data: parts.join(""), dropped: t.dropped });
		t.dropped = false;
	}));

	// POST /drawer/terminal/resize —— 按 body.id 寻址会话
	route("/drawer/terminal/resize", guard(async (req, res) => {
		if (req.method !== "POST") {
			respond(res, 405, { ok: false, error: "method not allowed" });
			return;
		}
		const body = JSON.parse(await readBody(req));
		const t = typeof body.id === "string" ? terminals.get(body.id) : undefined;
		if (t === undefined) {
			respond(res, 404, { ok: false, error: "no session" });
			return;
		}
		try {
			t.proc.resize(clamp(body.cols, 20, 240) || 80, clamp(body.rows, 5, 100) || 24);
		} catch {
			/* 部分后端不支持 resize，忽略 */
		}
		respond(res, 200, { ok: true });
	}));

	// POST /drawer/terminal/kill —— body.id 杀指定会话；缺省杀全部（pagehide 回收）
	route("/drawer/terminal/kill", guard(async (req, res) => {
		if (req.method !== "POST") {
			respond(res, 405, { ok: false, error: "method not allowed" });
			return;
		}
		let body = {};
		try {
			body = JSON.parse(await readBody(req));
		} catch {
			/* 空 / 非法 body → 杀全部 */
		}
		killTerminal(body.id);
		respond(res, 200, { ok: true });
	}));
}
