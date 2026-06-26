// https://nuxt.com/docs/api/configuration/nuxt-config
//
// Reproduction of the Vue 3.6 Vapor prod-hydration bug inside Nuxt's own build.
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // `vite.vue.features.prodDevtools: true` flips @vitejs/plugin-vue's
  // `devToolsEnabled`, disabling `inlineTemplate` so the SFC compiles to a
  // separate (non-inline) render function — the codegen shape that triggers the
  // bug. It MUST live under `vite.vue` (what @nuxt/vite-builder passes to the Vue
  // plugin); the top-level `vue` key feeds the compiler's transform options
  // instead and leaves the build inline (a false negative).
  vite: {
    vue: {
      features: { prodDevtools: true },
    },
  },
})
