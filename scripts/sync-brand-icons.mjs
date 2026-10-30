/**
 * 从贴牌资料目录同步两套图标到 channels/default/
 *
 * - logo.png   → 界面内 Logo（无字，侧栏/顶栏）
 * - 图标.png   → 应用图标（带字，窗口/任务栏/exe）
 *
 * 用法:
 *   node scripts/sync-brand-icons.mjs
 *   node scripts/sync-brand-icons.mjs "C:\Users\...\贴牌资料\厉影AI"
 */

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const targetDir = path.join(repoRoot, 'channels', 'default')
const sourceDir = process.argv[2]?.trim() || 'C:\\Users\\Administrator\\Desktop\\公司资料\\贴牌资料\\厉影AI'

function pickFile(dir, preferredName, sizeFilter) {
  if (!fs.existsSync(dir)) return null
  const named = path.join(dir, preferredName)
  if (fs.existsSync(named)) return named
  if (!sizeFilter) return null
  const matched = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => path.join(dir, f))
    .filter(sizeFilter)
    .sort((a, b) => fs.statSync(a).size - fs.statSync(b).size)
  return matched[0] || null
}

const uiLogoSrc = pickFile(
  sourceDir,
  'logo.png',
  (p) => {
    const size = fs.statSync(p).size
    return size > 50000 && size < 500000
  },
)

const appIconSrc = pickFile(
  sourceDir,
  '图标.png',
  (p) => {
    const size = fs.statSync(p).size
    return size > 5000 && size < 50000
  },
)

if (!uiLogoSrc) {
  console.error(`[sync-brand-icons] 未找到 logo.png（界面无字 Logo），请检查: ${sourceDir}`)
  process.exit(1)
}
if (!appIconSrc) {
  console.error(`[sync-brand-icons] 未找到 图标.png（应用带字图标），请检查: ${sourceDir}`)
  process.exit(1)
}

fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(uiLogoSrc, path.join(targetDir, 'logo.png'))
fs.copyFileSync(appIconSrc, path.join(targetDir, '图标.png'))
console.log(`[sync-brand-icons] 界面 Logo: ${uiLogoSrc} -> channels/default/logo.png`)
console.log(`[sync-brand-icons] 应用图标: ${appIconSrc} -> channels/default/图标.png`)
console.log('[sync-brand-icons] 请继续运行: node scripts/prepare-channel.mjs default')
