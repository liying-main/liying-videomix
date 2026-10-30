<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { APP_THEMES, useThemeStore, type AppTheme } from '@/stores/theme'

const themeStore = useThemeStore()
const { theme } = storeToRefs(themeStore)

function pickTheme(id: AppTheme) {
  themeStore.setTheme(id)
}
</script>

<template>
  <el-card class="settings-card" shadow="never">
    <template #header>
      <span class="settings-card__title">界面外观</span>
    </template>
    <p class="appearance-settings__hint">选择主题配色，与厉影 AI 客户端保持一致。</p>
    <div class="appearance-theme-grid">
      <button
        v-for="item in APP_THEMES"
        :key="item.id"
        type="button"
        class="appearance-theme-chip"
        :class="{ 'appearance-theme-chip--active': theme === item.id }"
        @click="pickTheme(item.id)"
      >
        {{ item.label }}
      </button>
    </div>
  </el-card>
</template>

<style scoped>
.appearance-settings__hint {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--qt-text-2);
  line-height: 1.6;
}
</style>
