import { resolveFontPath } from '@/utils/fontResolver'

const loadedFontKeys = new Set<string>()

function hashFontKey(value: string): string {
  if (!value) return ''
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `PreviewFont_${(hash >>> 0).toString(36)}`
}

function estimateTextWidth(lines: string[], fontSizePx: number): number {
  let max = 0
  for (const line of lines) {
    let width = 0
    for (const char of line) {
      const code = char.codePointAt(0) ?? 0
      width += code < 128 ? fontSizePx * 0.52 : fontSizePx
    }
    max = Math.max(max, width)
  }
  return Math.ceil(max)
}

function measureCanvasTextWidth(ctx: CanvasRenderingContext2D, text: string): number {
  const metrics = ctx.measureText(text)
  let width = metrics.width
  const left = metrics.actualBoundingBoxLeft
  const right = metrics.actualBoundingBoxRight
  if (
    typeof left === 'number' &&
    typeof right === 'number' &&
    Number.isFinite(left) &&
    Number.isFinite(right)
  ) {
    const bbox = left + right
    if (bbox > 0) width = Math.max(width, bbox)
  }
  return width
}

async function ensureFontFace(fontFileKey: string, family: string): Promise<void> {
  if (!fontFileKey || loadedFontKeys.has(fontFileKey) || typeof document === 'undefined') return
  loadedFontKeys.add(fontFileKey)

  let src = ''
  try {
    const resolved = await resolveFontPath(fontFileKey)
    const api = window.electronAPI
    if (resolved && api?.pathToFileUrl) {
      src = await api.pathToFileUrl(resolved)
    }
  } catch {
    src = ''
  }

  if (!src || !family) return
  const styleId = `vm_drawtext_measure_${family}`
  if (document.getElementById(styleId)) return

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(src)});font-display:swap;}`
  document.head.appendChild(style)
}

export async function measureDrawtextWidth(options: {
  text: string
  fontSizePx: number
  fontFileKey?: string
  strokeWidthPx?: number
}): Promise<number> {
  const fontSizePx = Math.max(1, options.fontSizePx)
  const strokeWidthPx = Math.max(0, options.strokeWidthPx ?? 0)
  const lines = String(options.text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return 0

  const fontFileKey = String(options.fontFileKey || '').trim()
  const family = hashFontKey(fontFileKey)
  const padding = Math.ceil(strokeWidthPx * 2) + 2
  const fallback = estimateTextWidth(lines, fontSizePx) + padding

  if (typeof document === 'undefined') return fallback

  await ensureFontFace(fontFileKey, family)
  if (family) {
    try {
      await document.fonts.load(`${fontSizePx}px ${family}`)
    } catch {
      /* ignore */
    }
  }
  try {
    await document.fonts.ready
  } catch {
    /* ignore */
  }

  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return fallback

  ctx.font = family
    ? `${fontSizePx}px ${family}, "Microsoft YaHei", "PingFang SC", sans-serif`
    : `${fontSizePx}px "Microsoft YaHei", "PingFang SC", sans-serif`

  let maxWidth = 0
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, measureCanvasTextWidth(ctx, line))
  }
  if (maxWidth <= 0) return fallback
  return Math.max(fallback, Math.ceil(maxWidth + padding))
}
