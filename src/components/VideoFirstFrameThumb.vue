<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  filePath?: string
}>()

const thumbSrc = ref<string | null>(null)
const failed = ref(false)
let cancelled = false

function captureFirstFrame(videoUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.preload = 'auto'

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
      video.remove()
    }

    video.onerror = () => {
      cleanup()
      reject(new Error('video error'))
    }

    video.onloadedmetadata = () => {
      let seekTo = 0.1
      const duration = video.duration
      if (Number.isFinite(duration) && duration > 0) {
        seekTo = Math.min(0.1, Math.max(0, duration * 0.02))
        if (seekTo >= duration) seekTo = Math.max(0, duration - 0.05)
      }
      video.currentTime = seekTo
    }

    video.onseeked = () => {
      try {
        const width = video.videoWidth
        const height = video.videoHeight
        if (!width || !height) {
          cleanup()
          reject(new Error('no size'))
          return
        }

        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 280 / width)
        canvas.width = Math.round(width * scale)
        canvas.height = Math.round(height * scale)

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          cleanup()
          reject(new Error('no ctx'))
          return
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        cleanup()
        resolve(dataUrl)
      } catch (err) {
        cleanup()
        reject(err)
      }
    }

    video.src = videoUrl
  })
}

async function loadThumb() {
  thumbSrc.value = null
  failed.value = false

  const filePath = String(props.filePath || '').trim()
  if (!filePath || !window.electronAPI?.pathToFileUrl) {
    failed.value = true
    return
  }

  const fileUrl = await window.electronAPI.pathToFileUrl(filePath)
  if (!fileUrl) {
    failed.value = true
    return
  }

  cancelled = false
  try {
    const dataUrl = await captureFirstFrame(fileUrl)
    if (!cancelled) thumbSrc.value = dataUrl
  } catch {
    if (!cancelled) failed.value = true
  }
}

watch(
  () => props.filePath,
  () => {
    void loadThumb()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  cancelled = true
})
</script>

<template>
  <div class="video-first-frame-thumb">
    <img v-if="thumbSrc" :src="thumbSrc" alt="" class="video-first-frame-thumb__img" />
    <div v-else-if="failed" class="video-first-frame-thumb__fallback" aria-hidden="true" />
    <div v-else class="video-first-frame-thumb__loading" aria-hidden="true" />
  </div>
</template>

<style scoped>
.video-first-frame-thumb {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: inherit;
  background: rgba(91, 141, 239, 0.08);
}

.video-first-frame-thumb__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-first-frame-thumb__fallback,
.video-first-frame-thumb__loading {
  width: 100%;
  height: 100%;
  min-height: 72px;
  background: linear-gradient(145deg, rgba(91, 141, 239, 0.2), rgba(91, 141, 239, 0.05));
}

.video-first-frame-thumb__loading {
  animation: vm-thumb-pulse 1.2s ease-in-out infinite;
}

@keyframes vm-thumb-pulse {
  50% {
    opacity: 0.65;
  }
}
</style>
