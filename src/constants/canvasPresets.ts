import type { CanvasSettings } from '@/types/mix'

export const CANVAS_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: '1920 × 1080（横屏）', width: 1920, height: 1080 },
  { label: '1080 × 1920（竖屏）', width: 1080, height: 1920 },
  { label: '1080 × 1080（方形）', width: 1080, height: 1080 },
]

export const DEFAULT_CANVAS: CanvasSettings = {
  width: 1080,
  height: 1920,
  fps: 30,
  color: '#000000',
}

export const DEFAULT_EXPORT_ENCODER = 'libx264' as const
export const DEFAULT_EXPORT_BITRATE = '3M'
