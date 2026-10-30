import axios from 'axios'
import { appLog } from '@/utils/appLog'
import { cancelClipV3, fetchClipV3Progress, postClipV3 } from '@/api/local'

const POLL_INTERVAL_MS = 500
const MAX_POLL_ATTEMPTS = 14400
const SUBMIT_RETRIES = 3
const SUBMIT_RETRY_DELAY_MS = 2000

let pendingCancel: Record<string, string> | null = null

function isOutputUrl(value: string): boolean {
  const trimmed = (value || '').trim()
  return (
    /^(https?|file):\/\//i.test(trimmed) ||
    trimmed.includes('/files/') ||
    trimmed.includes('\\files\\')
  )
}

function pickOutputUrl(data: unknown): string | undefined {
  if (data == null) return undefined
  if (typeof data === 'string' && data.length > 0 && isOutputUrl(data)) return data
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['url', 'urlData', 'output_url', 'output', 'result']) {
      const val = obj[key]
      if (typeof val === 'string' && val.length > 0) return val
    }
  }
  return undefined
}

type ProgressResult =
  | { kind: 'done'; url: string }
  | { kind: 'progress'; percent?: number }
  | { kind: 'error'; message: string }

function parseProgressResponse(response: { code?: number; message?: string; data?: unknown }): ProgressResult {
  if (response.code !== 0 && response.code != null) {
    return { kind: 'error', message: response.message || '查询进度失败' }
  }

  const data = response.data
  if (data == null) return { kind: 'progress' }
  if (typeof data === 'string') {
    return isOutputUrl(data) ? { kind: 'done', url: data } : { kind: 'progress' }
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const status = obj.status
    if (status === 'done' || status === 'success' || status === 'completed') {
      const url = pickOutputUrl(obj) ?? pickOutputUrl(obj.data)
      return url
        ? { kind: 'done', url }
        : { kind: 'error', message: String(obj.message || '已完成但未返回成片地址') }
    }
    if (status === 'error' || status === 'failed' || status === 'cancelled') {
      return { kind: 'error', message: String(obj.message || status) }
    }
    if (
      status === 'progress' ||
      status === 'running' ||
      status === 'pending' ||
      status === 'processing'
    ) {
      let percent: number | undefined
      const nested = obj.data
      if (typeof nested === 'number') percent = Math.round(nested)
      else if (nested && typeof nested === 'object' && typeof (nested as { progress?: number }).progress === 'number') {
        percent = Math.round((nested as { progress: number }).progress)
      }
      return { kind: 'progress', percent }
    }
    const direct = pickOutputUrl(obj)
    if (direct) return { kind: 'done', url: direct }
  }

  return { kind: 'progress' }
}

function sanitizeErrorDetail(detail: string): string {
  const trimmed = detail.trim()
  if (!trimmed) return ''
  if (/^<!doctype html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    if (/CalledProcessError.*ffprobe/i.test(trimmed) || /file:\\\\?/i.test(trimmed)) {
      return '素材路径格式不被后端识别，请重启应用后重试；若仍失败，请到镜头剪辑重新加载素材并新建任务'
    }
    if (/AssertionError.*时间线必须有结束时间/i.test(trimmed)) {
      return '时间线缺少有效镜头时长，请确认每个镜头都已加载素材并完成配音'
    }
    if (/KeyError.*['"]effect['"]/i.test(trimmed)) {
      return '字幕参数不完整（缺少 effect 字段），请更新应用后重试'
    }
    return '后端返回异常页面，请确认本地合成服务已正常启动后重试'
  }
  if (/CalledProcessError.*ffprobe/i.test(trimmed)) {
    return '无法读取素材文件（路径无效或文件不存在），请到镜头剪辑重新加载素材并新建任务'
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed
}

function formatSubmitError(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err.message : String(err)
  }
  const status = err.response?.status
  const data = err.response?.data
  let detail = ''
  if (typeof data === 'string') detail = sanitizeErrorDetail(data)
  else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const msg = obj.detail ?? obj.message ?? obj.msg
    if (typeof msg === 'string') detail = sanitizeErrorDetail(msg)
    else if (Array.isArray(msg) && typeof msg[0] === 'string') detail = sanitizeErrorDetail(msg[0])
  }
  if (status === 500) {
    return detail ? `合成服务异常(500)：${detail}` : '合成服务暂时不可用(500)，请稍后重试'
  }
  if (status == null) return err.message || '网络请求失败'
  return detail ? `请求失败(${status})：${detail}` : err.message || `请求失败(${status})`
}

