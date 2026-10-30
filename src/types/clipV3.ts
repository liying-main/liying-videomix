export interface ClipDataBase {
  start?: number
  duration?: number
  file_url?: string
  file?: string
  trim_start?: number | null
  trim_end?: number | null
  volume?: number
}

export interface FFMPEGVideoClip {
  type: 'FFMPEGVideoClip'
  data: ClipDataBase & {
    position?: { x: number; y: number }
    scale?: { x: number; y: number }
  }
}

export interface FFMPEGAudioClip {
  type: 'FFMPEGAudioClip'
  data: ClipDataBase & {
    volume: number
  }
}

export interface FFMPEGDrawtextClip {
  type: 'FFMPEGDrawtextClip'
  data: {
    start: number
    duration: number
    text: string
    position: { x: number; y: number }
    font_size: number
    font_file: string
    color: string
    stroke_width?: number
    stroke_color?: string
    shadow_x?: number
    shadow_y?: number
    shadow_color?: string
  }
}

export interface FFMPEGAssSubtitlesClip {
  type: 'FFMPEGAssSubtitlesClip'
  data: {
    file: string
    font_file: string
    font_size: number
    margin_v: number
    color: string
    outline_width?: number
    outline_color?: string
    effect?: string
  }
}

export type ClipItem =
  | FFMPEGVideoClip
  | FFMPEGAudioClip
  | FFMPEGDrawtextClip
  | FFMPEGAssSubtitlesClip

export interface ClipV3Request {
  timeline: {
    width: number
    height: number
    color: string
    tracks: Array<{ clips: ClipItem[] }>
    duration: null
  }
  exporter: {
    fps: number
    encoder: string
    video_bitrate: string
    output_file: string
  }
}
