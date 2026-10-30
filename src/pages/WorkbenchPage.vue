<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  CircleCheck,
  Loading,
  Warning,
  VideoCamera,
  FolderOpened,
  User,
  Headset,
  Share,
  Calendar,
  Setting,
  Grid,
} from '@element-plus/icons-vue'
import PageShell from '@/components/PageShell.vue'
import { BRAND } from '@/constants/channel'
import { getTemplateName } from '@/constants/mixTemplates'
import { useMixStore } from '@/stores/mix'
import { usePublishAccountsStore, platformLabel } from '@/stores/publishAccounts'
import { useReleaseScheduleStore } from '@/stores/releaseSchedule'
import { isTaskCancelled, mixTaskStatusLabel, mixTaskStatusType } from '@/services/mixTaskStatus'
import {
  isAccountChecking,
  isStartupDetectRunning,
  startupStatusText,
} from '@/services/publishAccountStatus'
import type { MixTask } from '@/types/mix'

const router = useRouter()
const mixStore = useMixStore()
const publishStore = usePublishAccountsStore()
const scheduleStore = useReleaseScheduleStore()

const { tasks } = storeToRefs(mixStore)
const { accounts } = storeToRefs(publishStore)
const { metaByTaskId } = storeToRefs(scheduleStore)

const recentTasks = computed(() =>
  [...tasks.value].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
)

const doneCount = computed(
  () => tasks.value.filter((t) => t.status === 'done' && t.outputUrl).length,
)
const renderingCount = computed(
  () => tasks.value.filter((t) => t.status === 'queued' || t.status === 'rendering').length,
)
const errorCount = computed(() => tasks.value.filter((t) => t.status === 'error' && !isTaskCancelled(t)).length)

const monthPublishedCount = computed(() => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  let count = 0
  for (const meta of Object.values(metaByTaskId.value)) {
    if (meta.phase !== 'published') continue
    const at = Number(meta.scheduledAt || 0)
    if (at >= start && at < end) count += 1
  }
  return count
})

const offlineAccounts = computed(() =>
  accounts.value.filter((a) => a.linkStatus !== 'connected'),
)

const checkingCount = computed(
  () => accounts.value.filter((account) => isAccountChecking(account.id)).length,
)

const lastCheckedAt = computed(() =>
  accounts.value.reduce((max, account) => Math.max(max, Number(account.lastStatusCheckedAt || 0)), 0),
)

const accountStatus = computed<'empty' | 'ok' | 'danger' | 'checking'>(() => {
  if (isStartupDetectRunning.value || checkingCount.value > 0) return 'checking'
  if (offlineAccounts.value.length > 0) return 'danger'
  if (accounts.value.length > 0) return 'ok'
  return 'empty'
})

const accountStatusTitle = computed(() => {
  if (accountStatus.value === 'checking') return '账号检测中'
  if (accountStatus.value === 'danger') return `${offlineAccounts.value.length} 个账号掉线`
  if (accountStatus.value === 'empty') return '暂无发布账号'
  return '账号状态正常'
})

const accountStatusDesc = computed(() => {
  if (accountStatus.value === 'checking') {
    return startupStatusText.value || `正在检测 ${checkingCount.value} 个账号`
  }
  if (accountStatus.value === 'danger') return '请到发布账号管理重新登录后再发布'
  if (accountStatus.value === 'empty') return '添加账号后会在这里显示登录检测结果'
  return `共 ${accounts.value.length} 个账号可用于发布`
})

const visibleOfflineAccounts = computed(() => offlineAccounts.value.slice(0, 3))
const hiddenOfflineCount = computed(() => Math.max(0, offlineAccounts.value.length - visibleOfflineAccounts.value.length))

