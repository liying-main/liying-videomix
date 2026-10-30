const STORAGE_KEY = 'videomix_minimax_manual_voice_ids'

export interface MiniMaxVoiceOption {
  id: string
  name: string
  desc?: string
}

const RECOMMENDED_VOICE_NAMES = [
  '沉稳高管',
  '嚣张小姐',
  '舒朗男声',
  '电台男主播',
  '游戏主播',
  '温暖闺蜜',
]

function parseVoiceArray(raw: unknown): MiniMaxVoiceOption[] {
  if (!Array.isArray(raw)) return []
  const result: MiniMaxVoiceOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const voice = item as Record<string, unknown>
    const id = String(voice.voice_id ?? '').trim()
    if (!id) continue
    const name = String(voice.voice_name ?? '').trim() || id
    const descRaw = voice.description
    const desc = Array.isArray(descRaw) && descRaw.length > 0
      ? String(descRaw[0] ?? '').trim()
      : undefined
    result.push({ id, name, desc })
  }
  return result
}

function flattenVoiceCatalog(data: unknown): MiniMaxVoiceOption[] {
  if (!data || typeof data !== 'object') return []
  const root = data as Record<string, unknown>
  const buckets = ['system_voice', 'voice_cloning', 'voice_generation']
  const merged: MiniMaxVoiceOption[] = []
  for (const key of buckets) {
    merged.push(...parseVoiceArray(root[key]))
  }
  const seen = new Set<string>()
  return merged.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function nameMatchesRecommended(name: string, recommended: string): boolean {
  const trimmed = name.trim()
  const base = recommended.trim()
  if (!base) return false
  return (
    trimmed === base ||
    trimmed.startsWith(`${base} -`) ||
    trimmed.startsWith(`${base}—`) ||
    trimmed.startsWith(`${base}–`)
  )
}

function pickRecommendedVoices(catalog: MiniMaxVoiceOption[]): MiniMaxVoiceOption[] {
  const picked: MiniMaxVoiceOption[] = []
  for (const label of RECOMMENDED_VOICE_NAMES) {
    const match = catalog.find((item) => nameMatchesRecommended(item.name, label))
    if (match) picked.push(match)
  }
  return picked
}

export function loadManualVoiceIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item).trim()).filter(Boolean)
  } catch {
    return []
  }
}

export function saveManualVoiceId(voiceId: string): boolean {
  const trimmed = voiceId.trim()
  if (!trimmed) return false
  const ids = loadManualVoiceIds()
  if (ids.includes(trimmed)) return false
  ids.push(trimmed)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    return true
  } catch {
    return false
  }
}

export function removeManualVoiceId(voiceId: string): boolean {
  const trimmed = voiceId.trim()
  if (!trimmed) return false
  const ids = loadManualVoiceIds()
  const next = ids.filter((id) => id !== trimmed)
  if (next.length === ids.length) return false
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

export function mergeMiniMaxVoiceCatalog(data: unknown): MiniMaxVoiceOption[] {
  const catalog = flattenVoiceCatalog(data)
  const recommended = pickRecommendedVoices(catalog)
  if (!data || typeof data !== 'object') return recommended

  const cloning = parseVoiceArray((data as Record<string, unknown>).voice_cloning)
  const seen = new Set(recommended.map((item) => item.id))
  const merged = [...recommended]
  for (const item of cloning) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

export function appendManualVoiceIds(
  voices: MiniMaxVoiceOption[],
  manualIds: string[],
): MiniMaxVoiceOption[] {
  const seen = new Set(voices.map((item) => item.id))
  const merged = [...voices]
  for (const id of manualIds) {
    const trimmed = String(id || '').trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    merged.push({ id: trimmed, name: trimmed })
  }
  return merged
}

export function listSavedVoiceIds(): string[] {
  return loadManualVoiceIds()
}

export function pickDefaultVoiceId(
  voices: MiniMaxVoiceOption[],
  preferredName = '嚣张小姐',
): string {
  if (!voices.length) return ''
  const preferred = voices.find(
    (item) => item.name === preferredName || item.name.startsWith(`${preferredName} `),
  )
  return (preferred ?? voices[0]).id
}
