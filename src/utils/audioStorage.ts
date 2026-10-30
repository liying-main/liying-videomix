import { pathJoin } from '@/utils/pathJoin'

function readWorkDirFromSettings(): string {
  try {
    const raw = localStorage.getItem('videomix_settings')
    if (!raw) return ''
    const parsed = JSON.parse(raw) as { workDir?: string }
    return typeof parsed?.workDir === 'string' ? parsed.workDir.trim() : ''
  } catch {
    return ''
  }
}

async function writeBufferToDir(
  buffer: Uint8Array,
  filename: string,
  targetDir: string,
): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.writeFileBuffer) return null

  const dir = targetDir.replace(/[/\\]+$/, '')
  const sep = api.platform === 'win32' ? '\\' : '/'
  if (api.ensureDir) await api.ensureDir(dir)
  const safeName =
    String(filename || 'bin')
      .replace(/[^\w.\-]/g, '_')
      .trim() || 'bin'
  const fullPath = `${dir}${sep}videomix_${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`
  await api.writeFileBuffer(fullPath, buffer)
  return fullPath
}

export async function saveAudioBuffer(buffer: Uint8Array, filename: string): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.getPath) return null

  const workDir = readWorkDirFromSettings()
  let targetDir = ''

  if (workDir) {
    targetDir = pathJoin(workDir, 'minimax音频夹')
  } else {
    try {
      const userData = await api.getPath('userData')
      targetDir = pathJoin(String(userData), 'Cache', 'minimax音频夹')
    } catch {
      targetDir = await api.getPath('temp')
    }
  }

  return writeBufferToDir(buffer, filename, targetDir)
}

export async function saveTempBuffer(buffer: Uint8Array, filename: string): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.getPath) return null
  const tempDir = await api.getPath('temp')
  return writeBufferToDir(buffer, filename, tempDir)
}

export async function writeUtf8File(content: string, filename: string, workDir: string): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.getPath || !api?.writeFileUtf8) return null

  let dir = ''
  const trimmedWorkDir = String(workDir || '').trim()
  const sep = api.platform === 'win32' ? '\\' : '/'

  if (trimmedWorkDir) {
    dir = `${trimmedWorkDir.replace(/[/\\]+$/, '')}${sep}srt字幕`
  } else {
    try {
      const userData = await api.getPath('userData')
      dir = `${String(userData).replace(/[/\\]+$/, '')}${sep}Cache${sep}srt字幕`
    } catch {
      dir = await api.getPath('temp')
    }
  }

  if (api.ensureDir) await api.ensureDir(dir)

  const safeName =
    String(filename || 'tmp')
      .replace(/[^\w.\-]/g, '_')
      .trim() || 'tmp'
  const fullPath = `${String(dir).replace(/[/\\]+$/, '')}${sep}videomix_${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`
  await api.writeFileUtf8(fullPath, content)
  return fullPath
}
