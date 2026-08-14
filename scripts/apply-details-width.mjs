// 宿主补丁：放宽 DSH details 栏宽度上限（默认 520 → 900，可用参数覆盖）。
// 背景：details 栏宽被宿主 dsh-client-ui-layout 钳制在 300–520px
// （setDetails 与 computeColumns 两处 clampWidth），插件无 API 可改。
// 全局 dsh 为 npm 平铺安装（非 pnpm 管理），无法用 pnpm patch，
// 故用本脚本做可重放的等价补丁；dsh 升级覆盖后重跑一次即可。
// 用法：node scripts/apply-details-width.mjs [目标最大宽度px]
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const target = Math.trunc(Number(process.argv[2])) || 900;
if (target < 520 || target > 4000) {
  console.error("目标宽度应在 520–4000 之间，实际: " + process.argv[2]);
  process.exit(1);
}

// 定位全局 node_modules（npm root -g），拼出 ui-layout 的 client.js
let globalRoot;
try {
  globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
} catch {
  globalRoot = join(process.env.APPDATA ?? "", "npm", "node_modules");
}
const file = join(globalRoot, "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-client-ui-layout", "lib", "client.js");

let src;
try {
  src = readFileSync(file, "utf8");
} catch {
  console.error("找不到宿主文件: " + file + "\n请确认 dsh 为全局安装，或手动核对路径。");
  process.exit(1);
}

// 两处钳制点：拖拽写入（setDetails）与排版计算（computeColumns）。
// 正则匹配 "300, <数字>"，兼容首次打补丁（520）与重复执行（已是其他值）。
const sites = [
  { name: "setDetails", re: /clampWidth\(px, 300, \d+\)/ },
  { name: "computeColumns", re: /clampWidth\(details, 300, \d+\)/ }
];
let patched = src;
for (const { name, re } of sites) {
  const m = patched.match(re);
  if (m === null) {
    console.error("未找到钳制点 " + name + "（" + re.source + "）。dsh 可能已改版，请人工核对 " + file);
    process.exit(1);
  }
  if (m[0] === "clampWidth(" + (name === "setDetails" ? "px" : "details") + ", 300, " + target + ")") {
    console.log(name + ": 已是 " + target + "，无需改动");
    continue;
  }
  patched = patched.replace(re, (s) => s.replace(/\d+\)$/, target + ")"));
  console.log(name + ": " + m[0] + "  →  上限 " + target);
}

if (patched !== src) {
  writeFileSync(file, patched);
  console.log("已写入 " + file);
}
console.log("完成。重启 dsh web 后生效，展开抽屉即可拖出 300–" + target + "px 的宽度。");
