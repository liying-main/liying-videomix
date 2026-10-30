import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bundle = fs.readFileSync(
  path.join(__dirname, '../../app_extracted/dist/assets/index-Dsigg7a2.js'),
  'utf8',
)

function extractObjectLiteral(marker) {
  const start = bundle.indexOf(marker)
  if (start < 0) throw new Error(`Missing ${marker}`)
  const braceStart = bundle.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < bundle.length; i += 1) {
    const ch = bundle[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return bundle.slice(braceStart, i + 1)
    }
  }
  throw new Error(`Unclosed object for ${marker}`)
}

const brObj = extractObjectLiteral('br={')
// eslint-disable-next-line no-new-func
const br = new Function(`return (${brObj})`)()

const crObj = extractObjectLiteral('Cr={')
// eslint-disable-next-line no-new-func
const Cr = new Function(`return (${crObj})`)()

const Sr = ['操作过程', '产品', '店内环境', '服务过程', '空镜', '门头', '人物']

const out = `/* Auto-extracted from app.asar v1.0.2 */
import type { MixTemplate, TemplateCategoryMap } from '@/types/mix'

export const MIX_TEMPLATES: Record<string, MixTemplate> = ${JSON.stringify(br, null, 2)}

export const TEMPLATE_CATEGORY_MAP: TemplateCategoryMap = ${JSON.stringify(Cr, null, 2)}

export const DEFAULT_ASSET_CATEGORIES: string[] = ${JSON.stringify(Sr, null, 2)}

export const CUSTOM_TEMPLATE_TYPE = 'custom'

export function getTemplateInfo(type: string): MixTemplate | undefined {
  return MIX_TEMPLATES[type]
}

export function getTemplateName(type: string): string {
  if (type === CUSTOM_TEMPLATE_TYPE) return '自定义'
  return MIX_TEMPLATES[type]?.name || type
}
`

fs.writeFileSync(path.join(__dirname, '../src/constants/mixTemplates.ts'), out, 'utf8')
console.log('Templates:', Object.keys(br).length)
