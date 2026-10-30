<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  cloneMiniMaxVoice,
  getMiniMaxVoices,
  isMiniMaxCloneSuccess,
  pickMiniMaxCloneDemoAudio,
  pickMiniMaxFileId,
  uploadMiniMaxVoiceFile,
} from '@/api/minimax'
import { STATION_HOME } from '@/shared/station'
import { readStationPreferences, saveStationPreferences } from '@/utils/stationPreferences'
import { CANVAS_PRESETS } from '@/constants/canvasPresets'
import { DEFAULT_BAILIAN_REWRITE_INSTRUCTION } from '@/constants/prompts'
import { useMixStore } from '@/stores/mix'
import {
  listSavedVoiceIds,
  removeManualVoiceId,
  saveManualVoiceId,
} from '@/utils/minimaxManualVoicesStorage'

const connection = ref(readStationPreferences())
function saveConnection() {
  try { connection.value = saveStationPreferences(connection.value); ElMessage.success('服务配置已保存，未发起收费请求') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)) }
}
const mixStore = useMixStore()
const {
  canvas,
  exportEncoder,
  exportVideoBitrate,
  minimaxApiKey,
  minimaxVoiceId,
  bailianApiKey,
  bailianRewriteInstruction,
} = storeToRefs(mixStore)

const presetLabel = ref('')
const rewriteCollapse = ref<string[]>([])
const voiceDialogVisible = ref(false)
const savedVoiceIds = ref<string[]>([])
const cloneAudioInputRef = ref<HTMLInputElement | null>(null)
const cloneAudioFile = ref<File | null>(null)
const cloneAudioDuration = ref(0)
const cloneVoiceId = ref('')
const clonePreviewText = ref(
  '大家好，欢迎使用厉影AI混剪智能体，祝您创作顺利，使用愉快。',
)
const cloneDemoAudio = ref('')
const cloneClonedVoiceId = ref('')
const cloning = ref(false)
const savingClone = ref(false)


/**
 * 开源版：文案改写与配音共用同一个中转站 Key，
 * 界面上只暴露一个输入框，内部同时写入两个字段（保持原有逻辑不变）。
 */
const stationKey = computed({
  get: () => minimaxApiKey.value || bailianApiKey.value,
  set: (value: string) => {
    minimaxApiKey.value = value
    bailianApiKey.value = value
  },
})
const canSubmitClone = computed(
  () =>

    !!cloneAudioFile.value &&
    !cloning.value,
)
const canSaveClone = computed(() => !!cloneClonedVoiceId.value.trim() && !savingClone.value)

function persist() {
  mixStore.save()
}

function syncPresetLabel() {
  const match = CANVAS_PRESETS.find(
    (item) => item.width === canvas.value.width && item.height === canvas.value.height,
  )
  if (match) {
    presetLabel.value = match.label
    return
  }
  const fallback = CANVAS_PRESETS.find((item) => item.width === 1080 && item.height === 1920)
  if (fallback) {
    presetLabel.value = fallback.label
    canvas.value = { ...canvas.value, width: fallback.width, height: fallback.height }
  }
}

function onPresetChange(label: string) {
  const preset = CANVAS_PRESETS.find((item) => item.label === label)
  if (!preset) return
  canvas.value = { ...canvas.value, width: preset.width, height: preset.height }
  persist()
}

function onCanvasFieldChange(field: 'fps', value: number) {
  canvas.value = { ...canvas.value, [field]: value }
  persist()
}

function refreshSavedVoices() {
  savedVoiceIds.value = listSavedVoiceIds()
}

function openVoiceDialog() {
  refreshSavedVoices()
  voiceDialogVisible.value = true
}

