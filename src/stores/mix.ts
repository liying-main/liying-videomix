import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { CUSTOM_TEMPLATE_TYPE, getTemplateName, MIX_TEMPLATES, TEMPLATE_CATEGORY_MAP } from '@/constants/mixTemplates'
import {
  DEFAULT_CANVAS,
  DEFAULT_EXPORT_BITRATE,
  DEFAULT_EXPORT_ENCODER,
} from '@/constants/canvasPresets'
import { DEFAULT_BAILIAN_REWRITE_INSTRUCTION } from '@/constants/prompts'
import type {
  BgMusicSettings,
  ClipSourceItem,
  FolderGroupItem,
  MixAssetsScan,
  MixTask,
  PersonaProfile,
  PersonaProfileFields,
  ShotItem,
  SrtSettings,
  TitleSettings,
} from '@/types/mix'
import { normalizeBgMusicSettings, normalizeTasksOnStartup } from '@/utils/mixStartup'

const STORAGE_KEY = 'videomix_settings'

const EMPTY_PROFILE: PersonaProfileFields = {
  nickname: '',
  birth: '',
  gender: '',
  hometown: '',
  storeName: '',
  industry: '',
  address: '',
  investment: '',
  duration: '',
  setback: '',
  trust: '',
  goal: '',
  audience: '',
  sellingPoint: '',
  promo: '',
}

const PROFILE_KEYS = Object.keys(EMPTY_PROFILE) as Array<keyof PersonaProfileFields>

