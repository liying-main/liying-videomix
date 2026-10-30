<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import PageShell from '@/components/PageShell.vue'
import ShotEditTemplatePanel from '@/components/videoMix/ShotEditTemplatePanel.vue'
import ShotCardList from '@/components/videoMix/ShotCardList.vue'
import ShotPreviewColumn from '@/components/videoMix/ShotPreviewColumn.vue'
import TitleSrtDialog from '@/components/videoMix/TitleSrtDialog.vue'
import { bailianChatCompletions, extractBailianContent } from '@/api/bailian'
import { miniMaxTextToAudio } from '@/api/minimax'
import { parseMiniMaxTtsResponse } from '@/services/minimaxTtsResult'
import { CUSTOM_TEMPLATE_TYPE } from '@/constants/mixTemplates'
import { DEFAULT_BAILIAN_REWRITE_INSTRUCTION } from '@/constants/prompts'
import { validateRewriteContent } from '@/utils/bailianRewriteValidate'
import {
  buildDeduplicatedSelectionIndices,
  clipItemName,
  mergeTemplateShotAssets,
  resolveClipItemUrl,
} from '@/services/videoMixAssets'
import { useMixStore } from '@/stores/mix'
import { useMiniMaxVoiceOptions } from '@/composables/useMiniMaxVoiceOptions'
import { validateAndListAudios } from '@/services/mixMediaFiles'
import '@/styles/video-mix.css'

const mixStore = useMixStore()
const {
  templateType,
  folderGroups,
  bailianApiKey,
  bailianRewriteInstruction,
  persona,
  personaProfileOptions,
  activePersonaProfileId,
  voiceoverEnabled,
  voiceoverVolume,
  voiceoverSpeed,
  minimaxApiKey,
  minimaxVoiceId,
  exportOutputDir,
  bgMusic,
} = storeToRefs(mixStore)

const rewriting = ref(false)
const creating = ref(false)
const rewriteStatus = ref('')
const titleDialogVisible = ref(false)
const voiceConfigExpanded = ref(false)
const bgmTracks = ref<Array<{ name: string; url: string }>>([])
const bgmLoading = ref(false)

const isCustomTemplate = computed(() => templateType.value === CUSTOM_TEMPLATE_TYPE)
const effectiveVoiceoverEnabled = computed(() =>
  isCustomTemplate.value ? voiceoverEnabled.value : true,
)

const {
  voiceOptions,
  voiceLoading,
  voiceLoadError,
  hasMiniMaxKey,
  onVoiceSelectVisible,
} = useMiniMaxVoiceOptions(minimaxApiKey, minimaxVoiceId, {
  autoSelectDefault: effectiveVoiceoverEnabled,
  onPersist: () => mixStore.save(),
})

function onVoiceChange() {
  mixStore.save()
}

async function ensureShotAssetsLoaded() {
  if (isCustomTemplate.value) return
  if (folderGroups.value.some((g) => !g.files?.length)) {
    folderGroups.value = await mergeTemplateShotAssets(templateType.value, folderGroups.value)
    mixStore.save()
  }
}