function resetCloneForm() {
  cloneDemoAudio.value = ''
  cloneClonedVoiceId.value = ''
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '未知时长'
  const minutes = Math.floor(seconds / 60)
  const remain = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes}分${String(remain).padStart(2, '0')}秒` : `${remain}秒`
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function probeAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const timer = window.setTimeout(() => {
      cleanup()
      resolve(0)
    }, 10_000)

    const cleanup = () => {
      window.clearTimeout(timer)
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
    }

    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      cleanup()
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    audio.onerror = () => {
      cleanup()
      resolve(0)
    }
    audio.src = url
  })
}

async function validateCloneAudio(file: File): Promise<number | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (!['wav', 'mp3', 'm4a'].includes(ext)) {
    ElMessage.warning('参考音频仅支持 wav、mp3、m4a')
    return null
  }
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.warning('参考音频不能超过 20MB')
    return null
  }
  const duration = await probeAudioDuration(file)
  if (duration <= 0) {
    ElMessage.warning('无法读取音频时长，请换一个音频文件')
    return null
  }
  if (duration < 10 || duration > 300) {
    ElMessage.warning('参考音频时长需在 10 秒到 5 分钟之间')
    return null
  }
  return duration
}

function pickCloneAudio() {
  cloneAudioInputRef.value?.click()
}

async function onCloneAudioChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  input.value = ''
  if (!file) return
  const duration = await validateCloneAudio(file)
  if (duration == null) return
  cloneAudioFile.value = file
  cloneAudioDuration.value = duration
  resetCloneForm()
}

async function removeSavedVoice(voiceId: string) {
  try {
    await ElMessageBox.confirm(
      `确认从软件音色列表删除「${voiceId}」吗？只移除本机记录。`,
      '删除音色',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  if (!removeManualVoiceId(voiceId)) {
    ElMessage.warning('该音色不在本地列表中')
    refreshSavedVoices()
    return
  }
  if (minimaxVoiceId.value === voiceId) {
    minimaxVoiceId.value = ''
    persist()
  }
  refreshSavedVoices()
  ElMessage.success('已从软件音色列表删除')
}

async function submitVoiceClone() {
  if (!canSubmitClone.value || !cloneAudioFile.value) return
  cloning.value = true
  resetCloneForm()
  try {
    const apiKey = minimaxApiKey.value.trim()
    const voiceId = cloneVoiceId.value.trim()
    const text = clonePreviewText.value.trim()
    const uploadResponse = await uploadMiniMaxVoiceFile(apiKey, cloneAudioFile.value)
    const fileId = pickMiniMaxFileId(uploadResponse)
    if (!fileId) throw new Error('保存失败，未返回本机文件地址')

    const cloneResponse = await cloneMiniMaxVoice(apiKey, { fileId, voiceId, text })
    if (!isMiniMaxCloneSuccess(cloneResponse)) {
      throw new Error('参考音频导入失败')
    }

    cloneClonedVoiceId.value = String(fileId)
    cloneDemoAudio.value = pickMiniMaxCloneDemoAudio(cloneResponse)
    ElMessage.success(cloneDemoAudio.value ? '参考音频已导入，可试听原音后保存' : '参考音频已导入，可保存到列表')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '参考音频导入失败')
  } finally {
    cloning.value = false
  }
}

async function saveClonedVoice() {
  if (!canSaveClone.value) return
  savingClone.value = true
  try {
    const voiceId = cloneClonedVoiceId.value.trim()
    const added = saveManualVoiceId(voiceId)
    minimaxVoiceId.value = voiceId
    persist()
    refreshSavedVoices()
    ElMessage.success(added ? '已保存到音色列表' : '该音色已在列表中，已设为当前音色')
  } finally {
    savingClone.value = false
  }
}

function restoreRewriteDefault() {
  bailianRewriteInstruction.value = DEFAULT_BAILIAN_REWRITE_INSTRUCTION
  persist()
  ElMessage.success('已恢复默认改写要求')
}

watch(
  () => [canvas.value.width, canvas.value.height],
  () => syncPresetLabel(),
)

watch(minimaxApiKey, async (key) => {
  if (!key.trim() || !voiceDialogVisible.value) return
  try {
    await getMiniMaxVoices(key.trim())
  } catch {
    /* ignore background refresh errors */
  }
})

onMounted(() => {
  syncPresetLabel()
  refreshSavedVoices()
})
</script>

<template>
  <div class="settings-panel">
    <el-card class="settings-card" shadow="never">
      <template #header>
        <span class="settings-card__title">剪辑设置</span>
      </template>
      <el-form label-width="100px" size="small">
        <el-form-item label="预设分辨率">
          <el-select
            v-model="presetLabel"
            placeholder="选择预设"
            style="width: 240px"
            @change="onPresetChange"
          >
            <el-option
              v-for="preset in CANVAS_PRESETS"
              :key="preset.label"
              :label="preset.label"
              :value="preset.label"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="帧率">
          <el-slider
            :model-value="canvas.fps"
            :min="15"
            :max="60"
            style="width: 260px"
            @update:model-value="(v: number | number[]) => onCanvasFieldChange('fps', Number(v))"
          />
        </el-form-item>
        <el-form-item label="编码器">
          <el-select v-model="exportEncoder" style="width: 200px" @change="persist">
            <el-option label="普通剪辑（CPU）" value="libx264" />
            <el-option label="快速剪辑（GPU）" value="h264_nvenc" />
          </el-select>
        </el-form-item>
        <el-form-item label="视频质量">
          <el-select v-model="exportVideoBitrate" style="width: 200px" @change="persist">
            <el-option label="低档（1M）" value="1M" />
            <el-option label="中档（3M）" value="3M" />
            <el-option label="高档（5M）" value="5M" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="settings-card" shadow="never">
      <template #header>
        <span class="settings-card__title">文案配音设置</span>
      </template>
      <el-form label-width="100px" size="small">
        <el-form-item label="API Key">
          <div class="settings-voice-key-row">
            <el-input
              v-model="stationKey"
              type="password"
              show-password
              class="settings-voice-input"
              placeholder="填写所选服务的 API Key"
              @change="persist"
            />
            <el-link
              type="primary"
              :href="STATION_HOME"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenAPI 控制台
            </el-link>
          </div>
          <div class="settings-station-hint">
            文案改写与配音都使用这个 Key。没有的话到
            <el-link
              type="primary"
              :href="STATION_HOME"
              target="_blank"
              rel="noopener noreferrer"
            >api.openapi.cn</el-link>
            注册后创建令牌，也可使用下方的兼容服务地址。软件免费；云端文案和配音按所选服务的额度与价格计费。OpenAPI 是项目方提供的可选服务。Key 仅保存在本机配置中。
          </div>
        </el-form-item>
        <el-form-item label="服务地址"><el-input v-model="connection.baseURL" placeholder="https://example.com/v1" /></el-form-item>
        <el-form-item label="文案模型"><el-input v-model="connection.chatModel" /></el-form-item>
        <el-form-item label="配音模型"><el-input v-model="connection.ttsModel" /></el-form-item>
        <el-form-item><el-button @click="saveConnection">保存服务配置</el-button><span class="settings-station-hint">文案需兼容 chat/completions；配音需兼容 audio/speech 与参考音频 voice。</span></el-form-item>
        <el-form-item label="音色管理">
          <div class="settings-clone-entry">
            <el-button type="primary" plain @click="openVoiceDialog">音色管理</el-button>
            <span class="settings-clone-entry__hint">
              导入自有参考音频；此步骤不调用云端服务。
            </span>
          </div>
        </el-form-item>
        <el-form-item label="当前音色">
          <el-input
            v-model="minimaxVoiceId"
            placeholder="voice_id"
            class="settings-voice-input"
            @change="persist"
          />
        </el-form-item>
      </el-form>
    </el-card>

    <el-collapse v-model="rewriteCollapse" class="settings-panel__collapse">
      <el-collapse-item name="rewrite-config">
        <template #title>
          <div class="settings-panel__collapse-title">
            <span class="settings-card__title">大模型改写配置</span>
            <span class="settings-panel__collapse-sub">
              只配置可调整的改写要求，底层规则由系统自动处理
            </span>
          </div>
        </template>
        <el-card class="settings-card settings-card--inner" shadow="never">
          <div class="settings-rewrite-config">
            <div class="settings-rewrite-config__head">
              <div class="settings-rewrite-config__hint">
                可填写语气、行业表达、禁用词等补充要求；行数、格式和变量规则不需要手动设置。
              </div>
              <el-button size="small" plain @click="restoreRewriteDefault">恢复默认</el-button>
            </div>
            <el-input
              v-model="bailianRewriteInstruction"
              type="textarea"
              :rows="5"
              resize="vertical"
              placeholder="例如：更像南京本地老板口播，真实、接地气，避免夸张承诺"
              @change="persist"
            />
          </div>
        </el-card>
      </el-collapse-item>
    </el-collapse>

    <el-dialog
      v-model="voiceDialogVisible"
      title="音色管理"
      width="640px"
      class="settings-clone-dialog"
      :close-on-click-modal="!cloning && !savingClone"
      destroy-on-close
    >
      <div class="settings-clone-voice">
        <div class="settings-clone-voice__section">
          <div class="settings-clone-voice__section-head">
            <div class="settings-clone-voice__label">我的音色</div>
            <span class="settings-clone-voice__count">共 {{ savedVoiceIds.length }} 个</span>
          </div>
          <div v-if="savedVoiceIds.length" class="settings-voice-list">
            <div v-for="voiceId in savedVoiceIds" :key="voiceId" class="settings-voice-list__item">
              <div class="settings-voice-list__name">{{ voiceId }}</div>
              <el-button type="danger" plain size="small" @click="removeSavedVoice(voiceId)">
                删除
              </el-button>
            </div>
          </div>
          <div v-else class="settings-voice-list__empty">暂无已保存音色，请在下方添加音色。</div>
        </div>

        <div class="settings-clone-voice__divider" />

        <input
          ref="cloneAudioInputRef"
          type="file"
          accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a"
          hidden
          @change="onCloneAudioChange"
        />

        <div class="settings-clone-voice__section">
          <div class="settings-clone-voice__label">参考音频</div>
          <div class="settings-clone-voice__row">
            <el-button plain @click="pickCloneAudio">选择参考音频</el-button>
            <span class="settings-clone-voice__file">
              <template v-if="cloneAudioFile">
                {{ cloneAudioFile.name }}（{{ formatFileSize(cloneAudioFile.size) }}，{{
                  formatDuration(cloneAudioDuration)
                }}）
              </template>
              <template v-else>支持 wav/mp3/m4a，10 秒到 5 分钟，20MB 内</template>
            </span>
          </div>
        </div>

        <div v-if="cloneDemoAudio" class="settings-clone-voice__section">
          <div class="settings-clone-voice__label">试听音频</div>
          <audio class="settings-clone-voice__audio" :src="cloneDemoAudio" controls />
        </div>

        <p class="settings-clone-voice__hint">
          导入会在本机保存参考音频，试听播放的是原音频；实际生成配音时才会将文本和参考音频发送到所选云端服务。
        </p>
      </div>

      <template #footer>
        <div class="settings-clone-dialog__footer">
          <el-button @click="voiceDialogVisible = false">关闭</el-button>
          <el-button type="primary" :loading="cloning" :disabled="!canSubmitClone" @click="submitVoiceClone">
            导入参考音频
          </el-button>
          <el-button
            v-if="cloneClonedVoiceId"
            type="success"
            plain
            :loading="savingClone"
            :disabled="!canSaveClone"
            @click="saveClonedVoice"
          >
            保存到音色列表
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
@import '@/styles/system-settings.css';
</style>
