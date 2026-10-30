import { isMiniMaxRateLimited, miniMaxTextToAudio } from '@/api/minimax'
import {
  AUDIO_PAD_SEC,
  SHOT_GAP_SEC,
  TTS_INTER_SHOT_DELAY_MS,
  TTS_RATE_LIMIT_MAX_RETRIES,
  TTS_RATE_LIMIT_WAIT_MS,
} from '@/constants/mixRender'
import { parseMiniMaxTtsResponse } from '@/services/minimaxTtsResult'
import {
  listAudiosInFolder,
  listVideosInFolder,
  toBackendFileUrl,
  type MediaFileItem,
} from '@/services/mixMediaFiles'
import { runClipV3Task } from '@/services/clipV3Task'
import type { ClipItem, ClipV3Request } from '@/types/clipV3'
import type {
  BgMusicSettings,
  CanvasSettings,
  FolderGroupItem,
  MixTask,
  ShotItem,
  SrtSettings,
  TitleSettings,
} from '@/types/mix'
import { appLog } from '@/utils/appLog'
import { writeUtf8File } from '@/utils/audioStorage'
import { colorNormalize } from '@/utils/colorNormalize'
import { measureDrawtextWidth } from '@/utils/drawtextMeasure'
import { toBackendFontPath, resolveFontPath, joinOutputPath } from '@/utils/fontResolver'
import { ensureLocalRenderReady } from '@/api/local'
import { fitScale } from '@/utils/fitScale'
import { fileUrlToLocalPath, normalizePathSlashes } from '@/utils/mediaUrl'
import { probeVideoMeta } from '@/utils/videoMeta'

function roundSec(value: number, min = 0.01): number {
  return Number(Math.max(min, Number.isFinite(value) ? value : 0).toFixed(3))
}

function sanitizeFilenamePart(value: string): string {
  return (
    (String(value || '').trim() || 'video')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 120)
      .trim() || 'video'
  )
}

export function buildOutputFilePath(task: MixTask, exportOutputDir: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const suffix = task.id.length > 6 ? task.id.slice(-6) : task.id
  const name = `${sanitizeFilenamePart(task.templateName || task.templateType || '成片')}_${stamp}_${suffix}.mp4`
  return joinOutputPath(exportOutputDir, name)
}

