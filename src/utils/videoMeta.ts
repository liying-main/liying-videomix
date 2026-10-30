import { fileUrlToLocalPath, isLocalFsPath } from '@/utils/mediaUrl'

export interface VideoMeta {
  duration: number
  width: number
  height: number
}

export function normalizeVideoMeta(meta: VideoMeta): VideoMeta {
  return {
    duration: Number.isFinite(meta.duration) && meta.duration >= 0.3 ? meta.duration : 5,
    width: Number.isFinite(meta.width) && meta.width > 0 ? meta.width : 0,
    height: Number.isFinite(meta.height) && meta.height > 0 ? meta.height : 0,
  }
}

function readVideoMetaFromUrl(url: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.crossOrigin = 'anonymous'
    video.onloadedmetadata = () => {
      resolve({
        duration: video.duration,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
      })
    }
    video.onerror = () => reject(new Error('无法读取视频信息'))
    video.src = url
  })
}

async function probeVideoMetaViaFfprobe(localPath: string): Promise<VideoMeta | null> {
  const api = window.electronAPI
  if (!api?.probeVideoMeta) return null
  try {
    const result = await api.probeVideoMeta(localPath)
    if (!result || typeof result !== 'object') return null
    const duration = Number((result as VideoMeta).duration) || 0
    const width = Number((result as VideoMeta).width) || 0
    const height = Number((result as VideoMeta).height) || 0
    if (width <= 0 || height <= 0) return null
    return normalizeVideoMeta({ duration, width, height })
  } catch {
    return null
  }
}

export async function probeVideoMeta(source: string): Promise<VideoMeta> {
  const trimmed = String(source || '').trim()
  if (!trimmed) {
    return normalizeVideoMeta({ duration: 5, width: 0, height: 0 })
  }

  const localPath = isLocalFsPath(trimmed) ? fileUrlToLocalPath(trimmed) || trimmed : trimmed

  if (localPath && !/^https?:\/\//i.test(localPath)) {
    const ffprobeMeta = await probeVideoMetaViaFfprobe(localPath)
    if (ffprobeMeta) return ffprobeMeta
  }

  try {
    let mediaUrl = trimmed
    if (isLocalFsPath(trimmed)) {
      const api = window.electronAPI
      if (api?.pathToFileUrl) {
        mediaUrl = await api.pathToFileUrl(localPath)
      }
    }
    const fromElement = normalizeVideoMeta(await readVideoMetaFromUrl(mediaUrl))
    if (fromElement.width > 0 && fromElement.height > 0) return fromElement
  } catch {
    /* fall through */
  }

  return normalizeVideoMeta({ duration: 5, width: 0, height: 0 })
}

export function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    const done = (duration: number) => {
      audio.removeAttribute('src')
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0)
    }
    audio.onloadedmetadata = () => done(audio.duration)
    audio.onerror = () => done(0)
    audio.src = url
  })
}
