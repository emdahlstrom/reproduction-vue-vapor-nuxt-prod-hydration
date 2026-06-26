// https://nuxt.com/docs/api/configuration/nuxt-config
//
// Reproduction of the Vue 3.6 Vapor prod-hydration bug inside Nuxt's own build.
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  // @nuxt/vite-builder invokes `vuePlugin(config.vue)` where `config.vue`
  // comes from `vite.vue` (NOT the top-level `vue` key, which feeds the
  // compiler's transform options, not the plugin's `features`). Setting
  // `features.prodDevtools: true` here flips the plugin's `devToolsEnabled`,
  // which disables `inlineTemplate` -> the SFC compiles to a separate
  // (non-inline) render function. That is the codegen shape that triggers
  // the bug; the default inline build hides it (false negative).
  vite: {
    vue: {
      features: { prodDevtools: true },
    },
  },
})
