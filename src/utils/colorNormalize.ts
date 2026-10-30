/** Normalize color to #RRGGBB or #RRGGBB@alpha for clip_v3. */
export function colorNormalize(value: string | undefined | null): string {
  if (!value) return value || ''
  if (value.startsWith('#')) return value.split('@')[0].toUpperCase()

  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!match) return value

  const hex = `#${[match[1], match[2], match[3]]
    .map((part) => Number.parseInt(part, 10).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`
  const alpha = match[4] == null ? null : Number.parseFloat(match[4])
  if (alpha != null && alpha < 1) return `${hex}@${alpha}`
  return hex
}