async function rewriteAll() {
  const apiKey = bailianApiKey.value.trim()
  if (!apiKey) {
    ElMessage.warning('请先在系统设置中填写百炼 API Key')
    return
  }

  const sentences = folderGroups.value.map((g) =>
    String(g.scriptOriginal || g.script || '').trim(),
  )
  if (!sentences.some(Boolean)) {
    ElMessage.warning('请先填写镜头文案')
    return
  }

  const expected = sentences.length
  const instruction = bailianRewriteInstruction.value.trim() || DEFAULT_BAILIAN_REWRITE_INSTRUCTION
  const buildPrompt = (strict: boolean) =>
    `${instruction}

人设信息：
${persona.value}

请改写以下 ${expected} 句文案，必须返回 JSON 数组，且恰好 ${expected} 个字符串元素。
${strict ? '上次结果行数不正确，请严格输出恰好 ' + expected + ' 句。' : ''}

原句：
${JSON.stringify(sentences)}

除了这个 JSON 数组以外不得输出任何文字`

  rewriting.value = true
  rewriteStatus.value = ''
  try {
    const runOnce = async (strict: boolean) => {
      const response = await bailianChatCompletions({
        apiKey,
        prompt: buildPrompt(strict),
      })
      return validateRewriteContent(extractBailianContent(response), expected)
    }

    let result = await runOnce(false)
    if (!result.exact) {
      rewriteStatus.value = '改写结果校验中，正在自动重试…'
      result = await runOnce(true)
    }
    if (!result.exact) {
      throw new Error(`改写结果行数异常：应返回 ${expected} 句，实际解析到 ${result.count} 句`)
    }

    folderGroups.value = folderGroups.value.map((group, index) => ({
      ...group,
      script: result.lines[index] ?? group.script ?? '',
      scriptRewritten: result.lines[index] ?? group.scriptRewritten ?? '',
      scriptOriginal: group.scriptOriginal || group.script || '',
    }))
    mixStore.save()
    ElMessage.success('已填入各镜头改写文案')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '改写失败')
  } finally {
    rewriting.value = false
    rewriteStatus.value = ''
  }
}

async function pickExportDir() {
  const selected = await window.electronAPI?.selectFolder?.()
  if (!selected) return
  exportOutputDir.value = selected
  mixStore.save()
  ElMessage.success('成片目录已更新')
}

async function pickBgmFolder() {
  const selected = await window.electronAPI?.selectFolder?.()
  if (!selected) return
  bgMusic.value.folder = selected
  await refreshBgmTracks()
  mixStore.save()
}

async function refreshBgmTracks() {
  const folder = bgMusic.value.folder.trim()
  if (!folder) {
    bgmTracks.value = []
    return
  }
  bgmLoading.value = true
  try {
    const result = await validateAndListAudios(folder)
    if (!result.ok) {
      ElMessage.warning(`文件夹含非音频文件：${result.invalidFiles.join('、')}`)
      bgmTracks.value = []
      return
    }
    bgmTracks.value = result.audios
  } finally {
    bgmLoading.value = false
  }
}

async function auditionVoice() {
  const apiKey = minimaxApiKey.value.trim()
  const voiceId = minimaxVoiceId.value.trim()
  if (!apiKey || !voiceId) {
    ElMessage.warning('请先在系统设置中配置 MiniMax API Key 与音色')
    return
  }
  const text =
    folderGroups.value
      .map((g) => String(g.script || g.scriptRewritten || g.scriptOriginal || '').trim())
      .find(Boolean) || '这是一段试听文案。'

  try {
    const response = await miniMaxTextToAudio(apiKey, { voiceId, text })
    const parsed = await parseMiniMaxTtsResponse(response)
    if (parsed?.url) {
      new Audio(parsed.url).play()
      return
    }
    ElMessage.warning('未返回可播放的音频')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '试听失败')
  }
}

