import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getRenderRuntimeStatus: () => ipcRenderer.invoke('render:runtime'),
  startLocalRender: (body: unknown) => ipcRenderer.invoke('render:start', body),
  localRenderProgress: (body: unknown) => ipcRenderer.invoke('render:progress', body),
  cancelLocalRender: (body?: unknown) => ipcRenderer.invoke('render:cancel', body),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  windowReload: () => ipcRenderer.invoke('window:reload'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
  pathToFileUrl: (path: string) => ipcRenderer.invoke('path:toFileUrl', path),
  selectFile: (opts?: unknown) => ipcRenderer.invoke('fs:selectFile', opts),
  selectFolder: () => ipcRenderer.invoke('fs:selectFolder'),
  readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
  readFileUtf8: (path: string) => ipcRenderer.invoke('fs:readFileUtf8', path),
  writeFileUtf8: (path: string, content: string) =>
    ipcRenderer.invoke('fs:writeFileUtf8', path, content),
  writeFileBuffer: (path: string, buffer: ArrayBuffer) =>
    ipcRenderer.invoke('fs:writeFileBuffer', path, buffer),
  pathExists: (path: string) => ipcRenderer.invoke('fs:pathExists', path),
  copyFile: (src: string, dest: string) => ipcRenderer.invoke('fs:copyFile', src, dest),
  ensureDir: (path: string) => ipcRenderer.invoke('fs:ensureDir', path),
  emptyDir: (path: string) => ipcRenderer.invoke('fs:emptyDir', path),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  scanMixRoot: (root: string) => ipcRenderer.invoke('assets:scanMixRoot', root),
  createMixCategoryFolder: (root: string, name: string) =>
    ipcRenderer.invoke('assets:createCategoryFolder', root, name),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  listMixCustomTemplates: () => ipcRenderer.invoke('mixTemplates:list'),
  saveMixCustomTemplate: (name: string, payload: unknown) =>
    ipcRenderer.invoke('mixTemplates:save', name, payload),
  deleteMixCustomTemplate: (id: string) => ipcRenderer.invoke('mixTemplates:delete', id),
  getMixCustomTemplate: (id: string) => ipcRenderer.invoke('mixTemplates:get', id),
  defaultFontsDirectory: () => ipcRenderer.invoke('fonts:defaultDirectory'),
  systemFontsDirectory: () => ipcRenderer.invoke('fonts:systemDirectory'),
  listFontFiles: (dir: string, limit?: number) =>
    ipcRenderer.invoke('fonts:listDirectory', dir, limit),
  probeVideoMeta: (filePath: string) =>
    ipcRenderer.invoke('video:probeMeta', filePath) as Promise<{
      duration: number
      width: number
      height: number
    } | null>,
  dashscopeChatCompletions: (body: unknown) =>
    ipcRenderer.invoke('dashscope:chatCompletions', body),
  syncReleaseScheduleMeta: (data: unknown) =>
    ipcRenderer.invoke('store:syncReleaseScheduleMeta', data),
  syncPublishAccounts: (data: unknown) =>
    ipcRenderer.invoke('store:syncPublishAccounts', data),
  onAutoPublishResult: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => {
      try {
        cb(payload)
      } catch {
        /* ignore */
      }
    }
    ipcRenderer.on('release:autoPublishResult', listener)
    return () => ipcRenderer.removeListener('release:autoPublishResult', listener)
  },
  onMainLog: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => {
      try {
        cb(payload)
      } catch {
        /* ignore */
      }
    }
    ipcRenderer.on('app:mainLog', listener)
    return () => ipcRenderer.removeListener('app:mainLog', listener)
  },
})
