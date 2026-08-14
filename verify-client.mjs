// 临时冒烟测试：模拟 DSH 浏览器环境加载 client.js，验证 apply 的注册行为。
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const code = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");
const require = createRequire("C:/Users/ayor/.dsh/profiles/web/node_modules/dsh-plugin-side-drawer/lib/client.js");

let captured = null;
const registrations = [];
const sandbox = {
  window: { __ModuleLoader__: { load: (cfg) => { captured = cfg; } } },
  document: {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, style: {}, appendChild() {} }),
    head: { appendChild() {} }
  },
  navigator: {}
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "client.js" });

if (captured === null) throw new Error("client.js 未调用 window.__ModuleLoader__.load");
console.log("load id:", captured.id);

const { apply, inject } = captured.factory(require);
console.log("inject:", JSON.stringify(inject));

const mockCtx = {
  get: (name) => (name === "layout" ? { openDetails: () => console.log("  layout.openDetails()"), closeDetails: () => console.log("  layout.closeDetails()") } : undefined),
  sessions: {
    list: {
      getSnapshot: () => ({ current: undefined, byId: {} }),
      subscribe: () => () => {}
    }
  },
  effect: (fn) => { const d = fn(); return () => typeof d === "function" && d(); },
  slots: {
    inject: (name, cb) => { const d = cb(); return () => typeof d === "function" && d(); },
    register: (opts, comp) => {
      registrations.push({ name: opts.name, priority: opts.priority ?? 0, id: opts.id ?? null, hasInject: typeof opts.inject === "function", hasComponent: typeof comp === "function" });
      return () => {};
    }
  }
};

apply(mockCtx);
console.log("registrations:");
for (const r of registrations) console.log("  " + JSON.stringify(r));

const detailsReg = registrations.find((r) => r.name === "details");
if (!detailsReg) throw new Error("未注册 details 槽");
if (detailsReg.priority !== -1) throw new Error("details 注册 priority 应为 -1，实际 " + detailsReg.priority);
const utilReg = registrations.find((r) => r.name === "conversation.session.header.utilities");
if (!utilReg) throw new Error("未注册 utilities 席位");
console.log("SMOKE TEST PASSED");
