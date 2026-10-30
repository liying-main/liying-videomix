<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string }>()
</script>

<template>
  <div class="page-shell">
    <header v-if="title || subtitle" class="page-shell__head">
      <div class="page-shell__head-main">
        <h1 v-if="title" class="page-shell__title">{{ title }}</h1>
        <p v-if="subtitle" class="page-shell__subtitle">{{ subtitle }}</p>
      </div>
    </header>
    <div class="page-shell__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.page-shell {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
}

.page-shell__head {
  margin-bottom: 18px;
}

.page-shell__head-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px 14px;
}

.page-shell__title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--qt-text);
}

.page-shell__subtitle {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--qt-primary-2);
}

.page-shell__body {
  min-height: 0;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}
</style>
