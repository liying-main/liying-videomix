<script setup lang="ts">
import { onMounted, ref } from 'vue'
const dismissed = ref(localStorage.getItem('liying_local_setup_dismissed') === '1')
const available = ref(false)
const message = ref('正在检查本地合成环境…')
async function check() {
  try {
    const status = await window.electronAPI?.getRenderRuntimeStatus()
    available.value = !!status?.available
    message.value = status?.message || '请使用桌面应用运行本地合成；浏览器预览不提供本地文件合成。'
  } catch (error) { message.value = error instanceof Error ? error.message : String(error) }
}
function dismiss() { dismissed.value = true; localStorage.setItem('liying_local_setup_dismissed', '1') }
onMounted(check)
</script>
<template>
  <div v-if="!dismissed || !available" class="local-setup-notice" role="status">
    <strong>{{ available ? '开始制作' : '需要配置本地合成环境' }}</strong>
    <span>软件免费。本地剪辑无需 Key；文案和配音等云端功能按所选服务收费。{{ message }}</span>
    <RouterLink to="/settings">打开设置</RouterLink>
    <el-button size="small" @click="check">重新检查</el-button>
    <el-button v-if="available" size="small" text @click="dismiss">知道了</el-button>
  </div>
</template>
<style scoped>
.local-setup-notice { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 20px; background: var(--el-color-primary-light-9); font-size: 13px; }
.local-setup-notice span { flex: 1; min-width: 220px; }
</style>
