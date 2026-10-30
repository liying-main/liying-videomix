/** Audio lead-in padding before voiceover (seconds). */
export const AUDIO_PAD_SEC = 0.07

/** Gap between shots when voiceover is disabled (seconds). */
export const SHOT_GAP_SEC = 0.3

/** Delay between MiniMax TTS requests (ms). */
export const TTS_INTER_SHOT_DELAY_MS = 2000

/** Max MiniMax rate-limit retries per shot. */
export const TTS_RATE_LIMIT_MAX_RETRIES = 3

/** Wait time on MiniMax rate limit (ms). */
export const TTS_RATE_LIMIT_WAIT_MS = 60_000

export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.flv',
  '.wmv',
  '.m4v',
]

export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac']
