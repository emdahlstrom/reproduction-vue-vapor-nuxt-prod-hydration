<script setup vapor lang="ts">
import { ref, onMounted } from 'vue'
const count = ref(0)

// The button proves click hydration (#1 handleSetupResult); the probe proves a
// setup-variable template ref reaches the setup var (#1b setRef). See README.
const btnEl = ref<HTMLButtonElement | null>(null)
const refProbe = ref('pending')
onMounted(() => {
  refProbe.value = btnEl.value ? `ref-set:${btnEl.value.tagName}` : 'ref-NULL'
})
</script>

<template>
  <button ref="btnEl" type="button" @click="count++">count is {{ count }}</button>
  <p data-test="probe">{{ refProbe }}</p>
</template>
