<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { BRAND } from '@/constants/channel'
import { bootstrapAppData } from '@/services/appBootstrap'
import { shouldShowFirstDataRootDialog } from '@/utils/firstDataRoot'
import FirstDataRootDialog from '@/components/FirstDataRootDialog.vue'

const showFirstDataRoot = ref(false)

function onFirstDataRootDone() {
  showFirstDataRoot.value = false

}

onMounted(() => {
  document.title = BRAND.productName
  void bootstrapAppData().then(() => {
    showFirstDataRoot.value = shouldShowFirstDataRootDialog()

  })
})
</script>

<template>
  <RouterView />
  <FirstDataRootDialog v-if="showFirstDataRoot" @done="onFirstDataRootDone" />
</template>
