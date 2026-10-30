<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import { bailianChatCompletions, extractBailianContent } from '@/api/bailian'
import { publish } from '@/api/local'
import { BAILIAN_TITLE_TOPICS_PROMPT } from '@/constants/prompts'
import { getTemplateName } from '@/constants/mixTemplates'
import {
  checkPublishAccountForPublish,
  isPublishAccountCompatMode,
} from '@/services/publishAccountStatus'
import { useMixStore } from '@/stores/mix'
import { usePublishAccountsStore, platformLabel } from '@/stores/publishAccounts'
import { useReleaseScheduleStore } from '@/stores/releaseSchedule'
import {
  buildTitleTopicsRetryPrompt,
  formatTopicsForStorage,
  parseTitleTopicsContent,
  parseTopicsInput,
} from '@/utils/bailianTitleTopicsValidate'
import type { MixTask } from '@/types/mix'
import type { PublishTarget, ReleaseMeta } from '@/types/publish'
import '@/styles/release-schedule.css'

const MANUAL_AUTO_PUBLISH_KEY = 'videomix_release_manual_auto_publish'
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

interface ScheduleRow {
  id: string
  outputUrl: string
  templateType?: string
  templateName?: string
  createdAt: number
  task?: MixTask
}

const mixStore = useMixStore()
const publishStore = usePublishAccountsStore()
const scheduleStore = useReleaseScheduleStore()

const { tasks, bailianApiKey } = storeToRefs(mixStore)
const { metaByTaskId } = storeToRefs(scheduleStore)
const { accountOptions } = storeToRefs(publishStore)

const activeFilter = ref<'unscheduled' | 'scheduled' | 'published'>('unscheduled')
const resultSubFilter = ref<'success' | 'failed'>('success')
const previewUrl = ref('')
const previewCaption = ref('')
const scheduleDialogVisible = ref(false)
const scheduleDialogTaskId = ref('')
const scheduleInput = ref('')
const publishing = ref(false)
const publishingLabel = ref('')
const autoPublishMode = ref(readAutoPublishMode())
const generatingId = ref('')
const aiQueue = ref<string[]>([])
const aiRunning = ref(false)
const aiSignatures = new Map<string, string>()

function readAutoPublishMode(): boolean {
  try {
    return localStorage.getItem(MANUAL_AUTO_PUBLISH_KEY) !== 'false'
  } catch {
    return true
  }
}

function taskCreatedAt(taskId: string): number {
  const match = String(taskId || '').match(/^task_(\d{10,})_/)
  return match?.[1] ? Number(match[1]) : 0
}

function metaOf(taskId: string): ReleaseMeta {
  return scheduleStore.getOrCreate(taskId)
}

function taskOf(taskId: string): MixTask | null {
  return tasks.value.find((t) => t.id === taskId) ?? null
}

const allRows = computed<ScheduleRow[]>(() => {
  const fromTasks = tasks.value
    .filter((t) => t.status === 'done' && t.outputUrl)
    .map((t) => ({
      id: t.id,
      outputUrl: t.outputUrl,
      templateType: t.templateType,
      templateName: t.templateName,
      createdAt: Number(t.createdAt) || taskCreatedAt(t.id),
      task: t,
    }))

  const taskIds = new Set(fromTasks.map((r) => r.id))
  const orphans: ScheduleRow[] = []
  for (const [id, meta] of Object.entries(metaByTaskId.value)) {
    const outputUrl = String(meta?.outputUrl || '').trim()
    if (!outputUrl || taskIds.has(id)) continue
    orphans.push({
      id,
      outputUrl,
      templateType: meta.templateType,
      templateName: meta.templateName,
      createdAt: taskCreatedAt(id),
    })
  }

  return [...fromTasks, ...orphans].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
})

const stats = computed(() => {
  let toSchedule = 0
  let scheduled = 0
  let incomplete = 0
  let published = 0
  for (const row of allRows.value) {
    const meta = metaOf(row.id)
    if (meta.phase === 'unscheduled') toSchedule += 1
    else if (meta.phase === 'scheduled') scheduled += 1
    else published += 1
    if ((meta.phase === 'unscheduled' || meta.phase === 'scheduled') && !hasTitleTopics(row.id)) {
      incomplete += 1
    }
  }
  return { toSchedule, scheduled, incomplete, published }
})

