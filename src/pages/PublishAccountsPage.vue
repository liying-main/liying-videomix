<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import PageShell from '@/components/PageShell.vue'
import { publishAccount } from '@/api/local'
import { usePublishAccountsStore, platformLabel } from '@/stores/publishAccounts'
import { useReleaseScheduleStore } from '@/stores/releaseSchedule'
import {
  checkPublishAccountStatus,
  compatModeMessage,
  isAccountBusy,
  isAccountChecking,
  isPublishAccount404Error,
  isPublishAccountCompatMode,
  isStartupDetectRunning,
  linkStatusLabel,
  patchFromStatusResponse,
  setAccountLoginLoading,
  startupStatusText,
} from '@/services/publishAccountStatus'
import type { PublishAccount, PublishPlatform } from '@/types/publish'
import '@/styles/publish-accounts.css'

type PlatformTab = 'douyin' | 'xhs' | 'channels' | 'kuaishou'

const TAB_TO_PLATFORM: Record<PlatformTab, PublishPlatform> = {
  douyin: 'douyin',
  xhs: 'xiaohongshu',
  channels: 'shipinhao',
  kuaishou: 'kuaishou',
}

const BLOCKED_ADD_PLATFORMS = new Set<PublishPlatform>(['xiaohongshu'])
const RECHECK_INTERVAL_MS = 8000
const RECHECK_MAX_ATTEMPTS = 6

const publishStore = usePublishAccountsStore()
const scheduleStore = useReleaseScheduleStore()
const { accounts } = storeToRefs(publishStore)

const activeTab = ref<PlatformTab>('douyin')
const searchQuery = ref('')
const dialogVisible = ref(false)
const saving = ref(false)
const batchChecking = ref(false)
const form = ref({ name: '', platform: 'douyin' as PublishPlatform, positioning: '' })

const recheckTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const activePlatform = computed(() => TAB_TO_PLATFORM[activeTab.value])

const filteredAccounts = computed(() => {
  const platform = activePlatform.value
  const query = searchQuery.value.trim().toLowerCase()
  return accounts.value
    .filter((a) => a.platform === platform)
    .filter((a) => {
      if (!query) return true
      return (
        a.name.toLowerCase().includes(query) ||
        platformLabel(a.platform).toLowerCase().includes(query) ||
        a.positioning.toLowerCase().includes(query) ||
        String(a.linkMessage || '').toLowerCase().includes(query)
      )
    })
})

const stats = computed(() => {
  const list = accounts.value.filter((a) => a.platform === activePlatform.value)
  return {
    total: list.length,
    connected: list.filter((a) => a.linkStatus === 'connected').length,
    pending: list.filter((a) => a.linkStatus !== 'connected').length,
  }
})

const addBlocked = computed(() => BLOCKED_ADD_PLATFORMS.has(activePlatform.value))
const addBlockedHint = computed(() =>
  addBlocked.value ? `${platformLabel(activePlatform.value)}账号添加暂未开放` : '',
)
const dialogTitle = computed(() => `添加${platformLabel(form.value.platform)}账号`)

function isAddBlocked(platform: PublishPlatform): boolean {
  return BLOCKED_ADD_PLATFORMS.has(platform)
}

function resetForm() {
  form.value = { name: '', platform: activePlatform.value, positioning: '' }
}

function openAddDialog() {
  resetForm()
  dialogVisible.value = true
}

function countScheduleUsage(accountId: string): number {
  let count = 0
  for (const meta of Object.values(scheduleStore.metaByTaskId)) {
    if (meta.publishTargets.some((t) => t.accountId === accountId)) count += 1
  }
  return count
}

