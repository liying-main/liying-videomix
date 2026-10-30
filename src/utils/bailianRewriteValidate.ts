export interface RewriteParseResult {
  lines: string[]
  count: number
  exact: boolean
  mode: 'json' | 'lines'
}

function parseJsonLines(content: string): string[] | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.map((line) => String(line ?? '').trim())
  } catch {
    return null
  }
}

function parsePlainLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function parseRewriteContent(content: string, expectedCount: number): RewriteParseResult {
  const jsonLines = parseJsonLines(content)
  if (jsonLines) {
    return {
      lines: jsonLines,
      count: jsonLines.length,
      exact: jsonLines.length === expectedCount,
      mode: 'json',
    }
  }

  const lines = parsePlainLines(content)
  return {
    lines,
    count: lines.length,
    exact: lines.length === expectedCount,
    mode: 'lines',
  }
}

export function validateRewriteContent(
  content: string,
  expectedCount: number,
): RewriteParseResult {
  const first = parseRewriteContent(content, expectedCount)
  if (first.exact || first.lines.length > 0) return first
  return { ...first, exact: first.count === expectedCount }
}
