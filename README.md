# nuxt-vapor-repro

Confirms, inside **Nuxt's own production pipeline**, the Vue 3.6 Vapor bugs that
make a **non-inline** `<script setup vapor>` component break under the production
runtime — and that the `@vue/runtime-vapor` patch fixes them. Two prod bugs of the
same `__DEV__`-DCE family are reproduced here:

- **#1 `handleSetupResult`** — the non-inline `render()` never runs → button inert
  (on hydrate) / `anchor` crash (on fresh mount).
- **#1b `setRef`** — a setup-variable template ref (`const el = ref()` + `ref="el"`)
  stays `null` even once #1 is fixed, because the `setupState[ref] = el` write is
  `__DEV__`-gated and dead-code-eliminated in prod. Masked by #1 (no render until
  #1 is patched), so it only surfaces with #1 already applied.

The single patch (`patches/@vue__runtime-vapor@3.6.0-beta.17.patch`) fixes both.

Companion to the bare Vite/Astro repro at
`../vue-vapor-ssr-prod-hydration`, which proves the same runtime behaviour with a
pure-Vapor root. This repo reproduces it through Nuxt's vDOM app + SSR +
hydration instead.

## Versions

- Node 24, pnpm 10
- Nuxt `4.4.8`, Vue `3.6.0-beta.17` (every `@vue/*` pinned to the beta via
  `pnpm.overrides` so the runtime, compiler and SSR halves stay in lockstep)
- `@vitejs/plugin-vue 6.0.7` (pulled in by Nuxt)

## The bug

`@vue/runtime-vapor`'s `handleSetupResult` only handles a non-block setup return
(the bindings object a **non-inline** SFC produces) inside a
`NODE_ENV !== "production"` branch:

```js
// runtime-vapor.esm-bundler.js, handleSetupResult
if (!!(process.env.NODE_ENV !== "production") && !isBlock(setupResult)) { /* ...dev only... */ }
else if (setupResult === EMPTY_OBJ && component.render) instance.block = callRender(...);
else instance.block = setupResult;   // <-- prod: bindings object assigned AS the block
```

In production that `isBlock` discriminator is gone, so the bindings object
(`{ count: ref(0), __isScriptSetup: true }`) is assigned straight to
`instance.block`. The real `render()` never runs against the setup state, so the
hydrated `<button>` never gets its delegated `$evtclick` handler and stays inert.

An **inline** build hides this (setup returns the block directly), so forcing
non-inline codegen is essential or the test is a false negative.

The patch adds the missing production branch:

```diff
 else if (setupResult === EMPTY_OBJ && component.render) instance.block = callRender(component.render, instance, setupResult);
+else if (!isBlock(setupResult) && component.render) {
+	instance.setupState = proxyRefs(setupResult);
+	instance.block = callRender(component.render, instance, instance.setupState);
+}
 else instance.block = setupResult;
```

## The second bug (#1b): template refs to setup variables

With #1 patched, `render()` runs — but a setup-variable template ref is still
broken. In `setRef$1` the `setupState` handle and its writes are `__DEV__`-gated,
so in prod the element is written only to `instance.refs`, never to the setup
`ref()`:

```js
// runtime-vapor.esm-bundler.js, setRef$1
const setupState   = __DEV__ ? instance.setupState || {} : null;          // null in prod
const canSetSetupRef = __DEV__ ? createCanSetSetupRefChecker(...) : NO;    // NO in prod
...
refs[ref] = refValue;
if (__DEV__ && canSetSetupRef(ref)) setupState[ref] = refValue;           // DCE'd in prod
```

So `const el = ref(); ref="el"; onMounted(() => el.value)` sees `el.value === null`
in non-inline prod. The same patch un-gates `setupState`/`canSetSetupRef` and the
`setupState[ref]` writes (guarded by the existing `canSetSetupRef`), so the write
fires in prod and `el.value` resolves to the element. The repro's `Counter.vue`
includes such a ref to exercise this (`templateRef = ref-NULL` → `ref-set:BUTTON`).

## Two extra things Nuxt needs (vs. the bare repro)

The bare repro mounts a **pure-Vapor root** (`createVaporSSRApp(Counter)`). Nuxt's
app root is always vDOM, so the Vapor `<Counter>` is a vDOM child and two things
must be arranged that the handoff didn't anticipate:

1. **Force non-inline codegen via `vite.vue`, not the top-level `vue` key.**
   `@nuxt/vite-builder` calls `vuePlugin(config.vue)` where `config.vue` comes
   from `vite.vue`. The top-level `vue` key feeds the compiler's transform
   options, not the plugin's `features`. So `vite.vue.features.prodDevtools: true`
   is what flips the plugin's `devToolsEnabled` → disables `inlineTemplate` →
   non-inline render function. (Setting it on the top-level `vue` key is a no-op
   and the build stays inline.)

