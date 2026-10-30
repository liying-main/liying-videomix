/** Join path segments using OS-appropriate separator (Windows backslash when drive letter present). */
export function pathJoin(base: string, ...parts: string[]): string {
  let result = base.trim().replace(/[/\\]+$/, '')
  if (!result) return parts.join('/')

  const sep = /^[a-zA-Z]:/.test(result) || result.includes('\\') ? '\\' : '/'

  for (const part of parts) {
    const segment = part.replace(/^[/\\]+|[/\\]+$/g, '')
    if (segment) result += sep + segment
  }

  return result
}
