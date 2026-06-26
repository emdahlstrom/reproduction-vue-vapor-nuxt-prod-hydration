<script setup vapor lang="ts">
import { ref, onMounted } from 'vue'
const count = ref(0)

// A setup-variable template ref. This exercises BOTH prod bugs:
//   #1  handleSetupResult drops the non-inline render()  -> button inert
//   #1b setRef's `setupState[ref] = el` write is __DEV__-gated/DCE'd
//       -> `btnEl.value` stays null even once #1 is fixed
// The patch (patches/@vue__runtime-vapor@3.6.0-beta.17.patch) fixes both.
const btnEl = ref<HTMLButtonElement | null>(null)
const refProbe = ref('pending')
onMounted(() => {
  refProbe.value = btnEl.value ? `ref-set:${btnEl.value.tagName}` : 'ref-NULL'
})
</script>

<template>
  <button ref="btnEl" type="button" @click="count++">count is {{ count }}</button>
  <p data-test="probe">templateRef = {{ refProbe }}</p>
</template>