function parentDirOf(filePath: string): string {
  const trimmed = String(filePath || '').trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return ''
  const parent = normalized.slice(0, idx)
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}\\`
  const sep = window.electronAPI?.platform === 'win32' ? '\\' : '/'
  return sep === '\\' ? parent.replace(/\//g, '\\') : parent
}

async function persistOutputToExpectedPath(expectedPath: string, sourceUrl: string): Promise<boolean> {
  const api = window.electronAPI
  if (!api?.ensureDir || !api?.writeFileBuffer) return false

  const parent = parentDirOf(expectedPath)
  if (parent) await api.ensureDir(parent)

  const localSource = fileUrlToLocalPath(sourceUrl)
  if (api.copyFile && localSource && localSource !== sourceUrl) {
    try {
      if (!api.pathExists || (await api.pathExists(localSource))) {
        await api.copyFile(localSource, expectedPath)
        return true
      }
    } catch (err) {
      appLog.warn('output.copy_from_local_failed', {
        message: err instanceof Error ? err.message : String(err),
        fromPath: localSource,
        toPath: expectedPath,
      })
    }
  }

  if (/^https?:\/\//i.test(sourceUrl)) {
    try {
      const response = await fetch(sourceUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      await api.writeFileBuffer(expectedPath, bytes)
      return true
    } catch (err) {
      appLog.warn('output.download_remote_failed', {
        message: err instanceof Error ? err.message : String(err),
        remoteUrl: sourceUrl,
        toPath: expectedPath,
      })
    }
  }

  return false
}

export async function finalizeOutputUrl(expectedPath: string, remoteUrl: string): Promise<string> {
  const api = window.electronAPI
  const normalizedRemote = String(remoteUrl || '').trim()

  if (api?.pathExists && api?.pathToFileUrl) {
    try {
      if (await api.pathExists(expectedPath)) {
        const fileUrl = await api.pathToFileUrl(expectedPath)
        if (fileUrl) {
          appLog.info('output.ready', { fsPath: expectedPath, source: 'expected_path' })
          return fileUrl
        }
      }
    } catch (err) {
      appLog.error('output.expected_path_check_failed', {
        message: err instanceof Error ? err.message : String(err),
        fsPath: expectedPath,
      })
    }
  }

  if (normalizedRemote && (await persistOutputToExpectedPath(expectedPath, normalizedRemote))) {
    if (api?.pathExists && api?.pathToFileUrl && (await api.pathExists(expectedPath))) {
      const fileUrl = await api.pathToFileUrl(expectedPath)
      if (fileUrl) {
        appLog.info('output.ready', { fsPath: expectedPath, source: 'persisted_remote_result' })
        return fileUrl
      }
    }
  }

  if (normalizedRemote) {
    appLog.warn('output.expected_path_missing_fallback_remote', {
      fsPath: expectedPath,
      remoteUrl: normalizedRemote,
    })
    return normalizedRemote
  }

  throw new Error('合成完成但未找到可预览的成片文件，请检查成片目录配置或本地后端输出结果')
}

function isVoiceoverEnabledForTask(task: MixTask, defaultEnabled: boolean): boolean {
  if (task.templateType === 'custom') {
    return task.voiceoverEnabledSnapshot ?? defaultEnabled
  }
  return true
}

function shotScriptText(task: MixTask, shotIndex: number): string {
  const shot = task.shots[shotIndex]
  return (
    String(shot?.scriptRewritten ?? '').trim() || String(shot?.scriptOriginal ?? '').trim()
  )
}

function shotBaseDuration(task: MixTask, shotIndex: number): number {
  const shot = task.shots[shotIndex]
  if (typeof shot?.baseDurationSec === 'number' && shot.baseDurationSec > 0) return shot.baseDurationSec
  return Math.max(0, Number(shot?.durationSec) || 0)
}

function subtitleEffectTag(effect: string): string {
  const trimmed = String(effect || '').trim()
  if (!trimmed || ['fade_pop', 'scroll'].includes(trimmed)) return trimmed
  throw new Error('不支持此字幕效果，请重新选择')
}

function formatSrtTimestamp(seconds: number): string {
  const total = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = Math.floor(total % 60)
  const ms = Math.floor((total - Math.floor(total)) * 1000)
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const pad3 = (n: number) => String(n).padStart(3, '0')
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)},${pad3(ms)}`
}

function buildSrtContent(
  cues: Array<{ start: number; end: number; text: string }>,
): string {
  return cues
    .map((cue, index) => {
      const text = String(cue.text || '').trim()
      if (!text) return ''
      const start = formatSrtTimestamp(cue.start)
      const end = formatSrtTimestamp(Math.max(cue.end, cue.start + 0.05))
      return `${index + 1}\n${start} --> ${end}\n${text}\n`
    })
    .filter(Boolean)
    .join('\n')
}

function normalizeBgMusicVolume(value: unknown): number {
  let vol = typeof value === 'number' && !Number.isNaN(value) ? value : 0.3
  if (vol > 1) vol = Math.min(1, vol / 100)
  return Math.min(1, Math.max(0, vol))
}

function taskVoiceVolume(task: MixTask, defaultVolume: number): number {
  const value =
    typeof task.voiceoverVolumeSnapshot === 'number'
      ? task.voiceoverVolumeSnapshot
      : defaultVolume
  return Math.min(3, Math.max(0, Number(value) || 1))
}

function taskVoiceSpeed(task: MixTask, defaultSpeed: number): number {
  const value =
    typeof task.voiceoverSpeedSnapshot === 'number' ? task.voiceoverSpeedSnapshot : defaultSpeed
  return Math.min(2, Math.max(0.5, Number(value) || 1))
}

function taskMinimaxKey(task: MixTask, fallback: string): string {
  return typeof task.minimaxApiKeySnapshot === 'string'
    ? task.minimaxApiKeySnapshot.trim()
    : String(fallback || '').trim()
}

function taskMinimaxVoiceId(task: MixTask, fallback: string): string {
  return typeof task.minimaxVoiceIdSnapshot === 'string'
    ? task.minimaxVoiceIdSnapshot.trim()
    : String(fallback || '').trim()
}

function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

