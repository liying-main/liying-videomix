/**
 * 渠道贴牌预处理脚本（本地渠道）
 *
 * 用法:
 *   node scripts/prepare-channel.mjs [channelId]
 *   node scripts/prepare-channel.mjs --list-channels
 *
 * 本地可用渠道: default, xiaojieai
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execSync } from 'node:child_process'

const repoRoot = process.cwd()
const args_raw = process.argv.slice(2)
const platformIdx = args_raw.indexOf('--platform')
const targetPlatform = platformIdx !== -1 ? args_raw[platformIdx + 1] : 'win'

const DEFAULT_CFG = {
  id: 'default',
  appId: 'com.liying.hunjian',
  packageName: 'liying-videomix',
  productName: '厉影AI混剪智能体',
  description: '厉影AI混剪：免费开源本地视频合成客户端',
  titleLeft: '厉影',
  titleMiddle: 'AI',
  titleRight: '混剪智能体',
  uiLogoPng: path.join(repoRoot, 'channels', 'default', 'logo.png'),
  appIconPng: path.join(repoRoot, 'channels', 'default', '图标.png'),
  iconIco: path.join(repoRoot, 'channels', 'default', 'icon.ico'),
}

const CHANNELS = {
  default: DEFAULT_CFG,
}

const args = args_raw

if (args.includes('--list-channels')) {
  console.log(Object.keys(CHANNELS).join('\n'))
  process.exit(0)
}

let cfg

const channelId = (args[0] || '').trim() || 'default'
if (Object.hasOwn(CHANNELS, channelId)) {
  cfg = CHANNELS[channelId]
} else {
  console.error(`[prepare-channel] 未知本地渠道: ${channelId}`)
  console.error(`[prepare-channel] 本地可用: ${Object.keys(CHANNELS).join(', ')}`)
  process.exit(1)
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function safeCopyFile(src, dst) {
  ensureDir(path.dirname(dst))
  fs.copyFileSync(src, dst)
}

function toMixProductName(appName) {
  const base = String(appName || '小杰AI').trim()
  if (!base) return '小杰AI混剪智能体'
  if (base.includes('混剪')) return base
  return `${base}混剪智能体`
}

/** 安装包/可执行文件名：与 liying-pc 区分，统一 *-hunjian-ai */
function toMixPackageName(agentCode, installerPrefix) {
  const raw = String(installerPrefix || agentCode || 'app')
    .trim()
    .toLowerCase()
  let base = raw.replace(/-hunjian-ai$/i, '').replace(/-ai$/i, '')
  base = base.replace(/[^a-z0-9-]/g, '')
  if (!base) base = String(agentCode || 'app').replace(/[^a-z0-9]/g, '') || 'app'
  return `${base}-hunjian-ai`
}

function toMixAppId(agentCode, packageName) {
  const pkg = toMixPackageName(agentCode, packageName)
  const slug = pkg.replace(/-hunjian-ai$/i, '').replace(/[^a-z0-9]/g, '')
  return `com.${slug || 'app'}.hunjian`
}

/** 本地渠道与 API 渠道统一命名，避免与 liying-pc 的 *-ai 安装包冲突 */
function finalizeMixChannel(raw) {
  const packageName = toMixPackageName(raw.id, raw.packageName)
  return {
    ...raw,
    packageName,
    appId: toMixAppId(raw.id, packageName),
  }
}

function parseBrandTitles(productName) {
  const appName = productName
  let titleLeft = appName
  let titleMiddle = ''
  let titleRight = ''
  const aiIdx = appName.indexOf('AI')
  if (aiIdx > 0) {
    titleLeft = appName.substring(0, aiIdx)
    titleMiddle = 'AI'
    titleRight = appName.substring(aiIdx + 2).trim()
  }
  return { titleLeft, titleMiddle, titleRight }
}

