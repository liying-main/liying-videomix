export async function postClipV3(body: unknown) {
  if (!window.electronAPI?.startLocalRender) throw new Error('请通过桌面应用运行本地合成')
  return window.electronAPI.startLocalRender(body)
}

export async function fetchClipV3Progress(params: Record<string, string>) {
  if (!window.electronAPI?.localRenderProgress) throw new Error('请通过桌面应用查询合成进度')
  return window.electronAPI.localRenderProgress(params)
}

export async function cancelClipV3(body?: unknown) {
  if (!window.electronAPI?.cancelLocalRender) throw new Error('请通过桌面应用取消合成')
  return window.electronAPI.cancelLocalRender(body)
}

export async function ensureLocalRenderReady(): Promise<void> {
  if (!window.electronAPI?.getRenderRuntimeStatus) throw new Error('请通过桌面应用运行本地合成')
  const status = await window.electronAPI.getRenderRuntimeStatus()
  if (!status.available) throw new Error(status.message)
}

const unavailable = '当前开源版未包含平台发布插件，请导出成片后手动上传。'
export async function publish(_body: unknown): Promise<import('@/types/api').ApiResponse> { throw new Error(unavailable) }
export async function publishAccount(_body?: unknown): Promise<import('@/types/api').ApiResponse> { throw new Error(unavailable) }
export async function publishAccountStatus(_body?: unknown): Promise<import('@/types/api').ApiResponse> { throw new Error(unavailable) }
export async function uploadFile(_body: FormData): Promise<import('@/types/api').ApiResponse<string>> { throw new Error('本地合成请直接选择本机素材文件') }
