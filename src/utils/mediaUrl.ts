export function isLocalFsPath(value: string): boolean {
  const trimmed = String(value || '').trim()
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return false
  return (
    trimmed.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    (trimmed.startsWith('/') && !trimmed.startsWith('//'))
  )
}

/** Local paths stay local; relative legacy backend paths are no longer served. */
export function normalizeMediaUrl(value: string | undefined | null): string {
  if (!value || typeof value !== 'string') return value || ''
  const trimmed = value.trim().replace(/\\/g, '/')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file://')) {
    return trimmed
  }
  const encoded = encodeURI(trimmed).replace(/#/g, '%23').replace(/\?/g, '%3F')
  if (/^[a-zA-Z]:\//.test(trimmed)) return `file:///${encoded}`
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return `file://${encoded}`
  return trimmed
}

/** file:// URL → local filesystem path. */
export function fileUrlToLocalPath(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed || !trimmed.startsWith('file://')) return trimmed
  try {
    const url = new URL(trimmed)
    let pathname = decodeURIComponent(url.pathname || '')
    if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1)
    return pathname
  } catch {
    return trimmed
  }
}

/**
 * Local renderer accepts absolute filesystem paths and file URLs.
 */
export function toBackendLocalPath(value: string | undefined | null): string {
  const normalized = normalizeMediaUrl(value)
  if (!normalized.startsWith('file://')) return normalized
  return fileUrlToLocalPath(normalized)
}

export function normalizePathSlashes(value: string): string {
  let trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed)
      trimmed = decodeURIComponent(url.pathname || '')
      if (/^\/[a-zA-Z]:\//.test(trimmed)) trimmed = trimmed.slice(1)
    } catch {
      /* keep */
    }
  }
  return trimmed.replace(/\\/g, '/')
}
