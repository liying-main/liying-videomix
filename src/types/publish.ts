export type PublishPlatform = 'douyin' | 'xiaohongshu' | 'shipinhao' | 'kuaishou'

export type PublishStatus = 'ok' | 'blocked' | 'restricted'
export type LinkStatus = 'connected' | 'reauth'
export type ReleasePhase = 'unscheduled' | 'scheduled' | 'published'
export type PublishTargetPhase = 'pending' | 'scheduled' | 'publishing' | 'published' | 'failed'

export interface PublishAccount {
  id: string
  name: string
  platform: PublishPlatform
  publishStatus: PublishStatus
  linkStatus: LinkStatus
  linkMessage?: string
  currentUrl?: string
  lastStatusCheckedAt?: number
  positioning: string
  defaultTimes: string
  copyStyle: string
  lastPost: string
  abnormalReason?: string
  userDataDir: string
}

export interface PublishTarget {
  accountId: string
  userDataDir: string
  phase: PublishTargetPhase
  scheduledAt?: number
  publishMessage?: string
  lastAttemptAt?: number
  nextRetryAt?: number
}

export interface ReleaseMeta {
  phase: ReleasePhase
  scheduledAt?: number
  title: string
  topics: string
  hasVoiceover?: boolean
  coverImage: string
  coverPath: string
  copySourceText: string
  outputUrl?: string
  templateType?: string
  templateName?: string
  publishTargets: PublishTarget[]
  publishMessage?: string
}

export const PLATFORM_LABELS: Record<PublishPlatform, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  shipinhao: '视频号',
  kuaishou: '快手',
}
