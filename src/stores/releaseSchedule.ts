import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PublishTarget, ReleaseMeta } from '@/types/publish'
import { normalizeReleaseMeta, normalizeReleaseMetaMap } from '@/utils/releaseScheduleMeta'

const STORAGE_KEY = 'videomix_release_meta'

type MetaMap = Record<string, ReleaseMeta>

function loadMeta(): MetaMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return normalizeReleaseMetaMap(parsed as Record<string, unknown>)
  } catch {
    return {}
  }
}

function emptyMeta(): ReleaseMeta {
  return normalizeReleaseMeta({
    phase: 'unscheduled',
    title: '',
    topics: '',
    coverImage: '',
    coverPath: '',
    publishTargets: [],
  })
}

export const useReleaseScheduleStore = defineStore('releaseSchedule', () => {
  const metaByTaskId = ref<MetaMap>(loadMeta())

  function persist(): void {
    const snapshot = JSON.parse(JSON.stringify(metaByTaskId.value)) as MetaMap
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      /* ignore */
    }
    window.electronAPI?.syncReleaseScheduleMeta?.(snapshot)
  }

  function getOrCreate(taskId: string): ReleaseMeta {
    const id = String(taskId || '').trim()
    if (!id) return emptyMeta()

    const existing = metaByTaskId.value[id]
    if (!existing) {
      const created = emptyMeta()
      metaByTaskId.value[id] = created
      persist()
      return created
    }

    const normalized = normalizeReleaseMeta(existing)
    if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
      metaByTaskId.value[id] = normalized
      persist()
    }
    return metaByTaskId.value[id]
  }

  function patch(taskId: string, patchValue: Partial<ReleaseMeta>): ReleaseMeta {
    const id = String(taskId || '').trim()
    const current = getOrCreate(id)
    const next = normalizeReleaseMeta({ ...current, ...patchValue })
    metaByTaskId.value[id] = next
    persist()
    return next
  }

  function setPhase(taskId: string, phase: ReleaseMeta['phase']): void {
    const id = String(taskId || '').trim()
    const current = getOrCreate(id)

    if (phase === 'unscheduled') {
      patch(id, {
        ...current,
        phase: 'unscheduled',
        publishTargets: current.publishTargets.map((target) => ({
          ...target,
          phase: target.phase === 'published' ? 'published' : 'pending',
          scheduledAt: undefined,
          nextRetryAt: undefined,
        })),
      })
      return
    }

    if (phase === 'scheduled') {
      const scheduledAt = Date.now()
      patch(id, {
        ...current,
        phase: 'scheduled',
        scheduledAt,
        publishTargets: current.publishTargets.map((target) => ({
          ...target,
          phase: 'scheduled',
          scheduledAt,
          nextRetryAt: undefined,
        })),
      })
      return
    }

    patch(id, {
      ...current,
      phase: 'published',
      publishTargets: current.publishTargets.map((target) => ({
        ...target,
        phase: 'published',
        scheduledAt: target.scheduledAt || Date.now(),
      })),
    })
  }

  function removeMeta(taskId: string): void {
    const id = String(taskId || '').trim()
    if (!id || !metaByTaskId.value[id]) return
    delete metaByTaskId.value[id]
    persist()
  }

  function syncPublishTargets(taskId: string, targets: PublishTarget[]): void {
    patch(taskId, { publishTargets: targets.map((t) => ({ ...t })) })
  }

  function patchPublishTarget(
    taskId: string,
    accountId: string,
    targetPatch: Partial<PublishTarget>,
  ): void {
    const id = String(taskId || '').trim()
    const accountKey = String(accountId || '').trim()
    const meta = getOrCreate(id)
    const nextTargets = meta.publishTargets.map((target) =>
      target.accountId === accountKey ? { ...target, ...targetPatch, accountId: accountKey } : target,
    )
    patch(id, { publishTargets: nextTargets })
  }

  function schedulePublishTargets(taskId: string, scheduledAt: number): boolean {
    const id = String(taskId || '').trim()
    const meta = getOrCreate(id)
    const pendingTargets = meta.publishTargets.filter((t) => t.phase !== 'published')
    if (!pendingTargets.length) return false

    let changed = false
    const nextTargets = meta.publishTargets.map((target) => {
      if (target.phase === 'published') return target
      changed = true
      return {
        ...target,
        phase: 'scheduled' as const,
        scheduledAt,
        publishMessage: undefined,
        nextRetryAt: undefined,
      }
    })
    if (!changed) return false

    patch(id, {
      phase: 'scheduled',
      scheduledAt,
      publishTargets: nextTargets,
    })
    return true
  }

  function schedulePublishTargetsWithAccounts(
    taskId: string,
    accountIds: string[],
    scheduledAt: number,
    accounts: Array<{ id: string; userDataDir: string }>,
  ): void {
    const targets: PublishTarget[] = accountIds.map((accountId) => {
      const account = accounts.find((a) => a.id === accountId)
      return {
        accountId,
        userDataDir: account?.userDataDir || '',
        phase: 'scheduled',
        scheduledAt,
      }
    })
    patch(taskId, {
      phase: 'scheduled',
      scheduledAt,
      publishTargets: targets,
    })
  }

  function removePublishAccount(accountId: string): void {
    const trimmed = String(accountId || '').trim()
    if (!trimmed) return

    let changed = false
    const nextMap: MetaMap = { ...metaByTaskId.value }

    for (const [taskId, meta] of Object.entries(metaByTaskId.value)) {
      const nextTargets = meta.publishTargets.filter((t) => t.accountId !== trimmed)
      if (nextTargets.length === meta.publishTargets.length) continue
      changed = true
      nextMap[taskId] = normalizeReleaseMeta({ ...meta, publishTargets: nextTargets })
    }

    if (changed) {
      metaByTaskId.value = nextMap
      persist()
    }
  }

  persist()

  return {
    metaByTaskId,
    getOrCreate,
    patch,
    setPhase,
    removeMeta,
    syncPublishTargets,
    patchPublishTarget,
    schedulePublishTargets,
    schedulePublishTargetsWithAccounts,
    removePublishAccount,
    persist,
  }
})
