import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  type ContextMenuParams,
  type Input,
  type IpcMainInvokeEvent,
  type NativeImage,
} from 'electron'
import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'

type Utf8Dirent = Dirent<string>
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fsSync from 'node:fs'
import { CHANNEL } from './channel.generated'
import { normalizeStationBaseUrl, STATION_CHAT_MODEL } from './station'
import { LocalRenderer } from './local-renderer'

const localRenderer = new LocalRenderer(process.resourcesPath, process.cwd())

// ---------------------------------------------------------------------------
// 渠道隔离：userData / 单实例锁 / Windows AppUserModelId 必须按渠道区分，
// 不可与原版「混剪矩阵」(videomix) 共用，否则会被识别为同一应用并互相唤醒。
// ---------------------------------------------------------------------------

const APP_FOLDER_NAME = CHANNEL.packageName
/** 仅迁移本产品线旧目录，不包含原版「混剪矩阵」应用名 */
const LEGACY_USER_DATA_NAMES = ['videomix']

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.flv',
  '.wmv',
  '.m4v',
])
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])
const HDR_PRIMARIES = new Set(['bt2020'])


const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc'])

// ---------------------------------------------------------------------------
// userData path override & migration
// ---------------------------------------------------------------------------

const appDataRoot = app.getPath('appData')
const previousAppName = String(app.getName() || '').trim()
const userDataPath = path.join(appDataRoot, APP_FOLDER_NAME)

app.setName(CHANNEL.productName)
if (process.platform === 'win32') {
  app.setAppUserModelId(CHANNEL.appId)
}

app.setPath('userData', userDataPath)

if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function dirHasEntries(target: string): Promise<boolean> {
  try {
    return (await fs.readdir(target)).length > 0
  } catch {
    return false
  }
}

function legacyUserDataCandidates(): string[] {
  const names = [previousAppName, ...LEGACY_USER_DATA_NAMES]
    .map((n) => String(n || '').trim())
    .filter(Boolean)

  const seen = new Set<string>()
  const candidates: string[] = []

  for (const name of names) {
    const candidate = path.join(appDataRoot, name)
    const key = candidate.toLowerCase()
    if (key !== userDataPath.toLowerCase() && !seen.has(key)) {
      seen.add(key)
      candidates.push(candidate)
    }
  }

  return candidates
}

async function migrateUserDataIfNeeded(): Promise<void> {
  if (await dirHasEntries(userDataPath)) return

  for (const legacyPath of legacyUserDataCandidates()) {
    if (!(await pathExists(legacyPath)) || !(await dirHasEntries(legacyPath))) continue

    try {
      await fs.mkdir(path.dirname(userDataPath), { recursive: true })
      await fs.cp(legacyPath, userDataPath, {
        recursive: true,
        force: false,
        errorOnExist: false,
      })
      emitMainLog('info', 'userData.migrated', { from: legacyPath, to: userDataPath })
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '')
      emitMainLog('warn', 'userData.migrate_failed', {
        from: legacyPath,
        to: userDataPath,
        message,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Environment paths
// ---------------------------------------------------------------------------

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST!
  : path.join(process.env.DIST!, '../public')

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const devToolsEnabled = process.env.VIDEOMIX_DEVTOOLS === '1'

// ---------------------------------------------------------------------------
// Main log buffer
// ---------------------------------------------------------------------------

type MainLogLevel = 'info' | 'warn' | 'error'

interface MainLogEntry {
  ts: number
  level: MainLogLevel
  message: string
  data?: unknown
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

const mainLogBuffer: MainLogEntry[] = []

function emitMainLog(level: MainLogLevel, message: string, data?: unknown): void {
  const entry: MainLogEntry = { ts: Date.now(), level, message, data }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('app:mainLog', entry)
      return
    } catch {
      /* fall through to buffer */
    }
  }

  mainLogBuffer.push(entry)
  if (mainLogBuffer.length > 300) {
    mainLogBuffer.splice(0, mainLogBuffer.length - 300)
  }
}

function flushMainLogBuffer(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainLogBuffer.length === 0) return

  const pending = mainLogBuffer.splice(0, mainLogBuffer.length)
  for (const entry of pending) {
    try {
      mainWindow.webContents.send('app:mainLog', entry)
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Single instance lock
// ---------------------------------------------------------------------------

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL || !app.isPackaged)

if (!isDev) {
  const singleInstanceKey = {
    appId: CHANNEL.appId,
    packageName: CHANNEL.packageName,
    channelId: CHANNEL.id,
  }
  if (!app.requestSingleInstanceLock(singleInstanceKey)) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      app.whenReady().then(() => showMainWindow())
    })
  }
}

// ---------------------------------------------------------------------------
// HDR detection (ffprobe)
// ---------------------------------------------------------------------------

function execFileAsync(
  command: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: 8000, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve({ ok: false, stdout: '' })
        resolve({ ok: true, stdout: String(stdout || '') })
      },
    )
  })
}