function formatCheckedAt(ts?: number): string {
  if (!ts) return '未检测'
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return '未检测'
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

function statusPillClass(account: PublishAccount): string {
  if (isAccountChecking(account.id)) return 'pub-acct-card__status-pill--checking'
  return account.linkStatus === 'connected'
    ? 'pub-acct-card__status-pill--connected'
    : 'pub-acct-card__status-pill--pending'
}

function statusPillLabel(account: PublishAccount): string {
  if (isAccountChecking(account.id)) return '检测中'
  return linkStatusLabel(account.linkStatus)
}

function clearRecheck(accountId: string) {
  const timer = recheckTimeouts.get(accountId)
  if (timer != null) {
    clearTimeout(timer)
    recheckTimeouts.delete(accountId)
  }
}

function scheduleRecheck(accountId: string, attempt = 1) {
  clearRecheck(accountId)
  const timer = setTimeout(() => {
    recheckTimeouts.delete(accountId)
    void runRecheck(accountId, attempt)
  }, RECHECK_INTERVAL_MS)
  recheckTimeouts.set(accountId, timer)
}

async function runRecheck(accountId: string, attempt: number) {
  if (isStartupDetectRunning.value) return
  const account = publishStore.getAccountById(accountId)
  if (!account) return

  const result = await checkPublishAccountStatus(accountId, 'manual')
  const latest = publishStore.getAccountById(accountId) || account
  if (result.ok) {
    ElMessage.success(`账号“${latest.name}”登录状态已确认`)
    return
  }
  if (attempt >= RECHECK_MAX_ATTEMPTS) {
    ElMessage.warning(
      `账号“${latest.name}”登录后暂未检测到有效状态，请扫码完成后手动检测一次`,
    )
    return
  }
  scheduleRecheck(accountId, attempt + 1)
}

async function detectAccount(account: PublishAccount, silent = false): Promise<boolean> {
  if (isStartupDetectRunning.value) {
    if (!silent) ElMessage.info('启动自动检测进行中，请稍后再手动检测')
    return false
  }
  if (isPublishAccountCompatMode.value) {
    if (!silent) ElMessage.warning(compatModeMessage('status'))
    return false
  }

  const result = await checkPublishAccountStatus(account.id, 'manual')
  if (!silent) {
    ElMessage[result.ok ? 'success' : 'warning'](result.message)
  }
  return result.ok
}

async function loginAccount(account: PublishAccount) {
  if (isPublishAccountCompatMode.value) {
    ElMessage.warning(compatModeMessage('login'))
    return
  }

  setAccountLoginLoading(account.id, true)
  clearRecheck(account.id)

  try {
    if (!account.userDataDir) await publishStore.ensureAutoBrowserProfileDirs()
    const latest = publishStore.getAccountById(account.id) || account
    const response = await publishAccount({
      platform: latest.platform,
      user_data_dir: latest.userDataDir,
    })
    if (response.code != null && response.code !== 0) {
      throw new Error(response.message || '登录账号失败')
    }
    patchFromStatusResponse(account.id, response.data as {
      is_valid?: boolean
      message?: string
      user_data_dir?: string
    })
    scheduleRecheck(account.id)
    const msg =
      (response.data as { message?: string } | undefined)?.message ||
      `已触发 ${platformLabel(latest.platform)} 登录，完成登录后会自动回检当前账号`
    ElMessage.success(msg)
  } catch (err) {
    if (isPublishAccount404Error(err)) {
      const message = compatModeMessage('login')
      publishStore.patchAccount(account.id, { linkMessage: message, lastStatusCheckedAt: Date.now() })
      ElMessage.warning(message)
      return
    }
    const message = err instanceof Error ? err.message : '登录账号失败'
    publishStore.patchAccount(account.id, {
      linkStatus: 'reauth',
      linkMessage: message,
      lastStatusCheckedAt: Date.now(),
    })
    ElMessage.error(message)
  } finally {
    setAccountLoginLoading(account.id, false)
  }
}

async function saveAccount() {
  const name = form.value.name.trim()
  if (!name) {
    ElMessage.warning('请填写账号名称')
    return
  }
  if (isAddBlocked(form.value.platform)) {
    ElMessage.warning(`${platformLabel(form.value.platform)}账号添加暂未开放`)
    return
  }

  saving.value = true
  try {
    const created = publishStore.addAccount({
      name,
      platform: form.value.platform,
      positioning: form.value.positioning,
    })
    await publishStore.ensureAutoBrowserProfileDirs()
    dialogVisible.value = false
    resetForm()
    const account = publishStore.getAccountById(created.id) || created
    await loginAccount(account)
  } finally {
    saving.value = false
  }
}

async function batchDetectCurrentPlatform() {
  if (batchChecking.value) return
  if (isStartupDetectRunning.value) {
    ElMessage.info('启动自动检测进行中，请稍后再手动检测')
    return
  }
  if (!filteredAccounts.value.length) {
    ElMessage.info('当前平台还没有账号')
    return
  }
  if (isPublishAccountCompatMode.value) {
    ElMessage.warning(compatModeMessage('status'))
    return
  }

  batchChecking.value = true
  try {
    let connected = 0
    for (const account of filteredAccounts.value) {
      if (await detectAccount(account, true)) connected += 1
    }
    ElMessage.success(
      `检测完成：${connected} 个已登录，${filteredAccounts.value.length - connected} 个待登录`,
    )
  } finally {
    batchChecking.value = false
  }
}

async function removeAccount(account: PublishAccount) {
  const usage = countScheduleUsage(account.id)
  const lines = [
    `确定删除账号“${account.name}”吗？`,
    usage > 0
      ? `该账号已被 ${usage} 条发布记录使用，删除后会一并从这些记录里移除。`
      : '删除后该账号将不能再用于发布和排期。',
  ]
  try {
    await ElMessageBox.confirm(lines.join('\n\n'), '删除账号', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  clearRecheck(account.id)
  scheduleStore.removePublishAccount(account.id)
  if (!publishStore.removeAccount(account.id)) {
    ElMessage.error('账号删除失败')
    return
  }
  ElMessage.success(usage > 0 ? '账号已删除，并已从发布记录中移除' : '账号已删除')
}

onMounted(() => {
  void publishStore.ensureAutoBrowserProfileDirs()
})

onUnmounted(() => {
  for (const timer of recheckTimeouts.values()) clearTimeout(timer)
  recheckTimeouts.clear()
})
</script>

<template>
  <PageShell title="发布账号管理">
    <div class="pub-acct">
      <p class="pub-acct__intro vm-intro-banner">
        这里负责账号建档、账号登录、登录状态检测。添加账号只会创建账号卡片和独立浏览器目录
      </p>

      <div v-if="startupStatusText" class="pub-acct__startup-status">{{ startupStatusText }}</div>

      <div class="pub-acct__stats">
        <div class="pub-acct__stat pub-acct__stat--blue">
          <span class="pub-acct__stat-val">{{ stats.total }}</span>
          <span class="pub-acct__stat-label">当前平台账号</span>
        </div>
        <div class="pub-acct__stat pub-acct__stat--green">
          <span class="pub-acct__stat-val">{{ stats.connected }}</span>
          <span class="pub-acct__stat-label">已登录账号</span>
        </div>
        <div class="pub-acct__stat pub-acct__stat--orange">
          <span class="pub-acct__stat-val">{{ stats.pending }}</span>
          <span class="pub-acct__stat-label">待登录账号</span>
        </div>
      </div>

      <div class="pub-acct__toolbar">
        <el-radio-group v-model="activeTab" class="pub-acct__tabs pub-acct__tabs--prominent">
          <el-radio-button label="douyin">抖音</el-radio-button>
          <el-radio-button label="xhs">小红书</el-radio-button>
          <el-radio-button label="channels">视频号</el-radio-button>
          <el-radio-button label="kuaishou">快手</el-radio-button>
        </el-radio-group>

        <div class="pub-acct__toolbar-right">
          <el-input
            v-model="searchQuery"
            class="pub-acct__search"
            placeholder="搜索账号名称 / 平台 / 状态说明"
            clearable
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-button :loading="batchChecking" @click="batchDetectCurrentPlatform">
            检测当前平台
          </el-button>
          <el-button type="primary" :disabled="addBlocked" :title="addBlockedHint" @click="openAddDialog">
            添加账号
          </el-button>
        </div>
      </div>

      <div v-if="filteredAccounts.length" class="pub-acct__cards">
        <article v-for="account in filteredAccounts" :key="account.id" class="pub-acct-card">
          <div class="pub-acct-card__head">
            <h3 class="pub-acct-card__title">{{ account.name }}</h3>
            <span class="pub-acct-card__status-pill" :class="statusPillClass(account)">
              {{ statusPillLabel(account) }}
            </span>
          </div>

          <dl class="pub-acct-card__dl">
            <div class="pub-acct-card__row">
              <dt>账号定位</dt>
              <dd>{{ account.positioning || '-' }}</dd>
            </div>
            <div
              class="pub-acct-card__row"
              :class="{ 'pub-acct-card__row--warn': account.linkStatus !== 'connected' }"
            >
              <dt>状态说明</dt>
              <dd>{{ account.linkMessage || '请先登录该账号' }}</dd>
            </div>
            <div class="pub-acct-card__row">
              <dt>最近检测</dt>
              <dd>{{ formatCheckedAt(account.lastStatusCheckedAt) }}</dd>
            </div>
            <div class="pub-acct-card__row">
              <dt>浏览器目录</dt>
              <dd class="pub-acct-card__path">{{ account.userDataDir || '未创建' }}</dd>
            </div>
          </dl>

          <div class="pub-acct-card__actions">
            <el-button
              :loading="isAccountBusy(account.id) && !isAccountChecking(account.id)"
              :disabled="isAccountBusy(account.id)"
              @click="loginAccount(account)"
            >
              登录账号
            </el-button>
            <el-button
              :loading="isAccountChecking(account.id)"
              :disabled="isAccountBusy(account.id)"
              @click="detectAccount(account)"
            >
              检测状态
            </el-button>
            <el-button
              type="danger"
              plain
              :disabled="isAccountBusy(account.id)"
              @click="removeAccount(account)"
            >
              删除账号
            </el-button>
          </div>
        </article>
      </div>

      <div v-else class="pub-acct__empty">
        当前平台还没有账号，点击「添加账号」开始建档
      </div>

      <el-dialog v-model="dialogVisible" :title="dialogTitle" width="420px" destroy-on-close>
        <el-form label-width="88px" @submit.prevent="saveAccount">
          <el-form-item label="账号名称" required>
            <el-input v-model="form.name" placeholder="例如：门店主号" />
          </el-form-item>
          <el-form-item label="所属平台">
            <el-select v-model="form.platform" style="width: 100%">
              <el-option label="抖音" value="douyin" />
              <el-option label="小红书" value="xiaohongshu" disabled>
                <span>小红书（暂不可添加）</span>
              </el-option>
              <el-option label="视频号" value="shipinhao" />
              <el-option label="快手" value="kuaishou" />
            </el-select>
          </el-form-item>
          <el-form-item label="账号定位">
            <el-input v-model="form.positioning" placeholder="例如：本地生活 / 品牌号" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="saveAccount">确定</el-button>
        </template>
      </el-dialog>
    </div>
  </PageShell>
</template>
