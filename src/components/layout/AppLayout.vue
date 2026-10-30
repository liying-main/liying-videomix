<script setup lang="ts">
import { provide, ref } from 'vue'
import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'
import CustomTitlebar from './CustomTitlebar.vue'
import LocalSetupNotice from './LocalSetupNotice.vue'

const collapsed = ref(false)

provide('sidebarCollapsed', collapsed)
provide('toggleSidebar', () => {
  collapsed.value = !collapsed.value
})
</script>

<template>
  <div class="app-container">
    <CustomTitlebar />
    <div class="app-body">
      <AppSidebar />
      <div class="app-main">
        <AppHeader />
        <LocalSetupNotice />
        <div class="app-main-content">
          <RouterView v-slot="{ Component, route }">
            <component :is="Component" v-if="Component" :key="route.fullPath" />
          </RouterView>
        </div>
      </div>
    </div>
  </div>
</template>
