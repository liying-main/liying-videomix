import { computed, ref, watch, type Ref } from 'vue'
import { getMiniMaxVoices } from '@/api/minimax'
import {
  appendManualVoiceIds,
  loadManualVoiceIds,
  mergeMiniMaxVoiceCatalog,
  pickDefaultVoiceId,
  type MiniMaxVoiceOption,
} from '@/utils/minimaxManualVoicesStorage'

export function useMiniMaxVoiceOptions(
  minimaxApiKey: Ref<string>,
  minimaxVoiceId: Ref<string>,
  options?: { autoSelectDefault?: Ref<boolean>; onPersist?: () => void },
) {
  const voiceOptions = ref<MiniMaxVoiceOption[]>([])
  const voiceLoading = ref(false)
  const voiceLoadError = ref('')

  const hasMiniMaxKey = computed(() => !!minimaxApiKey.value.trim())

  function mergeVoiceOptions(catalog: unknown): MiniMaxVoiceOption[] {
    return appendManualVoiceIds(mergeMiniMaxVoiceCatalog(catalog), loadManualVoiceIds())
  }

  function ensureDefaultVoice(): void {
    if (options?.autoSelectDefault && !options.autoSelectDefault.value) return
    const current = minimaxVoiceId.value.trim()
    if (current && voiceOptions.value.some((item) => item.id === current)) return
    const defaultId = pickDefaultVoiceId(voiceOptions.value)
    if (!defaultId) return
    minimaxVoiceId.value = defaultId
    options?.onPersist?.()
  }

  async function loadVoiceOptions(): Promise<void> {
    if (!hasMiniMaxKey.value) {
      voiceOptions.value = mergeVoiceOptions(null)
      voiceLoadError.value = ''
      ensureDefaultVoice()
      return
    }

    voiceLoading.value = true
    voiceLoadError.value = ''
    try {
      const data = await getMiniMaxVoices(minimaxApiKey.value.trim())
      voiceOptions.value = mergeVoiceOptions(data)
      if (!voiceOptions.value.length) {
        voiceLoadError.value = '未获取到音色列表（请检查 Key 权限或网络）'
      }
      ensureDefaultVoice()
    } catch (err) {
      console.warn('getMiniMaxVoices:', err)
      voiceLoadError.value =
        err instanceof Error ? err.message : '获取 MiniMax 音色列表失败'
      voiceOptions.value = mergeVoiceOptions(null)
      ensureDefaultVoice()
    } finally {
      voiceLoading.value = false
    }
  }

  function onVoiceSelectVisible(open: boolean): void {
    if (!open) return
    voiceOptions.value = appendManualVoiceIds(voiceOptions.value, loadManualVoiceIds())
    if (!voiceOptions.value.length && hasMiniMaxKey.value) {
      void loadVoiceOptions()
    }
  }

  watch(
    minimaxApiKey,
    () => {
      voiceOptions.value = []
      voiceLoadError.value = ''
      if (hasMiniMaxKey.value) void loadVoiceOptions()
      else {
        voiceOptions.value = mergeVoiceOptions(null)
        ensureDefaultVoice()
      }
    },
    { immediate: true },
  )

  return {
    voiceOptions,
    voiceLoading,
    voiceLoadError,
    hasMiniMaxKey,
    loadVoiceOptions,
    onVoiceSelectVisible,
  }
}
