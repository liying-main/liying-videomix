const STORAGE_KEY = 'videomix_app_logs'
const MAX_ENTRIES = 600

export type AppLogLevel = 'info' | 'warn' | 'error'

export interface AppLogEntry {
  ts: number
  level: AppLogLevel
  message: string
  data?: unknown
}

const listeners = new Set<() => void>()

function readEntries(): AppLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e) => e && typeof e === 'object' && typeof e.ts === 'number')
      .slice(-MAX_ENTRIES) as AppLogEntry[]
  } catch {
    return []
  }
}

function writeEntries(entries: AppLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    /* ignore */
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

function append(level: AppLogLevel, message: string, data?: unknown): void {
  const entry: AppLogEntry = {
    ts: Date.now(),
    level,
    message: String(message || '').slice(0, 2000),
    data,
  }
  const entries = readEntries()
  entries.push(entry)
  writeEntries(entries)
  notify()
}

export function appendExternalLog(
  level: AppLogLevel,
  message: string,
  data?: unknown,
): void {
  append(level, message, data)
}

export const appLog = {
  info(message: string, data?: unknown) {
    append('info', message, data)
  },
  warn(message: string, data?: unknown) {
    append('warn', message, data)
  },
  error(message: string, data?: unknown) {
    append('error', message, data)
  },
}

export function readAppLogs(): AppLogEntry[] {
  return readEntries()
}

export function clearAppLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  notify()
}

export function onAppLogsChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
