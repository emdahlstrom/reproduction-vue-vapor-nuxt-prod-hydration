import { vaporInteropPlugin } from 'vue'

// Vue 3.6's vapor<->vdom interop must be registered on the app; Nuxt does not do
// this out of the box, so a `<script setup vapor>` child of Nuxt's vDOM root has
// no mount/hydrate hook and the interop dispatch reads `.mount`/`.hydrate` off
// `undefined`, crashing the whole app before the target bug can surface.
//
// Client-only: `vaporInteropPlugin` is exported from vue's browser build (what
// Vite bundles for the client) but not the Node entry Nitro externalises, so a
// universal plugin breaks the SSR bundle. SSR renders the Vapor child fine.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(vaporInteropPlugin)
})
