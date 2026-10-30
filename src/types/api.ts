export interface ApiResponse<T = unknown> {
  code?: number
  message?: string
  data?: T
}

export interface ElectronAPI {
  platform: string
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  windowReload: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  probeVideoMeta: (filePath: string) => Promise<{ duration: number; width: number; height: number } | null>
  getRenderRuntimeStatus: () => Promise<{ available: boolean; message: string; ffmpeg: string; ffprobe: string }>
  startLocalRender: (body: unknown) => Promise<ApiResponse<{ job_id: string }>>
  localRenderProgress: (body: unknown) => Promise<ApiResponse>
  cancelLocalRender: (body?: unknown) => Promise<ApiResponse>
  pathToFileUrl: (path: string) => Promise<string>
  selectFile: (opts?: unknown) => Promise<string | null>
  selectFolder: () => Promise<string | null>
  readDir: (path: string) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>
  readFileUtf8: (path: string) => Promise<string>
  writeFileUtf8: (path: string, content: string) => Promise<void>
  writeFileBuffer: (path: string, buffer: ArrayBuffer | Uint8Array) => Promise<void>
  pathExists: (path: string) => Promise<boolean>
  copyFile: (src: string, dest: string) => Promise<void>
  ensureDir: (path: string) => Promise<void>
  emptyDir: (path: string) => Promise<{ removedCount: number }>
  getPath: (name: string) => Promise<string>
  scanMixRoot: (root: string) => Promise<unknown>
  createMixCategoryFolder: (root: string, name: string) => Promise<unknown>
  openPath: (path: string) => Promise<string | null>
  listMixCustomTemplates: () => Promise<unknown>
  saveMixCustomTemplate: (name: string, payload: unknown) => Promise<unknown>
  deleteMixCustomTemplate: (id: string) => Promise<void>
  getMixCustomTemplate: (id: string) => Promise<unknown>
  defaultFontsDirectory: () => Promise<string>
  systemFontsDirectory: () => Promise<string>
  listFontFiles: (dir: string, limit?: number) => Promise<Array<{ label: string; file: string }>>
  dashscopeChatCompletions: (body: unknown) => Promise<unknown>
  syncReleaseScheduleMeta: (data: unknown) => Promise<void>
  syncPublishAccounts: (data: unknown) => Promise<void>
  onAutoPublishResult: (cb: (payload: unknown) => void) => () => void
  onMainLog: (cb: (payload: unknown) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