function newProfileId(): string {
  return `persona_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function newTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeProfile(input?: Partial<PersonaProfileFields>): PersonaProfileFields {
  const result = { ...EMPTY_PROFILE }
  for (const key of PROFILE_KEYS) {
    result[key] = String(input?.[key] ?? '').trim()
  }
  return result
}

function createPersonaProfile(name = '默认人设', profile?: Partial<PersonaProfileFields>): PersonaProfile {
  const now = Date.now()
  return {
    id: newProfileId(),
    name: String(name || '').trim() || '默认人设',
    profile: normalizeProfile(profile),
    createdAt: now,
    updatedAt: now,
  }
}

function defaultSrtSettings(): SrtSettings {
  return {
    enableSubtitle: true,
    font_file: '',
    font_size: 56,
    margin_v: 350,
    color: '#FFFFFF',
    outline_width: 1,
    outline_color: '#000000',
    subtitle_effect: '',
  }
}

function defaultTitleSettings(): TitleSettings {
  return {
    titles: [{ text: '' }],
    timeStartSec: 0,
    timeEndSec: 0,
    font_file: '',
    font_size: 85,
    color: '#FCE897',
    centered: true,
    stroke_width: 1,
    stroke_color: '#000000',
    shadow_color: '#EE6A23',
    shadow_x: 2,
    shadow_y: 2,
    position_x: 540,
    position_y: 120,
    title2: { text: '', position_x: 540, position_y: 260 },
  }
}

function defaultBgMusic(): BgMusicSettings {
  return { enabled: false, folder: '', volume: 0.4, selectedTrack: '' }
}

function normalizeEncoder(value: unknown): 'libx264' | 'h264_nvenc' {
  return value === 'h264_nvenc' ? 'h264_nvenc' : 'libx264'
}

function loadPersisted(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function persistState(snapshot: Record<string, unknown>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* ignore */
  }
}

export const useMixStore = defineStore('mix', () => {
  const saved = loadPersisted()

  const templateType = ref(String(saved?.templateType || 'persona'))
  const customTemplateName = ref(String(saved?.customTemplateName || ''))
  const folderGroups = ref<FolderGroupItem[]>(
    Array.isArray(saved?.folderGroups) ? (saved!.folderGroups as FolderGroupItem[]) : [],
  )
  const tasks = ref<MixTask[]>(
    Array.isArray(saved?.tasks) ? normalizeTasksOnStartup(saved!.tasks as MixTask[]) : [],
  )
  const canvas = ref({ ...DEFAULT_CANVAS, ...((saved?.canvas as object) || {}) })
  const voiceoverEnabled = ref(saved?.voiceoverEnabled !== false)
  const voiceoverVolume = ref(Number(saved?.voiceoverVolume ?? 1))
  const voiceoverSpeed = ref(Number(saved?.voiceoverSpeed ?? 1))
  const minimaxApiKey = ref(String(saved?.minimaxApiKey || ''))
  const minimaxVoiceId = ref(String(saved?.minimaxVoiceId || ''))
  const bailianApiKey = ref(String(saved?.bailianApiKey || ''))
  const bailianRewriteInstruction = ref(
    String(saved?.bailianRewriteInstruction || DEFAULT_BAILIAN_REWRITE_INSTRUCTION),
  )
  const persona = ref(String(saved?.persona || ''))

  const personaProfiles = ref<PersonaProfile[]>(
    Array.isArray(saved?.personaProfiles) && saved!.personaProfiles.length
      ? (saved!.personaProfiles as PersonaProfile[])
      : [createPersonaProfile()],
  )
  const activePersonaProfileId = ref(
    String(saved?.activePersonaProfileId || personaProfiles.value[0]?.id || ''),
  )

  const srtSettings = ref<SrtSettings>({
    ...defaultSrtSettings(),
    ...((saved?.srtSettings as SrtSettings) || {}),
  })
  const titleSettings = ref<TitleSettings>({
    ...defaultTitleSettings(),
    ...((saved?.titleSettings as TitleSettings) || {}),
  })
  const bgMusic = ref<BgMusicSettings>(
    normalizeBgMusicSettings({
      ...defaultBgMusic(),
      ...((saved?.bgMusic as BgMusicSettings) || {}),
    }),
  )
  const exportEncoder = ref<'libx264' | 'h264_nvenc'>(
    normalizeEncoder(saved?.exportEncoder || DEFAULT_EXPORT_ENCODER),
  )
  const exportVideoBitrate = ref(String(saved?.exportVideoBitrate || DEFAULT_EXPORT_BITRATE))
  const exportOutputDir = ref(String(saved?.exportOutputDir || ''))
  const exportOutputDirAttentionSignal = ref(Number(saved?.exportOutputDirAttentionSignal || 0))
  const workDir = ref(String(saved?.workDir || ''))
  const mixAssetsScan = ref<MixAssetsScan | null>(
    (saved?.mixAssetsScan as MixAssetsScan | null) || null,
  )

  const activePersonaProfile = computed(
    () =>
      personaProfiles.value.find((p) => p.id === activePersonaProfileId.value) ??
      personaProfiles.value[0] ??
      createPersonaProfile(),
  )
  const personaProfile = computed(() => activePersonaProfile.value.profile)
  const personaProfileOptions = computed(() =>
    personaProfiles.value.map((p) => ({ label: p.name, value: p.id })),
  )
  const readyTasks = computed(() => tasks.value.filter((t) => t.status === 'ready'))
  const doneTasks = computed(() => tasks.value.filter((t) => t.status === 'done'))
  const errorTasks = computed(() => tasks.value.filter((t) => t.status === 'error'))

  function buildPersonaTextFromProfile(
    profile: PersonaProfileFields,
    profileName = '',
  ): string {
    const lines: string[] = []
    const add = (label: string, value: string) => {
      const v = String(value || '').trim()
      if (v) lines.push(`${label}：${v}`)
    }
    add('账号档案名称', profileName)
    add('别人怎么称呼你', profile.nickname)
    add('出生年份', profile.birth)
    add('性别', profile.gender)
    add('哪里人', profile.hometown)
    add('门店或品牌名称', profile.storeName)
    add('行业或主营业务', profile.industry)
    add('门店地址或商圈', profile.address)
    add('投了多少钱干了什么事', profile.investment)
    add('做了多少年', profile.duration)
    add('遇到过什么挫折怎么解决的', profile.setback)
    add('我为什么值得信赖', profile.trust)
    add('目标或者期望', profile.goal)
    add('目标客群', profile.audience)
    add('特色卖点', profile.sellingPoint)
    add('产品介绍和价格', profile.promo)
    return lines.join('\n')
  }

  function buildActivePersonaText(): string {
    const active = activePersonaProfile.value
    return buildPersonaTextFromProfile(active.profile, active.name)
  }

  function syncActivePersona(): void {
    const active = activePersonaProfile.value
    persona.value = buildPersonaTextFromProfile(active.profile, active.name)
    active.updatedAt = Date.now()
    save()
  }

  function selectPersonaProfile(id: string): void {
    if (personaProfiles.value.some((p) => p.id === id)) {
      activePersonaProfileId.value = id
      syncActivePersona()
    }
  }

  function addPersonaProfile(name?: string): PersonaProfile {
    const profile = createPersonaProfile(name || `人设档案 ${personaProfiles.value.length + 1}`)
    personaProfiles.value.push(profile)
    activePersonaProfileId.value = profile.id
    syncActivePersona()
    return profile
  }

  function removePersonaProfile(id: string): PersonaProfile | null {
    const target = personaProfiles.value.find((p) => p.id === id)
    if (!target) return null
    personaProfiles.value = personaProfiles.value.filter((p) => p.id !== id)
    if (personaProfiles.value.length === 0) {
      personaProfiles.value = [createPersonaProfile()]
    }
    if (!personaProfiles.value.some((p) => p.id === activePersonaProfileId.value)) {
      activePersonaProfileId.value = personaProfiles.value[0]?.id || ''
    }
    syncActivePersona()
    return target
  }

  function renamePersonaProfile(id: string, name: string): void {
    const target = personaProfiles.value.find((p) => p.id === id)
    if (!target) return
    target.name = String(name || '').trim() || '未命名人设'
    target.updatedAt = Date.now()
    if (target.id === activePersonaProfileId.value) syncActivePersona()
    else save()
  }

  function clearActivePersonaProfile(): void {
    const active = activePersonaProfile.value
    active.profile = normalizeProfile({})
    active.updatedAt = Date.now()
    syncActivePersona()
  }

  function setPersonaProfiles(profiles: PersonaProfile[], activeId?: string): void {
    personaProfiles.value = profiles.length ? profiles : [createPersonaProfile()]
    activePersonaProfileId.value =
      personaProfiles.value.find((p) => p.id === activeId)?.id ||
      personaProfiles.value[0]?.id ||
      ''
    syncActivePersona()
  }

  function setMixAssetsScan(scan: MixAssetsScan | null): void {
    mixAssetsScan.value = scan
    save()
  }

  function createEmptyTask(): MixTask {
    const shots: ShotItem[] = folderGroups.value.map((group) => ({
      folder: group.folder,
      scriptOriginal: String(group.scriptOriginal || group.script || '').trim(),
      scriptRewritten: String(group.scriptRewritten || '').trim(),
      audioUrl: '',
      baseDurationSec: group.durationSec || 0,
      durationSec: group.durationSec || 0,
      muteOriginal: !!group.muteOriginal,
      status: 'pending',
      selectedFileIndex: 0,
    }))

    const type = templateType.value
    const templateName =
      type === CUSTOM_TEMPLATE_TYPE
        ? customTemplateName.value || '自定义模板'
        : getTemplateName(type)

    const clipSourcesPerShot: ClipSourceItem[] = folderGroups.value.map((group) => {
      const files = group.files || []
      const file = files[0]
      if (!file?.url) return { url: '', name: '' }
      return { url: file.url, name: file.name || 'video.mp4' }
    })

    return {
      id: newTaskId(),
      status: 'pending',
      shots,
      clipSourcesPerShot,
      selectionIndices: folderGroups.value.map(() => 0),
      outputUrl: '',
      errorMessage: '',
      createdAt: Date.now(),
      templateType: type,
      templateName,
      srtSettingsSnapshot: JSON.parse(JSON.stringify(srtSettings.value)),
      titleSettingsSnapshot: JSON.parse(JSON.stringify(titleSettings.value)),
      canvasSnapshot: { ...canvas.value },
      exportEncoderSnapshot: exportEncoder.value,
      exportVideoBitrateSnapshot: exportVideoBitrate.value,
      bgMusicSnapshot: JSON.parse(JSON.stringify(bgMusic.value)),
      voiceoverEnabledSnapshot: voiceoverEnabled.value,
      minimaxApiKeySnapshot: minimaxApiKey.value,
      minimaxVoiceIdSnapshot: minimaxVoiceId.value,
      voiceoverVolumeSnapshot: voiceoverVolume.value,
      voiceoverSpeedSnapshot: voiceoverSpeed.value,
    }
  }

  function addTask(task: MixTask): void {
    tasks.value.push(task)
    save()
  }

  function removeTask(id: string): void {
    const index = tasks.value.findIndex((t) => t.id === id)
    if (index >= 0) tasks.value.splice(index, 1)
    save()
  }

  function clearDoneTasks(): void {
    tasks.value = tasks.value.filter((t) => t.status !== 'done')
    save()
  }

  function updateTask(id: string, patch: Partial<MixTask>): void {
    const task = tasks.value.find((t) => t.id === id)
    if (task) Object.assign(task, patch)
    save()
  }

  function notifyExportOutputDirRequired(): void {
    exportOutputDirAttentionSignal.value += 1
  }

  function clearTitleSubtitleText(): void {
    const settings = titleSettings.value
    settings.titles = [{ text: '' }]
    if (settings.title2) settings.title2.text = ''
    else settings.title2 = { text: '', position_x: 540, position_y: 260 }
    save()
  }

  function applyCustomTemplate(): void {
    templateType.value = CUSTOM_TEMPLATE_TYPE
    customTemplateName.value = '自定义'
    folderGroups.value = [
      {
        folder: '镜头1',
        files: [],
        muteOriginal: true,
        durationSec: 0,
        script: '',
        scriptOriginal: '',
        scriptRewritten: '',
        sentenceLabel: '镜头1',
      },
    ]
    clearTitleSubtitleText()
    save()
  }

  function applyTemplate(type: string, options?: { clearTitle?: boolean }): void {
    templateType.value = type
    if (type === CUSTOM_TEMPLATE_TYPE) {
      applyCustomTemplate()
      return
    }

    const info = MIX_TEMPLATES[type]
    if (!info) {
      save()
      return
    }

    const categories = TEMPLATE_CATEGORY_MAP[type] || []
    folderGroups.value = info.shots.map((shot, index) => ({
      folder: '',
      assetCategory: categories[index] || '',
      script: shot.defaultScript,
      scriptOriginal: shot.defaultScript,
      scriptRewritten: '',
      durationSec: 0,
      muteOriginal: false,
      files: [],
      sentenceLabel: shot.label || `镜头${shot.index || index + 1}`,
    }))

    if (options?.clearTitle !== false) clearTitleSubtitleText()
    else save()
  }

  function save(): void {
    persistState({
      templateType: templateType.value,
      customTemplateName: customTemplateName.value,
      folderGroups: folderGroups.value,
      tasks: tasks.value,
      canvas: canvas.value,
      voiceoverEnabled: voiceoverEnabled.value,
      voiceoverVolume: voiceoverVolume.value,
      voiceoverSpeed: voiceoverSpeed.value,
      minimaxApiKey: minimaxApiKey.value,
      minimaxVoiceId: minimaxVoiceId.value,
      bailianApiKey: bailianApiKey.value,
      bailianRewriteInstruction: bailianRewriteInstruction.value,
      persona: persona.value,
      personaProfiles: personaProfiles.value,
      activePersonaProfileId: activePersonaProfileId.value,
      srtSettings: srtSettings.value,
      titleSettings: titleSettings.value,
      bgMusic: bgMusic.value,
      exportEncoder: exportEncoder.value,
      exportVideoBitrate: exportVideoBitrate.value,
      exportOutputDir: exportOutputDir.value,
      exportOutputDirAttentionSignal: exportOutputDirAttentionSignal.value,
      workDir: workDir.value,
      mixAssetsScan: mixAssetsScan.value,
    })
  }

  if (!persona.value) syncActivePersona()
  else save()

  return {
    templateType,
    customTemplateName,
    folderGroups,
    tasks,
    canvas,
    voiceoverEnabled,
    voiceoverVolume,
    voiceoverSpeed,
    minimaxApiKey,
    minimaxVoiceId,
    bailianApiKey,
    bailianRewriteInstruction,
    persona,
    personaProfiles,
    activePersonaProfileId,
    activePersonaProfile,
    personaProfile,
    personaProfileOptions,
    srtSettings,
    titleSettings,
    bgMusic,
    exportEncoder,
    exportVideoBitrate,
    exportOutputDir,
    exportOutputDirAttentionSignal,
    workDir,
    mixAssetsScan,
    readyTasks,
    doneTasks,
    errorTasks,
    setMixAssetsScan,
    buildPersonaTextFromProfile,
    buildActivePersonaText,
    syncActivePersona,
    selectPersonaProfile,
    addPersonaProfile,
    removePersonaProfile,
    renamePersonaProfile,
    clearActivePersonaProfile,
    setPersonaProfiles,
    createEmptyTask,
    addTask,
    removeTask,
    clearDoneTasks,
    updateTask,
    notifyExportOutputDirRequired,
    applyTemplate,
    applyCustomTemplate,
    clearTitleSubtitleText,
    save,
  }
})