async function isHdrVideo(filePath: string): Promise<boolean> {
  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=color_primaries,color_transfer,color_space',
    '-of',
    'json',
    filePath,
  ]

  let result = await execFileAsync(ffprobeExecutable(), args)
  if (!result.ok && process.platform === 'win32') {
    result = await execFileAsync('ffprobe.exe', args)
  }
  if (!result.ok) return false

  try {
    const parsed = JSON.parse(result.stdout || '{}') as {
      streams?: Array<{ color_primaries?: string; color_transfer?: string }>
    }
    const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null
    const primaries = String(stream?.color_primaries || '').toLowerCase()
    const transfer = String(stream?.color_transfer || '').toLowerCase()

    if ((HDR_PRIMARIES.has(primaries) && HDR_TRANSFERS.has(transfer)) || HDR_TRANSFERS.has(transfer)) {
      return true
    }
  } catch {
    return false
  }

  return false
}

// Local compatibility storage: old task metadata remains readable.
function releaseSchedulePath(): string {
  return path.join(app.getPath('userData'), 'release-schedule-meta.json')
}

function publishAccountsPath(): string {
  return path.join(app.getPath('userData'), 'publish-accounts.json')
}

const jsonWriteQueues = new Map<string, Promise<void>>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function replaceFileSafely(tmpPath: string, destPath: string): Promise<void> {
  const maxAttempts = 8
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (process.platform === 'win32') {
        // Windows 上 rename 无法覆盖已存在/被占用的目标文件，改用 copyFile。
        await fs.copyFile(tmpPath, destPath)
        await fs.unlink(tmpPath)
      } else {
        await fs.rename(tmpPath, destPath)
      }
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'EXDEV'
      if (!retryable || attempt === maxAttempts) throw err
      await delay(40 * attempt)
    }
  }
}

async function writeJsonAtomicInner(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await replaceFileSafely(tmp, filePath)
  } catch (err) {
    try {
      await fs.unlink(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const previous = jsonWriteQueues.get(filePath) ?? Promise.resolve()
  const next = previous
    .catch(() => {
      /* 前一次失败后仍继续排队，避免阻塞后续写入 */
    })
    .then(() => writeJsonAtomicInner(filePath, data))

  jsonWriteQueues.set(filePath, next)
  try {
    await next
  } finally {
    if (jsonWriteQueues.get(filePath) === next) {
      jsonWriteQueues.delete(filePath)
    }
  }
}

// ---------------------------------------------------------------------------
// Window, tray, menu
// ---------------------------------------------------------------------------

function setupDevMenu(): void {
  if (!devToolsEnabled) {
    Menu.setApplicationMenu(null)
    return
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '视图',
        submenu: [
          { role: 'toggleDevTools', label: '切换开发者工具' },
          { type: 'separator' },
          { role: 'reload', label: '重新加载' },
        ],
      },
    ]),
  )
}

function attachContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event: Electron.Event, params: ContextMenuParams) => {
    const hasSelection = !!String(params.selectionText || '').trim()
    const isEditable = !!params.isEditable
    if (!isEditable && !hasSelection) return

    const template = isEditable
      ? [
          { role: 'undo' as const, label: '撤销', enabled: params.editFlags.canUndo },
          { role: 'redo' as const, label: '重做', enabled: params.editFlags.canRedo },
          { type: 'separator' as const },
          { role: 'cut' as const, label: '剪切', enabled: params.editFlags.canCut },
          {
            role: 'copy' as const,
            label: '复制',
            enabled: params.editFlags.canCopy || hasSelection,
          },
          { role: 'paste' as const, label: '粘贴', enabled: params.editFlags.canPaste },
          { role: 'selectAll' as const, label: '全选' },
        ]
      : [{ role: 'copy' as const, label: '复制', enabled: hasSelection }]

    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

function appIconCandidates(): string[] {
  return [
    path.join(process.cwd(), 'resources', 'icon.png'),
    path.join(process.cwd(), 'public', 'tray-icon.png'),
    path.join(process.cwd(), 'public', 'favicon.png'),
    path.join(process.env.DIST || '', 'favicon.png'),
    path.join(process.env.DIST || '', 'tray-icon.png'),
    app.isPackaged ? path.join(process.resourcesPath, 'app-icon.png') : '',
    path.join(process.cwd(), 'build', 'icon.ico'),
    path.join(process.env.VITE_PUBLIC || '', 'favicon.png'),
    path.join(process.env.VITE_PUBLIC || '', 'tray-icon.png'),
    path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'),
  ].filter(Boolean)
}

function resolveAppIconPath(): string {
  for (const candidate of appIconCandidates()) {
    try {
      if (candidate && fsSync.existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }
  return path.join(process.cwd(), 'resources', 'icon.png')
}

function resolveAppWindowIcon(): NativeImage {
  if (process.platform === 'win32') {
    for (const candidate of [
      path.join(process.cwd(), 'build', 'icon.ico'),
      path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'),
    ]) {
      try {
        if (candidate && fsSync.existsSync(candidate)) {
          const image = nativeImage.createFromPath(candidate)
          if (!image.isEmpty()) return image
        }
      } catch {
        /* ignore */
      }
    }
  }

  for (const candidate of appIconCandidates()) {
    if (!candidate || !candidate.toLowerCase().endsWith('.png')) continue
    try {
      const image = nativeImage.createFromPath(candidate)
      if (!image.isEmpty()) return image
    } catch {
      /* ignore */
    }
  }

  const fallbackPath = resolveAppIconPath()
  const fallback = nativeImage.createFromPath(fallbackPath)
  if (!fallback.isEmpty()) return fallback
  return nativeImage.createEmpty()
}

function loadTrayIcon(): NativeImage {
  const candidates = [
    path.join(process.cwd(), 'resources', 'icon.png'),
    path.join(process.cwd(), 'public', 'tray-icon.png'),
    path.join(process.env.DIST || '', 'tray-icon.png'),
    app.isPackaged ? path.join(process.resourcesPath, 'app-icon.png') : '',
    path.join(process.env.VITE_PUBLIC || '', 'tray-icon.png'),
    path.join(process.env.VITE_PUBLIC || '', 'favicon.png'),
    path.join(process.env.VITE_PUBLIC || '', 'favicon.ico'),
    path.join(process.cwd(), 'build', 'icon.ico'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) return image.resize({ width: 16, height: 16 })
  }

  emitMainLog('warn', 'tray.icon_missing', { candidates })
  return nativeImage.createEmpty()
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }

  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function createTray(): void {
  if (tray) return

  const icon = loadTrayIcon()
  if (icon.isEmpty()) {
    emitMainLog('warn', 'tray.icon_missing_skip', {})
    return
  }

  try {
    tray = new Tray(icon)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? '')
    emitMainLog('warn', 'tray.create_failed', { message })
    return
  }

  tray.setToolTip(CHANNEL.productName)
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showMainWindow()
    }
  })

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showMainWindow() },
      {
        label: '退出',
        click: () => {
          quitting = true
          tray?.destroy()
          tray = null
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close()
          } else {
            app.quit()
          }
        },
      },
    ]),
  )
}

function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() || mainWindow
}

const DESIGN_WINDOW_SIZE = { width: 1600, height: 960 }
const WORKAREA_FILL_RATIO = 1.02
const ZOOM_MIN = 0.65
const ZOOM_MAX = 1.95
const ZOOM_BIAS = 1.12

function clampZoom(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function debounceWindow<T extends (...args: unknown[]) => void>(fn: T, delayMs: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delayMs)
  }) as T
}