async function callMiniMaxWithRetry(
  task: MixTask,
  shotIndex: number,
  apiKey: string,
  voiceId: string,
  text: string,
  srtEnabled: boolean,
  defaultSpeed: number,
  onMessage: (message: string) => void,
  signal?: AbortSignal,
) {
  let retries = 0
  for (;;) {
    try {
      return await miniMaxTextToAudio(apiKey, {
        voiceId,
        text,
        speed: taskVoiceSpeed(task, defaultSpeed),
        subtitle_enable: srtEnabled,
        signal,
      })
    } catch (err) {
      if (!isMiniMaxRateLimited(err)) throw err
      if (retries >= TTS_RATE_LIMIT_MAX_RETRIES) {
        throw new Error(`MiniMax 配音限流，已等待重试 ${TTS_RATE_LIMIT_MAX_RETRIES} 次仍失败，请稍后再试`)
      }
      retries += 1
      const message = `MiniMax 限流，等待 60 秒后重试当前镜头 ${shotIndex + 1}/${task.shots.length}（第 ${retries} 次）`
      onMessage(message)
      appLog.warn('minimax.t2a.rate_limit_retry', { taskId: task.id, shotIndex, retry: retries })
      await waitMs(TTS_RATE_LIMIT_WAIT_MS, signal)
      onMessage(`生成音频中 ${shotIndex + 1}/${task.shots.length}（限流后重试 ${retries}）`)
    }
  }
}

export async function runTaskTtsPhase(
  task: MixTask,
  options: {
    defaultVoiceEnabled: boolean
    defaultMinimaxKey: string
    defaultMinimaxVoiceId: string
    defaultVoiceSpeed: number
    srtEnabled: boolean
    onMessage?: (message: string) => void
    signal?: AbortSignal
  },
): Promise<ShotItem[]> {
  const shots = task.shots.map((shot) => ({ ...shot }))
  const voiceEnabled = isVoiceoverEnabledForTask(task, options.defaultVoiceEnabled)
  const apiKey = taskMinimaxKey(task, options.defaultMinimaxKey)
  const voiceId = taskMinimaxVoiceId(task, options.defaultMinimaxVoiceId)

  if (!voiceEnabled) {
    for (let i = 0; i < shots.length; i += 1) {
      shots[i].audioUrl = ''
      shots[i].durationSec = shotBaseDuration(task, i)
    }
    return shots
  }

  if (!apiKey || !voiceId) {
    for (let i = 0; i < shots.length; i += 1) {
      shots[i].audioUrl = ''
      shots[i].durationSec = shotBaseDuration(task, i)
    }
    return shots
  }

  for (let i = 0; i < shots.length; i += 1) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const text = shotScriptText(task, i)
    if (!text) {
      shots[i].audioUrl = ''
      shots[i].durationSec = shotBaseDuration(task, i)
      continue
    }

    options.onMessage?.(`生成音频中 ${i + 1}/${shots.length}`)
    const response = await callMiniMaxWithRetry(
      task,
      i,
      apiKey,
      voiceId,
      text,
      options.srtEnabled,
      options.defaultVoiceSpeed,
      (message) => options.onMessage?.(message),
      options.signal,
    )

    const parsed = await parseMiniMaxTtsResponse(response)
    if (!parsed?.url) {
      shots[i].audioUrl = ''
      shots[i].durationSec = shotBaseDuration(task, i)
      continue
    }

    shots[i].audioUrl = parsed.url
    shots[i].scriptRewritten = text
    shots[i].durationSec = parsed.durationSec > 0 ? parsed.durationSec : 0.01

    if (i < shots.length - 1) {
      await waitMs(TTS_INTER_SHOT_DELAY_MS, options.signal)
    }
  }

  return shots
}

function pickShotSource(
  task: MixTask,
  shotIndex: number,
  folderGroups: FolderGroupItem[],
): { item?: MediaFileItem; source: 'snapshot' | 'legacy' | 'missing' } {
  const snapshot = task.clipSourcesPerShot?.[shotIndex]
  if (snapshot?.url) {
    return { item: { url: snapshot.url, name: snapshot.name || 'video.mp4' }, source: 'snapshot' }
  }

  const group = folderGroups[shotIndex]
  if (!group?.files?.length) return { source: 'missing' }

  const selected = Number(task.selectionIndices?.[shotIndex])
  const index =
    Number.isInteger(selected) && selected >= 0 && selected < group.files.length
      ? selected
      : Math.floor(Math.random() * group.files.length)

  return { item: group.files[index], source: 'legacy' }
}

