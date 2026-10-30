/**
 * 中转站底座配置（主进程副本，保持与 src/shared/station.ts 一致）
 */
export const STATION_HOME = 'https://api.openapi.cn'
export const STATION_BASE_URL = 'https://api.openapi.cn/v1'
export const STATION_CHAT_MODEL = 'deepseek-v4.1-flash'
export const STATION_TTS_MODEL = 'indextts2-v1'
export const STATION_ASR_MODEL = 'whisper-large-v3-turbo'

export function normalizeStationBaseUrl(value: unknown): string {
  const raw = String(value || STATION_BASE_URL).trim()
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址须为 http(s) 地址，不包含账号、查询参数或片段；通常以 /v1 结尾')
  }
  return url.href.replace(/\/+$/, '')
}