const publishedStats = computed(() => {
  let success = 0
  let failed = 0
  for (const row of allRows.value) {
    if (metaOf(row.id).phase !== 'published') continue
    if (hasFailedTargets(row.id)) failed += 1
    else success += 1
  }
  return { success, failed }
})

const filteredRows = computed(() => {
  const rows = allRows.value.filter((row) => metaOf(row.id).phase === activeFilter.value)
  if (activeFilter.value !== 'published') return rows
  return rows.filter((row) =>
    resultSubFilter.value === 'failed' ? hasFailedTargets(row.id) : !hasFailedTargets(row.id),
  )
})

const emptyHint = computed(() => {
  if (!allRows.value.length) return '当前还没有可发布的成片，先去任务中心完成混剪生成。'
  if (activeFilter.value === 'published') {
    return resultSubFilter.value === 'failed'
      ? '当前没有发布失败的结果。'
      : '当前没有发布成功的结果。'
  }
  return '当前分类下没有符合条件的条目。'
})

watch(autoPublishMode, (value) => {
  try {
    localStorage.setItem(MANUAL_AUTO_PUBLISH_KEY, value ? 'true' : 'false')
  } catch {
    /* ignore */
  }
})

watch(
  [allRows, bailianApiKey],
  () => {
    const apiKey = bailianApiKey.value.trim()
    if (!apiKey) return

    let queued = false
    for (const row of allRows.value) {
      const meta = metaOf(row.id)
      const content = copySourceFor(row.id)
      if (!row.outputUrl || !content) {
        aiSignatures.delete(row.id)
        continue
      }
      if (meta.title.trim() || meta.topics.trim()) {
        aiSignatures.delete(row.id)
        continue
      }
      const signature = `${row.id}:${content}`
      if (aiSignatures.get(row.id) === signature) continue
      if (aiQueue.value.includes(row.id) || generatingId.value === row.id) continue
      aiSignatures.set(row.id, signature)
      aiQueue.value = [...aiQueue.value, row.id]
      queued = true
    }
    if (queued) void drainAiQueue()
  },
  { immediate: true, deep: true },
)

function targetStats(taskId: string) {
  const targets = metaOf(taskId).publishTargets
  return {
    total: targets.length,
    pending: targets.filter((t) => t.phase === 'pending').length,
    scheduled: targets.filter((t) => t.phase === 'scheduled').length,
    publishing: targets.filter((t) => t.phase === 'publishing').length,
    published: targets.filter((t) => t.phase === 'published').length,
    failed: targets.filter((t) => t.phase === 'failed').length,
  }
}

function hasFailedTargets(taskId: string): boolean {
  return targetStats(taskId).failed > 0
}

function hasTitleTopics(taskId: string): boolean {
  const meta = metaOf(taskId)
  return !!(meta.title.trim() && parseTopicsInput(meta.topics).length > 0)
}

function titleTopicsError(taskId: string): string {
  const meta = metaOf(taskId)
  const hasTitle = !!meta.title.trim()
  const hasTopics = parseTopicsInput(meta.topics).length > 0
  if (hasTitle && hasTopics) return ''
  if (!hasTitle && !hasTopics) return '请先填写发布标题和发布话题'
  return hasTitle ? '请先填写发布话题' : '请先填写发布标题'
}

function hasVoiceoverGap(taskId: string, row?: ScheduleRow): boolean {
  const task = row?.task || taskOf(taskId)
  if (task) return !task.shots.some((s) => String(s.audioUrl || '').trim())
  return metaOf(taskId).hasVoiceover === false
}

function accountLabel(accountId: string): string {
  const account = publishStore.getAccountById(accountId)
  if (!account) return '账号已删除'
  const pending = account.linkStatus === 'connected' ? '' : ' / 待登录'
  return `${account.name} / ${platformLabel(account.platform)}${pending}`
}

function hasUnloggedSelected(taskId: string): boolean {
  return metaOf(taskId).publishTargets.some((target) => {
    const account = publishStore.getAccountById(target.accountId)
    return !account || account.linkStatus !== 'connected'
  })
}

function selectedAccountIds(taskId: string): string[] {
  return metaOf(taskId).publishTargets.map((t) => t.accountId)
}

