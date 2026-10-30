import type { PublishTarget, PublishTargetPhase, ReleaseMeta } from '@/types/publish'

const VALID_TARGET_PHASES = new Set<PublishTargetPhase>([
  'pending',
  'scheduled',
  'publishing',
  'published',
  'failed',
])

function normalizePublishTarget(input: unknown): PublishTarget | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const accountId = String(raw.accountId || '').trim()
  if (!accountId) return null
  const phaseRaw = String(raw.phase || 'pending')
  const phase = VALID_TARGET_PHASES.has(phaseRaw as PublishTargetPhase)
    ? (phaseRaw as PublishTargetPhase)
    : 'pending'
  return {
    accountId,
    userDataDir: String(raw.userDataDir || '').trim(),
    phase,
    scheduledAt: typeof raw.scheduledAt === 'number' ? raw.scheduledAt : undefined,
    publishMessage:
      String(raw.publishMessage || '').trim() || undefined,
    lastAttemptAt: typeof raw.lastAttemptAt === 'number' ? raw.lastAttemptAt : undefined,
    nextRetryAt: typeof raw.nextRetryAt === 'number' ? raw.nextRetryAt : undefined,
  }
}

function dedupePublishTargets(targets: PublishTarget[]): PublishTarget[] {
  const map = new Map<string, PublishTarget>()
  for (const item of targets) {
    const normalized = normalizePublishTarget(item)
    if (normalized) map.set(normalized.accountId, normalized)
  }
  return [...map.values()]
}

/** Migrate legacy single `account` field to publishTargets. */
function migrateLegacyAccount(raw: Record<string, unknown>): PublishTarget[] {
  const accountId = String(raw.account || '').trim()
  if (!accountId) return []
  const legacyPhase = String(raw.phase || '')
  const phase: PublishTargetPhase =
    legacyPhase === 'published'
      ? 'published'
      : legacyPhase === 'scheduled'
        ? 'scheduled'
        : 'pending'
  const target = normalizePublishTarget({
    accountId,
    userDataDir: raw.userDataDir,
    phase,
    scheduledAt: raw.scheduledAt,
    publishMessage: raw.publishMessage,
    lastAttemptAt: raw.lastAutoPublishAttemptAt,
    nextRetryAt: raw.nextAutoPublishRetryAt,
  })
  return target ? [target] : []
}

function derivePhase(targets: PublishTarget[]): ReleaseMeta['phase'] {
  if (targets.some((t) => t.phase === 'scheduled' || t.phase === 'publishing')) {
    return 'scheduled'
  }
  if (targets.some((t) => t.phase === 'published' || t.phase === 'failed')) {
    return 'published'
  }
  return 'unscheduled'
}

function deriveScheduledAt(targets: PublishTarget[]): number | undefined {
  const pending = targets.filter((t) => t.phase !== 'published')
  const pool = pending.length > 0 ? pending : targets
  const values = pool
    .map((t) => Number(t.scheduledAt || 0))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)
  return values[0]
}

function derivePublishMessage(targets: PublishTarget[]): string | undefined {
  const sorted = [...targets]
    .filter((t) => t.publishMessage)
    .sort(
      (a, b) =>
        Number(b.lastAttemptAt || b.scheduledAt || 0) -
        Number(a.lastAttemptAt || a.scheduledAt || 0),
    )
  const message = sorted[0]?.publishMessage
  return message ? String(message).trim() : undefined
}

export function normalizeReleaseMeta(input: unknown): ReleaseMeta {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const deduped = dedupePublishTargets(
    Array.isArray(raw.publishTargets)
      ? (raw.publishTargets as PublishTarget[])
      : [],
  )
  const publishTargets = deduped.length > 0 ? deduped : migrateLegacyAccount(raw)

  return {
    phase: derivePhase(publishTargets),
    scheduledAt: deriveScheduledAt(publishTargets),
    title: String(raw.title || ''),
    topics: String(raw.topics || ''),
    hasVoiceover: typeof raw.hasVoiceover === 'boolean' ? raw.hasVoiceover : undefined,
    coverImage: String(raw.coverImage || ''),
    coverPath: String(raw.coverPath || ''),
    copySourceText: String(raw.copySourceText || ''),
    publishTargets,
    publishMessage: derivePublishMessage(publishTargets),
    outputUrl: String(raw.outputUrl || '').trim() || undefined,
    templateType: String(raw.templateType || '').trim() || undefined,
    templateName: String(raw.templateName || '').trim() || undefined,
  }
}

export function normalizeReleaseMetaMap(
  input: Record<string, unknown>,
): Record<string, ReleaseMeta> {
  const result: Record<string, ReleaseMeta> = {}
  for (const [taskId, meta] of Object.entries(input)) {
    result[taskId] = normalizeReleaseMeta(meta)
  }
  return result
}
