<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { DEFAULT_ASSET_CATEGORIES } from '@/constants/mixTemplates'
import { useMixStore } from '@/stores/mix'
import { usePublishAccountsStore } from '@/stores/publishAccounts'
import { setAssetsRoot } from '@/utils/assetsRootStorage'
import { markFirstDataRootDone } from '@/utils/firstDataRoot'
import { pathJoin } from '@/utils/pathJoin'

const emit = defineEmits<{ done: [] }>()

const visible = ref(true)
const loading = ref(false)
const mixStore = useMixStore()
const publishStore = usePublishAccountsStore()

async function onConfirm() {
  const api = window.electronAPI
  if (!api?.selectFolder) {
    ElMessage.error('当前环境无法选择文件夹')
    return
  }

  loading.value = true
  try {
    const root = await api.selectFolder()
    if (!root) return

    const assetsRoot = pathJoin(root, '混剪素材')
    const workDir = pathJoin(root, '工作缓存')
    const exportDir = pathJoin(root, '成片')

    await api.ensureDir(assetsRoot)
    for (const category of DEFAULT_ASSET_CATEGORIES) {
      await api.createMixCategoryFolder(assetsRoot, category)
    }
    await api.ensureDir(workDir)
    await api.ensureDir(exportDir)

    setAssetsRoot(assetsRoot)
    mixStore.workDir = workDir
    mixStore.exportOutputDir = exportDir
    mixStore.save()

    markFirstDataRootDone(root)
    await publishStore.ensureAutoBrowserProfileDirs()

    visible.value = false
    emit('done')
    ElMessage.success('数据目录已创建')
  } catch (err) {
    const message = err instanceof Error ? err.message : '创建目录失败'
    ElMessage.error(message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="first-data-root-dialog"
    title="首次使用：选择数据存放位置"
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
  >
    <p class="first-data-root-dialog__hint">
      请选择一个本地文件夹，程序将自动创建「混剪素材」「工作缓存」「成片」等子目录。
    </p>
    <ul class="first-data-root-dialog__list">
      <li><strong>混剪素材</strong> — 按分类存放镜头视频</li>
      <li><strong>工作缓存</strong> — TTS 音频、字幕等临时文件</li>
      <li><strong>成片</strong> — 合成完成的视频输出</li>
    </ul>
    <template #footer>
      <el-button type="primary" :loading="loading" @click="onConfirm">
        选择文件夹并创建
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.first-data-root-dialog__hint {
  margin: 0 0 12px;
  color: var(--vm-text-secondary, #6b7280);
  font-size: 14px;
  line-height: 1.6;
}

.first-data-root-dialog__list {
  margin: 0;
  padding-left: 18px;
  color: var(--vm-text, #1f2937);
  font-size: 13px;
  line-height: 1.8;
}
</style>
