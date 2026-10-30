import { ref } from 'vue'
import axios from 'axios'
import { publishAccountStatus } from '@/api/local'
import { usePublishAccountsStore } from '@/stores/publishAccounts'
import type { LinkStatus } from '@/types/publish'

type CheckReason = 'manual' | 'startup'
type CompatScope = 'login' | 'status' | 'publish'

interface QueueItem {
  accountId: string
  reason: CheckReason
  resolve: (result: StatusCheckResult) => void
  reject: (err: unknown) => void
}

export interface StatusCheckResult {
  ok: boolean
  message: string
}

const QUEUE_GAP_MS = 800
const STARTUP_DELAY_MS = 3000

const checkingAccountIds = ref<Set<string>>(new Set())
const actionLoadingMap = ref<Record<string, 'login'>>({})
const isStartupDetectRunning = ref(false)
const startupStatusText = ref('')
const isPublishAccountCompatMode = ref(false)

let queue: QueueItem[] = []
let processing = false
let startupJobCount = 0
let startupDoneCount = 0

const COMPAT_MESSAGES: Record<CompatScope, string> = {
  login: '当前后端未提供独立账号登录接口，请先使用发布时登录，或升级后端后再在账号管理中登录。',
  status: '当前后端未提供账号状态检测接口，暂时无法在账号管理页检测登录状态。',
  publish: '当前后端未提供账号状态检测接口，已跳过登录态预检，继续按发布接口执行。',
}

export function compatModeMessage(scope: CompatScope): string {
  return COMPAT_MESSAGES[scope]
}

export function enablePublishAccountCompatMode(): void {
  isPublishAccountCompatMode.value = true
}

export function isPublishAccount404Error(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    return err.response?.status === 404
  }
  if (err && typeof err === 'object') {
    const status = Number((err as { status?: number }).status)
    if (status === 404) return true
  }
  return false
}

export function linkStatusLabel(status: LinkStatus): string {
  return status === 'connected' ? '已登录' : '待登录'
}

export function isAccountChecking(accountId: string): boolean {
  return checkingAccountIds.value.has(accountId)
}

export function isAccountLoggingIn(accountId: string): boolean {
  return actionLoadingMap.value[accountId] === 'login'
}

export function isAccountBusy(accountId: string): boolean {
  return isAccountChecking(accountId) || isAccountLoggingIn(accountId)
}

export function setAccountLoginLoading(accountId: string, loading: boolean): void {
  const next = { ...actionLoadingMap.value }
  if (loading) next[accountId] = 'login'
  else delete next[accountId]
  actionLoadingMap.value = next
}

function patchFromStatusResponse(
  accountId: string,
  payload: { is_valid?: boolean; message?: string; user_data_dir?: string; current_url?: string } | undefined,
): void {
  const store = usePublishAccountsStore()
  const account = store.getAccountById(accountId)
  if (!account) return

  const valid = !!payload?.is_valid
  const message = String(payload?.message || '').trim()
  const userDataDir = String(payload?.user_data_dir || account.userDataDir || '').trim()

  store.patchAccount(accountId, {
    linkStatus: valid ? 'connected' : 'reauth',
    linkMessage: message || (valid ? '登录有效' : '请重新登录该账号'),
    userDataDir,
    currentUrl: payload?.current_url,
    lastStatusCheckedAt: Date.now(),
  })
}

async function runStatusCheck(accountId: string): Promise<StatusCheckResult> {
  if (isPublishAccountCompatMode.value) {
    return { ok: false, message: compatModeMessage('status') }
  }

  const store = usePublishAccountsStore()
  const account = store.getAccountById(accountId)
  if (!account) {
    return { ok: false, message: '账号不存在' }
  }

  checkingAccountIds.value = new Set([...checkingAccountIds.value, accountId])
  try {
    const { data } = await publishAccountStatus({
      platform: account.platform,
      user_data_dir: account.userDataDir,
    })
    const payload = data as {
      is_valid?: boolean
      message?: string
      user_data_dir?: string
      current_url?: string
    }
    patchFromStatusResponse(accountId, payload)
    const ok = !!payload?.is_valid
    const message =
      String(payload?.message || '').trim() ||
      (ok ? `账号“${account.name}”已登录` : `账号“${account.name}”需要重新登录`)
    return { ok, message }
  } catch (err) {
    if (isPublishAccount404Error(err)) {
      enablePublishAccountCompatMode()
      const message = compatModeMessage('status')
      store.patchAccount(accountId, { linkMessage: message, lastStatusCheckedAt: Date.now() })
      return { ok: false, message }
    }
    const message = err instanceof Error ? err.message : '检测失败'
    store.patchAccount(accountId, { linkMessage: message, lastStatusCheckedAt: Date.now() })
    return { ok: false, message }
  } finally {
    const next = new Set(checkingAccountIds.value)
    next.delete(accountId)
    checkingAccountIds.value = next
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function processQueue(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (queue.length > 0) {
      const item = queue.shift()!
      try {
        const result = await runStatusCheck(item.accountId)
        item.resolve(result)
      } catch (err) {
        item.reject(err)
      }
      if (queue.length > 0) await sleep(QUEUE_GAP_MS)
    }
  } finally {
    processing = false
  }
}

export function checkPublishAccountStatus(
  accountId: string,
  reason: CheckReason = 'manual',
): Promise<StatusCheckResult> {
  if (isPublishAccountCompatMode.value) {
    return Promise.resolve({ ok: false, message: compatModeMessage('status') })
  }

  return new Promise((resolve, reject) => {
    const item: QueueItem = { accountId, reason, resolve, reject }
    if (reason === 'startup') queue.unshift(item)
    else queue.push(item)
    void processQueue()
  })
}

export async function checkPublishAccountForPublish(accountId: string): Promise<StatusCheckResult> {
  if (isPublishAccountCompatMode.value) {
    return { ok: false, message: compatModeMessage('publish') }
  }
  return checkPublishAccountStatus(accountId, 'manual')
}

export async function runStartupAccountStatusCheck(delay = STARTUP_DELAY_MS): Promise<void> {
  if (isStartupDetectRunning.value) return

  const store = usePublishAccountsStore()
  const ids = store.accounts.map((a) => a.id)
  if (!ids.length) return

  isStartupDetectRunning.value = true
  startupJobCount = ids.length
  startupDoneCount = 0
  startupStatusText.value = `启动自动检测进行中 (0/${startupJobCount})`

  try {
    await sleep(delay)
    await store.ensureAutoBrowserProfileDirs()

    for (const id of ids) {
      startupStatusText.value = `启动自动检测进行中 (${startupDoneCount}/${startupJobCount})`
      await checkPublishAccountStatus(id, 'startup')
      startupDoneCount += 1
    }
  } finally {
    isStartupDetectRunning.value = false
    startupStatusText.value = ''
  }
}

export {
  checkingAccountIds,
  actionLoadingMap,
  isStartupDetectRunning,
  startupStatusText,
  isPublishAccountCompatMode,
  patchFromStatusResponse,
}
