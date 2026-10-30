<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { Expand, Fold } from '@element-plus/icons-vue'

const collapsed = inject<Ref<boolean>>('sidebarCollapsed')!
const toggleSidebar = inject<() => void>('toggleSidebar')!
</script>

<template>
  <header class="app-main-header">
    <div class="app-main-header-inner">
      <div class="app-main-header-left">
        <button
          type="button"
          class="sidebar-toggle"
          :title="collapsed ? '展开侧栏' : '收起侧栏'"
          @click="toggleSidebar()"
        >
          <el-icon :size="18">
            <Expand v-if="collapsed" />
            <Fold v-else />
          </el-icon>
        </button>
      </div>

      <div class="app-main-header-center" aria-hidden="true" />

      <div class="app-main-header-right" />
    </div>
  </header>
</template>