async function createTask() {
  if (!folderGroups.value.length) {
    ElMessage.warning('请先添加镜头')
    return
  }

  creating.value = true
  try {
    await ensureShotAssetsLoaded()

    if (!folderGroups.value.every((g) => g.files && g.files.length > 0)) {
      if (!isCustomTemplate.value) {
        const missingCats = [
          ...new Set(
            folderGroups.value
              .filter((g) => !g.files?.length)
              .map((g) => String(g.assetCategory || '').trim())
              .filter(Boolean),
          ),
        ]
        if (missingCats.length) {
          ElMessage.warning(`以下素材分类没有可用视频：${missingCats.join('、')}`)
          return
        }
      }
      ElMessage.warning('请为每个镜头加载素材')
      return
    }

    if (!isCustomTemplate.value && folderGroups.value.some((g) => !String(g.script || '').trim())) {
      ElMessage.warning('请先进行文案改写')
      return
    }

    if (effectiveVoiceoverEnabled.value && !minimaxVoiceId.value.trim()) {
      ElMessage.warning('已开启智能配音，请先选择音色')
      return
    }

    const selectionIndices = buildDeduplicatedSelectionIndices(folderGroups.value)
    const task = mixStore.createEmptyTask()
    const clipSources: Array<{ url: string; name: string }> = []

    for (let i = 0; i < task.shots.length; i += 1) {
      const group = folderGroups.value[i]
      const files = group?.files || []
      const pick = Math.min(selectionIndices[i] ?? 0, Math.max(0, files.length - 1))
      selectionIndices[i] = pick
      const file = files[pick]
      const url = await resolveClipItemUrl(file)
      if (!url) {
        ElMessage.error(`镜头 ${i + 1} 素材无法解析，请检查文件后重试`)
        return
      }
      clipSources.push({ url, name: clipItemName(file) })

      task.shots[i].scriptRewritten =
        String(group?.script ?? '').trim() || String(group?.scriptOriginal ?? '').trim()
      task.shots[i].scriptOriginal = String(group?.scriptOriginal ?? '').trim()
      task.shots[i].selectedFileIndex = pick
      task.shots[i].muteOriginal = !!group?.muteOriginal
      task.shots[i].durationSec = Number(group?.durationSec) || 0
      task.shots[i].baseDurationSec = Number(group?.durationSec) || 0
      task.shots[i].folder = group?.folder || ''
      task.shots[i].status = 'ready'
      task.shots[i].audioUrl = ''
    }

    task.selectionIndices = selectionIndices
    task.clipSourcesPerShot = clipSources
    task.bgMusicSnapshot = { ...bgMusic.value }
    task.voiceoverEnabledSnapshot = isCustomTemplate.value
      ? voiceoverEnabled.value
      : true
    task.voiceoverVolumeSnapshot = mixStore.voiceoverVolume
    task.voiceoverSpeedSnapshot = mixStore.voiceoverSpeed
    task.minimaxApiKeySnapshot = minimaxApiKey.value.trim()
    task.minimaxVoiceIdSnapshot = minimaxVoiceId.value.trim()
    task.status = 'ready'

    mixStore.addTask(task)
    ElMessage.success('创建任务成功')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '创建任务失败')
  } finally {
    creating.value = false
  }
}

function onPersonaChange(id: string) {
  mixStore.selectPersonaProfile(id)
}

watch(
  templateType,
  async (type, prev) => {
    if (type === prev || type === CUSTOM_TEMPLATE_TYPE) return
    await ensureShotAssetsLoaded()
  },
)

onMounted(async () => {
  if (!folderGroups.value.length && templateType.value !== CUSTOM_TEMPLATE_TYPE) {
    mixStore.applyTemplate(templateType.value)
  }
  await ensureShotAssetsLoaded()
  if (bgMusic.value.folder) await refreshBgmTracks()
})
</script>