function calcZoomFactor(win: BrowserWindow): number {
  const bounds = win.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  })
  const scaleFactor = display.scaleFactor || 1
  const workArea = display.workAreaSize
  const zoomFromResolution = Math.min(
    (workArea.width * WORKAREA_FILL_RATIO) / DESIGN_WINDOW_SIZE.width,
    (workArea.height * WORKAREA_FILL_RATIO) / DESIGN_WINDOW_SIZE.height,
  )
  const DPI_COMPENSATION_EXP = 0.18
  const zoomFromScale = 1 / Math.pow(scaleFactor, DPI_COMPENSATION_EXP)
  const nextZoom = zoomFromResolution * zoomFromScale * ZOOM_BIAS
  return clampZoom(nextZoom, ZOOM_MIN, ZOOM_MAX)
}

function attachDynamicPageZoom(win: BrowserWindow): () => void {
  const wc = win.webContents
  const apply = (): void => {
    const current = wc.getZoomFactor?.() ?? 1
    const next = calcZoomFactor(win)
    if (Math.abs(current - next) < 0.01) return
    wc.setZoomFactor(next)
  }
  const onDomReady = (): void => apply()
  wc.on('dom-ready', onDomReady)
  const onWindowMoved = debounceWindow(apply, 250)
  const onWindowResized = debounceWindow(apply, 250)
  win.on('moved', onWindowMoved)
  win.on('resize', onWindowResized)
  const onDisplayMetricsChanged = (): void => apply()
  screen.on('display-metrics-changed', onDisplayMetricsChanged)
  const onEnterFullScreen = (): void => apply()
  const onLeaveFullScreen = (): void => apply()
  win.on('enter-full-screen', onEnterFullScreen)
  win.on('leave-full-screen', onLeaveFullScreen)
  return () => {
    try {
      wc.off('dom-ready', onDomReady)
      win.off('moved', onWindowMoved)
      win.off('resize', onWindowResized)
      win.off('enter-full-screen', onEnterFullScreen)
      win.off('leave-full-screen', onLeaveFullScreen)
      screen.off('display-metrics-changed', onDisplayMetricsChanged)
    } catch {
      /* ignore */
    }
  }
}

function createMainWindow(): void {
  setupDevMenu()

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1300,
    minHeight: 900,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    title: CHANNEL.productName,
    backgroundColor: '#08091a',
    icon: resolveAppWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      devTools: devToolsEnabled,
    },
  })

  const cleanupDynamicPageZoom = attachDynamicPageZoom(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    cleanupDynamicPageZoom()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const target = String(url || '').trim()
    if (target.startsWith('http:') || target.startsWith('https:')) {
      void shell.openExternal(target)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    if (devToolsEnabled) {
      mainWindow.webContents.openDevTools()
    }
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  attachContextMenu(mainWindow)

  if (devToolsEnabled) {
    mainWindow.webContents.on('before-input-event', (_event: Electron.Event, input: Input) => {
      const key = String(input.key || '').toLowerCase()
      if (
        input.type === 'keyDown' &&
        input.control &&
        input.shift &&
        key === 'i' &&
        mainWindow
      ) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools()
        } else {
          mainWindow.webContents.openDevTools({ mode: 'detach' })
        }
      }
    })
  }

  mainWindow.on('close', (event: Electron.Event) => {
    if (quitting) return
    if (tray) {
      event.preventDefault()
      mainWindow?.hide()
      emitMainLog('info', 'window.hide_to_tray')
      return
    }
    if (isDev) {
      quitting = true
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    flushMainLogBuffer()
  })
}

// ---------------------------------------------------------------------------
// Asset scan helpers
// ---------------------------------------------------------------------------

async function countSubfolders(dirPath: string): Promise<number> {
  let count = 0
  let entries: Utf8Dirent[]
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return 0
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    count += 1
    count += await countSubfolders(path.join(dirPath, String(entry.name)))
  }

  return count
}

function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/^\.+$/, '')
  if (!cleaned || cleaned === '.' || cleaned === '..') return ''
  return cleaned
}

// ---------------------------------------------------------------------------
// Mix templates store
// ---------------------------------------------------------------------------

interface MixTemplateRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  payload: unknown
}

function mixTemplatesPath(): string {
  return path.join(app.getPath('userData'), 'mix-custom-templates.json')
}

async function readMixTemplates(): Promise<MixTemplateRecord[]> {
  try {
    const raw = await fs.readFile(mixTemplatesPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item) => !!item && typeof item === 'object')
      : []
  } catch {
    return []
  }
}

