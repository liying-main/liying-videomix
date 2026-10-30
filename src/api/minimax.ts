/**
 * 配音接口（开源版）
 *
 * 原版对接 MiniMax 的 /t2a_v2、/get_voice、/files/upload、/voice_clone。
 * 开源版全部改为中转站：
 *   - 配音：POST /v1/audio/speech（indextts2-v1，零样本音色克隆，voice 传参考音频）
 *   - 音色：导入用户有权使用的参考音频，无需服务端音色库
 *
 * 对外的函数签名与返回结构保持不变，页面无需改动。
 */
import { appLog } from '@/utils/appLog'
import { formatMiniMaxThrowMessage } from '@/utils/minimaxErrorFormat'
import { saveAudioBuffer } from '@/utils/audioStorage'
import { readStationPreferences } from '@/utils/stationPreferences'

function pickStatusCode(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  const base = root.base_resp
  if (base && typeof base === 'object') {
    const code = Number((base as { status_code?: number }).status_code)
    if (Number.isFinite(code)) return code
  }
  const direct = Number(root.status_code ?? root.code)
  return Number.isFinite(direct) ? direct : null
}

function pickMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const root = data as Record<string, unknown>
  const base = root.base_resp
  if (base && typeof base === 'object') {
    const msg = (base as { status_msg?: string; message?: string }).status_msg
      ?? (base as { message?: string }).message
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  const error = root.error
  if (error && typeof error === 'object') {
    const msg = (error as { message?: string }).message
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  for (const key of ['status_msg', 'error_msg', 'message', 'detail']) {
    const val = root[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return ''
}

function isMiniMaxError(data: unknown): boolean {
  const code = pickStatusCode(data)
  if (code != null) return code !== 0
  const message = pickMessage(data)
  return !!(message && message.toLowerCase() !== 'success' && message.toLowerCase() !== 'ok')
}

export function isMiniMaxRateLimited(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const code = pickStatusCode(err)
    if (code === 1002 || code === 429) return true
  }
  const message = err instanceof Error ? err.message : String(err || '')
  return /(rate\s*limit|too\s*many\s*requests|frequency|frequent|qps|请求.*频繁|过于频繁|429)/i.test(
    message,
  )
}

/** 旧版可选本地资源；公开发行不包含这些音频，缺失项不会显示。 */
const BUILTIN_VOICES: Array<{ file: string; name: string }> = [
  { file: 'voice1.wav', name: '青春女' },
  { file: 'voice2.wav', name: '磁性男' },
  { file: 'voice3.wav', name: '甜美女' },
  { file: 'voice4.wav', name: '干净男' },
  { file: 'voice5.wav', name: '口播女' },
  { file: 'voice6.wav', name: '播音男' },
  { file: '温柔女.mp3', name: '温柔女' },
  { file: '老者.mp3', name: '老者' },
  { file: '小朋友.mp3', name: '小朋友' },
]

function builtinVoiceId(file: string): string {
  return `voices/${file}`
}

/** 音色列表：返回随包的参考音频，页面里直接可选 */
export async function getMiniMaxVoices(_apiKey: string, _signal?: AbortSignal) {
  return {
    system_voice: (await Promise.all(BUILTIN_VOICES.map(async (item) => {
      try {
        const response = await fetch(builtinVoiceId(item.file))
        if (response.ok && (response.headers.get("content-type") || "").startsWith("audio/")) return item
      } catch { /* optional reference audio is absent */ }
      return null
    }))).filter((item): item is { file: string; name: string } => item !== null).map((item) => ({
      voice_id: builtinVoiceId(item.file),
      voice_name: item.name,
      description: ['3-10 秒参考音频，零样本克隆'],
    })),
    voice_cloning: [],
    voice_generation: [],
  }
}

export interface MiniMaxTtsOptions {
  voiceId: string
  text: string
  speed?: number
  vol?: number
  pitch?: number
  model?: string
  emotion?: string
  language_boost?: string
  subtitle_enable?: boolean
  signal?: AbortSignal
}

/** 把 voiceId 解析成中转站可用的参考音频：URL / data URI 原样返回，本地相对路径转 data URI */
async function resolveVoiceReference(voiceId: string): Promise<string> {
  const value = String(voiceId || '').trim()
  if (!value) throw new Error('请先选择音色（参考音频）')
  if (/^(https?:|data:)/i.test(value)) return value

  const response = await fetch(value)
  if (!response.ok || (response.headers.get("content-type") || "").includes("text/html")) throw new Error("参考音频不存在，请在音色管理中导入有权使用的音频")
  const blob = await response.blob()
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const mime = blob.type || (value.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg')
  return `data:${mime};base64,${btoa(binary)}`
}

/** 配音：调用中转站 /v1/audio/speech，返回与 MiniMax 兼容的结构供上层解析 */
export async function miniMaxTextToAudio(apiKey: string, options: MiniMaxTtsOptions) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('缺少 API Key（请在系统设置中填写中转站令牌）')
  if (!String(options.text || '').trim()) throw new Error('配音文本为空')

  const preferences = readStationPreferences()
  const voice = await resolveVoiceReference(options.voiceId)

  const response = await fetch(`${preferences.baseURL}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || preferences.ttsModel,
      input: options.text,
      voice,
      response_format: 'mp3',
      speed: options.speed ?? 1,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = text
    try {
      const parsed = JSON.parse(text)
      message = parsed?.error?.message || parsed?.message || text
    } catch {
      /* 非 JSON */
    }
    appLog.error('station.tts.failed', { status: response.status, message })
    throw new Error(formatMiniMaxThrowMessage({ message }, '配音生成失败'))
  }

  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return {
    audio_file: btoa(binary),
    extra_info: { audio_format: 'mp3' },
  }
}

/** 上传参考音频：零样本克隆不需要服务端预处理，直接存本地并返回可用的 file_id */
export async function uploadMiniMaxVoiceFile(
  _apiKey: string,
  file: File,
  _signal?: AbortSignal,
) {
  const buffer = await file.arrayBuffer()
  const url = await saveAudioBuffer(new Uint8Array(buffer), file.name || 'reference.wav')
  if (!url) throw new Error('保存参考音频失败')
  const fileUrl = await window.electronAPI?.pathToFileUrl?.(url)
  if (!fileUrl) throw new Error('无法读取本机参考音频地址，请在桌面客户端导入')
  return { file: { file_id: fileUrl } }
}

/** 音色复刻：中转站是零样本克隆，直接把参考音频当作音色返回 */
export async function cloneMiniMaxVoice(
  _apiKey: string,
  input: { fileId: string | number; voiceId: string; text: string; model?: string },
  _signal?: AbortSignal,
) {
  return { demo_audio: String(input.fileId || '') }
}

export function pickMiniMaxFileId(data: unknown): string | number | null {
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  const file = root.file
  if (file && typeof file === 'object') {
    const id = (file as { file_id?: unknown }).file_id
    if (id != null && String(id).trim()) return id as string | number
  }
  const direct = root.file_id
  if (direct != null && String(direct).trim()) return direct as string | number
  return null
}

export function pickMiniMaxCloneDemoAudio(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const root = data as Record<string, unknown>
  if (typeof root.demo_audio === 'string' && root.demo_audio.trim()) {
    return root.demo_audio.trim()
  }
  const nested = root.data
  if (nested && typeof nested === 'object') {
    const demo = (nested as { demo_audio?: string }).demo_audio
    if (typeof demo === 'string' && demo.trim()) return demo.trim()
  }
  return ''
}

export function isMiniMaxCloneSuccess(data: unknown): boolean {
  return !isMiniMaxError(data)
}

