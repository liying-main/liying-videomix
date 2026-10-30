<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageShell from '@/components/PageShell.vue'
import AppearanceSettings from '@/components/settings/AppearanceSettings.vue'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import { clearAppLogs, onAppLogsChange, readAppLogs, type AppLogEntry } from '@/utils/appLog'
import '@/styles/system-settings.css'

const logs = ref<AppLogEntry[]>(readAppLogs())
const logsCollapse = ref<string[]>([])

let stopLogWatch: (() => void) | null = null

const logsText = computed(() => {
  const formatTs = (ts: number) => {
    const date = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
  return logs.value
    .slice()
    .reverse()
    .map((entry) => {
      const line = `[${formatTs(entry.ts)}] [${entry.level.toUpperCase()}] ${entry.message}`
      if (entry.data === undefined) return line
      try {
        return `${line}\n${JSON.stringify(entry.data, null, 2)}`
      } catch {
        return line
      }
    })
    .join('\n\n')
})

function refreshLogs() {
  logs.value = readAppLogs()
}

async function copyLogs() {
  try {
    await navigator.clipboard.writeText(logsText.value || '')
  } catch {
    /* ignore */
  }
}

function clearLogs() {
  clearAppLogs()
  logs.value = []
}

onMounted(() => {
  stopLogWatch = onAppLogsChange(refreshLogs)
})

onUnmounted(() => {
  stopLogWatch?.()
})
</script>

<template>
  <PageShell title="系统设置">
    <div class="system-settings-page">
      <AppearanceSettings />
      <SettingsPanel />

      <el-collapse v-model="logsCollapse" class="system-settings-page__collapse">
        <el-collapse-item name="app-logs">
          <template #title>
            <div class="system-settings-page__logs-title">
              <span class="settings-card__title">日志</span>
              <span class="system-settings-page__logs-sub">（默认收起，可展开查看/复制）</span>
            </div>
          </template>
          <el-card class="settings-card system-settings-page__logs" shadow="never">
            <div class="system-settings-page__logs-actions">
              <el-button size="small" @click="refreshLogs">刷新</el-button>
              <el-button size="small" @click="copyLogs">复制</el-button>
              <el-button size="small" type="danger" plain @click="clearLogs">清空</el-button>
            </div>
            <el-input
              :model-value="logsText"
              type="textarea"
              :rows="10"
              readonly
              placeholder="暂无日志"
            />
          </el-card>
        </el-collapse-item>
      </el-collapse>
    </div>
  </PageShell>
</template>

<style scoped>
@import '@/styles/system-settings.css';
</style>
