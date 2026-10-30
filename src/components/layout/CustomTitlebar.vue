<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const isMaximized = ref(false)

async function refreshMaximized() {
  try {
    isMaximized.value = (await window.electronAPI?.windowIsMaximized?.()) ?? false
  } catch {
    isMaximized.value = false
  }
}

function minimize() {
  void window.electronAPI?.minimizeWindow?.()
}

function maximize() {
  void window.electronAPI?.maximizeWindow?.()
  void refreshMaximized()
}

function closeWindow() {
  void window.electronAPI?.closeWindow?.()
}

function reload() {
  void window.electronAPI?.windowReload?.()
}

onMounted(() => {
  void refreshMaximized()
})

onUnmounted(() => {
  /* no-op */
})
</script>

<template>
  <div class="custom-titlebar">
    <div class="titlebar-drag-region" />
    <div class="titlebar-controls">
      <button type="button" class="titlebar-button" title="刷新" @click="reload">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M23 4v6h-6" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>
      <button type="button" class="titlebar-button" title="最小化" @click="minimize">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M2 6h8v1H2z" /></svg>
      </button>
      <button type="button" class="titlebar-button" :title="isMaximized ? '还原' : '最大化'" @click="maximize">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path fill="none" stroke="currentColor" d="M2.5 2.5h7v7h-7z" />
        </svg>
      </button>
      <button type="button" class="titlebar-button close-button" title="关闭" @click="closeWindow">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path fill="currentColor" d="M6.707 6l2.647 2.646-.708.708L6 6.707l-2.646 2.647-.708-.708L5.293 6 2.646 3.354l.708-.708L6 5.293l2.646-2.647.708.708z" />
        </svg>
      </button>
    </div>
  </div>
</template>