function summarizeClipsForLog(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const root = body as Record<string, unknown>
  const timeline = root.timeline
  if (!timeline || typeof timeline !== 'object') return body
  const tracks = (timeline as { tracks?: unknown }).tracks
  if (!Array.isArray(tracks)) return body
  const clips: unknown[] = []
  for (const track of tracks) {
    if (!track || typeof track !== 'object') continue
    const list = (track as { clips?: unknown }).clips
    if (!Array.isArray(list)) continue
    for (const [index, clip] of list.entries()) {
      if (!clip || typeof clip !== 'object') continue
      const item = clip as { type?: string; data?: Record<string, unknown> }
      const data = item.data ?? {}
      clips.push({
        index,
        type: item.type,
        start: data.start,
        duration: data.duration,
        file_url: data.file_url ?? data.file,
        trim_start: data.trim_start,
        trim_end: data.trim_end,
      })
    }
  }
  const exporter = root.exporter
  return {
    clipCount: clips.length,
    clips,
    output_file:
      exporter && typeof exporter === 'object'
        ? (exporter as { output_file?: unknown }).output_file
        : undefined,
  }
}

async function submitWithRetry(body: unknown, signal?: AbortSignal) {
  let lastError: unknown
  for (let attempt = 0; attempt < SUBMIT_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await postClipV3(body)
    } catch (err) {
      lastError = err
      const status = axios.isAxiosError(err) ? err.response?.status ?? 0 : 0
      if (status >= 500 && status < 600 && attempt < SUBMIT_RETRIES - 1) {
        appLog.warn('clip_v3.submit.retry', { attempt: attempt + 1, status })
        await new Promise((r) => setTimeout(r, SUBMIT_RETRY_DELAY_MS * (attempt + 1)))
        continue
      }
      appLog.error('clip_v3.submit.failed', {
        attempt: attempt + 1,
        status,
        summary: summarizeClipsForLog(body),
      })
      throw new Error(formatSubmitError(err))
    }
  }
  throw new Error(formatSubmitError(lastError))
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runClipV3Task(
  body: unknown,
  options: {
    progressParams?: Record<string, string>
    signal?: AbortSignal
    onProgress?: (percent?: number) => void
    onAfterSubmit?: () => void
  } = {},
): Promise<string> {
  const submit = await submitWithRetry(body, options.signal)
  if (submit.code !== 0) {
    appLog.error('clip_v3.submit.code_failed', submit)
    throw new Error(submit.message || '视频剪辑任务提交失败')
  }

  const progressParams = { ...options.progressParams, job_id: String(submit.data?.job_id || '') }
  pendingCancel = { ...progressParams }
  let completed = false
  try {
    options.onAfterSubmit?.()
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const progress = await fetchClipV3Progress(progressParams)
      const parsed = parseProgressResponse(progress)
      if (parsed.kind === 'done') { completed = true; return parsed.url }
      if (parsed.kind === 'error') {
        appLog.error('clip_v3.progress.failed', { message: parsed.message, progress })
        throw new Error(parsed.message)
      }

      options.onProgress?.(parsed.percent)
      await wait(POLL_INTERVAL_MS, options.signal)
    }
    throw new Error('视频剪辑超时，请稍后重试')
  } finally {
    if (!completed) await cancelClipV3(progressParams).catch(() => {})
    pendingCancel = null
  }
}

export async function cancelActiveClipV3Task(): Promise<void> {
  if (!pendingCancel) return
  const payload = { ...pendingCancel }
  pendingCancel = null
  try {
    await cancelClipV3(payload)
  } catch (err) {
    console.warn('clip_v3 cancel:', err)
  }
}