function dedupeAccountsByPlatform(accountIds: string[]): string[] {
  const picked: string[] = []
  const seen = new Set<string>()
  for (let i = accountIds.length - 1; i >= 0; i -= 1) {
    const account = publishStore.getAccountById(accountIds[i])
    if (!account || seen.has(account.platform)) continue
    seen.add(account.platform)
    picked.push(account.id)
  }
  return picked.reverse()
}

function onAccountsChange(taskId: string, accountIds: string[]) {
  const deduped = dedupeAccountsByPlatform(accountIds)
  if (deduped.length !== accountIds.filter(Boolean).length) {
    ElMessage.warning('同一平台下只能选择一个发布账号')
  }
  const targets = deduped
    .map((accountId) => {
      const account = publishStore.getAccountById(accountId)
      if (!account) return null
      return {
        accountId: account.id,
        userDataDir: account.userDataDir || '',
        phase: 'pending' as const,
      }
    })
    .filter(Boolean) as PublishTarget[]
  scheduleStore.syncPublishTargets(taskId, targets)
}

function accountSummary(taskId: string): string {
  const stats = targetStats(taskId)
  if (!stats.total) return '未选择发布账号'
  const labels = metaOf(taskId)
    .publishTargets.slice(0, 2)
    .map((t) => accountLabel(t.accountId))
  if (stats.total <= 2) return labels.join('、')
  return `${labels.join('、')} 等 ${stats.total} 个账号`
}