const quickItems = [
  { name: 'Account', label: '账号档案', icon: User, color: 'violet' },
  { name: 'AssetsCenter', label: '素材中心', icon: FolderOpened, color: 'amber' },
  { name: 'VideoMix', label: '镜头剪辑', icon: VideoCamera, color: 'blue' },
  { name: 'BatchGeneration', label: '任务中心', icon: Headset, color: 'green' },
  { name: 'PublishAccounts', label: '发布账号管理', icon: Share, color: 'cyan' },
  { name: 'ReleaseSchedule', label: '发布排期', icon: Calendar, color: 'pink' },
  { name: 'SystemSettings', label: '系统设置', icon: Setting, color: 'gray' },
] as const

function go(name: string) {
  router.push({ name })
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function taskTitle(task: MixTask): string {
  return String(task.templateName || getTemplateName(task.templateType) || '混剪任务').trim() || '混剪任务'
}

function taskSubText(task: MixTask): string {
  if (task.status === 'error' && !isTaskCancelled(task)) {
    const msg = String(task.errorMessage || '合成失败').trim()
    return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg
  }
  if (task.status === 'rendering' && task.renderMessage) return task.renderMessage
  if (task.status === 'done' && task.outputUrl) return '成片已生成，可在任务中心预览'
  return ''
}
</script>

<template>
  <PageShell title="工作台" :subtitle="BRAND.productName">
    <div class="workbench-page">
      <section class="workbench-overview" aria-label="任务概览">
        <article class="workbench-stat workbench-stat--blue">
          <div class="workbench-stat__icon" aria-hidden="true">
            <el-icon :size="22"><CircleCheck /></el-icon>
          </div>
          <div class="workbench-stat__body">
            <span class="workbench-stat__value">{{ doneCount }}</span>
            <span class="workbench-stat__label">已生成视频</span>
          </div>
        </article>
        <article class="workbench-stat workbench-stat--green">
          <div class="workbench-stat__icon" aria-hidden="true">
            <el-icon :size="22"><Loading /></el-icon>
          </div>
          <div class="workbench-stat__body">
            <span class="workbench-stat__value">{{ renderingCount }}</span>
            <span class="workbench-stat__label">正在生成任务</span>
          </div>
        </article>
        <article class="workbench-stat workbench-stat--amber">
          <div class="workbench-stat__icon" aria-hidden="true">
            <el-icon :size="22"><Grid /></el-icon>
          </div>
          <div class="workbench-stat__body">
            <span class="workbench-stat__value">{{ monthPublishedCount }}</span>
            <span class="workbench-stat__label">本月已发布视频</span>
          </div>
        </article>
        <article class="workbench-stat workbench-stat--rose">
          <div class="workbench-stat__icon" aria-hidden="true">
            <el-icon :size="22"><Warning /></el-icon>
          </div>
          <div class="workbench-stat__body">
            <span class="workbench-stat__value">{{ errorCount }}</span>
            <span class="workbench-stat__label">异常任务</span>
          </div>
        </article>
      </section>

      <div class="workbench-layout">
        <div class="workbench-main">
          <section class="workbench-panel workbench-tasks" aria-labelledby="workbench-tasks-title">
            <div class="workbench-panel__head">
              <h2 id="workbench-tasks-title" class="workbench-panel__title">最近任务</h2>
              <a href="javascript:void(0)" class="workbench-panel__link" @click.prevent="go('BatchGeneration')">
                查看全部
              </a>
            </div>

            <div v-if="recentTasks.length" class="workbench-task-list-scroll">
              <ul class="workbench-task-list">
                <li v-for="task in recentTasks" :key="task.id" class="workbench-task">
                  <div class="workbench-task__thumb" aria-hidden="true" />
                  <div class="workbench-task__main">
                    <div class="workbench-task__title-row">
                      <span class="workbench-task__name">{{ taskTitle(task) }}</span>
                    </div>
                    <div class="workbench-task__tags">
                      <span class="workbench-tag">{{ task.shots.length }} 个镜头</span>
                    </div>
                    <p v-if="taskSubText(task)" class="workbench-task__sub">{{ taskSubText(task) }}</p>
                  </div>
                  <div class="workbench-task__meta">
                    <el-tag :type="mixTaskStatusType(task)" size="small" effect="light">
                      {{ mixTaskStatusLabel(task) }}
                    </el-tag>
                    <time class="workbench-task__time" :datetime="String(task.createdAt)">
                      创建于 {{ formatTime(task.createdAt) }}
                    </time>
                    <div class="workbench-task__links">
                      <a href="javascript:void(0)" class="workbench-link" @click.prevent="go('BatchGeneration')">
                        任务中心
                      </a>
                      <a href="javascript:void(0)" class="workbench-link" @click.prevent="go('VideoMix')">
                        镜头剪辑
                      </a>
                    </div>
                  </div>
                </li>
              </ul>
            </div>

            <div v-else class="workbench-tasks-empty">
              <p class="workbench-tasks-empty__text">暂无混剪任务</p>
              <p class="workbench-tasks-empty__hint">
                请先在镜头剪辑中配置模板与素材，创建任务后到任务中心合成。
              </p>
              <el-button type="primary" round @click="go('VideoMix')">去镜头剪辑</el-button>
            </div>
          </section>
        </div>

        <aside class="workbench-aside">
          <div class="workbench-quick">
            <h3 class="workbench-quick__title">快捷入口</h3>
            <div class="workbench-quick__grid">
              <button
                v-for="item in quickItems"
                :key="item.name"
                type="button"
                class="workbench-quick__item"
                @click="go(item.name)"
              >
                <span class="workbench-quick__icon" :class="`workbench-quick__icon--${item.color}`">
                  <el-icon :size="18"><component :is="item.icon" /></el-icon>
                </span>
                <span class="workbench-quick__label">{{ item.label }}</span>
              </button>
            </div>
          </div>

          <section
            class="workbench-account-status"
            :class="`workbench-account-status--${accountStatus === 'empty' ? 'ok' : accountStatus}`"
            aria-label="发布账号检测状态"
          >
            <div class="workbench-account-status__head">
              <span class="workbench-account-status__icon" aria-hidden="true">
                <el-icon v-if="accountStatus === 'checking'" class="is-loading" :size="18">
                  <Loading />
                </el-icon>
                <el-icon v-else-if="accountStatus === 'danger'" :size="18"><Warning /></el-icon>
                <el-icon v-else :size="18"><CircleCheck /></el-icon>
              </span>
              <div class="workbench-account-status__title-wrap">
                <h3 class="workbench-account-status__title">{{ accountStatusTitle }}</h3>
                <p class="workbench-account-status__desc">{{ accountStatusDesc }}</p>
              </div>
            </div>
            <div class="workbench-account-status__meta">
              <span>{{ accounts.length }} 个账号</span>
              <span v-if="lastCheckedAt">最近检测 {{ formatTime(lastCheckedAt) }}</span>
            </div>
            <ul v-if="visibleOfflineAccounts.length" class="workbench-account-status__list">
              <li
                v-for="account in visibleOfflineAccounts"
                :key="account.id"
                class="workbench-account-status__item"
              >
                <span class="workbench-account-status__name">
                  {{ account.name }} / {{ platformLabel(account.platform) }}
                </span>
                <span class="workbench-account-status__message">
                  {{ account.linkMessage || '需要重新登录' }}
                </span>
              </li>
            </ul>
            <p v-if="hiddenOfflineCount > 0" class="workbench-account-status__more">
              还有 {{ hiddenOfflineCount }} 个账号需要处理
            </p>
            <el-button
              class="workbench-account-status__btn"
              type="primary"
              plain
              @click="go('PublishAccounts')"
            >
              发布账号管理
            </el-button>
          </section>

          <section class="workbench-actions" aria-label="批量任务">
            <el-button disabled>新建一个月的视频任务</el-button>
          </section>
        </aside>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
@import '@/styles/workbench.css';
</style>
