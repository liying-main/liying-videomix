import { getAssetsRoot } from '@/utils/assetsRootStorage'

const FIRST_DONE_KEY = 'videomix_first_data_root_done'
const PARENT_KEY = 'videomix_data_root_parent'
const SETTINGS_KEY = 'videomix_settings'

export function getDataRootParent(): string | null {
  try {
    return localStorage.getItem(PARENT_KEY)
  } catch {
    return null
  }
}

export function markFirstDataRootDone(parentPath: string): void {
  try {
    localStorage.setItem(FIRST_DONE_KEY, '1')
    if (parentPath.trim()) {
      localStorage.setItem(PARENT_KEY, parentPath.trim())
    }
  } catch {
    /* ignore */
  }
}

export function shouldShowFirstDataRootDialog(): boolean {
  if (typeof window === 'undefined' || !window.electronAPI?.selectFolder) return false

  try {
    if (localStorage.getItem(FIRST_DONE_KEY) === '1') return false
  } catch {
    return false
  }

  if (getAssetsRoot()?.trim()) return false

  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { workDir?: string; exportOutputDir?: string }
      if (String(parsed?.workDir || '').trim() || String(parsed?.exportOutputDir || '').trim()) {
        return false
      }
    }
  } catch {
    /* ignore */
  }

  return true
}
