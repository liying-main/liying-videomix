<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import PageShell from '@/components/PageShell.vue'
import { useMixStore } from '@/stores/mix'
import type { PersonaProfileFields } from '@/types/mix'

const mixStore = useMixStore()
const {
  personaProfile,
  personaProfiles,
  activePersonaProfile,
  activePersonaProfileId,
} = storeToRefs(mixStore)

const fields: Array<{
  key: keyof PersonaProfileFields
  label: string
  placeholder: string
  type?: 'textarea'
  rows?: number
}> = [
  { key: 'nickname', label: '（别人怎么称呼你）', placeholder: '大家都叫我红姐' },
  { key: 'birth', label: '（出生年份）', placeholder: '八四年出生（八四年大写，不要写84）' },
  { key: 'gender', label: '（性别）', placeholder: '女' },
  { key: 'hometown', label: '（哪里人）', placeholder: '江苏南京人' },
  { key: 'storeName', label: '（门店或品牌名称）', placeholder: '红姐鸭血粉丝汤' },
  { key: 'industry', label: '（行业或主营业务）', placeholder: '餐饮 / 鸭血粉丝汤 / 本地门店' },
  { key: 'address', label: '（门店地址或商圈）', placeholder: '南京秦淮区夫子庙附近' },
  {
    key: 'investment',
    label: '（投了多少钱干了什么事）',
    placeholder: '花了20万在南京开了家鸭血粉丝汤',
    type: 'textarea',
    rows: 2,
  },
  { key: 'duration', label: '（做了多少年）', placeholder: '5年' },
  {
    key: 'setback',
    label: '（遇到过什么挫折怎么解决的）',
    placeholder: '2018年盲目扩张什么都想做，结果亏了100万，现在专注做好鸭血粉丝汤这一件事，靠这一口地道口味积累了口碑',
    type: 'textarea',
    rows: 2,
  },
  {
    key: 'trust',
    label: '（我为什么值得信赖）',
    placeholder: '5年专注做鸭血粉丝汤，秉承顾客至上，真材实料的理念，踏实做事',
    type: 'textarea',
    rows: 2,
  },
  {
    key: 'goal',
    label: '（目标或者期望）',
    placeholder: '让每一个顾客吃上一碗地道的南京鸭血粉丝汤',
    type: 'textarea',
    rows: 2,
  },
  {
    key: 'audience',
    label: '（目标客群）',
    placeholder: '南京本地上班族、附近居民、喜欢老味道的人',
    type: 'textarea',
    rows: 2,
  },
  {
    key: 'sellingPoint',
    label: '（特色卖点）',
    placeholder: '汤底每天现熬、鸭血新鲜、粉丝劲道、老南京口味',
    type: 'textarea',
    rows: 2,
  },
  {
    key: 'promo',
    label: '（产品介绍和价格）',
    placeholder: '18元，鸭血粉丝汤',
    type: 'textarea',
    rows: 2,
  },
]

const previewText = computed(() => mixStore.buildActivePersonaText())

function countFilled(profile: PersonaProfileFields): number {
  return Object.values(profile).filter((v) => String(v || '').trim()).length
}

function onInput() {
  mixStore.syncActivePersona()
}

function onBlurName() {
  mixStore.renamePersonaProfile(activePersonaProfile.value.id, activePersonaProfile.value.name)
}

async function onCreateProfile() {
  try {
    const { value } = await ElMessageBox.prompt('请输入账号档案名称', '新建账号档案', {
      confirmButtonText: '新建',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：红姐南京店',
      inputValidator: (v) => (String(v || '').trim() ? true : '档案名称不能为空'),
    })
    mixStore.addPersonaProfile(String(value || '').trim())
    ElMessage.success('已新建账号档案')
  } catch {
    /* cancelled */
  }
}

async function onDeleteProfile() {
  const profile = activePersonaProfile.value
  try {
    await ElMessageBox.confirm(`确定删除“${profile.name}”吗？`, '删除账号档案', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    mixStore.removePersonaProfile(profile.id)
    ElMessage.success('已删除账号档案')
  } catch {
    /* cancelled */
  }
}

onMounted(() => {
  mixStore.syncActivePersona()
})
</script>

<template>
  <PageShell title="账号档案">
    <div class="account-page">
      <aside class="account-page__profiles" aria-label="账号档案列表">
        <div class="account-page__profiles-head">
          <div>
            <h3 class="account-page__profiles-title">账号档案</h3>
            <p class="account-page__profiles-subtitle">共 {{ personaProfiles.length }} 个</p>
          </div>
          <el-button type="primary" size="small" :icon="Plus" @click="onCreateProfile">
            新建
          </el-button>
        </div>
        <button
          v-for="profile in personaProfiles"
          :key="profile.id"
          type="button"
          class="account-page__profile-item"
          :class="{ 'account-page__profile-item--active': profile.id === activePersonaProfileId }"
          @click="mixStore.selectPersonaProfile(profile.id)"
        >
          <span class="account-page__profile-name">{{ profile.name }}</span>
          <span class="account-page__profile-meta">{{ countFilled(profile.profile) }} 项信息</span>
        </button>
      </aside>

      <section class="account-page__editor" aria-label="账号档案编辑">
        <div class="account-page__head">
          <div>
            <span class="account-page__title">人设信息填写</span>
            <p class="account-page__hint">用于镜头剪辑页一键改写文案时的“人设/口吻”参考。</p>
          </div>
          <div class="account-page__head-actions">
            <el-button size="small" @click="mixStore.clearActivePersonaProfile()">清空内容</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" @click="onDeleteProfile">
              删除档案
            </el-button>
          </div>
        </div>

        <div class="account-page__name-row">
          <div class="account-page__field account-page__field--name">
            <div class="account-page__label">档案名称</div>
            <el-input
              v-model="activePersonaProfile.name"
              placeholder="例如：红姐南京店"
              @input="onInput"
              @blur="onBlurName"
            />
          </div>
        </div>

        <p class="account-page__hint vm-intro-banner">
          可以为不同门店、账号、老板人设建立独立档案，镜头剪辑页改写时可直接选择。
        </p>

        <div class="account-page__form">
          <div
            v-for="field in fields"
            :key="field.key"
            class="account-page__field"
            :class="{ 'account-page__field--wide': field.type === 'textarea' }"
          >
            <div class="account-page__label">{{ field.label }}</div>
            <el-input
              v-model="personaProfile[field.key]"
              :type="field.type"
              :rows="field.rows"
              :placeholder="field.placeholder"
              @input="onInput"
            />
          </div>
        </div>

        <div class="account-page__preview">
          <div class="account-page__preview-title">当前改写参考</div>
          <pre class="account-page__preview-text">{{ previewText || '暂无人设信息' }}</pre>
        </div>
      </section>
    </div>
  </PageShell>
</template>

<style scoped>
@import '@/styles/account.css';
</style>
