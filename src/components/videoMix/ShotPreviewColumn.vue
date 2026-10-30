<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { MIX_TEMPLATES } from '@/constants/mixTemplates'
import { useMixStore } from '@/stores/mix'

const mixStore = useMixStore()
const { templateType, folderGroups } = storeToRefs(mixStore)

const previewVideoUrl = computed(() => MIX_TEMPLATES[templateType.value]?.previewVideoUrl || '')

const captionText = computed(() => {
  const first = folderGroups.value[0]
  if (!first) return '预览文案将显示在这里'
  return (
    String(first.script || '').trim() ||
    String(first.scriptRewritten || '').trim() ||
    String(first.scriptOriginal || '').trim() ||
    '预览文案将显示在这里'
  )
})
</script>

<template>
  <div class="shot-preview-col">
    <h3 class="shot-preview-col__title">效果预览</h3>

    <div class="shot-preview-col__phone">
      <div class="shot-preview-col__phone-inner">
        <div class="shot-preview-col__media">
          <video
            v-if="previewVideoUrl"
            class="shot-preview-col__video"
            :src="previewVideoUrl"
            muted
            playsinline
            loop
            autoplay
          />
          <div v-else class="shot-preview-col__placeholder">
            <div class="shot-preview-col__placeholder-content">
              <span>9:16 竖屏预览</span>
              <span class="shot-preview-col__placeholder-sub">选择模板后可播放示例视频</span>
            </div>
          </div>
        </div>
        <p class="shot-preview-col__caption">{{ captionText }}</p>
      </div>
    </div>

    <div class="shot-preview-col__hint-card">
      <span class="shot-preview-col__hint-icon">i</span>
      <p class="shot-preview-col__hint-text">
        先选模板并加载素材，再使用百炼改写文案。创建任务后前往任务中心合成成片。
      </p>
    </div>
  </div>
</template>
