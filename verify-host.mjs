// 临时冒烟测试：mock webServer 加载宿主半，真实 spawn shell 验证终端全链路（多会话模型）。
import { PassThrough } from "node:stream";

const mod = await import("./lib/index.js");
const routes = {};
const ctx = {
  effect: (fn) => { const d = fn(); return () => typeof d === "function" && d(); },
  webServer: { register: (cfg) => { routes[cfg.path] = cfg.handler; return () => {}; } }
};
mod.apply(ctx);
console.log("routes:", Object.keys(routes).join(", "));
if (typeof routes["/drawer/terminal/spawn"] !== "function") throw new Error("spawn 路由未注册");
if (typeof routes["/drawer/vendor/xterm.mjs"] !== "function") throw new Error("vendor xterm.mjs 路由未注册");
if (typeof routes["/drawer/vendor/xterm.css"] !== "function") throw new Error("vendor xterm.css 路由未注册");

function call(method, path, body) {
  return new Promise((resolve) => {
    const req = new PassThrough();
    req.method = method;
    req.url = path;
    req.headers = { "sec-fetch-site": "same-origin", host: "127.0.0.1:3080" };
    if (body !== undefined) req.push(JSON.stringify(body));
    req.push(null);
    const res = {
      status: 0,
      payload: "",
      writeHead: function (s) { this.status = s; },
      end: function (chunk) { this.payload += chunk; resolve(JSON.parse(this.payload)); }
    };
    routes[path.split("?")[0]](req, res);
  });
}

// 原始响应版本（vendor 路由返回非 JSON 内容，需校验 content-type 与原始 body）
function callRaw(method, path) {
  return new Promise((resolve) => {
    const req = new PassThrough();
    req.method = method;
    req.url = path;
    req.headers = { "sec-fetch-site": "same-origin", host: "127.0.0.1:3080" };
    req.push(null);
    const res = {
      status: 0,
      headers: {},
      payload: "",
      writeHead: function (s, h) { this.status = s; this.headers = h ?? {}; },
      end: function (chunk) { if (chunk) this.payload += chunk.toString("utf8"); resolve(this); }
    };
    routes[path.split("?")[0]](req, res);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 0. vendor 静态路由：200 + content-type 正确 + body 非空
const mjs = await callRaw("GET", "/drawer/vendor/xterm.mjs");
if (mjs.status !== 200) throw new Error("xterm.mjs 应返回 200，实际 " + mjs.status + ": " + mjs.payload.slice(0, 200));
if (!String(mjs.headers["content-type"]).startsWith("text/javascript")) throw new Error("xterm.mjs content-type 错误: " + mjs.headers["content-type"]);
if (mjs.payload.length === 0) throw new Error("xterm.mjs body 为空");
const css = await callRaw("GET", "/drawer/vendor/xterm.css");
if (css.status !== 200) throw new Error("xterm.css 应返回 200，实际 " + css.status + ": " + css.payload.slice(0, 200));
if (!String(css.headers["content-type"]).startsWith("text/css")) throw new Error("xterm.css content-type 错误: " + css.headers["content-type"]);
if (css.payload.length === 0) throw new Error("xterm.css body 为空");
console.log("vendor routes ok (xterm.mjs " + mjs.payload.length + "B, xterm.css " + css.payload.length + "B)");

// 多会话辅助：轮询某会话输出直到出现标记（最长 15s）
async function waitMarker(id, marker) {
  let output = "";
  let seq = 0;
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    const out = await call("GET", "/drawer/terminal/output?id=" + id + "&seq=" + seq);
    if (out.alive === false) throw new Error("会话 " + id + " 提前退出");
    seq = out.seq;
    output += out.data;
    if (output.includes(marker)) return;
  }
  throw new Error("会话 " + id + " 输出中未找到标记，实际输出: " + JSON.stringify(output.slice(0, 400)));
}

// 1. 多开：spawn 两个独立会话
const s1 = await call("POST", "/drawer/terminal/spawn", { cols: 80, rows: 24, cwd: "E:/Projects/workspace-deepseek-plugin" });
const s2 = await call("POST", "/drawer/terminal/spawn", { cols: 80, rows: 24, cwd: "E:/Projects/workspace-deepseek-plugin" });
if (s1.ok !== true || s2.ok !== true) throw new Error("spawn 失败: " + JSON.stringify(s1) + " / " + JSON.stringify(s2));
if (s1.id === s2.id) throw new Error("两次 spawn 应得到不同 id");
console.log("spawn x2 ok, ids:", s1.id, "/", s2.id);

// 2. 各自 echo 不同标记，输出互不串扰
await sleep(2500);
await call("POST", "/drawer/terminal/input", { id: s1.id, data: "echo DRAWER_MARKER_ONE\r" });
await call("POST", "/drawer/terminal/input", { id: s2.id, data: "echo DRAWER_MARKER_TWO\r" });
await waitMarker(s1.id, "DRAWER_MARKER_ONE");
await waitMarker(s2.id, "DRAWER_MARKER_TWO");
console.log("output roundtrip ok（两会话各自回显，互不串扰）");

// 3. kill 指定 id：s1 灭，s2 仍 alive
await call("POST", "/drawer/terminal/kill", { id: s1.id });
const after1 = await call("GET", "/drawer/terminal/output?id=" + s1.id + "&seq=0");
if (after1.alive !== false) throw new Error("kill 指定 id 后该会话 alive 应为 false");
const after2 = await call("GET", "/drawer/terminal/output?id=" + s2.id + "&seq=0");
if (after2.alive !== true) throw new Error("未 kill 的会话应仍 alive");
console.log("kill by id ok（只灭指定会话）");

// 4. 会话上限：s2 再加 7 个凑满 8，第 9 个应被拒绝
const extra = [];
for (let i = 0; i < 7; i++) {
  const s = await call("POST", "/drawer/terminal/spawn", { cols: 80, rows: 24 });
  if (s.ok !== true) throw new Error("第 " + (i + 3) + " 个会话 spawn 失败: " + JSON.stringify(s));
  extra.push(s.id);
}
const ninth = await call("POST", "/drawer/terminal/spawn", { cols: 80, rows: 24 });
if (ninth.ok !== false) throw new Error("超过上限应返回 ok:false，实际: " + JSON.stringify(ninth));
console.log("session cap ok（第 9 个被拒: " + ninth.error + "）");

// 5. kill 缺省 id = 杀全部（pagehide 回收语义）
await call("POST", "/drawer/terminal/kill", {});
const check2 = await call("GET", "/drawer/terminal/output?id=" + s2.id + "&seq=0");
const checkExtra = await call("GET", "/drawer/terminal/output?id=" + extra[0] + "&seq=0");
if (check2.alive !== false || checkExtra.alive !== false) throw new Error("kill {} 应杀掉全部会话");
console.log("kill-all ok（空 body 全灭）");
console.log("HOST SMOKE TEST PASSED");