async function writeMixTemplates(templates: MixTemplateRecord[]): Promise<void> {
  const filePath = mixTemplatesPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(templates, null, 2), 'utf8')
  await fs.rename(tmp, filePath)
}

function newTemplateId(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

// ---------------------------------------------------------------------------
// Fonts helpers
// ---------------------------------------------------------------------------

function systemFontsDirectory(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.SystemRoot || 'C:\\Windows', 'Fonts')
  }
  if (process.platform === 'darwin') return '/Library/Fonts'
  return '/usr/share/fonts'
}

function bundledFontsDirectory(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'fonts')
    : path.join(process.cwd(), 'resources', 'fonts')
}

function ffprobeExecutable(): string {
  return localRenderer.executable('ffprobe')
}

function parseFfprobeVideoMeta(stdout: string): { duration: number; width: number; height: number } | null {
  try {
    const parsed = JSON.parse(stdout || '{}') as {
      format?: { duration?: string | number }
      streams?: Array<{
        codec_type?: string
        width?: number
        height?: number
        duration?: string | number
        tags?: { rotate?: string | number }
        side_data_list?: Array<{ rotation?: number }>
      }>
    }
    const stream =
      parsed.streams?.find((item) => item.codec_type === 'video') ?? parsed.streams?.[0]
    if (!stream) return null

    let width = Number(stream.width) || 0
    let height = Number(stream.height) || 0
    if (width <= 0 || height <= 0) return null

    let rotation = Number(stream.tags?.rotate) || 0
    const sideData = stream.side_data_list?.find((item) => typeof item.rotation === 'number')
    if (sideData && typeof sideData.rotation === 'number') {
      rotation = sideData.rotation
    }
    const normalized = Math.abs(rotation) % 360
    if (normalized === 90 || normalized === 270) {
      ;[width, height] = [height, width]
    }

    const duration =
      Number(stream.duration) ||
      Number(parsed.format?.duration) ||
      0

    return {
      duration: Number.isFinite(duration) && duration > 0 ? duration : 5,
      width,
      height,
    }
  } catch {
    return null
  }
}

