import { saveAudioBuffer } from '@/utils/audioStorage'
import { probeAudioDuration } from '@/utils/videoMeta'

export interface ParsedTtsAudio {
  url: string
  durationSec: number
}

function decodeBase64ToBytes(value: string): Uint8Array | null {
  const trimmed = value.trim()
  if (trimmed.length < 32) return null
  try {
    const binary = atob(trimmed)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function hexToBytes(value: string): Uint8Array | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length < 2) return null
  if (/^https?:\/\//i.test(trimmed)) return null
  const hex = trimmed.replace(/\s+/g, '')
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function pickAudioLengthMs(data: unknown): number {
  if (!data || typeof data !== 'object') return 0
  const root = data as Record<string, unknown>
  const extra = root.extra_info
  if (extra && typeof extra === 'object') {
    const len = Number((extra as { audio_length?: number }).audio_length)
    if (len > 0) return len
  }
  const nested = root.data
  if (nested && typeof nested === 'object') {
    const audio = (nested as { audio?: unknown }).audio
    if (audio && typeof audio === 'object') {
      const len = Number((audio as { audio_length?: number }).audio_length)
      if (len > 0) return len
    }
  }
  return 0
}

function normalizeDurationMs(value: number): number {
  if (value <= 0) return 0
  if (value > 100) return value / 1000
  return value
}

async function persistBytes(
  bytes: Uint8Array,
  format: string,
): Promise<{ url: string; durationSec: number } | null> {
  const ext = format === 'mp3' ? 'mp3' : format.replace(/\W/g, '') || 'mp3'
  const url = await saveAudioBuffer(bytes, `minimax_tts.${ext}`)
  if (!url) return null
  let durationSec = await probeAudioDuration(url)
  return { url, durationSec }
}

export async function parseMiniMaxTtsResponse(data: unknown): Promise<ParsedTtsAudio | null> {
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>

  let durationMs = pickAudioLengthMs(root)
  let durationSec = normalizeDurationMs(durationMs)
  const format = String(
    (root.extra_info as { audio_format?: string } | undefined)?.audio_format || 'mp3',
  )

  const audioFile = root.audio_file
  if (typeof audioFile === 'string' && audioFile.length > 64) {
    const bytes = decodeBase64ToBytes(audioFile) || hexToBytes(audioFile)
    if (bytes && bytes.length > 0) {
      const saved = await persistBytes(bytes, format)
      if (!saved) return null
      if (durationSec <= 0) durationSec = saved.durationSec
      return { url: saved.url, durationSec: durationSec > 0 ? durationSec : saved.durationSec }
    }
  }

  const payload = root.data
  if (!payload || typeof payload !== 'object') return null
  const audio = (payload as { audio?: unknown }).audio

  if (audio && typeof audio === 'object' && !Array.isArray(audio)) {
    const audioObj = audio as { audio_url?: string; audio_length?: number }
    const audioUrl = String(audioObj.audio_url || '').trim()
    if (audioUrl && /^https?:\/\//i.test(audioUrl)) {
      if (typeof audioObj.audio_length === 'number' && audioObj.audio_length > 0) {
        durationMs = audioObj.audio_length
        durationSec = normalizeDurationMs(durationMs)
      }
      if (durationSec <= 0) durationSec = await probeAudioDuration(audioUrl)
      return { url: audioUrl, durationSec: durationSec > 0 ? durationSec : 0.01 }
    }
  }

  if (typeof audio === 'string') {
    const trimmed = audio.trim()
    if (/^https?:\/\//i.test(trimmed)) {
      if (durationSec <= 0) durationSec = await probeAudioDuration(trimmed)
      return { url: trimmed, durationSec: durationSec > 0 ? durationSec : 0.01 }
    }

    const bytes = hexToBytes(trimmed) || decodeBase64ToBytes(trimmed)
    if (bytes && bytes.length > 0) {
      const saved = await persistBytes(bytes, format)
      if (!saved) return null
      if (durationSec <= 0) durationSec = saved.durationSec
      return { url: saved.url, durationSec: durationSec > 0 ? durationSec : saved.durationSec }
    }
  }

  return null
}
