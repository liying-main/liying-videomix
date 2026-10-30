import { STATION_BASE_URL, STATION_CHAT_MODEL, STATION_TTS_MODEL, normalizeStationBaseUrl } from '@/shared/station'

export interface StationPreferences { baseURL: string; chatModel: string; ttsModel: string }
const STORAGE_KEY = 'liying_station_preferences'
export function readStationPreferences(): StationPreferences {
  let saved: Partial<StationPreferences> = {}
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {} } catch { /* defaults */ }
  let baseURL = STATION_BASE_URL
  try { baseURL = normalizeStationBaseUrl(saved.baseURL || STATION_BASE_URL) } catch { /* invalid old configuration */ }
  return {
    baseURL,
    chatModel: String(saved.chatModel || STATION_CHAT_MODEL),
    ttsModel: String(saved.ttsModel || STATION_TTS_MODEL),
  }
}
export function saveStationPreferences(value: StationPreferences): StationPreferences {
  const result = {
    baseURL: normalizeStationBaseUrl(value.baseURL),
    chatModel: value.chatModel.trim() || STATION_CHAT_MODEL,
    ttsModel: value.ttsModel.trim() || STATION_TTS_MODEL,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(result))
  return result
}