async function resolveCategoryFolder(
  folderKey: string,
  assetsScan: { categories: Array<{ name: string; path: string }> } | null,
): Promise<string> {
  const trimmed = String(folderKey || '').trim()
  if (!trimmed) return ''

  const api = window.electronAPI
  if (api?.pathExists && (await api.pathExists(trimmed))) return trimmed

  const category = assetsScan?.categories.find(
    (item) => item.name === trimmed || item.path === trimmed,
  )
  return category?.path || trimmed
}

export async function resolveFolderGroupFiles(
  folderKey: string,
  assetsScan: { categories: Array<{ name: string; path: string }> } | null,
): Promise<MediaFileItem[]> {
  const folder = await resolveCategoryFolder(folderKey, assetsScan)
  if (!folder) return []
  return listVideosInFolder(folder)
}

const bgMusicCache = new Map<string, MediaFileItem[]>()

async function pickBgMusicUrl(settings: BgMusicSettings): Promise<string | null> {
  const folder = String(settings.folder || '').trim()
  if (!folder) return null

  let tracks = bgMusicCache.get(folder)
  if (!tracks) {
    tracks = await listAudiosInFolder(folder)
    bgMusicCache.set(folder, tracks)
  }
  if (!tracks.length) return null

  const selected = String(settings.selectedTrack || '').trim()
  if (!selected) return tracks[Math.floor(Math.random() * tracks.length)].url

  const matched = tracks.find((track) => track.name === selected)
  return matched?.url || tracks[Math.floor(Math.random() * tracks.length)].url
}

function pushVideoClip(
  clips: ClipItem[],
  args: {
    start: number
    duration: number
    fileUrl: string
    position: { x: number; y: number }
    scale: { x: number; y: number }
    volume: number
    trimStart: number | null
    trimEnd: number | null
  },
) {
  clips.push({
    type: 'FFMPEGVideoClip',
    data: {
      start: roundSec(args.start, 0),
      duration: roundSec(args.duration),
      file_url: toBackendFileUrl(args.fileUrl),
      position: args.position,
      scale: args.scale,
      volume: args.volume,
      trim_start: args.trimStart,
      trim_end: args.trimEnd,
    },
  })
}

