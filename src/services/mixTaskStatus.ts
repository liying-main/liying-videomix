import type { MixTask } from '@/types/mix'

export function isTaskCancelled(task: MixTask): boolean {
  if (task.status !== 'error') return false
  const message = String(task.errorMessage || '')
  return (
    message === 'Aborted' ||
    message.includes('AbortError') ||
    message.includes('aborted') ||
    message.includes('取消')
  )
}

export function mixTaskStatusLabel(task: MixTask): string {
  const labels: Record<string, string> = {
    pending: '准备中',
    ready: '待合成',
    queued: '排队中',
    rendering: '合成中…',
    done: '已完成',
    error: '失败',
  }

  if (isTaskCancelled(task)) return '取消'

  if (task.status === 'queued') return '排队中'

  if (task.status === 'rendering') {
    if (task.renderPhase === 'tts') return task.renderMessage || '生成音频中'
    if (task.renderPhase === 'submitting') return task.renderMessage || '提交任务中'
    if (task.renderPhase === 'polling') return task.renderMessage || '合成中'
    return task.renderMessage || labels.rendering
  }

  return task.renderMessage || labels[task.status] || task.status
}

export function mixTaskStatusType(
  task: MixTask,
): 'info' | 'warning' | 'primary' | 'success' | 'danger' {
  if (isTaskCancelled(task)) return 'info'
  const map: Record<string, 'info' | 'warning' | 'primary' | 'success' | 'danger'> = {
    pending: 'info',
    ready: 'warning',
    queued: 'info',
    rendering: 'primary',
    done: 'success',
    error: 'danger',
  }
  return map[task.status] ?? 'info'
}
