import type { BgMusicSettings, MixTask } from '@/types/mix'

const TASK_RECOVERY_ERROR = '上次合成未完成，已停止，可重新合成'

export function normalizeBgMusicVolume(volume: unknown): number {
  let value = typeof volume === 'number' && !Number.isNaN(volume) ? volume : 0.3
  if (value > 1) value = Math.min(1, value / 100)
  return Math.min(1, Math.max(0, value))
}

export function normalizeBgMusicSettings(bgMusic: BgMusicSettings): BgMusicSettings {
  if (typeof bgMusic.volume === 'number' && !Number.isNaN(bgMusic.volume)) {
    bgMusic.volume = normalizeBgMusicVolume(bgMusic.volume)
  }
  return bgMusic
}

function isValidTask(task: unknown): task is MixTask {
  if (!task || typeof task !== 'object') return false
  const candidate = task as MixTask
  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.shots) &&
    Array.isArray(candidate.selectionIndices)
  )
}

export function recoverTaskAfterStartup(task: MixTask): MixTask {
  if (task.status === 'queued') {
    return {
      ...task,
      status: 'ready',
      renderPhase: undefined,
      renderMessage: undefined,
    }
  }
  if (task.status === 'rendering') {
    return {
      ...task,
      status: 'error',
      errorMessage: TASK_RECOVERY_ERROR,
      renderPhase: undefined,
      renderMessage: undefined,
    }
  }
  return task
}

export function normalizeTasksOnStartup(tasks: unknown[]): MixTask[] {
  return tasks.filter(isValidTask).map(recoverTaskAfterStartup)
}
