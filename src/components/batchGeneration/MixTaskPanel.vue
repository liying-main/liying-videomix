<script setup lang="ts">
import { computed, ref } from 'vue'
import MixTaskList from '@/components/batchGeneration/MixTaskList.vue'
import type { MixTask } from '@/types/mix'

const props = defineProps<{
  tasks: MixTask[]
  renderingTaskId: string
  retryingTaskId: string
}>()

const emit = defineEmits<{
  render: [taskId: string]
  retry: [taskId: string]
  remove: [taskId: string]
  cancel: [taskId: string]
}>()

const previewTaskId = ref('')

const previewTask = computed(() => props.tasks.find((task) => task.id === previewTaskId.value) || null)

function onRowClick(task: MixTask) {
  if (task.status === 'done' && task.outputUrl) {
    previewTaskId.value = task.id
  }
}

function clearPreview() {
  previewTaskId.value = ''
}
</script>

<template>
  <div class="mix-task-panel">
    <div class="mix-task-panel__toolbar">
      <span class="mix-task-panel__toolbar-title">任务列表</span>
      <span class="mix-task-panel__toolbar-hint">点击已完成任务可在右侧预览成片</span>
    </div>

    <div class="mix-task-panel__body">
      <div class="mix-task-panel__list">
        <MixTaskList
          :tasks="tasks"
          :rendering-task-id="renderingTaskId"
          :retrying-task-id="retryingTaskId"
          :preview-task-id="previewTaskId"
          @render="emit('render', $event)"
          @retry="emit('retry', $event)"
          @remove="emit('remove', $event)"
          @cancel="emit('cancel', $event)"
          @row-click="onRowClick"
        />
      </div>

      <aside class="mix-task-panel__preview" aria-label="成片预览">
        <div class="mix-task-panel__preview-head">
          <div class="mix-task-panel__preview-head-main">
            <h3 class="mix-task-panel__preview-title">成片预览</h3>
            <p v-if="previewTask" class="mix-task-panel__preview-sub">
              {{ previewTask.templateName || previewTask.templateType }}
            </p>
          </div>
          <span v-if="previewTask" class="mix-task-panel__preview-badge">已生成</span>
        </div>

        <div class="mix-task-panel__preview-body">
          <div class="mix-task-panel__preview-inner">
            <video
              v-if="previewTask?.outputUrl"
              class="mix-task-panel__video mix-task-panel__preview-video"
              :src="previewTask.outputUrl"
              controls
              playsinline
            />
            <div v-else class="mix-task-panel__preview-empty">
              <div class="mix-task-panel__preview-empty-icon" aria-hidden="true">▶</div>
              <p v-if="tasks.length" class="mix-task-panel__preview-empty-text">
                选择一条已完成的任务进行预览
              </p>
              <p v-else class="mix-task-panel__preview-empty-text">暂无任务</p>
            </div>
          </div>
        </div>

        <el-button
          v-if="previewTask"
          class="mix-task-panel__preview-clear"
          size="small"
          @click="clearPreview"
        >
          清除预览
        </el-button>
      </aside>
    </div>
  </div>
</template>
