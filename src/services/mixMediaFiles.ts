import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from '@/constants/mixRender'
import { toBackendLocalPath } from '@/utils/mediaUrl'

export interface MediaFileItem {
  url: string
  name: string
}

function extOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx).toLowerCase() : ''
}

function toFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const encoded = encodeURI(normalized).replace(/#/g, '%23')
  return /^[a-zA-Z]:/.test(normalized) ? `file:///${encoded}` : `file://${encoded}`
}

export async function listVideosInFolder(folderPath: string): Promise<MediaFileItem[]> {
  const api = window.electronAPI
  if (!api?.readDir) return []

  const entries = await api.readDir(folderPath)
  return entries
    .filter((entry) => !entry.isDirectory && VIDEO_EXTENSIONS.includes(extOf(entry.name)))
    .map((entry) => ({ url: toFileUrl(entry.path), name: entry.name }))
}

export async function listAudiosInFolder(folderPath: string): Promise<MediaFileItem[]> {
  const api = window.electronAPI
  if (!api?.readDir) return []

  const entries = await api.readDir(folderPath)
  return entries
    .filter((entry) => !entry.isDirectory && AUDIO_EXTENSIONS.includes(extOf(entry.name)))
    .map((entry) => ({ url: toFileUrl(entry.path), name: entry.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export async function validateAndListAudios(
  folderPath: string,
): Promise<{ ok: true; audios: MediaFileItem[] } | { ok: false; invalidFiles: string[] }> {
  const api = window.electronAPI
  if (!api?.readDir) return { ok: true, audios: [] }

  const entries = await api.readDir(folderPath)
  const audios: MediaFileItem[] = []
  const invalidFiles: string[] = []

  for (const entry of entries) {
    if (entry.isDirectory) continue
    if (AUDIO_EXTENSIONS.includes(extOf(entry.name))) {
      audios.push({ url: toFileUrl(entry.path), name: entry.name })
    } else {
      invalidFiles.push(entry.name)
    }
  }

  if (invalidFiles.length > 0) return { ok: false, invalidFiles }
  audios.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return { ok: true, audios }
}

export function clipItemToUrl(item: { url: string; name?: string } | undefined): string {
  return String(item?.url || '').trim()
}

export function toBackendFileUrl(pathOrUrl: string): string {
  return toBackendLocalPath(pathOrUrl)
}
