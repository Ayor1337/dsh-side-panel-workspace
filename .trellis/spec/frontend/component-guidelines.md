# Component Guidelines

> How components are built in this project (DSH Web plugin client halves).

---

## Overview

The client half (`lib/client.js`) is a **self-contained classic script** loaded via
`window.__ModuleLoader__.load({ id, factory })`. Constraints that every component must respect:

- No top-level `import`/`export`; React comes only from the factory's `require("react")`.
- Use `React.createElement` (no JSX, no build step).
- Components render inside DSH slot hosts (e.g. `details`, `conversation.session.header.utilities`);
  every effect/listener/observer/timer must return a cleanup.

---

## Component Structure

Components are plain functions inside the factory closure. Shared state that spans two render
trees (e.g. header toggle button ↔ details panel) uses an apply-closure pub/sub
(`subscribe`/`actions` injected via slot `inject()`), never React context.

---

## Props Conventions

Slot-registered components receive props only from the registration's `inject()` return value.
Visibility/lifecycle flags (e.g. `visible`) are passed down as plain props.

---

## Styling Patterns

Styles are injected as a single `<style data-plugin="dsh-plugin-side-drawer">` tag built from a
CSS-string array (the loader recycles it on module unload). All colors/spacing use DSH theme
variables (`--dsw-*` with fallbacks).

### Convention: Read `--dsw-*` tokens from `document.body`, never `document.documentElement`

**What**: When JS needs the computed value of a DSH theme token (e.g. to feed a canvas/terminal
theme), read `getComputedStyle(document.body)`, and watch **both** `<html>` and `<body>` for
changes.

**Why**: DSH ThemePresenter defines `--dsw-*` tokens **only** on `body {…}` /
`body[data-ds-dark-theme] {…}` selectors (no `:root` rule), and on theme switch it writes
`documentElement.style.colorScheme` + `body.dataset.dsDarkTheme` + inline tokens on `<body>`.
Custom properties inherit downwards, so `documentElement` (parent of `body`) **never** sees them
— reading it silently yields the fallback value (dark theme → near-black text on dark terminal).

**Example**:

```js
// Wrong — always the fallback; observer on <html> alone never fires for body token changes
const fg = getComputedStyle(document.documentElement).getPropertyValue("--dsw-alias-label-primary");
observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

// Correct
const fg = getComputedStyle(document.body ?? document.documentElement)
  .getPropertyValue("--dsw-alias-label-primary");
const watch = { attributes: true, attributeFilter: ["class", "style", "data-ds-dark-theme"] };
observer.observe(document.documentElement, watch);
observer.observe(document.body, watch);
```

---

## Loading Vendor Libraries (No Build Step)

### Convention: serve self-contained ESM through host routes, `import()` at runtime

**What**: Browser-side third-party libraries are served by the host half from the plugin's own
`node_modules` (`new URL("../node_modules/<pkg>/...", import.meta.url)`) via same-origin-guarded
routes, then loaded in a component effect with dynamic `import()`. Library CSS is injected as a
`<link data-plugin=...>` and must be **fully loaded** before the library initializes.

**Why**: client.js must stay a self-contained classic script, and the project has no bundler.
`@xterm/xterm@6.x` ships `lib/xterm.mjs` as a self-contained ESM single file (verified: 0 import
statements) — this must be re-verified on major upgrades (`grep -c "^import" lib/xterm.mjs`).

**Example**:

```js
// Wrong — open() may run before xterm.css arrives; xterm then mis-measures cols/rows
ensureXtermCss(); // fire-and-forget <link> injection
const { Terminal } = await import("/drawer/vendor/xterm.mjs");
term.open(el);

// Correct — both ready before open()
const [mod] = await Promise.all([import("/drawer/vendor/xterm.mjs"), ensureXtermCss()]);
const term = new mod.Terminal({ /* ... */ });
term.open(el);
```

**Related**: `.trellis/tasks/08-14-side-drawer-plugin/research/xterm-browser-loading.md`,
`.trellis/tasks/08-14-side-drawer-plugin/research/dsh-plugin-mechanisms.md`.

---

## Accessibility

Icon-only buttons carry `title` + `aria-label`; the drawer root uses `role="complementary"` and
`aria-hidden` when collapsed; tabs use `role="tablist"/"tab"` with `aria-selected`.

---

## Common Mistakes

### Mistake: killing the terminal session on component unmount

**Symptom**: collapsing the drawer destroyed the shell session.

**Cause**: `if (!open) return null` unmounted the pane; its cleanup sent `kill`.

**Fix**: keep panes mounted behind `display:none` once first opened (`everOpened` gate), stop
polling while hidden, and kill only on `window pagehide` (sendBeacon).

### Mistake: unguarded per-keystroke `fetch POST` for terminal input

**Symptom**: fast typing could deliver bytes to the pty out of order (browser connection pool
runs concurrent POSTs over different sockets).

**Fix**: serialize sends through a promise chain (`sendQueue = sendQueue.then(() => post(...))`),
dropping queued input whose session is stale; pair with a single-flight guard on output polling
so a manual tick and an interval tick cannot fetch the same `seq` twice.
