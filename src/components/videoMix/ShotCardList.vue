<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ArrowLeft, ArrowRight, Plus, Refresh } from '@element-plus/icons-vue'
import VideoFirstFrameThumb from '@/components/VideoFirstFrameThumb.vue'
import { CUSTOM_TEMPLATE_TYPE } from '@/constants/mixTemplates'
import { mergeTemplateShotAssets, loadVideosForCategory } from '@/services/videoMixAssets'
import { useMixStore } from '@/stores/mix'
import type { FolderGroupItem } from '@/types/mix'

const mixStore = useMixStore()
const { folderGroups, templateType, mixAssetsScan } = storeToRefs(mixStore)

const reloading = ref(false)

const isCustom = computed(() => templateType.value === CUSTOM_TEMPLATE_TYPE)

const categoryOptions = computed(() =>
  (mixAssetsScan.value?.categories || []).map((item) => ({
    label: `${item.name}（${item.clipCount}）`,
    value: item.name,
    path: item.path,
  })),
)

function selectedFileIndex(group: FolderGroupItem): number {
  return Math.max(0, Number((group as { selectedFileIndex?: number }).selectedFileIndex) || 0)
}

function currentFile(group: FolderGroupItem) {
  const files = group.files || []
  const index = Math.min(selectedFileIndex(group), Math.max(0, files.length - 1))
  return files[index]
}

function localPathFromUrl(url: string): string {
  const trimmed = String(url || '').trim()
  if (!trimmed.startsWith('file://')) return trimmed
  try {
    const parsed = new URL(trimmed)
    let path = decodeURIComponent(parsed.pathname || '')
    if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1)
    return path
  } catch {
    return trimmed
  }
}

async function reloadAllAssets() {
  if (isCustom.value) return
  reloading.value = true
  try {
    folderGroups.value = await mergeTemplateShotAssets(templateType.value, folderGroups.value)
    mixStore.save()
  } finally {
    reloading.value = false
  }
}

async function onCategoryChange(index: number, categoryName: string) {
  const group = folderGroups.value[index]
  if (!group) return
  const option = categoryOptions.value.find((item) => item.value === categoryName)
  const files = await loadVideosForCategory(categoryName)
  folderGroups.value[index] = {
    ...group,
    assetCategory: categoryName,
    folder: option?.path || group.folder,
    files,
    selectedFileIndex: 0,
  } as FolderGroupItem
  mixStore.save()
}

function shiftFile(index: number, delta: number) {
  const group = folderGroups.value[index]
  const files = group?.files || []
  if (!files.length) return
  const current = selectedFileIndex(group)
  const next = (current + delta + files.length) % files.length
  folderGroups.value[index] = { ...group, selectedFileIndex: next } as FolderGroupItem
  mixStore.save()
}

function addCustomShot() {
  const n = folderGroups.value.length + 1
  folderGroups.value.push({
    folder: `镜头${n}`,
    files: [],
    muteOriginal: true,
    durationSec: 0,
    script: '',
    scriptOriginal: '',
    scriptRewritten: '',
    sentenceLabel: `镜头${n}`,
  })
  mixStore.save()
}

function removeCustomShot(index: number) {
  if (folderGroups.value.length <= 1) return
  folderGroups.value.splice(index, 1)
  mixStore.save()
}

function onFieldChange() {
  mixStore.save()
}
</script>

<template>
  <div class="shot-list">
    <div class="template-workspace__bar">
      <h3 class="template-workspace__title">镜头组（{{ folderGroups.length }}）</h3>
      <div class="template-workspace__actions">
        <el-button
          v-if="!isCustom"
          :icon="Refresh"
          :loading="reloading"
          @click="reloadAllAssets"
        >
          重新加载素材
        </el-button>
      </div>
    </div>

    <div class="shot-cards__scroll">
      <article v-for="(group, index) in folderGroups" :key="index" class="shot-card">
        <header class="shot-card__head">
          <span class="shot-card__title">
            {{ group.sentenceLabel || `镜头 ${index + 1}` }}
          </span>
        </header>

        <div class="shot-card__text-row">
          <div class="shot-card__field">
            <span class="shot-card__label">原始文案</span>
            <el-input
              v-model="group.scriptOriginal"
              type="textarea"
              :rows="2"
              class="shot-card__textarea shot-card__textarea--readonly"
              :readonly="!isCustom"
              @change="onFieldChange"
            />
          </div>
          <div class="shot-card__field">
            <span class="shot-card__label">改写文案</span>
            <el-input
              v-model="group.script"
              type="textarea"
              :rows="2"
              class="shot-card__textarea"
              placeholder="百炼改写后填入，或手动编辑"
              @change="onFieldChange"
            />
          </div>
        </div>

        <div class="shot-card__foot">
          <div class="shot-card__category">
            <template v-if="isCustom">
              <el-input
                v-model="group.folder"
                size="small"
                placeholder="素材分类或文件夹路径"
                class="shot-card__category-select"
                @change="onFieldChange"
              />
            </template>
            <template v-else>
              <span v-if="group.assetCategory" class="shot-card__category-readonly">
                {{ group.assetCategory }}
              </span>
              <el-select
                v-else
                :model-value="group.assetCategory || ''"
                size="small"
                class="shot-card__category-select"
                placeholder="选择素材分类"
                @change="(v: string) => onCategoryChange(index, v)"
              >
                <el-option
                  v-for="opt in categoryOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </template>
            <span class="shot-card__dur-hint">{{ group.files?.length || 0 }} 个可用片段</span>
          </div>

          <div class="shot-card__foot-row">
            <div v-if="currentFile(group)" class="shot-card__preview-thumb">
              <VideoFirstFrameThumb
                :file-path="localPathFromUrl(currentFile(group)?.url || '')"
              />
            </div>
            <div class="shot-card__foot-actions">
              <el-button
                size="small"
                :icon="ArrowLeft"
                :disabled="!(group.files?.length)"
                @click="shiftFile(index, -1)"
              />
              <el-button
                size="small"
                :icon="ArrowRight"
                :disabled="!(group.files?.length)"
                @click="shiftFile(index, 1)"
              />
              <span class="shot-card__toolbar-label">静音原声</span>
              <el-switch v-model="group.muteOriginal" size="small" @change="onFieldChange" />
            </div>
          </div>

          <div class="shot-card__duration">
            <span class="shot-card__label">镜头时长（秒，0=自动）</span>
            <el-input-number
              v-model="group.durationSec"
              :min="0"
              :step="0.5"
              size="small"
              class="shot-card__duration-input"
              @change="onFieldChange"
            />
          </div>
        </div>

        <div v-if="isCustom" class="shot-card__foot-row">
          <el-button type="danger" plain size="small" @click="removeCustomShot(index)">
            删除镜头
          </el-button>
        </div>
      </article>
    </div>

    <el-button
      v-if="isCustom"
      class="shot-list__add"
      type="primary"
      plain
      :icon="Plus"
      @click="addCustomShot"
    >
      添加镜头
    </el-button>
  </div>
</template>

<style scoped>
.shot-card__preview-thumb {
  width: 72px;
  height: 128px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}
</style>
