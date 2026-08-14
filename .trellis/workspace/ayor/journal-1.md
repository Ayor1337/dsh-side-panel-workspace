# Journal - ayor (Part 1)

> AI development session journal
> Started: 2026-08-14

---



## Session 1: 抽屉插件 v2：xterm 终端 + 浏览器增强 + node-pty 解析修复

**Date**: 2026-08-14
**Task**: 抽屉插件 v2：xterm 终端 + 浏览器增强 + node-pty 解析修复

### Summary

终端 textarea 换 xterm.js（宿主 vendor 路由分发自包含 ESM，浏览器动态 import，零构建）；折叠不断连（display:none 保活 + pagehide 回收）；浏览器页加后退/前进/刷新、localStorage 网址记忆、iframe sandbox 加固。check 阶段修复：输入 promise 链串行化防乱序、输出拉取单飞、主题 token 从 body 读取（DSH 只在 body 定义 --dsw-*）。热修 node-pty 解析根因：dsh 不导出 DSH_HOME，node-pty 是 dsh 主包嵌套依赖，loadPty 改三级基准（argv[1] > DSH_HOME/~/.dsh profile > 插件目录）。自动验证全过；AC8-AC11 手测（重启 dsh web 后）待用户确认。新知识已写入 .trellis/spec/frontend/component-guidelines.md。

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**
