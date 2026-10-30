export interface PersonaProfileFields {
  nickname: string
  birth: string
  gender: string
  hometown: string
  storeName: string
  industry: string
  address: string
  investment: string
  duration: string
  setback: string
  trust: string
  goal: string
  audience: string
  sellingPoint: string
  promo: string
}

export interface PersonaProfile {
  id: string
  name: string
  profile: PersonaProfileFields
  createdAt: number
  updatedAt: number
}

export interface CanvasSettings {
  width: number
  height: number
  fps: number
  color: string
}

export interface SrtSettings {
  enableSubtitle: boolean
  font_file: string
  font_size: number
  margin_v: number
  color: string
  outline_width: number
  outline_color: string
  subtitle_effect: string
}

export interface TitleLine {
  text: string
}

export interface TitleSettings {
  titles: TitleLine[]
  timeStartSec: number
  timeEndSec: number
  font_file: string
  font_size: number
  color: string
  centered: boolean
  stroke_width: number
  stroke_color: string
  shadow_color: string
  shadow_x: number
  shadow_y: number
  position_x: number
  position_y: number
  title2: {
    text: string
    position_x: number
    position_y: number
  }
}

export interface BgMusicSettings {
  enabled: boolean
  folder: string
  volume: number
  selectedTrack: string
}

export interface MediaClipFile {
  url: string
  name: string
}

export interface ClipSourceItem {
  url: string
  name?: string
}

export interface FolderGroupItem {
  folder: string
  assetCategory?: string
  script?: string
  scriptOriginal?: string
  scriptRewritten?: string
  durationSec?: number
  muteOriginal?: boolean
  files?: MediaClipFile[]
  sentenceLabel?: string
  selectedFileIndex?: number
}

export interface FolderGroup {
  folder: string
  label?: string
}

export interface ShotItem {
  folder: string
  scriptOriginal: string
  scriptRewritten: string
  audioUrl: string
  baseDurationSec: number
  durationSec: number
  muteOriginal: boolean
  status: 'pending' | 'ready' | 'error'
  selectedFileIndex: number
}

export type MixTaskStatus = 'pending' | 'ready' | 'queued' | 'rendering' | 'done' | 'error'
export type MixTaskRenderPhase = 'tts' | 'submitting' | 'polling'

export interface MixTask {
  id: string
  status: MixTaskStatus
  shots: ShotItem[]
  clipSourcesPerShot?: ClipSourceItem[]
  selectionIndices: number[]
  outputUrl: string
  errorMessage: string
  createdAt: number
  templateType: string
  templateName: string
  srtSettingsSnapshot?: SrtSettings
  titleSettingsSnapshot?: TitleSettings
  canvasSnapshot?: CanvasSettings
  exportEncoderSnapshot?: string
  exportVideoBitrateSnapshot?: string
  bgMusicSnapshot?: BgMusicSettings
  voiceoverEnabledSnapshot?: boolean
  minimaxApiKeySnapshot?: string
  minimaxVoiceIdSnapshot?: string
  voiceoverVolumeSnapshot?: number
  voiceoverSpeedSnapshot?: number
  renderPhase?: MixTaskRenderPhase
  renderMessage?: string
}

export interface MixCategoryScan {
  name: string
  path: string
  clipCount: number
  folderCount?: number
  sampleClipPaths?: string[]
  unsupportedFiles?: number
  unsupportedReasons?: string[]
  hdrCount?: number
  unsupportedCount?: number
}

export interface MixAssetsScan {
  root: string
  categories: MixCategoryScan[]
  totalClips: number
  connectedFolders?: number
  unsupportedFiles?: number
  hdrClips?: number
  scannedAt: number
}

export interface MixAssetsScanResult extends MixAssetsScan {
  ok: boolean
  error?: string
}

export interface MixTemplateShot {
  index: number
  defaultScript: string
  label?: string
  role?: string
}

export interface MixTemplate {
  name: string
  description: string
  previewVideoUrl: string
  shots: MixTemplateShot[]
}

export type TemplateCategoryMap = Record<string, string[]>