export async function buildClipV3Request(
  task: MixTask,
  shots: ShotItem[],
  options: {
    outputFilePath: string
    folderGroups: FolderGroupItem[]
    assetsScan: { categories: Array<{ name: string; path: string }> } | null
    defaultVoiceEnabled: boolean
    defaultVoiceVolume: number
    workDir: string
  },
): Promise<ClipV3Request> {
  const canvas: CanvasSettings = task.canvasSnapshot || {
    width: 1080,
    height: 1920,
    fps: 30,
    color: '#000000',
  }
  const srt: SrtSettings = task.srtSettingsSnapshot || {
    enableSubtitle: true,
    font_file: '',
    font_size: 56,
    margin_v: 350,
    color: '#FFFFFF',
    outline_width: 1,
    outline_color: '#000000',
    subtitle_effect: '',
  }
  const title: TitleSettings = task.titleSettingsSnapshot || {
    titles: [{ text: '' }],
    timeStartSec: 0,
    timeEndSec: 0,
    font_file: '',
    font_size: 85,
    color: '#FCE897',
    centered: true,
    stroke_width: 1,
    stroke_color: '#000000',
    shadow_color: '#EE6A23',
    shadow_x: 2,
    shadow_y: 2,
    position_x: 540,
    position_y: 120,
    title2: { text: '', position_x: 540, position_y: 260 },
  }
  const bgMusic: BgMusicSettings = task.bgMusicSnapshot || {
    enabled: false,
    folder: '',
    volume: 0.4,
    selectedTrack: '',
  }

  const clips: ClipItem[] = []
  const subtitleCues: Array<{ start: number; end: number; text: string }> = []
  let timelineCursor = 0
  const voiceEnabled = isVoiceoverEnabledForTask(task, options.defaultVoiceEnabled)
  const subtitleEnabled = !!srt.enableSubtitle

  const subtitleFontAbs = await resolveFontPath(String(srt.font_file || ''))
  // 原版字幕 font_file 传绝对路径（normalizePathSlashes），不用 ../fonts/ 相对路径
  const subtitleFontPath = normalizePathSlashes(subtitleFontAbs)
  const subtitleColor = colorNormalize(srt.color) || '#FFFFFF'
  const outlineWidth = Number(srt.outline_width) || 0
  const outlineColor = colorNormalize(srt.outline_color) || '#000000'
  const marginV = Number(srt.margin_v) || 0
  const subtitleFontSize = Number(srt.font_size) || 48
  const assEffect = subtitleEffectTag(String(srt.subtitle_effect || ''))

  if (subtitleEnabled && !subtitleFontPath) {
    throw new Error('未找到字幕字体，请在字幕设置中选择系统字体或自有字体文件')
  }

  for (let shotIndex = 0; shotIndex < shots.length; shotIndex += 1) {
    let picked = pickShotSource(task, shotIndex, options.folderGroups)
    if (!picked.item) {
      const folder = shots[shotIndex]?.folder || options.folderGroups[shotIndex]?.folder || ''
      const files = await resolveFolderGroupFiles(folder, options.assetsScan)
      if (files.length) {
        const selected = Number(task.selectionIndices?.[shotIndex])
        const index =
          Number.isInteger(selected) && selected >= 0 && selected < files.length
            ? selected
            : Math.floor(Math.random() * files.length)
        picked = { item: files[index], source: 'legacy' }
      }
    }

    if (!picked.item?.url) {
      throw new Error(
        task.clipSourcesPerShot?.length
          ? `镜头 ${shotIndex + 1} 缺少素材快照，请到「镜头剪辑」重新加载素材并新建任务`
          : `镜头 ${shotIndex + 1} 没有可用视频，请先在「镜头剪辑」加载素材后再创建任务`,
      )
    }

    const sourceUrl = String(picked.item.url).trim()
    const localPath = fileUrlToLocalPath(sourceUrl) || sourceUrl
    const meta = await probeVideoMeta(localPath)
    const shot = shots[shotIndex]
    const originalVolume = shot?.muteOriginal ? 0 : 1
    const hasVoice = !!shot?.audioUrl && (shot.durationSec || 0) > 0
    const { position, scale } = fitScale(meta.width, meta.height, canvas.width, canvas.height)

    let shotDuration = 0

    const addVideoSegment = (segment: {
      start: number
      duration: number
      trimStart: number | null
      trimEnd: number | null
    }) => {
      pushVideoClip(clips, {
        start: segment.start,
        duration: segment.duration,
        fileUrl: sourceUrl,
        position,
        scale,
        volume: originalVolume,
        trimStart: segment.trimStart,
        trimEnd: segment.trimEnd,
      })
    }

    if (hasVoice) {
      const required = roundSec(roundSec(shot.durationSec || 0.01) + AUDIO_PAD_SEC * 2)
      shotDuration = required

      if (meta.duration >= required) {
        const maxStart = Math.max(0, meta.duration - required)
        const trimStart = Number(maxStart > 0 ? (Math.random() * maxStart).toFixed(3) : 0)
        const trimEnd = Number((trimStart + required).toFixed(3))
        addVideoSegment({
          start: timelineCursor,
          duration: required,
          trimStart,
          trimEnd,
        })
      } else {
        appLog.warn('clip_v3.video_source_too_short.loop', {
          taskId: task.id,
          shotIndex: shotIndex + 1,
          sourceDuration: meta.duration,
          requiredDuration: required,
        })
        let remaining = required
        let cursor = timelineCursor
        let guard = 0
        const segmentDuration = roundSec(meta.duration)
        while (remaining > 0.01 && guard < 100) {
          const chunk = roundSec(Math.min(segmentDuration, remaining))
          const isFull = chunk >= segmentDuration - 0.005
          addVideoSegment({
            start: cursor,
            duration: chunk,
            trimStart: 0,
            trimEnd: isFull ? null : chunk,
          })
          cursor = roundSec(cursor + chunk, 0)
          remaining = roundSec(remaining - chunk, 0)
          guard += 1
        }
      }

      clips.push({
        type: 'FFMPEGAudioClip',
        data: {
          start: roundSec(timelineCursor + AUDIO_PAD_SEC),
          duration: roundSec(shot.durationSec || 0.01),
          file_url: toBackendFileUrl(shot.audioUrl),
          volume: taskVoiceVolume(task, options.defaultVoiceVolume),
          trim_start: null,
          trim_end: null,
        },
      })
    } else {
      let duration = meta.duration
      let trimStart: number | null = null
      let trimEnd: number | null = null
      const baseDuration = shotBaseDuration(task, shotIndex)
      if (baseDuration > 0 && meta.duration > baseDuration) {
        duration = baseDuration
        const maxStart = Math.max(0, meta.duration - duration)
        trimStart = Number((Math.random() * maxStart).toFixed(3))
        trimEnd = Number((trimStart + duration).toFixed(3))
      }
      shotDuration = roundSec(duration)
      addVideoSegment({
        start: timelineCursor,
        duration: shotDuration,
        trimStart,
        trimEnd,
      })
    }

    if (subtitleEnabled) {
      const text =
        String(shot?.scriptRewritten ?? '').trim() || String(shot?.scriptOriginal ?? '').trim()
      if (text) {
        const cueStart = hasVoice ? timelineCursor + AUDIO_PAD_SEC : timelineCursor
        const cueEnd = hasVoice
          ? cueStart + (shot.durationSec || 0.01)
          : timelineCursor + Math.max(0.5, shotDuration)
        subtitleCues.push({ start: cueStart, end: cueEnd, text })
      }
    }

    timelineCursor += shotDuration + (voiceEnabled && !hasVoice ? SHOT_GAP_SEC : 0)
  }

  if (!clips.length) {
    throw new Error('没有有效的视频片段，请检查素材路径后重新创建任务')
  }

  if (bgMusic.enabled && bgMusic.folder) {
    try {
      const musicUrl = await pickBgMusicUrl(bgMusic)
      if (musicUrl) {
        clips.unshift({
          type: 'FFMPEGAudioClip',
          data: {
            start: 0,
            duration: -1,
            file_url: toBackendFileUrl(musicUrl),
            volume: normalizeBgMusicVolume(bgMusic.volume),
            trim_start: null,
            trim_end: null,
          },
        })
      }
    } catch (err) {
      appLog.warn('bg_music.pick_failed', {
        taskId: task.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const titleText = (title.titles || [])
    .map((line) => String(line.text || '').trim())
    .filter(Boolean)
    .join('\n')
  const titleFontKey = String(title.font_file || '')
  const titleFontResolved = await resolveFontPath(titleFontKey)
  const titleFontBackend = titleFontResolved
    ? await toBackendFontPath(titleFontResolved)
    : ''

  if ((titleText || String(title.title2?.text || '').trim()) && !titleFontBackend) {
    throw new Error('未找到标题字体，请在标题设置中选择系统字体或自有字体文件')
  }

  const totalDuration = timelineCursor

  if (titleText && titleFontBackend) {
    const start = Math.max(0, Number(title.timeStartSec) || 0)
    const end = Number(title.timeEndSec) || 0
    const duration = end > start ? end - start : Math.max(0.5, totalDuration - start)
    let posX = title.position_x
    let posY = title.position_y
    if (title.centered) {
      const width = await measureDrawtextWidth({
        text: titleText,
        fontSizePx: Math.max(1, Number(title.font_size) || 48),
        fontFileKey: titleFontKey,
        strokeWidthPx: Math.max(0, Number(title.stroke_width) || 0),
      })
      posX = Math.max(0, Math.round((canvas.width - width) / 2))
    }
    clips.push({
      type: 'FFMPEGDrawtextClip',
      data: {
        start,
        duration,
        text: titleText,
        position: { x: posX, y: posY },
        stroke_width: title.stroke_width,
        stroke_color: colorNormalize(title.stroke_color) || '#000000',
        shadow_color: colorNormalize(title.shadow_color) || '#000000',
        shadow_x: title.shadow_x,
        shadow_y: title.shadow_y,
        color: colorNormalize(title.color) || '#FFFFFF',
        font_size: title.font_size,
        font_file: titleFontBackend,
      },
    })
  }

  const title2Text = String(title.title2?.text || '').trim()
  if (title2Text && titleFontBackend) {
    const start = Math.max(0, Number(title.timeStartSec) || 0)
    const end = Number(title.timeEndSec) || 0
    const duration = end > start ? end - start : Math.max(0.5, totalDuration - start)
    let posX = title.title2.position_x
    let posY = title.title2.position_y
    if (title.centered) {
      const width = await measureDrawtextWidth({
        text: title2Text,
        fontSizePx: Math.max(1, Number(title.font_size) || 48),
        fontFileKey: titleFontKey,
        strokeWidthPx: Math.max(0, Number(title.stroke_width) || 0),
      })
      posX = Math.max(0, Math.round((canvas.width - width) / 2))
    }
    clips.push({
      type: 'FFMPEGDrawtextClip',
      data: {
        start,
        duration,
        text: title2Text,
        position: { x: posX, y: posY },
        stroke_width: title.stroke_width,
        stroke_color: colorNormalize(title.stroke_color) || '#000000',
        shadow_color: colorNormalize(title.shadow_color) || '#000000',
        shadow_x: title.shadow_x,
        shadow_y: title.shadow_y,
        color: colorNormalize(title.color) || '#FFFFFF',
        font_size: title.font_size,
        font_file: titleFontBackend,
      },
    })
  }

  if (subtitleEnabled && subtitleFontPath && subtitleCues.length > 0) {
    const srtPath = await writeUtf8File(
      buildSrtContent(subtitleCues),
      `videomix_${task.id}.srt`,
      options.workDir,
    )
    if (srtPath) {
      clips.push({
        type: 'FFMPEGAssSubtitlesClip',
        data: {
          file: normalizePathSlashes(srtPath),
          font_file: subtitleFontPath,
          font_size: subtitleFontSize,
          margin_v: marginV,
          color: subtitleColor,
          ...(outlineWidth > 0
            ? { outline_width: outlineWidth, outline_color: outlineColor }
            : {}),
          effect: assEffect,
        },
      })
    }
  }

  const encoder =
    task.exportEncoderSnapshot === 'h264_nvenc' ? 'h264_nvenc' : 'libx264'

  return {
    timeline: {
      width: canvas.width,
      height: canvas.height,
      color: colorNormalize(canvas.color) || '#000000',
      tracks: [{ clips }],
      duration: null,
    },
    exporter: {
      fps: canvas.fps,
      encoder,
      video_bitrate: task.exportVideoBitrateSnapshot || '3M',
      output_file: options.outputFilePath,
    },
  }
}

export async function renderMixTask(
  task: MixTask,
  options: {
    exportOutputDir: string
    workDir: string
    folderGroups: FolderGroupItem[]
    assetsScan: { categories: Array<{ name: string; path: string }> } | null
    defaultVoiceEnabled: boolean
    defaultVoiceVolume: number
    defaultVoiceSpeed: number
    defaultMinimaxKey: string
    defaultMinimaxVoiceId: string
    onPhase?: (phase: 'tts' | 'submitting' | 'polling', message: string) => void
    onProgress?: (percent?: number) => void
    signal?: AbortSignal
  },
): Promise<{ outputUrl: string; shots: ShotItem[]; outputFilePath: string }> {
  await ensureLocalRenderReady()
  const outputFilePath = buildOutputFilePath(task, options.exportOutputDir)
  const srtEnabled = !!(task.srtSettingsSnapshot?.enableSubtitle ?? true)

  options.onPhase?.('tts', '生成音频中')
  const shots = await runTaskTtsPhase(task, {
    defaultVoiceEnabled: options.defaultVoiceEnabled,
    defaultMinimaxKey: options.defaultMinimaxKey,
    defaultMinimaxVoiceId: options.defaultMinimaxVoiceId,
    defaultVoiceSpeed: options.defaultVoiceSpeed,
    srtEnabled,
    onMessage: (message) => options.onPhase?.('tts', message),
    signal: options.signal,
  })

  options.onPhase?.('submitting', '提交任务中')

  const api = window.electronAPI
  if (api?.ensureDir) {
    const parent = parentDirOf(outputFilePath)
    if (parent) await api.ensureDir(parent)
  }

  const body = await buildClipV3Request(task, shots, {
    outputFilePath,
    folderGroups: options.folderGroups,
    assetsScan: options.assetsScan,
    defaultVoiceEnabled: options.defaultVoiceEnabled,
    defaultVoiceVolume: options.defaultVoiceVolume,
    workDir: options.workDir,
  })

  const remoteUrl = await runClipV3Task(body, {
    signal: options.signal,
    onAfterSubmit: () => options.onPhase?.('polling', '合成中'),
    onProgress: (percent) => {
      options.onPhase?.(
        'polling',
        percent != null ? `合成中 ${percent}%` : '合成中',
      )
      options.onProgress?.(percent)
    },
  })

  const outputUrl = await finalizeOutputUrl(outputFilePath, remoteUrl)
  return { outputUrl, shots, outputFilePath }
}
