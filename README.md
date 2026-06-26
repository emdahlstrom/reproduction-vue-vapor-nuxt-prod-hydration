# nuxt-vapor-repro

> **TL;DR** — Under Vue 3.6's production Vapor runtime (through beta.17), a non-inline
> `<script setup vapor>` component hydrates dead / crashes on fresh mount (#1 `handleSetupResult`)
> and its string template refs never reach the setup variable (#1b `setRef`) — both are
> `__DEV__`-gated setup-state wiring that the prod build dead-code-eliminates. This repo proves it
> inside Nuxt's real production pipeline; `pnpm install && pnpm verify` reproduces it in a real
> browser and the bundled patch fixes both.

"Non-inline" means the SFC compiles to a separate `render()` instead of the template folded into
`setup()`. The dev runtime and the inline prod build are both fine; only non-inline prod is broken.
This repo reproduces the bugs through Nuxt's full production pipeline (vDOM app + SSR + hydration via
the vapor↔vdom interop), as a companion to the pure-Vite/Astro repro:
https://github.com/emdahlstrom/reproduction-vue-vapor-ssr-prod-hydration

Node 24 · pnpm 10 · Nuxt 4.4.8 · Vue 3.6.0-beta.17 (all `@vue/*` pinned via `pnpm.overrides`
to keep runtime, compiler, and SSR in lockstep).

## The two bugs

**#1 `handleSetupResult`** (`packages/runtime-vapor/src/component.ts`). A non-inline `setup()`
returns a bindings object. In prod the branch that runs `component.render` for it is
`__DEV__`-gated, so the object is assigned straight to `instance.block` and `render()` never
runs. The hydrated `<button>` never gets its delegated `$evtclick` handler and stays inert; a
fresh mount crashes with `TypeError: Cannot read properties of undefined (reading 'anchor')`.

**#1b `setRef`** (`packages/runtime-vapor/src/apiTemplateRef.ts`). The `setupState[ref] = node`
writes are `__DEV__`-gated, so a string template ref (`ref="el"` → `const el = ref()`) reaches
only `$refs`, never the setup variable: `el.value` stays `null`. Masked by #1 — no render runs
until #1 is fixed — so it only surfaces once #1 is patched.

Present through `vue@3.6.0-beta.17` (`handleSetupResult` byte-identical to beta.16; `setRef`
setupState still gated).

## Why non-inline matters

`@vitejs/plugin-vue` folds the template into `setup()` only when `!devServer && !devToolsEnabled`.
Nuxt, Astro, and `features: { prodDevtools: true }` all produce non-inline output in prod, so
real prod builds hit this. An inline build returns the block directly and hides the bug — forcing
non-inline codegen is essential or the test is a false negative.

## Reproduce

```bash
pnpm install
pnpm verify   # build + serve prod + drive headless Chromium + assert
```

`verify.mjs` detects the patch state of the installed `@vue/runtime-vapor` and asserts the
matching behaviour, so it is a regression gate in every state (exit 0 = behaviour matched). A
real headless Chromium is required — happy-dom/jsdom mis-report this bug.

Expected output with the patch applied (default):

```
Detected runtime: #1=true #1b=true -> expecting: #1 + #1b patched (working)
  ✓ button present
  ✓ click reactive (count 0 -> 1)
  ✓ $evtclick === function
  ✓ template ref resolved (ref-set:BUTTON)
  ✓ no console errors

Observed: button="count is 0"->"count is 1" reactive=true $evtclick=function templateRef=ref-set:BUTTON consoleErrors=0

PASS — behaviour matches "#1 + #1b patched (working)".
```

To see the bug, remove the `pnpm.patchedDependencies` block from `package.json`, then
`pnpm install --force && pnpm verify`. The runtime is now unpatched and `verify.mjs` asserts the
broken behaviour: no working interactive button. (In Nuxt's vDOM-interop host the unpatched
component with a setup-var template ref *crashes* on hydrate rather than going inert; a
pure-Vapor root just goes inert. Either way it is not interactive.)

## The fix

The single patch (`patches/@vue__runtime-vapor@3.6.0-beta.17.patch`) fixes both.

**#1** — add the missing production branch in `handleSetupResult`:

```diff
 else if (setupResult === EMPTY_OBJ && component.render) instance.block = callRender(component.render, instance, setupResult);
+else if (!isBlock(setupResult) && component.render) {
+	instance.setupState = proxyRefs(setupResult);
+	instance.block = callRender(component.render, instance, instance.setupState);
+}
 else instance.block = setupResult;
```

**#1b** — un-gate the `setupState` handle, the `canSetSetupRef` checker, and every
`setupState[ref] = …` write in `setRef` (the existing `canSetSetupRef` guard stays):

```diff
-const setupState = __DEV__ ? instance.setupState || {} : null;
+const setupState = instance.setupState || {};
-const canSetSetupRef = __DEV__ ? createCanSetSetupRefChecker(setupState, refs) : NO;
+const canSetSetupRef = createCanSetSetupRefChecker(setupState, refs);
 ...
 refs[ref] = refValue;
-if (__DEV__ && canSetSetupRef(ref)) setupState[ref] = refValue;
+if (canSetSetupRef(ref)) setupState[ref] = refValue;
```

## Nuxt-specific wiring

Nuxt's app root is always vDOM, so the Vapor `<Counter>` is a vDOM child. Two things have to be
arranged, both reflected in the config:

1. **Force non-inline codegen via `vite.vue`, not the top-level `vue` key** (`nuxt.config.ts`).
   `@nuxt/vite-builder` calls `vuePlugin(config.vue)` from `vite.vue`, so
   `vite.vue.features.prodDevtools: true` flips the plugin's `devToolsEnabled` → disables
   `inlineTemplate`. Setting it on the top-level `vue` key is a no-op (the build stays inline).

2. **Install `vaporInteropPlugin`, client-only** (`app/plugins/vapor-interop.client.ts`). The
   vapor↔vdom interop must be registered on the app; Nuxt does not do this out of the box.
   Without it the interop dispatch reads `.mount`/`.hydrate` off `undefined` and crashes the
   whole app before the target bug can surface. Client-only because the plugin is exported from
   vue's browser build (what Vite bundles for the client) but not the Node entry Nitro
   externalises on the server; SSR renders the Vapor child fine without it.