async function probeVideoMetaWithFfprobe(filePath: string): Promise<{ duration: number; width: number; height: number } | null> {
  const trimmed = String(filePath || '').trim()
  if (!trimmed) return null

  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration',
    '-of',
    'json',
    trimmed,
  ]

  let result = await execFileAsync(ffprobeExecutable(), args)
  if (!result.ok) {
    result = await execFileAsync('ffprobe', args)
    if (!result.ok && process.platform === 'win32') {
      result = await execFileAsync('ffprobe.exe', args)
    }
  }
  if (!result.ok) return null
  return parseFfprobeVideoMeta(result.stdout)
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  ipcMain.handle('render:runtime', () => localRenderer.runtime())
  ipcMain.handle('render:start', (_event, body: unknown) => localRenderer.start(body))
  ipcMain.handle('render:progress', (_event, body: { job_id?: string }) => localRenderer.progress(String(body?.job_id || '')))
  ipcMain.handle('render:cancel', (_event, body?: { job_id?: string }) => localRenderer.cancel(body?.job_id))
  ipcMain.handle('window:minimize', () => {
    const window = getFocusedWindow()
    window?.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    const window = getFocusedWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle('window:close', () => {
    getFocusedWindow()?.close()
  })

  ipcMain.handle('window:reload', () => {
    getFocusedWindow()?.webContents.reload()
  })

  ipcMain.handle('window:isMaximized', () => {
    const window = getFocusedWindow()
    return window ? window.isMaximized() : false
  })

  ipcMain.handle('store:syncReleaseScheduleMeta', async (_event: IpcMainInvokeEvent, data: unknown) => {
    try {
      await writeJsonAtomic(releaseSchedulePath(), data || {})
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '')
      emitMainLog('warn', 'store.syncReleaseScheduleMeta_failed', { message })
    }
  })

  ipcMain.handle('store:syncPublishAccounts', async (_event: IpcMainInvokeEvent, data: unknown) => {
    try {
      await writeJsonAtomic(publishAccountsPath(), Array.isArray(data) ? data : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '')
      emitMainLog('warn', 'store.syncPublishAccounts_failed', { message })
    }
  })

  ipcMain.handle('path:toFileUrl', (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      return pathToFileURL(filePath).href
    } catch {
      return ''
    }
  })

  ipcMain.handle(
    'dashscope:chatCompletions',
    async (_event: IpcMainInvokeEvent, body: Record<string, unknown>) => {
    const apiKey = String(body?.apiKey || '').trim()
    if (!apiKey) throw new Error('缺少 API Key（请在系统设置中填写中转站令牌）')

    const response = await fetch(
      `${normalizeStationBaseUrl(body.baseURL)}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: body.model || STATION_CHAT_MODEL,
          messages: body.messages || [],
        }),
      },
    )

    const result = (await response.json()) as {
      error?: { message?: string }
      message?: string
    }

    if (!response.ok) {
      const message =
        result.error?.message ||
        (typeof result.message === 'string' ? result.message : '') ||
        `请求失败 (${response.status})`
      throw new Error(message)
    }

      return result
    },
  )

  ipcMain.handle('fs:selectFolder', async (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory'] as ('openDirectory')[] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })

  ipcMain.handle(
    'fs:selectFile',
    async (event: IpcMainInvokeEvent, opts?: Record<string, unknown>) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: String(opts?.title || '').trim() || '选择文件',
      properties: ['openFile'] as ('openFile')[],
      filters: Array.isArray(opts?.filters)
        ? (opts!.filters as Array<{ name?: string; extensions?: unknown[] }>)
            .filter(
              (f) =>
                f &&
                typeof f === 'object' &&
                typeof f.name === 'string' &&
                Array.isArray(f.extensions),
            )
            .map((f) => ({
              name: f.name!,
              extensions: f.extensions!
                .map((ext) => String(ext || '').trim().replace(/^\./, ''))
                .filter(Boolean),
            }))
            .filter((f) => f.extensions.length > 0)
        : undefined,
    }

    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
      return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
    },
  )

  ipcMain.handle('fs:readDir', async (_event: IpcMainInvokeEvent, dirPath: string) => {
    try {
      return (await fs.readdir(dirPath, { withFileTypes: true, encoding: 'utf8' })).map((entry) => ({
        name: String(entry.name),
        isDirectory: entry.isDirectory(),
        path: path.join(dirPath, String(entry.name)),
      }))
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        emitMainLog('warn', 'fs.readDir.missing', { dirPath, code })
        return []
      }
      throw err
    }
  })

  ipcMain.handle('fs:readFileUtf8', async (_event: IpcMainInvokeEvent, filePath: string) =>
    fs.readFile(filePath, 'utf8'),
  )

  ipcMain.handle(
    'fs:writeFileUtf8',
    async (_event: IpcMainInvokeEvent, filePath: string, content: string) => {
      await fs.writeFile(filePath, content, 'utf8')
    },
  )

  ipcMain.handle(
    'fs:writeFileBuffer',
    async (_event: IpcMainInvokeEvent, filePath: string, buffer: ArrayBuffer) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, Buffer.from(buffer))
    },
  )

  ipcMain.handle('fs:pathExists', async (_event: IpcMainInvokeEvent, targetPath: string) =>
    pathExists(targetPath),
  )

  ipcMain.handle('fs:copyFile', async (_event: IpcMainInvokeEvent, src: string, dest: string) => {
    const from = String(src || '').trim()
    const to = String(dest || '').trim()
    if (!from || !to) throw new Error('路径不能为空')
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.copyFile(from, to)
  })

  ipcMain.handle('fs:ensureDir', async (_event: IpcMainInvokeEvent, dirPath: string) => {
    const target = String(dirPath || '').trim()
    if (!target) throw new Error('路径为空')
    await fs.mkdir(target, { recursive: true })
  })

  ipcMain.handle('fs:emptyDir', async (_event: IpcMainInvokeEvent, dirPath: string) => {
    const target = String(dirPath || '').trim()
    if (!target) throw new Error('路径为空')
    await fs.mkdir(target, { recursive: true })

    const entries = await fs.readdir(target, { withFileTypes: true, encoding: 'utf8' })
    await Promise.all(
      entries.map((entry) => fs.rm(path.join(target, String(entry.name)), { recursive: true, force: true })),
    )

    emitMainLog('info', 'fs.emptyDir', { dirPath: target, removedCount: entries.length })
    return { removedCount: entries.length }
  })

  ipcMain.handle('app:getPath', (_event: IpcMainInvokeEvent, name: Parameters<typeof app.getPath>[0]) =>
    app.getPath(name),
  )

  ipcMain.handle(
    'assets:createCategoryFolder',
    async (_event: IpcMainInvokeEvent, root: string, name: string) => {
    const folderName = sanitizeFolderName(name)
    if (!folderName) {
      return { ok: false, error: '文件夹名称无效，请使用常见字符且不能为空' }
    }

    let resolvedRoot: string
    try {
      if (!(await fs.stat(root)).isDirectory()) {
        return { ok: false, error: '根目录无效' }
      }
      resolvedRoot = path.resolve(root)
    } catch {
      return { ok: false, error: '无法访问根目录' }
    }

    const target = path.join(resolvedRoot, folderName)
    try {
      await fs.mkdir(target, { recursive: false })
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
      if (code === 'EEXIST') return { ok: false, error: '已存在同名文件夹' }
      return { ok: false, error: '创建失败，请检查权限与磁盘空间' }
    }

      return { ok: true, path: target, name: folderName }
    },
  )

  ipcMain.handle('assets:scanMixRoot', async (_event: IpcMainInvokeEvent, root: string) => {
    try {
      if (!(await fs.stat(root)).isDirectory()) {
        return { ok: false, error: '路径不是文件夹' }
      }
    } catch {
      return { ok: false, error: '无法访问该路径' }
    }

    let entries: Utf8Dirent[]
    try {
      entries = await fs.readdir(root, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return { ok: false, error: '无法读取目录' }
    }

    const categories: Array<{
      name: string
      path: string
      clipCount: number
      folderCount: number
      sampleClipPaths: string[]
      unsupportedFiles: number
      unsupportedReasons: string[]
    }> = []

    let totalClips = 0
    let totalUnsupported = 0

    async function scanCategory(categoryPath: string) {
      let clipCount = 0
      const sampleClipPaths: string[] = []
      let unsupportedFiles = 0
      let hasNonVideo = false
      let hasHdr = false

      async function walk(dir: string): Promise<void> {
        let files: Utf8Dirent[]
        try {
          files = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' })
        } catch {
          return
        }

        files.sort((a: { name: string }, b: { name: string }) =>
          String(a.name).localeCompare(String(b.name), 'zh-CN'),
        )

        for (const file of files) {
          const fileName = String(file.name)
          const fullPath = path.join(dir, fileName)

          if (file.isDirectory()) {
            await walk(fullPath)
            continue
          }

          const ext = path.extname(fileName).toLowerCase()
          if (!VIDEO_EXTENSIONS.has(ext)) {
            totalUnsupported += 1
            unsupportedFiles += 1
            hasNonVideo = true
            continue
          }

          if (await isHdrVideo(fullPath)) {
            totalUnsupported += 1
            unsupportedFiles += 1
            hasHdr = true
            continue
          }

          clipCount += 1
          if (sampleClipPaths.length < 4) sampleClipPaths.push(fullPath)
        }
      }

      await walk(categoryPath)

      const unsupportedReasons: string[] = []
      if (hasNonVideo) unsupportedReasons.push('non_video')
      if (hasHdr) unsupportedReasons.push('hdr_video')

      return { clipCount, sampleClipPaths, unsupportedFiles, unsupportedReasons }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const name = String(entry.name)
      const categoryPath = path.join(root, name)
      const scan = await scanCategory(categoryPath)
      const folderCount = await countSubfolders(categoryPath)

      categories.push({
        name,
        path: categoryPath,
        clipCount: scan.clipCount,
        folderCount,
        sampleClipPaths: scan.sampleClipPaths,
        unsupportedFiles: scan.unsupportedFiles,
        unsupportedReasons: scan.unsupportedReasons,
      })

      totalClips += scan.clipCount
    }

    categories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

    return {
      ok: true,
      root,
      scannedAt: Date.now(),
      categories,
      totalClips,
      connectedFolders: categories.length,
      unsupportedFiles: totalUnsupported,
    }
  })

  ipcMain.handle('shell:openPath', async (_event: IpcMainInvokeEvent, targetPath: string) => {
    const err = await shell.openPath(targetPath)
    return err || null
  })

  ipcMain.handle('mixTemplates:list', async () =>
    (await readMixTemplates())
      .map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt || t.createdAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  )

  ipcMain.handle('mixTemplates:get', async (_event: IpcMainInvokeEvent, id: string) =>
    (await readMixTemplates()).find((t) => t.id === id) ?? null,
  )

  ipcMain.handle(
    'mixTemplates:save',
    async (_event: IpcMainInvokeEvent, name: string, payload: unknown) => {
    const templateName = String(name || '').trim()
    if (!templateName) throw new Error('模板名不能为空')

    const data = payload as { version?: number }
    if (!data || data.version !== 1) throw new Error('模板数据版本不支持')

    const templates = await readMixTemplates()
    const now = Date.now()
    const existing = templates.find((t) => t.name === templateName)

    if (existing) {
      existing.payload = payload
      existing.updatedAt = now
      await writeMixTemplates(templates)
      return existing
    }

    const created: MixTemplateRecord = {
      id: newTemplateId(),
      name: templateName,
      createdAt: now,
      updatedAt: now,
      payload,
    }
    templates.push(created)
      await writeMixTemplates(templates)
      return created
    },
  )

  ipcMain.handle('mixTemplates:delete', async (_event: IpcMainInvokeEvent, id: string) => {
    await writeMixTemplates((await readMixTemplates()).filter((t) => t.id !== id))
  })

  ipcMain.handle('fonts:defaultDirectory', async () => {
    const bundled = bundledFontsDirectory()
    try {
      if ((await fs.stat(bundled)).isDirectory()) return bundled
    } catch {
      /* fall through */
    }
    return systemFontsDirectory()
  })

  ipcMain.handle('fonts:systemDirectory', () => systemFontsDirectory())

  ipcMain.handle('video:probeMeta', async (_event: IpcMainInvokeEvent, filePath: string) => {
    const trimmed = String(filePath || '').trim()
    if (!trimmed) return null
    return probeVideoMetaWithFfprobe(trimmed)
  })

  ipcMain.handle(
    'fonts:listDirectory',
    async (_event: IpcMainInvokeEvent, dir: string, limit = 400) => {
    const max = Math.min(2000, Math.max(1, Number(limit) || 400))
    const results: Array<{ label: string; file: string }> = []

    async function walk(current: string): Promise<void> {
      if (results.length >= max) return

      let entries: Utf8Dirent[]
      try {
        entries = await fs.readdir(current, { withFileTypes: true, encoding: 'utf8' })
      } catch {
        return
      }

      entries.sort((a: { name: string }, b: { name: string }) =>
        String(a.name).localeCompare(String(b.name), 'zh-CN'),
      )

      for (const entry of entries) {
        if (results.length >= max) return

        const name = String(entry.name)
        const fullPath = path.join(current, name)

        if (entry.isDirectory()) {
          await walk(fullPath)
        } else {
          const ext = path.extname(name).toLowerCase()
          if (FONT_EXTENSIONS.has(ext)) {
            results.push({ label: name, file: fullPath })
          }
        }
      }
    }

    try {
      if (!(await fs.stat(dir)).isDirectory()) return []
    } catch {
      return []
    }

    await walk(path.resolve(dir))
      results.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
      return results
    },
  )
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (quitting || !tray) {
    app.quit()
    mainWindow = null
  }
})

app.on('before-quit', () => {
  quitting = true
  localRenderer.cancel()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  } else {
    showMainWindow()
  }
})

process.on('uncaughtException', (err: Error) => {
  emitMainLog('error', 'main.uncaughtException', {
    message: err?.message,
    stack: err?.stack,
  })
})

process.on('unhandledRejection', (reason: unknown) => {
  emitMainLog('error', 'main.unhandledRejection', { reason })
})

app.whenReady().then(async () => {
  await fs.mkdir(path.join(userDataPath, 'Cache'), { recursive: true }).catch(() => undefined)
  await migrateUserDataIfNeeded()
  registerIpcHandlers()
  createTray()
  createMainWindow()
  // Core rendering is local FFmpeg. Proprietary backend/publishing plugins are not started.
})
