import { vaporInteropPlugin } from 'vue'

// Vue 3.6's Vapor components can only live inside a vDOM app tree through the
// vapor<->vdom interop, which must be registered on the app via this plugin.
// Nuxt does NOT install it out of the box, so a `<script setup vapor>` child
// of Nuxt's vDOM root has no registered mount/hydrate hook and the interop
// dispatch reads `.mount`/`.hydrate` off `undefined` -> the whole app crashes.
//
// Client-only (`.client.ts`) on purpose: `vaporInteropPlugin` is exported from
// vue's bundler/browser build (what Vite bundles for the client) but NOT from
// the Node entry that Nitro externalises on the server, so importing it in a
// universal plugin makes the SSR bundle throw "no export named
// vaporInteropPlugin". SSR renders the Vapor child correctly without it; only
// client hydration needs the bridge.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(vaporInteropPlugin)
})
