import { getAssetsRoot } from '@/utils/assetsRootStorage'
import { appendExternalLog } from '@/utils/appLog'
import { useMixStore } from '@/stores/mix'
import { usePublishAccountsStore } from '@/stores/publishAccounts'
import { useReleaseScheduleStore } from '@/stores/releaseSchedule'
import type { MixAssetsScan, MixTask } from '@/types/mix'

function buildCopySourceText(task: MixTask): string {
  return task.shots
    .map((shot) => String(shot.scriptRewritten || '').trim() || String(shot.scriptOriginal || '').trim())
    .filter(Boolean)
    .join('\n')
}

function hasVoiceoverInTask(task: MixTask): boolean {
  return task.shots.some((shot) => String(shot.audioUrl || '').trim() !== '')
}

export function seedReleaseScheduleFromDoneTasks(): void {
  const mixStore = useMixStore()
  const scheduleStore = useReleaseScheduleStore()

  for (const task of mixStore.tasks) {
    if (task.status !== 'done' || !String(task.outputUrl || '').trim()) continue
    scheduleStore.patch(task.id, {
      outputUrl: task.outputUrl,
      templateType: task.templateType || 'persona',
      templateName: task.templateName || undefined,
      copySourceText: buildCopySourceText(task),
      hasVoiceover: hasVoiceoverInTask(task),
    })
  }
}

export async function bootstrapAppData(): Promise<void> {
  const mixStore = useMixStore()
  const publishStore = usePublishAccountsStore()
  const scheduleStore = useReleaseScheduleStore()
  const api = window.electronAPI

  scheduleStore.persist()
  publishStore.persist()
  seedReleaseScheduleFromDoneTasks()

  const assetsRoot = getAssetsRoot()?.trim()
  if (assetsRoot && api?.scanMixRoot) {
    try {
      const scan = (await api.scanMixRoot(assetsRoot)) as MixAssetsScan
      mixStore.setMixAssetsScan(scan)
    } catch {
      /* ignore scan errors on startup */
    }
  }

  if (mixStore.workDir && api?.emptyDir) {
    try {
      await api.emptyDir(mixStore.workDir)
    } catch {
      /* ignore */
    }
  }

  await publishStore.ensureAutoBrowserProfileDirs()

  const unsubscribeAutoPublish = api?.onAutoPublishResult?.((payload) => {
    const data = payload as { taskId?: string; patch?: Record<string, unknown> }
    const taskId = String(data?.taskId || '').trim()
    if (!taskId || !data.patch) return
    scheduleStore.patch(taskId, data.patch)
  })

  const unsubscribeMainLog = api?.onMainLog?.((payload) => {
    const data = payload as { level?: string; message?: string; data?: unknown }
    const level = data?.level === 'warn' || data?.level === 'error' ? data.level : 'info'
    const message = String(data?.message || 'main.log')
    appendExternalLog(level, `main.${message}`, data?.data)
  })

  const cleanups = [unsubscribeAutoPublish, unsubscribeMainLog].filter(Boolean) as Array<() => void>
  if (cleanups.length) {
    window.addEventListener('beforeunload', () => cleanups.forEach((fn) => fn()), { once: true })
  }
}
