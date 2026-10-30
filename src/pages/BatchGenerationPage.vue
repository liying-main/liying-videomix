<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import StorageSettingsCard from '@/components/batchGeneration/StorageSettingsCard.vue'
import MixTaskPanel from '@/components/batchGeneration/MixTaskPanel.vue'
import { renderMixTask } from '@/services/mixRenderPipeline'
import { cancelActiveClipV3Task } from '@/services/clipV3Task'
import { useMixStore } from '@/stores/mix'
import { useReleaseScheduleStore } from '@/stores/releaseSchedule'
import type { MixTask } from '@/types/mix'
import '@/styles/batch-generation.css'

const mixStore = useMixStore()
const scheduleStore = useReleaseScheduleStore()
const router = useRouter()
const {
  tasks,
  exportOutputDir,
  workDir,
  folderGroups,
  mixAssetsScan,
  voiceoverEnabled,
  voiceoverVolume,
  voiceoverSpeed,
  minimaxApiKey,
  minimaxVoiceId,
} = storeToRefs(mixStore)

const renderingTaskId = ref('')
const retryingTaskId = ref('')
const abortController = ref<AbortController | null>(null)

function getTask(taskId: string): MixTask | undefined {
  return tasks.value.find((task) => task.id === taskId)
}

function hasVoiceoverInTask(task: MixTask): boolean {
  return task.shots.some((shot) => String(shot.audioUrl || '').trim() !== '')
}

function patchScheduleOnDone(task: MixTask, outputUrl: string) {
  scheduleStore.patch(task.id, {
    outputUrl,
    templateType: task.templateType,
    templateName: task.templateName,
    copySourceText: task.shots
      .map((shot) => shot.scriptRewritten || shot.scriptOriginal)
      .join('\n'),
    hasVoiceover: hasVoiceoverInTask(task),
  })
}

async function ensureExportDir(): Promise<boolean> {
  if (String(exportOutputDir.value || '').trim()) return true
  mixStore.notifyExportOutputDirRequired()
  ElMessage.warning('请先填写成片目录')
  return false
}

async function renderTask(taskId: string, isRetry = false) {
  const task = getTask(taskId)
  if (!task) return
  if (!(await ensureExportDir())) return

  if (isRetry) retryingTaskId.value = taskId
  else renderingTaskId.value = taskId

  const controller = new AbortController()
  abortController.value = controller

  mixStore.updateTask(task.id, {
    status: 'rendering',
    renderPhase: 'tts',
    renderMessage: '生成音频中',
    errorMessage: '',
  })

  try {
    const result = await renderMixTask(task, {
      exportOutputDir: exportOutputDir.value,
      workDir: workDir.value,
      folderGroups: folderGroups.value,
      assetsScan: mixAssetsScan.value,
      defaultVoiceEnabled: voiceoverEnabled.value,
      defaultVoiceVolume: voiceoverVolume.value,
      defaultVoiceSpeed: voiceoverSpeed.value,
      defaultMinimaxKey: minimaxApiKey.value,
      defaultMinimaxVoiceId: minimaxVoiceId.value,
      signal: controller.signal,
      onPhase: (phase, message) => {
        mixStore.updateTask(task.id, {
          status: 'rendering',
          renderPhase: phase,
          renderMessage: message,
        })
      },
      onProgress: (percent) => {
        mixStore.updateTask(task.id, {
          renderPhase: 'polling',
          renderMessage: percent != null ? `合成中 ${percent}%` : '合成中',
        })
      },
    })

    mixStore.updateTask(task.id, {
      status: 'done',
      outputUrl: result.outputUrl,
      shots: result.shots,
      renderPhase: undefined,
      renderMessage: '',
      errorMessage: '',
    })

    const updatedTask = getTask(task.id) || task
    patchScheduleOnDone(
      { ...updatedTask, shots: result.shots, outputUrl: result.outputUrl },
      result.outputUrl,
    )
    ElMessage.success('合成完成')
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    const message = aborted ? 'Aborted' : err instanceof Error ? err.message : '合成失败'
    mixStore.updateTask(task.id, {
      status: 'error',
      errorMessage: message,
      renderPhase: undefined,
      renderMessage: '',
    })
    if (!aborted) ElMessage.error(message)
  } finally {
    renderingTaskId.value = ''
    retryingTaskId.value = ''
    abortController.value = null
  }
}

function removeTask(id: string) {
  mixStore.removeTask(id)
  scheduleStore.removeMeta(id)
}

async function cancelTask(taskId: string) {
  const task = getTask(taskId)
  if (!task) return
  if (task.renderPhase === 'submitting') {
    ElMessage.warning('任务提交中，暂不支持取消')
    return
  }
  abortController.value?.abort()
  if (task.renderPhase === 'polling') {
    await cancelActiveClipV3Task()
  }
  mixStore.updateTask(task.id, {
    status: 'error',
    errorMessage: 'Aborted',
    renderPhase: undefined,
    renderMessage: '',
  })
  renderingTaskId.value = ''
  retryingTaskId.value = ''
  abortController.value = null
}
</script>

<template>
  <PageShell title="任务中心">
    <div class="batch-generation-page">
      <StorageSettingsCard />

      <MixTaskPanel
        v-if="tasks.length"
        :tasks="tasks"
        :rendering-task-id="renderingTaskId"
        :retrying-task-id="retryingTaskId"
        @render="renderTask($event)"
        @retry="renderTask($event, true)"
        @remove="removeTask"
        @cancel="cancelTask"
      />

      <div v-else class="batch-generation-page__empty">
        <p>暂无任务，请先在镜头剪辑中创建</p>
        <el-button type="primary" plain @click="router.push({ name: 'VideoMix' })">
          去镜头剪辑
        </el-button>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.batch-generation-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: calc(100vh - 180px);
}

.batch-generation-page__empty {
  border: 1px dashed var(--qt-border);
  border-radius: 14px;
  background: var(--qt-surface);
  padding: 48px 20px;
  text-align: center;
  color: var(--qt-text-2);
}

.batch-generation-page__empty p {
  margin: 0 0 16px;
  color: var(--qt-text);
}
</style>
