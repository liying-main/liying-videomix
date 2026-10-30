import { CUSTOM_TEMPLATE_TYPE, MIX_TEMPLATES } from '@/constants/mixTemplates'

export const TEMPLATE_GROUP_KEYS = ['persona', 'attract', 'deal', 'custom'] as const
export type TemplateGroupKey = (typeof TEMPLATE_GROUP_KEYS)[number]

export interface TemplateGroupMeta {
  key: TemplateGroupKey
  title: string
  blurb: string
}

export const TEMPLATE_GROUP_META: TemplateGroupMeta[] = [
  { key: 'persona', title: '人设型模板', blurb: '门店人设、同城信任、口播背书类结构。' },
  { key: 'attract', title: '流量型模板', blurb: '泛流量、痛点共鸣、完播与停留优化。' },
  { key: 'deal', title: '成交型模板', blurb: '团购活动、限时福利、到店转化。' },
  { key: 'custom', title: '自定义模板', blurb: '自行配置镜头文件夹与文案行，结构不受限。' },
]

export const TEMPLATE_GROUP_LABELS: Record<TemplateGroupKey, string> = {
  persona: '人设型',
  attract: '流量型',
  deal: '成交型',
  custom: '自定义',
}

export const TEMPLATES_BY_GROUP: Record<TemplateGroupKey, string[]> = {
  persona: ['persona'],
  attract: ['attract', 'attract_nanjing_dream_1', 'attract_real_day_1', 'attract_inner_truth_1'],
  deal: ['deal', 'deal_group_buy_1', 'deal_hotpot_story_1'],
  custom: [CUSTOM_TEMPLATE_TYPE],
}

export interface SubTemplateOption {
  key: string
  name: string
  description: string
  shotCount: number | null
  categoryTag: string
}

export function isTemplateGroupKey(value: string): value is TemplateGroupKey {
  return (TEMPLATE_GROUP_KEYS as readonly string[]).includes(value)
}

export function getTemplateGroup(templateType: string): TemplateGroupKey | null {
  if (isTemplateGroupKey(templateType)) return templateType
  for (const group of TEMPLATE_GROUP_KEYS) {
    if (TEMPLATES_BY_GROUP[group].includes(templateType)) return group
  }
  return null
}

export function getDefaultTemplateForGroup(group: TemplateGroupKey): string {
  return TEMPLATES_BY_GROUP[group][0] || group
}

export function listSubTemplates(group: TemplateGroupKey): SubTemplateOption[] {
  const categoryTag = TEMPLATE_GROUP_LABELS[group]
  if (group === 'custom') {
    return [
      {
        key: CUSTOM_TEMPLATE_TYPE,
        name: '自定义',
        description: '自行配置镜头文件夹与文案，结构不受固定模板限制。',
        shotCount: null,
        categoryTag,
      },
    ]
  }
  return TEMPLATES_BY_GROUP[group]
    .map((key) => {
      const info = MIX_TEMPLATES[key]
      if (!info) return null
      return {
        key,
        name: info.name,
        description: info.description,
        shotCount: info.shots.length,
        categoryTag,
      }
    })
    .filter(Boolean) as SubTemplateOption[]
}