function templateLabel(row: ScheduleRow): string {
  const type = row.templateType || 'persona'
  const name = String(row.templateName || '').trim() || getTemplateName(type)
  const createdAt = Number(row.createdAt) || 0
  if (!createdAt) return name
  const date = new Date(createdAt)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi} ${name}`
}

function scheduleLabel(taskId: string): string {
  const meta = metaOf(taskId)
  if (meta.phase === 'unscheduled' || !meta.scheduledAt) return '待排期'
  const date = new Date(meta.scheduledAt)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${WEEKDAYS[date.getDay()]} ${mm}-${dd} ${hh}:${mi}`
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseDatetimeLocal(value: string): Date | null {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, y, m, d, hh, mm] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeLocalPath(url: string): string {
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

async function pathExists(path: string): Promise<boolean> {
  const trimmed = String(path || '').trim()
  if (!trimmed) return false
  const api = window.electronAPI
  if (!api?.pathExists) return true
  try {
    return await api.pathExists(trimmed)
  } catch {
    return false
  }
}

function copySourceFor(taskId: string): string {
  const task = taskOf(taskId)
  if (task) {
    return task.shots
      .map((s) => String(s.scriptRewritten || '').trim() || String(s.scriptOriginal || '').trim())
      .filter(Boolean)
      .join('\n')
  }
  return String(metaOf(taskId).copySourceText || '').trim()
}

function statusTags(taskId: string, row: ScheduleRow) {
  const tags: Array<{ text: string; type: 'success' | 'warning' | 'info' | 'primary' | 'danger' }> = []
  tags.push(
    hasTitleTopics(taskId)
      ? { text: '标题 / 话题已填', type: 'success' }
      : { text: '待补标题 / 话题', type: 'warning' },
  )
  if (hasVoiceoverGap(taskId, row)) tags.push({ text: '未配音', type: 'info' })
  const stats = targetStats(taskId)
  tags.push(
    stats.total > 0
      ? { text: `已选 ${stats.total} 个账号`, type: 'primary' }
      : { text: '未选择发布账号', type: 'info' },
  )
  if (stats.failed > 0) tags.push({ text: `${stats.failed} 个失败`, type: 'danger' })
  else if (stats.published > 0) tags.push({ text: `${stats.published} 个已发布`, type: 'success' })
  return tags
}

function statusNote(taskId: string): string {
  const err = titleTopicsError(taskId)
  if (err) return err
  const stats = targetStats(taskId)
  if (!stats.total) return '请先选择发布账号'
  if (hasUnloggedSelected(taskId)) {
    return '当前已选账号中包含未登录账号，请先去发布账号管理完成登录后再发布'
  }
  const parts = [`共 ${stats.total} 个账号`]
  if (stats.published) parts.push(`已发布 ${stats.published}`)
  if (stats.publishing) parts.push(`发布中 ${stats.publishing}`)
  if (stats.scheduled) parts.push(`排期中 ${stats.scheduled}`)
  if (stats.pending) parts.push(`待发布 ${stats.pending}`)
  if (stats.failed) parts.push(`失败 ${stats.failed}`)
  return parts.join('，')
}

function publishedSummary(taskId: string): string {
  const labels = metaOf(taskId)
    .publishTargets.filter((t) => t.phase === 'published')
    .map((t) => accountLabel(t.accountId))
  return labels.length ? labels.join('、') : accountSummary(taskId)
}

function publishedStatusText(taskId: string): string {
  const stats = targetStats(taskId)
  if (stats.total > 0 && stats.published === stats.total) return '全部已发布'
  if (stats.failed > 0 && stats.published > 0) return '部分成功 / 部分失败'
  if (stats.failed > 0) return '发布失败'
  if (stats.published > 0) return '部分已发布'
  return '暂无发布结果'
}

function publishedStatusType(taskId: string): 'success' | 'warning' | 'danger' {
  const stats = targetStats(taskId)
  if (stats.total > 0 && stats.published === stats.total) return 'success'
  if (stats.failed > 0 && stats.published === 0) return 'danger'
  if (stats.published > 0) return 'warning'
  return 'danger'
}

function openPreview(row: ScheduleRow) {
  previewUrl.value = row.outputUrl
  previewCaption.value = templateLabel(row)
}

function clearPreview() {
  previewUrl.value = ''
  previewCaption.value = ''
}

function openScheduleDialog(taskId: string) {
  const meta = metaOf(taskId)
  if (!meta.publishTargets.length) {
    ElMessage.warning('请先选择发布账号')
    return
  }
  const err = titleTopicsError(taskId)
  if (err) {
    ElMessage.warning(err)
    return
  }
  if (meta.publishTargets.some((t) => t.phase === 'publishing')) {
    ElMessage.warning('当前有账号正在发布中，请等待本轮发布结束后再修改排期')
    return
  }
  scheduleDialogTaskId.value = taskId
  scheduleInput.value = toDatetimeLocalValue(
    meta.scheduledAt ? new Date(meta.scheduledAt) : new Date(),
  )
  scheduleDialogVisible.value = true
}

function confirmSchedule() {
  const taskId = scheduleDialogTaskId.value
  const date = parseDatetimeLocal(scheduleInput.value)
  if (!taskId || !date) {
    ElMessage.warning('请先填写有效的排期时间')
    return
  }
  const meta = metaOf(taskId)
  if (!meta.publishTargets.length) {
    ElMessage.warning('请先选择发布账号')
    return
  }
  const err = titleTopicsError(taskId)
  if (err) {
    ElMessage.warning(err)
    return
  }
  if (meta.publishTargets.some((t) => t.phase === 'publishing')) {
    ElMessage.warning('当前有账号正在发布中，请等待本轮发布结束后再修改排期')
    return
  }
  date.setSeconds(0, 0)
  if (!scheduleStore.schedulePublishTargets(taskId, date.getTime())) {
    ElMessage.info('当前选择的账号都已经发布完成，无需再设定排期')
    scheduleDialogVisible.value = false
    return
  }
  ElMessage.success(meta.phase === 'scheduled' ? '已更新排期时间' : '已设定排期时间')
  scheduleDialogVisible.value = false
}

async function pickCover(taskId: string) {
  const api = window.electronAPI
  if (!api?.selectFile || !api?.pathToFileUrl) {
    ElMessage.warning('当前环境不支持选择本地封面')
    return
  }
  const selected = await api.selectFile({
    title: '选择本地封面',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  })
  if (!selected) return
  const coverImage = (await api.pathToFileUrl(selected)) || selected
  scheduleStore.patch(taskId, { coverImage, coverPath: selected })
}

function clearCover(taskId: string) {
  scheduleStore.patch(taskId, { coverImage: '', coverPath: '' })
}

async function generateTitleTopics(taskId: string, silent = false) {
  const apiKey = bailianApiKey.value.trim()
  if (!apiKey) {
    if (!silent) ElMessage.warning('请先配置百炼 API Key')
    return
  }
  const content = copySourceFor(taskId)
  if (!content) {
    if (!silent) ElMessage.warning('缺少可用于生成标题话题的文案')
    return
  }

  generatingId.value = taskId
  try {
    const prompt = BAILIAN_TITLE_TOPICS_PROMPT.replace('{{content}}', content)
    let response = await bailianChatCompletions({ apiKey, prompt })
    let parsed = parseTitleTopicsContent(extractBailianContent(response))
    if (!parsed.exact) {
      response = await bailianChatCompletions({
        apiKey,
        prompt: buildTitleTopicsRetryPrompt(content),
      })
      parsed = parseTitleTopicsContent(extractBailianContent(response))
    }
    if (!parsed.exact) throw new Error('AI 返回的标题或话题格式不符合要求')

    scheduleStore.patch(taskId, {
      title: parsed.title,
      topics: formatTopicsForStorage(parsed.topics),
      copySourceText: content,
    })
    if (!silent) ElMessage.success('标题与话题已生成')
  } catch (err) {
    if (!silent) ElMessage.error(err instanceof Error ? err.message : '生成失败')
  } finally {
    if (generatingId.value === taskId) generatingId.value = ''
    aiQueue.value = aiQueue.value.filter((id) => id !== taskId)
    void drainAiQueue()
  }
}

async function drainAiQueue() {
  if (aiRunning.value || !aiQueue.value.length) return
  aiRunning.value = true
  try {
    while (aiQueue.value.length) {
      const taskId = aiQueue.value[0]
      await generateTitleTopics(taskId, true)
      aiQueue.value = aiQueue.value.slice(1)
    }
  } finally {
    aiRunning.value = false
  }
}

function publishableTargets(taskId: string, onlyAccountId?: string): PublishTarget[] {
  const targets = metaOf(taskId).publishTargets
  if (onlyAccountId) {
    return targets.filter((t) => t.accountId === onlyAccountId && t.phase !== 'published')
  }
  return targets.filter((t) => t.phase !== 'published')
}

async function validateBeforePublish(row: ScheduleRow, accountIds: string[]): Promise<string> {
  if (!accountIds.length) return '请先选择发布账号'
  const err = titleTopicsError(row.id)
  if (err) return err
  const localPath = normalizeLocalPath(row.outputUrl)
  if (!localPath || /^https?:\/\//i.test(localPath)) {
    return '视频文件路径无效或不是本地文件'
  }
  if (!(await pathExists(localPath))) return '视频文件路径无效或文件不存在'
  return ''
}

async function publishOneTarget(row: ScheduleRow, target: PublishTarget): Promise<void> {
  const meta = metaOf(row.id)
  const account = publishStore.getAccountById(target.accountId)
  if (!account) throw new Error(`账号 ${target.accountId} 已不存在，请重新选择`)

  const title = meta.title.trim()
  const topics = parseTopicsInput(meta.topics)
  if (!title) throw new Error('请先填写发布标题')
  if (!topics.length) throw new Error('请先填写发布话题')

  if (!isPublishAccountCompatMode.value) {
    const check = await checkPublishAccountForPublish(target.accountId)
    if (!check.ok || account.linkStatus !== 'connected') {
      throw new Error(check.message || `账号 ${account.name} 尚未登录，请先去发布账号管理登录`)
    }
  }

  const localPath = normalizeLocalPath(row.outputUrl)
  scheduleStore.patchPublishTarget(row.id, target.accountId, {
    phase: 'publishing',
    lastAttemptAt: Date.now(),
    publishMessage: '',
  })

  try {
    const response = await publish({
      platform: account.platform,
      video_file: localPath,
      title,
      topics,
      auto_publish: autoPublishMode.value,
      user_data_dir: target.userDataDir || account.userDataDir,
      ...(meta.coverPath ? { cover: meta.coverPath } : {}),
    })
    if (response.code != null && response.code !== 0) {
      throw new Error(response.message || '发布失败')
    }
    scheduleStore.patchPublishTarget(row.id, target.accountId, {
      phase: 'published',
      publishMessage: String(response.message || '发布成功'),
      lastAttemptAt: Date.now(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '发布失败'
    scheduleStore.patchPublishTarget(row.id, target.accountId, {
      phase: 'failed',
      publishMessage: message,
      lastAttemptAt: Date.now(),
    })
    if (/cookie|登录|login/i.test(message)) {
      publishStore.patchAccount(target.accountId, {
        linkStatus: 'reauth',
        linkMessage: message,
      })
    }
    throw err
  }
}

async function publishRow(row: ScheduleRow, onlyAccountId?: string) {
  if (publishing.value) return
  const targets = publishableTargets(row.id, onlyAccountId)
  if (!targets.length) {
    ElMessage.info('当前没有可发布的账号')
    return
  }

  const err = await validateBeforePublish(
    row,
    targets.map((t) => t.accountId),
  )
  if (err) {
    ElMessage.warning(err)
    return
  }
  if (hasUnloggedSelected(row.id) && !isPublishAccountCompatMode.value) {
    ElMessage.warning('当前已选账号中包含未登录账号，请先去发布账号管理完成登录后再发布')
    return
  }

  publishing.value = true
  let success = 0
  try {
    for (const target of targets) {
      const account = publishStore.getAccountById(target.accountId)
      publishingLabel.value = account ? `正在发布：${account.name}` : '正在发布'
      try {
        await publishOneTarget(row, target)
        success += 1
      } catch {
        /* per-target error already patched */
      }
    }

    const stats = targetStats(row.id)
    if (stats.published > 0) {
      scheduleStore.patch(row.id, {
        phase: 'published',
        publishMessage:
          stats.failed > 0
            ? `部分发布成功（${stats.published}/${stats.total}）`
            : autoPublishMode.value
              ? '自动发布完成'
              : '已打开发布流程，请手动确认发布',
      })
    }

    if (success > 0) {
      ElMessage.success(
        autoPublishMode.value ? `已成功发布 ${success} 个账号` : '已打开发布流程，请在浏览器中确认',
      )
    } else {
      ElMessage.error('发布失败，请查看状态说明')
    }
  } finally {
    publishing.value = false
    publishingLabel.value = ''
  }
}

async function deleteRow(row: ScheduleRow) {
  try {
    await ElMessageBox.confirm('确定删除该发布记录？相关排期与发布结果将一并清除。', '删除记录', {
      type: 'warning',
    })
  } catch {
    return
  }
  const task = taskOf(row.id)
  if (task) mixStore.removeTask(row.id)
  scheduleStore.removeMeta(row.id)
  if (previewUrl.value === row.outputUrl) clearPreview()
  ElMessage.success('已删除')
}

function patchMeta(taskId: string, patch: Partial<ReleaseMeta>) {
  scheduleStore.patch(taskId, patch)
}

onMounted(() => {
  void publishStore.ensureAutoBrowserProfileDirs()
})
</script>

<template>
  <PageShell title="发布排期">
    <div class="rel-sched-layout">
      <div class="rel-sched">
        <p class="rel-sched__intro vm-intro-banner">
          将任务中心已完成的成片配置标题、话题与发布账号；可设定排期由系统自动发布，也可立即手动发布。批量发布按平台和账号轮询规则执行。
        </p>

        <div class="rel-sched__stats">
          <div class="rel-sched__stat rel-sched__stat--blue">
            <span class="rel-sched__stat-val">{{ stats.toSchedule }}</span>
            <span class="rel-sched__stat-label">待排期视频</span>
          </div>
          <div class="rel-sched__stat rel-sched__stat--green">
            <span class="rel-sched__stat-val">{{ stats.scheduled }}</span>
            <span class="rel-sched__stat-label">排期中</span>
          </div>
          <div class="rel-sched__stat rel-sched__stat--amber">
            <span class="rel-sched__stat-val">{{ stats.incomplete }}</span>
            <span class="rel-sched__stat-label">待补标题/话题</span>
          </div>
          <div class="rel-sched__stat rel-sched__stat--published">
            <span class="rel-sched__stat-val">{{ stats.published }}</span>
            <span class="rel-sched__stat-label">已有发布结果</span>
          </div>
        </div>

        <div class="rel-sched__toolbar">
          <div class="rel-sched__toolbar-left">
            <el-radio-group v-model="activeFilter">
              <el-radio-button label="unscheduled">未排期</el-radio-button>
              <el-radio-button label="scheduled">排期中</el-radio-button>
              <el-radio-button label="published">已有结果</el-radio-button>
            </el-radio-group>
            <div class="rel-sched__publish-mode">
              <span class="rel-sched__publish-mode-label">立即发布方式</span>
              <el-switch
                v-model="autoPublishMode"
                inline-prompt
                active-text="自动发布"
                inactive-text="手动确认"
              />
            </div>
          </div>
        </div>

        <div class="rel-sched__section-head">
          <h3 class="rel-sched__section-title">排期列表</h3>
          <el-radio-group
            v-if="activeFilter === 'published'"
            v-model="resultSubFilter"
            size="small"
            class="rel-sched__result-tabs"
          >
            <el-radio-button label="success">成功 ({{ publishedStats.success }})</el-radio-button>
            <el-radio-button label="failed">失败 ({{ publishedStats.failed }})</el-radio-button>
          </el-radio-group>
        </div>

        <div v-if="publishingLabel" class="rel-sched__intro">{{ publishingLabel }}</div>

        <div v-if="!filteredRows.length" class="rel-sched__empty">{{ emptyHint }}</div>

        <div v-else class="rel-sched__list">
          <article
            v-for="row in filteredRows"
            :key="row.id"
            class="rel-sched-item"
            :class="{ 'rel-sched-item--published': activeFilter === 'published' }"
          >
            <template v-if="activeFilter === 'published'">
              <div class="rel-sched-result">
                <span class="rel-sched-result__name">{{ templateLabel(row) }}</span>
                <div class="rel-sched-result__meta rel-sched-result__meta--status">
                  <span class="rel-sched-result__label">状态</span>
                  <el-tag :type="publishedStatusType(row.id)" size="small">
                    {{ publishedStatusText(row.id) }}
                  </el-tag>
                </div>
                <div class="rel-sched-result__meta rel-sched-result__meta--accounts">
                  <span class="rel-sched-result__label">已发布账号</span>
                  <span class="rel-sched-result__value" :title="publishedSummary(row.id)">
                    {{ publishedSummary(row.id) }}
                  </span>
                </div>
                <el-button size="small" @click="openPreview(row)">预览</el-button>
                <el-button
                  v-if="publishableTargets(row.id).length"
                  size="small"
                  type="primary"
                  :loading="publishing"
                  @click="publishRow(row)"
                >
                  重新发布
                </el-button>
                <el-button size="small" type="danger" plain @click="deleteRow(row)">删除</el-button>
              </div>
            </template>

            <template v-else>
              <div class="rel-sched-item__time">
                <span class="rel-sched-item__time-dot" />
                <button
                  type="button"
                  class="rel-sched-item__time-text"
                  style="background: none; border: none; padding: 0; cursor: pointer; text-align: left"
                  @click="openScheduleDialog(row.id)"
                >
                  {{ scheduleLabel(row.id) }}
                </button>
              </div>

              <div class="rel-sched-item__main">
                <div class="rel-sched-item__head">
                  <span class="rel-sched-item__tpl">{{ templateLabel(row) }}</span>
                  <div class="rel-sched-item__tags">
                    <el-tag
                      v-for="tag in statusTags(row.id, row)"
                      :key="tag.text"
                      :type="tag.type"
                      size="small"
                    >
                      {{ tag.text }}
                    </el-tag>
                  </div>
                </div>

                <div class="rel-sched-item__grid">
                  <div class="rel-sched-item__field rel-sched-item__field--wide">
                    <label>发布标题</label>
                    <el-input
                      :model-value="metaOf(row.id).title"
                      type="textarea"
                      :rows="2"
                      placeholder="不超过20字"
                      @update:model-value="(v: unknown) => patchMeta(row.id, { title: String(v) })"
                    />
                  </div>
                  <div class="rel-sched-item__field">
                    <label>发布话题</label>
                    <el-input
                      :model-value="metaOf(row.id).topics"
                      placeholder="#话题 以空格分隔"
                      @update:model-value="(v: unknown) => patchMeta(row.id, { topics: String(v) })"
                    />
                  </div>
                  <div class="rel-sched-item__field">
                    <label>发布账号</label>
                    <el-select
                      :model-value="selectedAccountIds(row.id)"
                      multiple
                      collapse-tags
                      collapse-tags-tooltip
                      placeholder="选择发布账号"
                      style="width: 100%"
                      @update:model-value="(v: unknown) => onAccountsChange(row.id, v as string[])"
                    >
                      <el-option
                        v-for="opt in accountOptions"
                        :key="opt.value"
                        :label="opt.label"
                        :value="opt.value"
                      />
                    </el-select>
                    <p
                      v-if="hasUnloggedSelected(row.id)"
                      class="rel-sched-item__account-summary"
                      style="color: var(--el-color-warning-dark-2)"
                    >
                      包含未登录账号，请先去发布账号管理完成登录
                    </p>
                    <p v-else class="rel-sched-item__account-summary">{{ accountSummary(row.id) }}</p>
                  </div>
                </div>

                <div class="rel-sched-item__cover">
                  <div class="rel-sched-item__cover-left">
                    <div
                      class="rel-sched-item__cover-preview"
                      :class="{ 'rel-sched-item__cover-preview--has-img': !!metaOf(row.id).coverImage }"
                      @click="pickCover(row.id)"
                    >
                      <img
                        v-if="metaOf(row.id).coverImage"
                        class="rel-sched-item__cover-img"
                        :src="metaOf(row.id).coverImage"
                        alt="封面预览"
                      />
                      <span v-else>选择封面</span>
                    </div>
                    <div class="rel-sched-item__cover-meta">
                      <div class="rel-sched-item__cover-actions">
                        <el-button size="small" @click="pickCover(row.id)">选择封面</el-button>
                        <el-button
                          v-if="metaOf(row.id).coverPath"
                          size="small"
                          plain
                          @click="clearCover(row.id)"
                        >
                          清除封面
                        </el-button>
                      </div>
                      <p class="rel-sched-item__cover-note">
                        可选。未设置时将使用平台默认封面策略
                      </p>
                    </div>
                  </div>
                  <div class="rel-sched-item__cover-right">
                    <div class="rel-sched-item__cover-actions">
                      <el-button
                        size="small"
                        :loading="generatingId === row.id"
                        @click="generateTitleTopics(row.id)"
                      >
                        生成标题话题
                      </el-button>
                      <el-button size="small" disabled>AI 生成封面</el-button>
                    </div>
                  </div>
                </div>

                <div class="rel-sched-item__actions">
                  <el-button @click="openScheduleDialog(row.id)">
                    {{ metaOf(row.id).phase === 'scheduled' ? '修改排期时间' : '设定排期时间' }}
                  </el-button>
                  <el-button
                    type="primary"
                    :loading="publishing"
                    @click="publishRow(row)"
                  >
                    {{ selectedAccountIds(row.id).length ? '立即发布' : '选择账号后发布' }}
                  </el-button>
                  <el-button @click="openPreview(row)">预览视频</el-button>
                  <el-button type="danger" plain @click="deleteRow(row)">删除</el-button>
                </div>

                <p class="rel-sched-item__status-note">{{ statusNote(row.id) }}</p>
                <p
                  v-if="metaOf(row.id).publishMessage"
                  class="rel-sched-item__status-note"
                >
                  {{ metaOf(row.id).publishMessage }}
                </p>
              </div>
            </template>
          </article>
        </div>
      </div>

      <aside class="rel-sched-preview" aria-label="通用预览">
        <h3 class="rel-sched-preview__title">通用预览</h3>
        <div class="rel-sched-preview__box">
          <video
            v-if="previewUrl"
            class="rel-sched-preview__video"
            :src="previewUrl"
            controls
            playsinline
          />
          <div v-else class="rel-sched-preview__empty">点击条目中的「预览视频」在此播放成片</div>
        </div>
        <p v-if="previewCaption" class="rel-sched-preview__caption">{{ previewCaption }}</p>
        <el-button v-if="previewUrl" class="rel-sched-preview__clear" size="small" @click="clearPreview">
          清除预览
        </el-button>
      </aside>
    </div>

    <el-dialog v-model="scheduleDialogVisible" title="设定排期时间" width="420px" destroy-on-close>
      <div class="rel-sched__schedule-field">
        <label class="rel-sched__schedule-label">排期时间</label>
        <input v-model="scheduleInput" class="rel-sched__schedule-input" type="datetime-local" step="60" />
        <p class="rel-sched__schedule-note">
          到达设定时间后，Electron 主进程将按自动发布规则调用本地发布接口
        </p>
      </div>
      <template #footer>
        <el-button @click="scheduleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSchedule">保存</el-button>
      </template>
    </el-dialog>
  </PageShell>
</template>
