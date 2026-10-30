<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { FolderOpened, Plus, Refresh, Search } from '@element-plus/icons-vue'
import PageShell from '@/components/PageShell.vue'
import VideoFirstFrameThumb from '@/components/VideoFirstFrameThumb.vue'
import { useMixStore } from '@/stores/mix'
import { getAssetsRoot, setAssetsRoot } from '@/utils/assetsRootStorage'
import type { MixAssetsScanResult, MixCategoryScan } from '@/types/mix'

const mixStore = useMixStore()
const { mixAssetsScan } = storeToRefs(mixStore)

const assetsRoot = ref('')
const scanning = ref(false)
const creating = ref(false)
const scanError = ref('')
const scanView = ref<MixAssetsScanResult | null>(null)
const keyword = ref('')
const createDialogVisible = ref(false)
const newCategoryName = ref('')

const scanApiReady = typeof window !== 'undefined' && !!window.electronAPI?.scanMixRoot

const filteredCategories = computed(() => {
  const list = scanView.value?.categories ?? []
  const q = keyword.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (item) => item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q),
  )
})

const stats = computed(() => {
  const view = scanView.value
  if (!view) {
    return { folders: 0, clips: 0, lowCats: 0, unsupported: 0 }
  }
  const categories = view.categories ?? []
  return {
    folders: view.connectedFolders ?? categories.length,
    clips: view.totalClips ?? categories.reduce((sum, c) => sum + Number(c.clipCount || 0), 0),
    lowCats: categories.filter((c) => isLowCategory(c)).length,
    unsupported: Number(view.unsupportedFiles || 0),
  }
})

function isLowCategory(category: MixCategoryScan): boolean {
  return category.clipCount < 10
}

function hasUnsupported(category: MixCategoryScan): boolean {
  return Number(category.unsupportedFiles || 0) > 0
}

function unsupportedLabel(category: MixCategoryScan): string {
  const reasons = Array.isArray(category.unsupportedReasons) ? category.unsupportedReasons : []
  const hasNonVideo = reasons.includes('non_video')
  const hasHdr = reasons.includes('hdr_video')
  if (hasNonVideo && hasHdr) return '含图片或HDR视频'
  if (hasHdr) return '含HDR视频'
  return '含非视频文件'
}

function previewPaths(category: MixCategoryScan): Array<string | undefined> {
  const samples = category.sampleClipPaths ?? []
  return [0, 1, 2, 3].map((index) => samples[index])
}

function formatScannedAt(ts: number): string {
  const date = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function syncFromStore() {
  const root = assetsRoot.value.trim()
  if (!root) {
    scanView.value = null
    return
  }
  const cached = mixAssetsScan.value
  if (!cached || cached.root !== root) {
    scanView.value = null
    return
  }
  scanView.value = {
    ok: true,
    root: cached.root,
    scannedAt: cached.scannedAt,
    categories: cached.categories ?? [],
    totalClips: cached.totalClips,
    connectedFolders: cached.connectedFolders ?? cached.categories.length,
    unsupportedFiles:
      typeof cached.unsupportedFiles === 'number'
        ? cached.unsupportedFiles
        : cached.categories.reduce((sum, c) => sum + Number(c.unsupportedFiles || 0), 0),
  }
}

async function scanRoot(root = assetsRoot.value) {
  if (!window.electronAPI?.scanMixRoot) {
    scanError.value =
      '当前客户端未暴露素材扫描接口，请重新运行 pnpm run electron:dev 以加载最新 preload。'
    return
  }

  scanning.value = true
  scanError.value = ''
  try {
    const result = (await window.electronAPI.scanMixRoot(root)) as MixAssetsScanResult
    if (!result.ok) {
      scanView.value = null
      scanError.value = result.error || '扫描失败'
      return
    }

    scanView.value = result
    mixStore.setMixAssetsScan({
      root: result.root,
      categories: result.categories,
      scannedAt: result.scannedAt,
      totalClips: result.totalClips,
      connectedFolders: result.connectedFolders,
      unsupportedFiles: result.unsupportedFiles,
    })
  } catch (err) {
    scanView.value = null
    scanError.value = err instanceof Error ? err.message : '扫描失败'
  } finally {
    scanning.value = false
  }
}

async function pickRoot() {
  const selected = await window.electronAPI?.selectFolder?.()
  if (!selected) return
  assetsRoot.value = selected
  setAssetsRoot(selected)
  await scanRoot(selected)
}

async function rescan() {
  if (!assetsRoot.value) {
    ElMessage.warning('请先选择混剪素材根文件夹')
    return
  }
  await scanRoot(assetsRoot.value)
}

async function openCategory(targetPath: string) {
  const err = await window.electronAPI?.openPath?.(targetPath)
  if (err) ElMessage.warning(String(err))
}

async function createCategory() {
  const name = newCategoryName.value.trim()
  if (!name) {
    ElMessage.warning('请输入文件夹名称')
    return
  }
  if (!assetsRoot.value) {
    ElMessage.warning('请先选择混剪根目录')
    return
  }
  if (!window.electronAPI?.createMixCategoryFolder) {
    ElMessage.error('当前版本不支持在应用内新建文件夹')
    return
  }

  creating.value = true
  try {
    const result = (await window.electronAPI.createMixCategoryFolder(
      assetsRoot.value,
      name,
    )) as { ok: boolean; error?: string; name?: string }

    if (!result.ok) {
      ElMessage.error(result.error || '创建失败')
      return
    }

    ElMessage.success(`已创建文件夹「${result.name || name}」`)
    createDialogVisible.value = false
    newCategoryName.value = ''
    await scanRoot(assetsRoot.value)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '创建失败')
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  assetsRoot.value = getAssetsRoot() || ''
  syncFromStore()
})
</script>

