const STORAGE_KEY = 'videomix_assets_root'

export function getAssetsRoot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setAssetsRoot(path: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, path)
  } catch {
    /* ignore */
  }
}

export function clearAssetsRoot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
