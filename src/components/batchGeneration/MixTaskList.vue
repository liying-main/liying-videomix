<script setup lang="ts">
import { computed } from 'vue'
import { mixTaskStatusLabel, mixTaskStatusType } from '@/services/mixTaskStatus'
import type { MixTask } from '@/types/mix'

const props = defineProps<{
  tasks: MixTask[]
  renderingTaskId: string
  retryingTaskId: string
  previewTaskId: string
}>()

const emit = defineEmits<{
  render: [taskId: string]
  retry: [taskId: string]
  remove: [taskId: string]
  cancel: [taskId: string]
  rowClick: [task: MixTask]
}>()

function isNoVoiceover(task: MixTask): boolean {
  if (task.status === 'done') {
    return !task.shots.some((shot) => String(shot.audioUrl || '').trim())
  }
  if (String(task.templateType || '').trim() === 'custom') {
    if (task.voiceoverEnabledSnapshot === false) return true
    return !String(task.minimaxVoiceIdSnapshot || '').trim()
  }
  return false
}

function rowClassName({ row }: { row: MixTask }): string {
  return row.id === props.previewTaskId ? 'mix-task-list__row--preview' : ''
}

function formatCreatedAt(ts: number): string {
  const value = Number(ts) || 0
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const sortedTasks = computed(() =>
  [...props.tasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
)
</script>

<template>
  <el-table
    class="mix-task-list__table"
    :data="sortedTasks"
    stripe
    style="width: 100%"
    empty-text="暂无任务"
    height="100%"
    :row-class-name="rowClassName"
    @row-click="(row: MixTask) => emit('rowClick', row)"
  >
    <el-table-column label="模板类型" min-width="140" show-overflow-tooltip>
      <template #default="{ row }">
        <span class="mix-task-list__template">
          <span>{{ row.templateName || row.templateType || '—' }}</span>
          <el-tag v-if="isNoVoiceover(row)" size="small" type="info" effect="plain">未配音</el-tag>
        </span>
      </template>
    </el-table-column>
    <el-table-column label="镜头数" width="80" align="center">
      <template #default="{ row }">{{ row.shots.length }}</template>
    </el-table-column>
    <el-table-column label="创建时间" width="150" align="center">
      <template #default="{ row }">
        <span class="mix-task-list__created-at">{{ formatCreatedAt(row.createdAt) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="状态" width="110" align="center">
      <template #default="{ row }">
        <el-tag :type="mixTaskStatusType(row)" size="small">{{ mixTaskStatusLabel(row) }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="操作" width="220" fixed="right" align="center">
      <template #default="{ row }">
        <el-button
          v-if="row.status === 'ready'"
          type="primary"
          size="small"
          :loading="renderingTaskId === row.id"
          @click.stop="emit('render', row.id)"
        >
          开始合成
        </el-button>
        <el-button
          v-if="row.status === 'queued' || row.status === 'rendering'"
          type="warning"
          size="small"
          plain
          :disabled="row.status === 'rendering' && row.renderPhase === 'submitting'"
          @click.stop="emit('cancel', row.id)"
        >
          取消
        </el-button>
        <el-button
          v-if="row.status === 'error'"
          type="primary"
          size="small"
          :loading="retryingTaskId === row.id"
          @click.stop="emit('retry', row.id)"
        >
          重试合成
        </el-button>
        <el-button
          v-if="row.status !== 'rendering' && row.status !== 'queued'"
          type="danger"
          size="small"
          plain
          @click.stop="emit('remove', row.id)"
        >
          删除
        </el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.mix-task-list__template {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

</style>
