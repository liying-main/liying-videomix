<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useMixStore } from '@/stores/mix'

const mixStore = useMixStore()
const { workDir, exportOutputDir, exportOutputDirAttentionSignal } = storeToRefs(mixStore)

const defaultCacheDir = ref('')
const flashTick = ref(0)

const outputFlashClass = computed(() => {
  if (!flashTick.value) return ''
  return flashTick.value % 2 === 0
    ? 'storage-settings-card__output-input--flash-a'
    : 'storage-settings-card__output-input--flash-b'
})

watch(exportOutputDirAttentionSignal, () => {
  flashTick.value += 1
})

async function loadDefaultCacheDir() {
  const api = window.electronAPI
  if (!api?.getPath) return
  try {
    const userData = await api.getPath('userData')
    const sep = api.platform === 'win32' ? '\\' : '/'
    defaultCacheDir.value = `${String(userData).replace(/[/\\]+$/, '')}${sep}Cache`
  } catch {
    /* ignore */
  }
}

async function pickWorkDir() {
  const selected = await window.electronAPI?.selectFolder?.()
  if (!selected) return
  workDir.value = selected
  mixStore.save()
}

async function pickExportDir() {
  const selected = await window.electronAPI?.selectFolder?.()
  if (!selected) return
  exportOutputDir.value = selected
  mixStore.save()
}

function clearWorkDir() {
  workDir.value = ''
  mixStore.save()
}

function clearExportDir() {
  exportOutputDir.value = ''
  mixStore.save()
}

onMounted(() => {
  void loadDefaultCacheDir()
})
</script>

<template>
  <el-card class="storage-settings-card settings-card" shadow="never">
    <template #header>
      <span class="settings-card__title">存储设置</span>
    </template>

    <el-form label-width="100px" size="small">
      <el-form-item label="工作缓存目录">
        <div class="storage-settings-card__row">
          <el-input
            :model-value="workDir || defaultCacheDir"
            :placeholder="defaultCacheDir ? '' : '不设置则默认写入应用缓存目录'"
            readonly
            style="width: 420px; max-width: 100%"
          />
          <el-button type="primary" plain @click="pickWorkDir">选择目录</el-button>
          <el-button v-if="workDir" type="danger" plain @click="clearWorkDir">清空</el-button>
        </div>
      </el-form-item>
      <el-form-item>
        <div class="storage-settings-card__hint">
          配音音频会写入该目录下的 minimax音频夹，字幕 SRT 会写入 srt字幕；不设置则回退到应用缓存目录。
        </div>
      </el-form-item>
      <el-form-item label="成片目录">
        <div class="storage-settings-card__row">
          <el-input
            :model-value="exportOutputDir"
            :class="['storage-settings-card__output-input', outputFlashClass]"
            placeholder="请选择成片目录（开始合成前必填）"
            readonly
            style="width: 420px; max-width: 100%"
          />
          <el-button type="primary" plain @click="pickExportDir">选择目录</el-button>
          <el-button v-if="exportOutputDir" type="danger" plain @click="clearExportDir">
            清空
          </el-button>
        </div>
      </el-form-item>
      <el-form-item>
        <div class="storage-settings-card__hint">
          成片目录用于保存最终导出的视频文件；开始合成前必须先配置该目录。
        </div>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.storage-settings-card__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.storage-settings-card__hint {
  color: var(--qt-text-2);
  line-height: 1.4;
  font-size: 13px;
}
</style>