<template>
  <PageShell title="镜头剪辑">
    <div class="video-mix-page">
      <p class="video-mix-page__hint">
        选择模板 → 加载素材 → 百炼改写 → 配置标题字幕 → 创建任务前往任务中心合成
      </p>

      <div class="shot-edit-flow__body shot-edit-flow__body--wide">
        <div class="shot-edit-unified">
          <section class="shot-edit-unified__card shot-edit-unified__card--left">
            <ShotEditTemplatePanel />
          </section>

          <section class="shot-edit-unified__card shot-edit-unified__card--center">
            <div class="template-workspace" aria-label="模板创作区">
              <div class="template-workspace__top">
                <div class="template-workspace__persona-select">
                  <span class="template-workspace__persona-label">当前人设</span>
                  <el-select
                    :model-value="activePersonaProfileId"
                    style="width: 200px"
                    @change="onPersonaChange"
                  >
                    <el-option
                      v-for="opt in personaProfileOptions"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                  </el-select>
                </div>
                <div class="template-workspace__actions">
                  <el-button :loading="rewriting" @click="rewriteAll">百炼一键改写</el-button>
                  <el-button v-if="effectiveVoiceoverEnabled" @click="auditionVoice">配音试听</el-button>
                </div>
              </div>
              <p v-if="rewriteStatus" class="video-mix-page__hint">{{ rewriteStatus }}</p>
              <ShotCardList />
            </div>

            <div class="create-actions-card" role="group" aria-label="创建任务配置">
              <div class="create-actions-card__row">
                <span class="create-actions-card__label">成片目录</span>
                <div class="create-actions-card__content">
                  <el-input
                    :model-value="exportOutputDir"
                    readonly
                    placeholder="请设置成片输出目录"
                    class="create-actions-card__path"
                  />
                  <el-button @click="pickExportDir">选择目录</el-button>
                </div>
              </div>

              <div class="create-actions-card__row">
                <span class="create-actions-card__label">背景音乐</span>
                <div class="create-actions-card__content create-actions-card__bgm-block">
                  <div class="create-actions-card__bgm-line create-actions-card__bgm-line--switch">
                    <el-switch v-model="bgMusic.enabled" @change="mixStore.save()" />
                    <span class="create-actions-card__hint create-actions-card__hint--bgm-lead">
                      开启后使用下方文件夹中的音频；可选择固定曲目或随机一条
                    </span>
                  </div>
                  <div v-if="bgMusic.enabled" class="create-actions-card__bgm-line">
                    <el-input
                      v-model="bgMusic.folder"
                      readonly
                      placeholder="选择背景音乐文件夹"
                      class="create-actions-card__path"
                    />
                    <el-button :loading="bgmLoading" @click="pickBgmFolder">选择文件夹</el-button>
                  </div>
                  <div v-if="bgMusic.enabled && bgmTracks.length" class="create-actions-card__bgm-line">
                    <el-select
                      v-model="bgMusic.selectedTrack"
                      clearable
                      placeholder="随机"
                      class="create-actions-card__bgm-track"
                      @change="mixStore.save()"
                    >
                      <el-option label="随机" value="" />
                      <el-option
                        v-for="track in bgmTracks"
                        :key="track.url"
                        :label="track.name"
                        :value="track.name"
                      />
                    </el-select>
                    <el-slider
                      v-model="bgMusic.volume"
                      :min="0"
                      :max="1"
                      :step="0.05"
                      style="width: 160px"
                      @change="mixStore.save()"
                    />
                  </div>
                </div>
              </div>

              <div class="create-actions-card__row">
                <span class="create-actions-card__label">智能配音</span>
                <div class="create-actions-card__content create-actions-card__voice-line">
                  <template v-if="isCustomTemplate">
                    <el-switch v-model="voiceoverEnabled" @change="mixStore.save()" />
                    <span class="create-actions-card__hint">自定义模板可关闭配音</span>
                  </template>
                  <template v-else>
                    <el-tag type="success" effect="light">已开启</el-tag>
                    <span class="create-actions-card__hint">固定模板默认配音</span>
                  </template>
                  <template v-if="effectiveVoiceoverEnabled">
                    <div class="create-actions-card__spacer" />
                    <span class="create-actions-card__hint">音色</span>
                    <el-select
                      v-model="minimaxVoiceId"
                      :disabled="!hasMiniMaxKey"
                      :loading="voiceLoading"
                      filterable
                      clearable
                      placeholder="选择音色"
                      style="width: 260px"
                      @visible-change="onVoiceSelectVisible"
                      @change="onVoiceChange"
                    >
                      <el-option
                        v-for="voice in voiceOptions"
                        :key="voice.id"
                        :label="voice.name || voice.id"
                        :value="voice.id"
                      >
                        <div class="create-actions-card__voice-option">
                          <span class="create-actions-card__voice-name">{{ voice.name || voice.id }}</span>
                          <span class="create-actions-card__voice-id">{{ voice.id }}</span>
                        </div>
                      </el-option>
                    </el-select>
                    <span v-if="voiceLoadError" class="create-actions-card__hint create-actions-card__hint--error">
                      {{ voiceLoadError }}
                    </span>
                  </template>
                </div>
              </div>

              <div class="create-actions-card__row">
                <span class="create-actions-card__label">声音配置</span>
                <div class="create-actions-card__content">
                  <el-button
                    class="create-actions-card__title-btn"
                    @click="voiceConfigExpanded = !voiceConfigExpanded"
                  >
                    {{ voiceConfigExpanded ? '收起声音配置' : '声音配置' }}
                  </el-button>
                </div>
              </div>

              <div
                v-if="voiceConfigExpanded && effectiveVoiceoverEnabled"
                class="create-actions-card__row"
              >
                <span class="create-actions-card__label">语速</span>
                <div class="create-actions-card__content create-actions-card__slider-line">
                  <el-slider
                    v-model="voiceoverSpeed"
                    :min="0.5"
                    :max="2"
                    :step="0.1"
                    :show-tooltip="true"
                    style="width: 220px"
                    @change="mixStore.save()"
                  />
                  <span class="create-actions-card__slider-value">{{ voiceoverSpeed.toFixed(1) }}</span>
                </div>
              </div>

              <div v-if="voiceConfigExpanded" class="create-actions-card__row">
                <span class="create-actions-card__label">人声音量</span>
                <div class="create-actions-card__content create-actions-card__slider-line">
                  <el-slider
                    v-model="voiceoverVolume"
                    :min="0"
                    :max="3"
                    :step="0.1"
                    :show-tooltip="true"
                    style="width: 220px"
                    @change="mixStore.save()"
                  />
                  <span class="create-actions-card__slider-value">{{ voiceoverVolume.toFixed(1) }}</span>
                </div>
              </div>

              <div
                v-if="voiceConfigExpanded && bgMusic.enabled"
                class="create-actions-card__row"
              >
                <span class="create-actions-card__label">背景音乐音量</span>
                <div class="create-actions-card__content create-actions-card__slider-line">
                  <el-slider
                    v-model="bgMusic.volume"
                    :min="0"
                    :max="1"
                    :step="0.05"
                    :show-tooltip="true"
                    style="width: 220px"
                    @change="mixStore.save()"
                  />
                  <span class="create-actions-card__slider-value">{{ bgMusic.volume.toFixed(2) }}</span>
                </div>
              </div>

              <div class="create-actions-card__row">
                <span class="create-actions-card__label">标题/字幕</span>
                <div class="create-actions-card__content">
                  <el-button class="create-actions-card__title-btn" @click="titleDialogVisible = true">
                    顶部标题及字幕设置
                  </el-button>
                </div>
              </div>

              <div class="create-actions-card__row">
                <span class="create-actions-card__label">创建任务</span>
                <div class="create-actions-card__content">
                  <el-button type="primary" :loading="creating" @click="createTask">
                    创建任务
                  </el-button>
                </div>
              </div>
            </div>
          </section>

          <section class="shot-edit-unified__card shot-edit-unified__card--right">
            <ShotPreviewColumn />
          </section>
        </div>
      </div>

      <TitleSrtDialog v-model:visible="titleDialogVisible" />

      <div v-if="creating" class="global-loading-overlay">
        <div class="loading-content">
          <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          <p>正在创建任务…</p>
        </div>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.video-mix-page__hint {
  margin: 0 0 16px;
  font-size: 0.875rem;
  line-height: 1.65;
  color: var(--qt-text-2);
}

.template-workspace__top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.create-actions-card__voice-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.create-actions-card__spacer {
  width: 12px;
}

.create-actions-card__voice-option {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.create-actions-card__voice-name {
  font-size: 13px;
}

.create-actions-card__voice-id {
  font-size: 11px;
  color: var(--qt-text-2);
}

.create-actions-card__slider-line {
  display: flex;
  align-items: center;
  gap: 12px;
}

.create-actions-card__slider-value {
  min-width: 2.5rem;
  font-size: 13px;
  color: var(--qt-text-2);
}

.create-actions-card__hint--error {
  color: var(--el-color-warning);
}
</style>
