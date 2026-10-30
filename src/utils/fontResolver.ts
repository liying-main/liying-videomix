import { pathJoin } from '@/utils/pathJoin'
import { isLocalFsPath, normalizeMediaUrl, normalizePathSlashes } from '@/utils/mediaUrl'

export interface FontFileOption {
  label: string
  file: string
}

function fontBasename(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/')
  if (!normalized) return ''
  return (normalized.split('/').pop() || normalized).trim().toLowerCase()
}

function localPathFromFontKey(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed)
      let pathname = decodeURIComponent(url.pathname || '')
      if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1)
      return pathname
    } catch {
      return trimmed
    }
  }
  if (isLocalFsPath(trimmed)) return trimmed
  return ''
}

async function pathExists(path: string): Promise<boolean> {
  const api = window.electronAPI
  if (!api?.pathExists) return true
  try {
    return await api.pathExists(path)
  } catch {
    return false
  }
}

export async function listFontFileOptions(limit = 500): Promise<FontFileOption[]> {
  const api = window.electronAPI
  if (!api?.defaultFontsDirectory || !api?.listFontFiles) return []

  const dirs: string[] = []
  try {
    const defaultDir = String(await api.defaultFontsDirectory()).trim()
    if (defaultDir) dirs.push(defaultDir)
  } catch {
    /* ignore */
  }
  try {
    const systemDir = String((await api.systemFontsDirectory?.()) || '').trim()
    if (systemDir && !dirs.includes(systemDir)) dirs.push(systemDir)
  } catch {
    /* ignore */
  }

  const seen = new Set<string>()
  const result: FontFileOption[] = []
  for (const dir of dirs) {
    try {
      const files = (await api.listFontFiles(dir, limit)) as Array<{ label?: string; file?: string }>
      for (const item of files || []) {
        const file = String(item?.file || '').trim()
        if (!file || seen.has(file)) continue
        seen.add(file)
        result.push({
          label: String(item?.label || '').trim() || file,
          file,
        })
      }
    } catch {
      /* ignore */
    }
  }
  return result
}

export async function resolveFontPath(fontKey: string): Promise<string> {
  const trimmed = String(fontKey || '').trim()
  const basename = fontBasename(trimmed)

  const local = localPathFromFontKey(trimmed)
  if (local) return (await pathExists(local)) ? local : ''

  try {
    const options = await listFontFileOptions(500)
    const matched = basename
      ? options.find((item) => {
          const label = fontBasename(item.label)
          const file = fontBasename(item.file)
          return label === basename || file === basename
        })
      : undefined
    if (matched?.file) return localPathFromFontKey(matched.file) || matched.file

    const fallback = options.find((item) => /(?:msyh|simhei|pingfang|notosanscjk|notosanssc)/i.test(item.file))
      ?? options.find((item) => /\.(ttf|otf|ttc)$/i.test(String(item.file || ''))) ?? options[0]
    if (fallback?.file) return localPathFromFontKey(fallback.file) || fallback.file
  } catch {
    /* ignore */
  }

  return local
}

/** Relative ../fonts/ path for backend when font lives under default fonts dir. */
export async function toBackendFontPath(absOrKey: string): Promise<string> {
  const normalized = normalizePathSlashes(absOrKey)
  if (!normalized) return ''

  const api = window.electronAPI
  if (!api?.defaultFontsDirectory) return normalized

  try {
    const fontsDir = normalizePathSlashes(await api.defaultFontsDirectory()).replace(/\/+$/, '')
    const lower = normalized.toLowerCase()
    const fontsLower = fontsDir.toLowerCase()
    if (fontsDir && lower.startsWith(`${fontsLower}/`)) {
      const rel = normalized.slice(fontsDir.length + 1).replace(/^\/+/, '')
      return rel ? `../fonts/${rel}` : normalized
    }
  } catch {
    /* ignore */
  }

  return normalized
}

export function toClipFileUrl(pathOrUrl: string): string {
  return normalizeMediaUrl(pathOrUrl)
}

export function pathSep(): string {
  return window.electronAPI?.platform === 'win32' ? '\\' : '/'
}

export function joinOutputPath(dir: string, filename: string): string {
  return pathJoin(dir, filename)
}