2. **Install `vaporInteropPlugin` (client-only).** Vue 3.6's vapor↔vdom interop
   must be registered on the app, and Nuxt does **not** do this out of the box.
   Without it, a Vapor child of the vDOM root has no registered mount/hydrate
   hook and the interop dispatch reads `.mount`/`.hydrate` off `undefined`,
   crashing the **whole app** (both inline and non-inline) before the
   `handleSetupResult` bug can even surface — see `app/plugins/vapor-interop.client.ts`.
   It's client-only because `vaporInteropPlugin` is exported from vue's
   bundler/browser build (what Vite bundles for the client) but not from the Node
   entry Nitro externalises on the server; SSR renders the Vapor child fine
   without it.

With the interop wired, the build is genuinely non-inline (verified: the Counter
chunk's `setup()` returns `{ count: ref(0) }` with `__isScriptSetup` plus a
separate `render` function), and the original bug reproduces cleanly.

## One-command check

```bash
pnpm install
pnpm verify          # build + serve prod + drive headless Chromium + assert
```

`verify.mjs` detects the patch state of the installed `@vue/runtime-vapor` and
asserts the matching behaviour, so it is a regression gate in **both**
configurations (exit 0 = behaviour matched):

- patched (default) → working: click reactive, `$evtclick=function`,
  `templateRef=ref-set:BUTTON`, 0 console errors.
- patch removed → app broken (no interactive button).

It uses a real headless Chromium (happy-dom/jsdom mis-report this bug) and a
fresh build each run (it clears the Nuxt/Vite caches first).

## Reproduce manually

Default state has the patch **applied** (the app works). To see the bug, toggle
the patch off.

```bash
pnpm install
pnpm build
PORT=3000 node .output/server/index.mjs
```

Open <http://localhost:3000> in a **real browser** (Chromium/Firefox — not
happy-dom/jsdom, which mis-report this). In the console:

```js
const b = document.querySelector('button')
typeof b.$evtclick   // 'function' (patched) | 'undefined' (buggy)
b.click()            // increments (patched) | nothing (buggy)
```

### Run WITHOUT the patch (the bug)

Remove the `pnpm.patchedDependencies` block from `package.json`, then:

```bash
pnpm install --force               # --force needed: a plain install leaves the patched bytes
rm -rf node_modules/.cache .nuxt node_modules/.vite .output   # clear caches (important)
pnpm build && PORT=3000 node .output/server/index.mjs
```

### Run WITH the patch (fixed)

Restore the `patchedDependencies` block and repeat. Clearing the Nuxt/Vite cache
between toggles is required — otherwise the previous runtime is reused and the
client chunk hash won't change.

## Result

Default config (SSR + hydration):

| | without patch | with patch |
|---|---|---|
| `$evtclick` | `undefined` | `function` |
| click reactivity | dead — `count is 0` → `0` | `count is 0` → `1` |
| app hydration | button present but inert (no console error) | interactive |
| template ref (#1b) | n/a — render never runs | `btnEl.value` = the `<button>` |

With #1 patched but #1b **not**, the button is interactive yet
`templateRef = ref-NULL` (the #1b surface). With the full patch:
`templateRef = ref-set:BUTTON`. Flipping only the `patchedDependencies` entry
flips the behaviour, proving the patch is the cause of the fix.

### Surfaces of #1 (no patch)

The canonical #1 surface is selected by `if (!isHydrating)` in runtime-vapor's
`mountComponent` — and holds for a **pure-Vapor** root (bare repro) regardless of
whether the component has a template ref:

| pure-Vapor, no patch, non-inline | SSR + hydrate | fresh mount (`createVaporSSRApp` / SPA `ssr:false`) |
|---|---|---|
| surface | component **inert** (no crash) | hard crash `TypeError: …reading 'anchor'` |

The patch fixes both (`ssr:false` + patch → `count is 0` → `1`).

**Nuxt-specific sharper manifestation:** Nuxt hosts the Vapor component as a vDOM
child, so hydration goes through the vapor↔vdom interop. With **this repo's
component (which uses a setup-var template ref)**, the no-patch SSR+hydrate case
**crashes** (no button, 1 console error) instead of going inert — `verify.mjs`
asserts "no working interactive button", which covers both. This crash is
**interop-host-specific**: peers confirmed a pure-Vapor template-ref component
stays inert on hydrate (canonical bare repro + plummis/Astro), so it is not a
generic #1 escalation. The `run1b-without-patch-dead-button.png` screenshot shows
the plain inert surface (captured with a plain `ref`+click component).

Screenshots in `screenshots/`:

- `run1b-without-patch-dead-button.png` — SSR, no patch: inert button
- `run2-with-patch-working.png` — SSR, patched: `count is 1` after a click
- `both-patches-working.png` — SSR, full patch: `count is 1` **and**
  `templateRef = ref-set:BUTTON` (#1 + #1b fixed)
- `bug1b-templateref-null.png` — SSR, #1 patched only: interactive but
  `templateRef = ref-NULL` (the #1b surface in isolation)
- `spa-nopatch-anchor-crash.png` — `ssr:false`, interop-wired, no patch: the
  `anchor` fresh-mount crash
- `run1-without-patch-crash.png` — the *different* whole-app crash
  (`reading 'hydrate'`) you get if the `vaporInteropPlugin` client plugin is
  removed entirely (separate, more fundamental Nuxt issue that masks the target
  bug — happens for inline too)
