<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { listFontFileOptions } from '@/utils/fontResolver'
import { useMixStore } from '@/stores/mix'

const visible = defineModel<boolean>('visible', { default: false })

const mixStore = useMixStore()
const { titleSettings, srtSettings, canvas } = storeToRefs(mixStore)

const activeTab = ref('title')
const fontOptions = ref<Array<{ label: string; file: string }>>([])

const titleText = computed({
  get: () => titleSettings.value.titles?.[0]?.text || '',
  set: (v: string) => {
    if (!titleSettings.value.titles?.length) titleSettings.value.titles = [{ text: '' }]
    titleSettings.value.titles[0].text = v
  },
})

const previewScale = computed(() => {
  const el = document.querySelector('.title-srt-dialog__preview-box') as HTMLElement | null
  const width = el?.clientWidth || 320
  return width / (canvas.value.width || 1080)
})

const titlePreviewStyle = computed(() => {
  const s = titleSettings.value
  const scale = previewScale.value
  const fontSize = Math.max(8, Number(s.font_size) || 48) * scale
  let left = Number(s.position_x) || 0
  const top = Number(s.position_y) || 0
  if (s.centered) left = (canvas.value.width * scale) / 2
  return {
    left: `${left * scale}px`,
    top: `${top * scale}px`,
    transform: s.centered ? 'translateX(-50%)' : 'none',
    fontSize: `${fontSize}px`,
    color: s.color || '#FCE897',
    WebkitTextStrokeWidth: `${Math.max(0, Number(s.stroke_width) || 0) * scale * 0.55}px`,
    WebkitTextStrokeColor: s.stroke_color || '#000',
    textShadow: `${(s.shadow_x || 0) * scale}px ${(s.shadow_y || 0) * scale}px 0 ${s.shadow_color || '#000'}`,
    fontWeight: '800',
    whiteSpace: 'nowrap' as const,
  }
})

const subtitlePreviewStyle = computed(() => {
  const s = srtSettings.value
  const scale = previewScale.value
  return {
    left: '50%',
    bottom: `${Math.max(20, Number(s.margin_v) || 350) * scale * 0.15}px`,
    transform: 'translateX(-50%)',
    fontSize: `${Math.max(8, Number(s.font_size) || 56) * scale}px`,
    color: s.color || '#fff',
    fontWeight: '800',
    whiteSpace: 'nowrap' as const,
  }
})

async function loadFonts() {
  fontOptions.value = await listFontFileOptions()
}

async function chooseFont(target: 'title' | 'subtitle') {
  const file = await window.electronAPI?.selectFile({ filters: [{ name: '字体', extensions: ['ttf', 'otf', 'ttc'] }] })
  if (!file) return
  fontOptions.value.push({ label: file.split(/[\\/]/).pop() || file, file })
  if (target === 'title') titleSettings.value.font_file = file
  else srtSettings.value.font_file = file
}

function save() {
  mixStore.save()
  ElMessage.success('样式已保存')
  visible.value = false
}

watch(visible, (open) => {
  if (open) void loadFonts()
})

onMounted(() => {
  void loadFonts()
})
</script>

<template>
  <el-dialog
    v-model="visible"
    title="顶部标题及字幕设置"
    width="920px"
    class="title-srt-dialog"
    destroy-on-close
  >
    <div class="title-srt-dialog__layout">
      <el-tabs v-model="activeTab" type="border-card">
        <el-tab-pane label="顶部标题" name="title">
          <div class="title-srt-dialog__tab-inner">
            <el-form label-width="100px" size="small">
              <el-form-item label="主标题">
                <el-input v-model="titleText" placeholder="顶部主标题" />
              </el-form-item>
              <el-form-item label="副标题">
                <el-input v-model="titleSettings.title2.text" placeholder="副标题（可选）" />
              </el-form-item>
              <el-form-item label="字体">
                <el-select v-model="titleSettings.font_file" filterable style="width: 100%">
                  <el-option
                    v-for="font in fontOptions"
                    :key="font.file"
                    :label="font.label"
                    :value="font.file"
                  />
                </el-select>
                <el-button text @click="chooseFont('title')">选择自有字体文件</el-button>
              </el-form-item>
              <div class="tsm-section__grid">
                <el-form-item label="字号">
                  <el-input-number v-model="titleSettings.font_size" :min="12" :max="200" />
                </el-form-item>
                <el-form-item label="居中">
                  <el-switch v-model="titleSettings.centered" />
                </el-form-item>
                <el-form-item label="颜色">
                  <el-color-picker v-model="titleSettings.color" />
                </el-form-item>
                <el-form-item label="描边宽">
                  <el-input-number v-model="titleSettings.stroke_width" :min="0" :max="20" />
                </el-form-item>
              </div>
            </el-form>
          </div>
        </el-tab-pane>

        <el-tab-pane label="字幕" name="subtitle">
          <div class="title-srt-dialog__tab-inner">
            <div class="title-srt-dialog__subtitle-head">
              <span class="title-srt-dialog__subtitle-title">口播字幕</span>
              <el-switch v-model="srtSettings.enableSubtitle" active-text="启用字幕" />
            </div>
            <el-form label-width="100px" size="small">
              <el-form-item label="字体">
                <el-select v-model="srtSettings.font_file" filterable style="width: 100%">
                  <el-option
                    v-for="font in fontOptions"
                    :key="font.file"
                    :label="font.label"
                    :value="font.file"
                  />
                </el-select>
                <el-button text @click="chooseFont('subtitle')">选择自有字体文件</el-button>
              </el-form-item>
              <div class="tsm-section__grid">
                <el-form-item label="字号">
                  <el-input-number v-model="srtSettings.font_size" :min="12" :max="120" />
                </el-form-item>
                <el-form-item label="底边距">
                  <el-input-number v-model="srtSettings.margin_v" :min="0" :max="800" />
                </el-form-item>
                <el-form-item label="颜色">
                  <el-color-picker v-model="srtSettings.color" />
                </el-form-item>
                <el-form-item label="描边">
                  <el-input-number v-model="srtSettings.outline_width" :min="0" :max="10" />
                </el-form-item>
              </div>
              <el-form-item label="动效">
                <el-select v-model="srtSettings.subtitle_effect" clearable style="width: 200px">
                  <el-option label="无" value="" />
                  <el-option label="弹出" value="fade_pop" />
                  <el-option label="滚动" value="scroll" />
                </el-select>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>

      <aside>
        <p class="title-srt-dialog__preview-label">画布预览</p>
        <div class="title-srt-dialog__preview-box">
          <div class="title-srt-dialog__preview-surface" />
          <div
            v-if="titleText.trim()"
            class="title-srt-dialog__preview-title"
            :style="titlePreviewStyle"
          >
            {{ titleText }}
          </div>
          <div
            v-if="srtSettings.enableSubtitle"
            class="title-srt-dialog__preview-subtitle"
            :style="subtitlePreviewStyle"
          >
            字幕样式预览
          </div>
          <span class="title-srt-dialog__preview-tip">拖拽位置请在高级版中微调</span>
        </div>
      </aside>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