/** 界面内 Logo：logo.png（无字图形，侧栏/顶栏） */
function resolveUiLogoPng(channelDir, preferredPngPath) {
  const envIcon = process.env.BUILD_UI_LOGO_PNG?.trim()
  if (envIcon && fs.existsSync(envIcon)) return envIcon
  const candidates = []
  if (preferredPngPath) candidates.push(preferredPngPath)
  if (cfg.uiLogoPng) candidates.push(cfg.uiLogoPng)
  if (channelDir) {
    candidates.push(path.join(channelDir, 'logo.png'))
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

/** 应用图标：图标.png（带品牌字，窗口/任务栏/exe/托盘） */
function resolveAppIconPng(channelDir, preferredPngPath) {
  const envIcon = process.env.BUILD_APP_ICON_PNG?.trim() || process.env.BUILD_ICON_PNG?.trim()
  if (envIcon && fs.existsSync(envIcon)) return envIcon
  const candidates = []
  if (preferredPngPath) candidates.push(preferredPngPath)
  if (cfg.appIconPng) candidates.push(cfg.appIconPng)
  if (channelDir) {
    for (const name of ['图标.png', 'icon.png']) {
      candidates.push(path.join(channelDir, name))
    }
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function resolvePackagingIconIco(channelDir, preferredIcoPath) {
  const envIco = process.env.BUILD_ICON_ICO?.trim()
  if (envIco && fs.existsSync(envIco)) return envIco
  const candidates = []
  if (preferredIcoPath) candidates.push(preferredIcoPath)
  if (channelDir) {
    for (const name of ['windows.ico', 'icon.ico']) {
      candidates.push(path.join(channelDir, name))
    }
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function generateIcoFromPngFallback(pngPath, icoPath) {
  try {
    runPowerShellScript(`Add-Type -AssemblyName System.Drawing
$png = [System.Drawing.Image]::FromFile('${pngPath.replace(/'/g, "''")}')
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($png, 0, 0, 256, 256)
$g.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fileStream = [System.IO.FileStream]::new('${icoPath.replace(/'/g, "''")}', [System.IO.FileMode]::Create)
$icon.Save($fileStream)
$fileStream.Close()
$bmp.Dispose()
$icon.Dispose()
$png.Dispose()
`)
    return true
  } catch (err) {
    console.warn(`[prepare-channel] ICO 生成失败: ${err.message}`)
    return false
  }
}

async function generateIcoFromPng(pngPath, icoPath) {
  if (!fs.existsSync(pngPath)) return false
  try {
    const sharp = (await import('sharp')).default
    const pngToIco = (await import('png-to-ico')).default
    const sizes = [16, 24, 32, 48, 64, 128, 256]
    const buffers = []
    for (const size of sizes) {
      buffers.push(
        await sharp(pngPath)
          .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer(),
      )
    }
    ensureDir(path.dirname(icoPath))
    fs.writeFileSync(icoPath, await pngToIco(buffers))
    return true
  } catch (err) {
    console.warn(`[prepare-channel] sharp 生成 ICO 失败，尝试备用方案: ${err.message}`)
    return generateIcoFromPngFallback(pngPath, icoPath)
  }
}

function writeChannelGenerated() {
  const channelTs =
    `// 此文件由 scripts/prepare-channel.mjs 自动生成，请勿手动修改\n` +
    `export const CHANNEL = {\n` +
    `  id: ${JSON.stringify(cfg.id)},\n` +
    `  appId: ${JSON.stringify(cfg.appId)},\n` +
    `  packageName: ${JSON.stringify(cfg.packageName)},\n` +
    `  productName: ${JSON.stringify(cfg.productName)},\n` +
    `  description: ${JSON.stringify(cfg.description)},\n` +
    `} as const\n\n` +
    `export const BRAND = {\n` +
    `  productName: ${JSON.stringify(cfg.productName)},\n` +
    `  titleLeft: ${JSON.stringify(cfg.titleLeft)},\n` +
    `  titleMiddle: ${JSON.stringify(cfg.titleMiddle)},\n` +
    `  titleRight: ${JSON.stringify(cfg.titleRight)},\n` +
    `} as const\n`

  for (const outPath of [
    path.join(repoRoot, 'src', 'shared', 'channel.generated.ts'),
    path.join(repoRoot, 'electron', 'channel.generated.ts'),
  ]) {
    ensureDir(path.dirname(outPath))
    fs.writeFileSync(outPath, channelTs, 'utf8')
    console.log(`[prepare-channel] 已写入: ${path.relative(repoRoot, outPath)}`)
  }
}

async function generatePngFromIco(icoPath, pngPath) {
  if (!fs.existsSync(icoPath)) return false
  try {
    const sharp = (await import('sharp')).default
    ensureDir(path.dirname(pngPath))
    await sharp(icoPath, { density: 256 }).resize(256, 256).png().toFile(pngPath)
    return true
  } catch {
    return generatePngFromIcoFallback(icoPath, pngPath)
  }
}

function runPowerShellScript(scriptBody) {
  const tmpPs1 = path.join(repoRoot, 'scripts', `.prepare-channel-${process.pid}.ps1`)
  fs.writeFileSync(tmpPs1, scriptBody, 'utf8')
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`, { stdio: 'pipe' })
    return true
  } finally {
    fs.unlinkSync(tmpPs1)
  }
}

function generatePngFromIcoFallback(icoPath, pngPath) {
  try {
    ensureDir(path.dirname(pngPath))
    runPowerShellScript(`Add-Type -AssemblyName System.Drawing
$icon = New-Object System.Drawing.Icon('${icoPath.replace(/'/g, "''")}')
$bmp = $icon.ToBitmap()
$bmp.Save('${pngPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$icon.Dispose()
`)
    return fs.existsSync(pngPath)
  } catch (err) {
    console.warn(`[prepare-channel] 从 ICO 生成 PNG 失败: ${err.message}`)
    return false
  }
}

async function copyIconIfNeeded() {
  const resourcesIcon = path.join(repoRoot, 'resources', 'icon.png')
  const buildIconIco = path.join(repoRoot, 'build', 'icon.ico')
  const publicTrayIcon = path.join(repoRoot, 'public', 'tray-icon.png')
  const publicFaviconPng = path.join(repoRoot, 'public', 'favicon.png')
  const publicFaviconIco = path.join(repoRoot, 'public', 'favicon.ico')
  const uiLogo = path.join(repoRoot, 'src', 'assets', 'logo.png')

  const channelDir =
    cfg.appIconPng ? path.dirname(cfg.appIconPng) : cfg.uiLogoPng ? path.dirname(cfg.uiLogoPng) : path.join(repoRoot, 'channels', 'default')
  const uiLogoImage = resolveUiLogoPng(channelDir, cfg.uiLogoPng)
  const appIconImage = resolveAppIconPng(channelDir, cfg.appIconPng)
  const packagingIco = resolvePackagingIconIco(channelDir, cfg.iconIco)

  // 界面 Logo（无字/侧栏）— 与桌面应用图标分离，参考 liying-pc / sync-brand-icons
  if (uiLogoImage) {
    console.log(`[prepare-channel] 界面 Logo 源: ${path.relative(repoRoot, uiLogoImage)}`)
    safeCopyFile(uiLogoImage, uiLogo)
    console.log('[prepare-channel] 已同步界面: src/assets/logo.png（logo.png，侧栏/顶栏）')
  } else {
    console.warn('[prepare-channel] 未找到 logo.png（界面 Logo），侧栏可能仍显示旧图')
    console.warn('[prepare-channel] 请在后台配置 brandLogoUrl，或手动放置 channels/<id>/logo.png')
  }

  // 应用图标（带字，桌面/exe/任务栏）— 优先 图标.png，其次 ICO 转 PNG
  let appTrayPng = appIconImage
  if (!appTrayPng && packagingIco) {
    const generatedTray = path.join(channelDir, 'app-icon-from-ico.png')
    if (await generatePngFromIco(packagingIco, generatedTray)) {
      appTrayPng = generatedTray
      console.log('[prepare-channel] 已从 icon.ico 生成应用 PNG（托盘/资源）')
    }
  }

  if (appTrayPng) {
    console.log(`[prepare-channel] 应用图标源: ${path.relative(repoRoot, appTrayPng)}`)
    safeCopyFile(appTrayPng, resourcesIcon)
    safeCopyFile(appTrayPng, publicTrayIcon)
    safeCopyFile(appTrayPng, publicFaviconPng)
    console.log('[prepare-channel] 已覆盖: resources/icon.png、tray-icon.png、favicon.png（应用图标，带字）')
  } else if (packagingIco) {
    console.warn('[prepare-channel] 无应用 PNG，桌面 exe 将使用 icon.ico，托盘 PNG 未更新')
  } else {
    console.warn('[prepare-channel] 找不到应用图标（图标.png / icon.ico）')
  }

  const faviconSvg = path.join(repoRoot, 'public', 'favicon.svg')
  if (fs.existsSync(faviconSvg)) {
    fs.unlinkSync(faviconSvg)
    console.log('[prepare-channel] 已删除旧 public/favicon.svg')
  }

  if (targetPlatform === 'win') {
    const envIco = process.env.BUILD_ICON_ICO?.trim()
    if (envIco && fs.existsSync(envIco)) {
      safeCopyFile(envIco, buildIconIco)
      safeCopyFile(envIco, publicFaviconIco)
      console.log('[prepare-channel] Windows 图标: build/icon.ico (BUILD_ICON_ICO)')
    } else if (packagingIco) {
      safeCopyFile(packagingIco, buildIconIco)
      safeCopyFile(packagingIco, publicFaviconIco)
      console.log(`[prepare-channel] Windows 图标: build/icon.ico (${path.relative(repoRoot, packagingIco)})`)
    } else if (appTrayPng) {
      const generated = await generateIcoFromPng(appTrayPng, buildIconIco)
      if (!generated) {
        console.error('[prepare-channel] 无法从应用图标 PNG 生成 build/icon.ico')
        process.exit(1)
      }
      safeCopyFile(buildIconIco, publicFaviconIco)
      console.log('[prepare-channel] Windows 图标: build/icon.ico（由应用 PNG 生成）')
    } else {
      console.error('[prepare-channel] 找不到 Windows 应用图标（icon.ico 或 图标.png）')
      process.exit(1)
    }
  }
}

function updateIndexHtml() {
  const indexPath = path.join(repoRoot, 'index.html')
  if (!fs.existsSync(indexPath)) return
  let html = fs.readFileSync(indexPath, 'utf8')
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${cfg.productName}</title>`)
  html = html.replace(
    /(<p class="vm-startup__brand">)[^<]*(<\/p>)/,
    `$1${cfg.productName}$2`,
  )
  fs.writeFileSync(indexPath, html, 'utf8')
  console.log(`[prepare-channel] 已更新: index.html（${cfg.productName}）`)
}

function generateElectronBuilderConfig() {
  const basePath = path.join(repoRoot, 'electron-builder.yml')
  const outPath = path.join(repoRoot, 'electron-builder.generated.yml')
  const base = fs.readFileSync(basePath, 'utf8').replace(/\r\n/g, '\n')

  let next = base
    .replace(/^appId:\s*.*$/m, `appId: ${cfg.appId}`)
    .replace(/^productName:\s*.*$/m, `productName: ${cfg.productName}`)
    .replace(/^\s*executableName:\s*.*$/m, `  executableName: ${cfg.packageName}`)

  next = next.replace(/\nextraMetadata:[\s\S]*$/m, '').trimEnd()
  next = `${next}\nextraMetadata:\n  name: ${cfg.packageName}\n  description: ${cfg.description}\n`

  fs.writeFileSync(outPath, next, 'utf8')
  console.log(`[prepare-channel] 已生成: electron-builder.generated.yml`)
}

cfg = finalizeMixChannel(cfg)

writeChannelGenerated()
await copyIconIfNeeded()
updateIndexHtml()
generateElectronBuilderConfig()

const buildMeta = {
  agentCode: cfg.id,
  productName: cfg.productName,
  packageName: cfg.packageName,
}
fs.writeFileSync(path.join(repoRoot, '.build-meta.json'), JSON.stringify(buildMeta), 'utf8')

console.log(`\n[prepare-channel] 渠道 "${cfg.id}" 准备完成 (${cfg.productName})`)
console.log(`[prepare-channel] 安装包: ${cfg.packageName}-<version>-setup.exe`)
console.log(`[prepare-channel] appId: ${cfg.appId}\n`)