<template>
  <PageShell title="素材中心">
    <div class="assets-center">
      <p class="assets-center__intro">
        素材中心管理的是<strong>本地可重复使用的素材文件夹</strong>：请指定混剪根目录（例如
        <code>D:\混剪素材</code>），页面会优先显示上次扫描结果；点击「重新扫描」后再统计该目录下的视频片段。
      </p>

      <el-alert
        v-if="!scanApiReady"
        class="assets-center__alert"
        type="warning"
        :closable="false"
        show-icon
        title="素材扫描接口未就绪"
        description="请完全退出后重新执行 pnpm run electron:dev，确保 electron/preload 已编译进最新版本。"
      />

      <div class="assets-center__toolbar">
        <div class="assets-center__path-row">
          <span class="assets-center__path-label">混剪根目录</span>
          <code class="assets-center__path-value">{{ assetsRoot || '未选择' }}</code>

          <el-button v-if="scanApiReady" type="primary" :loading="scanning" @click="pickRoot">
            <el-icon class="el-icon--left"><FolderOpened /></el-icon>
            选择文件夹
          </el-button>

          <el-button v-if="scanApiReady && assetsRoot" :loading="scanning" @click="rescan">
            <el-icon class="el-icon--left"><Refresh /></el-icon>
            重新扫描
          </el-button>

          <el-button
            v-if="scanApiReady && assetsRoot"
            :loading="creating"
            @click="createDialogVisible = true"
          >
            <el-icon class="el-icon--left"><Plus /></el-icon>
            新建文件夹
          </el-button>
        </div>

        <el-input
          v-model="keyword"
          class="assets-center__search"
          clearable
          placeholder="按类别名或路径搜索"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
      </div>

      <p v-if="scanError" class="assets-center__error">{{ scanError }}</p>

      <div class="assets-stats">
        <div class="assets-stats__item assets-stats__item--blue">
          <span class="assets-stats__value">{{ stats.folders }}</span>
          <span class="assets-stats__label">已接入文件夹</span>
        </div>
        <div class="assets-stats__item assets-stats__item--green">
          <span class="assets-stats__value">{{ stats.clips }}</span>
          <span class="assets-stats__label">可用片段总数</span>
        </div>
        <div class="assets-stats__item assets-stats__item--amber">
          <span class="assets-stats__value">{{ stats.unsupported }}</span>
          <span class="assets-stats__label">不支持的文件</span>
        </div>
        <div class="assets-stats__item assets-stats__item--red">
          <span class="assets-stats__value">{{ stats.lowCats }}</span>
          <span class="assets-stats__label">素材不足类别</span>
        </div>
      </div>

      <section v-if="scanView" class="assets-section">
        <div class="assets-section__head">
          <h3 class="assets-section__title">素材文件夹视图</h3>
          <span v-if="scanView.scannedAt" class="assets-section__meta">
            最近扫描：{{ formatScannedAt(scanView.scannedAt) }}
          </span>
        </div>

        <el-empty v-if="!filteredCategories.length" description="暂无分类文件夹，可新建或放入视频素材后重新扫描" />

        <div v-else class="assets-cards">
          <article v-for="item in filteredCategories" :key="item.path" class="assets-card">
            <header class="assets-card__head">
              <div class="assets-card__title-row">
                <h4 class="assets-card__title">{{ item.name }}</h4>

                <el-tooltip v-if="isLowCategory(item)" content="素材建议10个以上" placement="top">
                  <el-tag
                    type="warning"
                    size="small"
                    class="assets-card__warning-tag assets-card__material-warning-tag"
                  >
                    素材较少
                  </el-tag>
                </el-tooltip>

                <el-tag
                  v-if="hasUnsupported(item)"
                  type="danger"
                  size="small"
                  class="assets-card__warning-tag"
                >
                  {{ unsupportedLabel(item) }}
                </el-tag>
              </div>
              <p class="assets-card__path">{{ item.path }}</p>
            </header>

            <div class="assets-card__stats">
              <span>{{ item.clipCount }} 个片段</span>
              <span v-if="hasUnsupported(item)" class="assets-card__stats-danger">
                {{ item.unsupportedFiles }} 个不支持文件
              </span>
            </div>

            <div class="assets-card__previews" aria-hidden="true">
              <div v-for="(preview, index) in previewPaths(item)" :key="index" class="assets-card__thumb">
                <VideoFirstFrameThumb v-if="preview" :file-path="preview" />
              </div>
            </div>

            <footer class="assets-card__actions">
              <el-button text type="primary" @click="openCategory(item.path)">查看详情</el-button>
              <el-button text type="primary" @click="rescan">重新扫描</el-button>
            </footer>
          </article>
        </div>
      </section>
    </div>

    <el-dialog
      v-model="createDialogVisible"
      title="新建素材类别文件夹"
      width="440px"
      destroy-on-close
      @closed="newCategoryName = ''"
    >
      <p class="assets-center__dialog-hint">
        将在当前混剪根目录下创建<strong>一级子文件夹</strong>，名称不能与已有类别重复。创建后请重新扫描。
      </p>
      <el-input
        v-model="newCategoryName"
        placeholder="例如：产品展示"
        maxlength="80"
        show-word-limit
        @keyup.enter="createCategory"
      />
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createCategory">创建</el-button>
      </template>
    </el-dialog>
  </PageShell>
</template>

<style scoped>
@import '@/styles/assets.css';

.assets-card__head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
