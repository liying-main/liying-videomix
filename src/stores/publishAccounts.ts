import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { pathJoin } from '@/utils/pathJoin'
import { getAssetsRoot } from '@/utils/assetsRootStorage'
import { getDataRootParent } from '@/utils/firstDataRoot'
import type { PublishAccount, PublishPlatform } from '@/types/publish'
import { PLATFORM_LABELS } from '@/types/publish'

const STORAGE_KEY = 'videomix_publish_accounts'
const PLATFORMS: PublishPlatform[] = ['douyin', 'xiaohongshu', 'shipinhao', 'kuaishou']
const LEGACY_IDS = new Set(['douyin-main', 'xhs-store', 'shipinhao-brand', 'kuaishou-backup'])

function loadAccounts(): PublishAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const result: PublishAccount[] = []
    for (const item of parsed) {
      const account = normalizeAccount(item)
      if (!account || LEGACY_IDS.has(account.id) || seen.has(account.id)) continue
      seen.add(account.id)
      result.push(account)
    }
    return result
  } catch {
    return []
  }
}

function normalizeAccount(raw: unknown): PublishAccount | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = String(item.id || '').trim()
  const platform = String(item.platform || '').trim() as PublishPlatform
  if (!id || !PLATFORMS.includes(platform)) return null

  return {
    id,
    name: String(item.name || id).trim() || id,
    platform,
    publishStatus: item.publishStatus === 'blocked' || item.publishStatus === 'restricted' ? item.publishStatus : 'ok',
    linkStatus: item.linkStatus === 'connected' ? 'connected' : 'reauth',
    linkMessage: String(item.linkMessage ?? '').trim() || undefined,
    currentUrl: String(item.currentUrl ?? '').trim() || undefined,
    lastStatusCheckedAt:
      typeof item.lastStatusCheckedAt === 'number' ? item.lastStatusCheckedAt : undefined,
    positioning: String(item.positioning ?? '-').trim() || '-',
    defaultTimes: String(item.defaultTimes ?? '-').trim() || '-',
    copyStyle: String(item.copyStyle ?? '-').trim() || '-',
    lastPost: String(item.lastPost ?? '-').trim() || '-',
    abnormalReason: String(item.abnormalReason ?? '').trim() || undefined,
    userDataDir: String(item.userDataDir ?? '').trim(),
  }
}

function slugify(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function makeAccountId(name: string, platform: PublishPlatform, existing: string[]): string {
  const base = `${platform}-${slugify(name) || 'account'}`
  let id = base
  let seq = 2
  while (existing.includes(id)) {
    id = `${base}-${seq}`
    seq += 1
  }
  return id
}

function resolveDataRootParent(): string {
  return String(getDataRootParent() || '').trim() || parentDir(getAssetsRoot() || '') || ''
}

function parentDir(target: string): string {
  const trimmed = String(target || '').trim().replace(/[/\\]+$/, '')
  if (!trimmed) return ''
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx <= 0 ? '' : trimmed.slice(0, idx)
}

function profileDirForAccount(dataRoot: string, accountId: string): string {
  return pathJoin(dataRoot, 'publish-browser-profiles', sanitizeDirName(accountId))
}

function sanitizeDirName(value: string): string {
  return (String(value || '').trim() || 'default').replace(/[/\\:*?"<>|]/g, '_')
}

export function platformLabel(platform: PublishPlatform): string {
  return PLATFORM_LABELS[platform] || platform
}

export const usePublishAccountsStore = defineStore('publishAccounts', () => {
  const accounts = ref<PublishAccount[]>(loadAccounts())

  const accountOptions = computed(() =>
    accounts.value.map((account) => ({
      value: account.id,
      label: `${account.name} / ${platformLabel(account.platform)}${account.linkStatus === 'connected' ? '' : ' / 待登录'}`,
      platform: account.platform,
      userDataDir: account.userDataDir,
      linkStatus: account.linkStatus,
      disabled: account.linkStatus !== 'connected',
    })),
  )

  function persist(): void {
    const snapshot = JSON.parse(JSON.stringify(accounts.value)) as PublishAccount[]
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      /* ignore */
    }
    window.electronAPI?.syncPublishAccounts?.(snapshot)
  }

  function setAccounts(next: PublishAccount[]): void {
    accounts.value = next
    persist()
  }

  function patchAccount(id: string, patch: Partial<PublishAccount>): void {
    setAccounts(accounts.value.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  function addAccount(input: {
    name: string
    platform: PublishPlatform
    positioning?: string
    defaultTimes?: string
    copyStyle?: string
    userDataDir?: string
  }): PublishAccount {
    const name = String(input.name || '').trim()
    const account: PublishAccount = {
      id: makeAccountId(
        name,
        input.platform,
        accounts.value.map((a) => a.id),
      ),
      name,
      platform: input.platform,
      publishStatus: 'ok',
      linkStatus: 'reauth',
      linkMessage: '请先登录该账号',
      positioning: String(input.positioning || '').trim() || '-',
      defaultTimes: String(input.defaultTimes || '').trim() || '-',
      copyStyle: String(input.copyStyle || '').trim() || '-',
      lastPost: '-',
      userDataDir: String(input.userDataDir || '').trim(),
    }
    setAccounts([...accounts.value, account])
    return account
  }

  function removeAccount(id: string): boolean {
    const trimmed = String(id || '').trim()
    if (!trimmed || !accounts.value.some((a) => a.id === trimmed)) return false
    setAccounts(accounts.value.filter((a) => a.id !== trimmed))
    return true
  }

  function getAccountById(id: string): PublishAccount | undefined {
    return accounts.value.find((a) => a.id === String(id || '').trim())
  }

  async function ensureAutoBrowserProfileDirs(): Promise<void> {
    const api = window.electronAPI
    if (!api?.ensureDir) return

    const dataRoot = resolveDataRootParent()
    if (!dataRoot.trim()) return

    const profilesRoot = pathJoin(dataRoot, 'publish-browser-profiles')
    await api.ensureDir(profilesRoot)

    for (const account of accounts.value) {
      const dir = profileDirForAccount(dataRoot, account.id)
      try {
        await api.ensureDir(dir)
      } catch {
        continue
      }
      if (account.userDataDir !== dir) {
        patchAccount(account.id, { userDataDir: dir })
      }
    }
  }

  persist()

  return {
    accounts,
    accountOptions,
    addAccount,
    removeAccount,
    patchAccount,
    getAccountById,
    ensureAutoBrowserProfileDirs,
    persist,
  }
})
