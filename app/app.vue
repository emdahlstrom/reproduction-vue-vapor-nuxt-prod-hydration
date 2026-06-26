<template>
  <div>
    <h1>Nuxt Vapor prod-hydration repro</h1>
    <!-- Auto-imported Vapor component. SSR renders it, the client hydrates it.
         Under the prod runtime with non-inline codegen the click handler is
         dead (the bug); with the @vue/runtime-vapor patch it increments. -->
    <Counter />
  </div>
</template>
