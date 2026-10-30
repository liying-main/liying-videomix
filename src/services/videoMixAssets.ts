import { CUSTOM_TEMPLATE_TYPE, TEMPLATE_CATEGORY_MAP } from '@/constants/mixTemplates'
import { getAssetsRoot } from '@/utils/assetsRootStorage'
import { pathJoin } from '@/utils/pathJoin'
import type { FolderGroupItem } from '@/types/mix'
import { listVideosInFolder, type MediaFileItem } from '@/services/mixMediaFiles'

export function categoryFolderPath(assetsRoot: string, categoryName: string): string {
  return pathJoin(assetsRoot, categoryName)
}

export async function loadVideosForCategory(categoryName: string): Promise<MediaFileItem[]> {
  const root = getAssetsRoot()?.trim()
  if (!root || !categoryName.trim()) return []
  return listVideosInFolder(categoryFolderPath(root, categoryName.trim()))
}

export async function loadTemplateShotAssets(templateType: string): Promise<FolderGroupItem[]> {
  if (templateType === CUSTOM_TEMPLATE_TYPE || !TEMPLATE_CATEGORY_MAP[templateType]) {
    return []
  }

  const categories = TEMPLATE_CATEGORY_MAP[templateType]
  const root = getAssetsRoot()?.trim()
  if (!root) return []

  const groups: FolderGroupItem[] = []
  for (let i = 0; i < categories.length; i += 1) {
    const category = categories[i]
    const folder = categoryFolderPath(root, category)
    let files: MediaFileItem[] = []
    try {
      files = await listVideosInFolder(folder)
    } catch {
      files = []
    }
    groups.push({
      folder,
      assetCategory: category,
      files,
    })
  }
  return groups
}

export async function mergeTemplateShotAssets(
  templateType: string,
  currentGroups: FolderGroupItem[],
): Promise<FolderGroupItem[]> {
  const categories = TEMPLATE_CATEGORY_MAP[templateType]
  if (!categories?.length) return currentGroups

  const root = getAssetsRoot()?.trim()
  if (!root) return currentGroups

  const next = [...currentGroups]
  for (let i = 0; i < next.length; i += 1) {
    if (next[i].files?.length) continue
    const category = categories[i]
    if (!category) continue
    const folder = categoryFolderPath(root, category)
    try {
      const files = await listVideosInFolder(folder)
      next[i] = {
        ...next[i],
        folder,
        assetCategory: category,
        files,
      }
    } catch {
      next[i] = { ...next[i], folder, assetCategory: category, files: [] }
    }
  }
  return next
}

function shuffleIndices(length: number): number[] {
  const arr = Array.from({ length }, (_, i) => i)
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function shotBucketKey(group: FolderGroupItem, index: number): string {
  const folder = String(group.folder || '').trim()
  if (folder) return `folder:${folder}`
  const category = String(group.assetCategory || '').trim()
  if (category) return `category:${category}`
  return `shot:${index}`
}

/** Diversify selected video index when multiple shots share the same category/folder. */
export function buildDeduplicatedSelectionIndices(groups: FolderGroupItem[]): number[] {
  const indices = Array.from({ length: groups.length }, () => 0)
  let cursor = 0

  while (cursor < groups.length) {
    const key = shotBucketKey(groups[cursor], cursor)
    let end = cursor + 1
    while (end < groups.length && shotBucketKey(groups[end], end) === key) end += 1

    const bucket = groups.slice(cursor, end)
    const bucketSize = bucket.length
    const minFiles = Math.min(
      ...bucket.map((g) => (Array.isArray(g.files) ? g.files.length : 0)),
    )

    if (minFiles <= 1) {
      for (let i = cursor; i < end; i += 1) indices[i] = 0
      cursor = end
      continue
    }

    if (minFiles >= bucketSize) {
      const order = shuffleIndices(minFiles)
      for (let i = 0; i < bucketSize; i += 1) indices[cursor + i] = order[i] ?? 0
      cursor = end
      continue
    }

    const order = shuffleIndices(minFiles)
    let orderCursor = 0
    let last = -1
    for (let i = 0; i < bucketSize; i += 1) {
      let pick = order[orderCursor % order.length] ?? 0
      orderCursor += 1
      if (pick === last) {
        const alt = order.find((v) => v !== last)
        pick = alt ?? pick
      }
      indices[cursor + i] = pick
      last = pick
    }
    cursor = end
  }

  return indices
}

export function clipItemName(item: MediaFileItem | undefined): string {
  return String(item?.name || '').trim() || 'video.mp4'
}

export async function resolveClipItemUrl(item: MediaFileItem | undefined): Promise<string> {
  return String(item?.url || '').trim()
}
