<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { CUSTOM_TEMPLATE_TYPE } from '@/constants/mixTemplates'
import {
  getDefaultTemplateForGroup,
  getTemplateGroup,
  listSubTemplates,
  TEMPLATE_GROUP_META,
  type TemplateGroupKey,
} from '@/constants/templateGroups'
import { useMixStore } from '@/stores/mix'

interface CustomTemplateItem {
  id: string
  name: string
}

const mixStore = useMixStore()
const { templateType, customTemplateName } = storeToRefs(mixStore)

const activeGroup = ref<TemplateGroupKey>('persona')
const customTemplates = ref<CustomTemplateItem[]>([])
const loadingCustom = ref(false)

const subTemplates = computed(() => listSubTemplates(activeGroup.value))

watch(
  templateType,
  (type) => {
    const group = getTemplateGroup(type)
    if (group) activeGroup.value = group
  },
  { immediate: true },
)

async function loadCustomTemplates() {
  const api = window.electronAPI
  if (!api?.listMixCustomTemplates) return
  loadingCustom.value = true
  try {
    const result = (await api.listMixCustomTemplates()) as CustomTemplateItem[]
    customTemplates.value = Array.isArray(result) ? result : []
  } catch {
    customTemplates.value = []
  } finally {
    loadingCustom.value = false
  }
}

function selectGroup(group: TemplateGroupKey) {
  activeGroup.value = group
  if (group === 'custom') {
    mixStore.applyCustomTemplate()
    return
  }
  mixStore.applyTemplate(getDefaultTemplateForGroup(group))
}

function selectSubTemplate(key: string) {
  if (key === CUSTOM_TEMPLATE_TYPE) {
    mixStore.applyCustomTemplate()
    return
  }
  mixStore.applyTemplate(key)
}

async function saveCurrentAsCustom() {
  const api = window.electronAPI
  if (!api?.saveMixCustomTemplate) {
    ElMessage.warning('当前环境不支持保存自定义模板')
    return
  }
  try {
    const { value } = await ElMessageBox.prompt('请输入自定义模板名称', '保存模板', {
      inputValue: customTemplateName.value || '我的模板',
    })
    const name = String(value || '').trim()
    if (!name) return
    await api.saveMixCustomTemplate(name, {
      templateType: templateType.value,
      folderGroups: mixStore.folderGroups,
      titleSettings: mixStore.titleSettings,
      srtSettings: mixStore.srtSettings,
    })
    customTemplateName.value = name
    mixStore.save()
    await loadCustomTemplates()
    ElMessage.success('模板已保存')
  } catch {
    /* cancelled */
  }
}

async function loadCustomTemplate(item: CustomTemplateItem) {
  const api = window.electronAPI
  if (!api?.getMixCustomTemplate) return
  try {
    const payload = (await api.getMixCustomTemplate(item.id)) as {
      folderGroups?: unknown
      titleSettings?: unknown
      srtSettings?: unknown
    }
    templateType.value = CUSTOM_TEMPLATE_TYPE
    customTemplateName.value = item.name
    if (Array.isArray(payload?.folderGroups)) {
      mixStore.folderGroups = payload.folderGroups as typeof mixStore.folderGroups
    }
    if (payload?.titleSettings) {
      mixStore.titleSettings = {
        ...mixStore.titleSettings,
        ...(payload.titleSettings as object),
      }
    }
    if (payload?.srtSettings) {
      mixStore.srtSettings = { ...mixStore.srtSettings, ...(payload.srtSettings as object) }
    }
    mixStore.save()
    ElMessage.success(`已加载模板「${item.name}」`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  }
}

async function deleteCustomTemplate(item: CustomTemplateItem) {
  const api = window.electronAPI
  if (!api?.deleteMixCustomTemplate) return
  try {
    await ElMessageBox.confirm(`确定删除自定义模板「${item.name}」？`, '删除模板', {
      type: 'warning',
    })
    await api.deleteMixCustomTemplate(item.id)
    await loadCustomTemplates()
    ElMessage.success('已删除')
  } catch {
    /* cancelled */
  }
}

onMounted(() => {
  void loadCustomTemplates()
})
</script>

<template>
  <div class="shot-tpl-panel">
    <div class="shot-tpl-panel__head">
      <div class="shot-tpl-panel__titles">
        <h3 class="shot-tpl-panel__title">模板库</h3>
        <p class="shot-tpl-panel__subtitle">选择大类与子模板，自动映射素材分类</p>
      </div>
    </div>

    <div class="shot-tpl-panel__categories" role="tablist" aria-label="模板大类">
      <button
        v-for="group in TEMPLATE_GROUP_META"
        :key="group.key"
        type="button"
        class="shot-tpl-panel__cat"
        :class="{
          'shot-tpl-panel__cat--active': activeGroup === group.key,
          'shot-tpl-panel__cat--custom': group.key === 'custom',
        }"
        @click="selectGroup(group.key)"
      >
        {{ group.title }}
      </button>
    </div>

    <div class="shot-tpl-panel__subs-wrap">
      <ul class="shot-tpl-panel__subs" aria-label="子模板列表">
        <li v-for="item in subTemplates" :key="item.key">
          <button
            type="button"
            class="shot-tpl-panel__sub-card"
            :class="{ 'shot-tpl-panel__sub-card--active': templateType === item.key }"
            @click="selectSubTemplate(item.key)"
          >
            <div class="shot-tpl-panel__sub-head">
              <span class="shot-tpl-panel__sub-name">{{ item.name }}</span>
              <span
                class="shot-tpl-panel__sub-tag"
                :class="`shot-tpl-panel__sub-tag--${activeGroup}`"
              >
                {{ item.categoryTag }}
              </span>
            </div>
            <p v-if="item.shotCount != null" class="shot-tpl-panel__sub-meta">
              {{ item.shotCount }} 个镜头
            </p>
            <p class="shot-tpl-panel__sub-meta">{{ item.description }}</p>
          </button>
        </li>
      </ul>

      <div v-if="activeGroup === 'custom'" class="shot-tpl-panel__my-custom">
        <div class="shot-tpl-panel__my-custom-head">
          <span class="shot-tpl-panel__my-custom-title">我的自定义</span>
          <el-button size="small" type="primary" plain @click="saveCurrentAsCustom">
            保存当前
          </el-button>
        </div>
        <p v-if="loadingCustom" class="shot-tpl-panel__my-custom-tip">加载中…</p>
        <p v-else-if="!customTemplates.length" class="shot-tpl-panel__my-custom-tip">
          暂无已保存模板
        </p>
        <ul v-else class="shot-tpl-panel__subs">
          <li v-for="item in customTemplates" :key="item.id">
            <div class="shot-tpl-panel__sub-card">
              <div class="shot-tpl-panel__sub-head">
                <span class="shot-tpl-panel__sub-name">{{ item.name }}</span>
                <div class="shot-tpl-panel__sub-actions">
                  <el-button size="small" link type="primary" @click="loadCustomTemplate(item)">
                    加载
                  </el-button>
                  <el-button
                    size="small"
                    link
                    type="danger"
                    :icon="Delete"
                    @click="deleteCustomTemplate(item)"
                  />
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
