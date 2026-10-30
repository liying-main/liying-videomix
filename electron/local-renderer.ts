import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const execute = promisify(execFile)
type Clip = { type: string; data: Record<string, any> }
type Request = { timeline: { width: number; height: number; color: string; tracks: { clips: Clip[] }[] }; exporter: { fps: number; encoder: string; video_bitrate: string; output_file: string } }
type Job = { id: string; status: 'running' | 'done' | 'error' | 'cancelled'; progress: number; message?: string; url?: string }
export interface RuntimeStatus { available: boolean; message: string; ffmpeg: string; ffprobe: string }

function number(value: unknown, fallback: number, min = 0, max = 86400): number {
  const parsed = value == null ? fallback : Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`无效时间线数值：${String(value)}`)
  return parsed
}
function color(value: unknown, fallback = 'white'): string {
  const v = String(value || fallback)
  if (!/^(#[a-f\d]{6}([a-f\d]{2})?|[a-z]+)$/i.test(v)) throw new Error('颜色必须为色名或十六进制颜色')
  return v
}
function localPath(value: unknown): string {
  const raw = String(value || '').trim()
  const p = raw.startsWith('file:') ? fileURLToPath(raw) : raw
  if (!path.isAbsolute(p)) throw new Error('合成仅支持本机绝对路径，请重新导入素材')
  return path.normalize(p)
}
function assColor(value: unknown): string {
  const v = String(value || '#FFFFFF').replace('#', '')
  if (!/^[a-f\d]{6}$/i.test(v)) throw new Error('字幕颜色必须为 #RRGGBB')
  return `&H00${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}`
}
async function fontFamily(file: string): Promise<string> {
  const data = await fs.readFile(file)
  const offset = data.toString('ascii', 0, 4) === 'ttcf' ? data.readUInt32BE(12) : 0
  for (let i = 0; i < data.readUInt16BE(offset + 4); i++) {
    const record = offset + 12 + i * 16
    if (data.toString('ascii', record, record + 4) !== 'name') continue
    const start = data.readUInt32BE(record + 8)
    const strings = start + data.readUInt16BE(start + 4)
    for (let j = 0; j < data.readUInt16BE(start + 2); j++) {
      const entry = start + 6 + j * 12
      if (data.readUInt16BE(entry) !== 3 || data.readUInt16BE(entry + 6) !== 1) continue
      const bytes = Buffer.from(data.subarray(strings + data.readUInt16BE(entry + 10), strings + data.readUInt16BE(entry + 10) + data.readUInt16BE(entry + 8)))
      return bytes.swap16().toString('utf16le').replace(/[,':\\]/g, '')
    }
  }
  throw new Error('无法识别字幕字体名称，请选择系统 TrueType 字体')
}

function srtToAss(text: string, width: number, height: number, style: string, effect: string): string {
  const timestamp = (stamp: string) => {
    const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(stamp.trim())
    if (!match) throw new Error('SRT 时间戳格式无效')
    return `${Number(match[1])}:${match[2]}:${match[3]}.${match[4].padEnd(3, '0').slice(0, 2)}`
  }
  const effects: Record<string, string> = {
    '': '', none: '', normal: '',
    fade_pop: '{\\fad(200,0)\\fscx0\\fscy0\\t(0,300,\\fscx120\\fscy120)\\t(300,500,\\fscx100\\fscy100)}',
    scroll: `{\\move(${width + 100},${height * 0.85},${-width},${height * 0.85})}`,
  }
  if (!(effect in effects)) throw new Error('不支持此字幕效果，请重新选择字幕效果')
  const rows = text.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n\s*\n/).map(block => {
    const lines = block.split('\n')
    if (/^\d+$/.test(lines[0]?.trim())) lines.shift()
    const time = lines.shift()?.split('-->')
    if (!time || time.length !== 2) throw new Error('SRT 字幕块缺少开始或结束时间')
    const content = lines.join('\\N').replace(/[{}]/g, '').replace(/<\/?[^>]+>/g, '')
    return `Dialogue: 0,${timestamp(time[0]!)},${timestamp(time[1]!)},Default,,0,0,0,,${effects[effect]}${content}`
  })
  if (!rows.length) throw new Error('字幕文件为空')
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: ${style}\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${rows.join('\n')}\n`
}

/** The adapter owns exactly one active job. No HTTP backend or cloud calls. */
export class LocalRenderer {
  private active: { job: Job; process?: ChildProcess; cancelled: boolean } | null = null
  private jobs = new Map<string, Job>()
  constructor(private resourcesDir: string, private projectDir: string) {}

  executable(kind: 'ffmpeg' | 'ffprobe'): string {
    return process.env[`LIYING_${kind.toUpperCase()}_PATH`] || kind
  }

  async runtime(): Promise<RuntimeStatus> {
    const ffmpeg = this.executable('ffmpeg'), ffprobe = this.executable('ffprobe')
    try {
      await Promise.all([ffmpeg, ffprobe].map(exe => execute(exe, ['-version'], { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 })))
      return { available: true, message: '本地 FFmpeg 合成可用，无需云端 Key；发布平台插件未包含在此版本。', ffmpeg, ffprobe }
    } catch {
      return { available: false, message: '未找到可运行的 FFmpeg / FFprobe。请安装并加入 PATH，或设置 LIYING_FFMPEG_PATH 与 LIYING_FFPROBE_PATH 后重启。', ffmpeg, ffprobe }
    }
  }

  async start(body: unknown): Promise<{ code: number; data: { job_id: string } }> {
    if (this.active) throw new Error('已有本地合成任务正在运行，请等待完成或取消')
    const runtime = await this.runtime()
    if (!runtime.available) throw new Error(runtime.message)
    if (this.active) throw new Error('已有本地合成任务正在运行')
    const job: Job = { id: randomUUID(), status: 'running', progress: 0 }
    const state = { job, cancelled: false } as NonNullable<LocalRenderer['active']>
    this.active = state
    this.jobs.set(job.id, job)
    if (this.jobs.size > 30) this.jobs.delete(this.jobs.keys().next().value!)
    void this.render(body as Request, state).catch(error => {
      job.status = state.cancelled ? 'cancelled' : 'error'
      job.message = state.cancelled ? '任务已取消' : error instanceof Error ? error.message : String(error)
    }).finally(() => { if (this.active === state) this.active = null })
    return { code: 0, data: { job_id: job.id } }
  }

  progress(id: string) {
    const job = this.jobs.get(id)
    return job ? { code: 0, data: { ...job, data: { progress: job.progress } } } : { code: 1, message: '找不到合成任务' }
  }

  cancel(id?: string) {
    const active = this.active
    if (active && (!id || active.job.id === id)) {
      active.cancelled = true
      active.process?.kill()
    }
    return { code: 0 }
  }

  private async fontPath(value: unknown): Promise<string> {
    const v = String(value || '')
    if (v.startsWith('../fonts/')) {
      const name = path.basename(v)
      for (const root of [path.join(this.resourcesDir, 'fonts'), path.join(this.projectDir, 'resources', 'fonts')]) {
        const candidate = path.join(root, name)
        try { await fs.access(candidate); return candidate } catch { /* try next */ }
      }
    }
    const result = localPath(value)
    await fs.access(result)
    return result
  }

  private async render(request: Request, state: NonNullable<LocalRenderer['active']>) {
    let scratch = '', partial = ''
    const checkCancelled = () => { if (state.cancelled) throw new Error('任务已取消') }
    try {
      const clips = request?.timeline?.tracks?.flatMap(track => track.clips)
      if (!Array.isArray(clips) || !clips.length || clips.length > 500) throw new Error('时间线须包含 1–500 个片段')
      const width = number(request.timeline.width, 1920, 2, 7680), height = number(request.timeline.height, 1080, 2, 7680)
      if (width % 2 || height % 2) throw new Error('画布宽高必须为偶数')
      const fps = number(request.exporter?.fps, 30, 1, 120)
      const duration = Math.max(...clips.filter(c => c.type === 'FFMPEGVideoClip').map(c => number(c.data.start, 0) + number(c.data.duration, 0, 0.01)))
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('时间线没有有效视频片段')
      const encoder = request.exporter.encoder || 'libx264'
      if (!['libx264', 'h264_nvenc'].includes(encoder)) throw new Error('编码器仅支持 libx264 或 h264_nvenc')
      const bitrate = request.exporter.video_bitrate || '3M'
      if (!/^\d+(\.\d+)?[kKmM]?$/.test(bitrate)) throw new Error('无效视频码率')
      const output = localPath(request.exporter.output_file)
      if (path.extname(output).toLowerCase() !== '.mp4') throw new Error('导出文件必须为 .mp4')
      try { await fs.access(output); throw new Error('导出文件已存在，请选择新的文件名') } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
      await fs.mkdir(path.dirname(output), { recursive: true })
      scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'liying-render-'))
      partial = path.join(path.dirname(output), `.liying-${state.job.id}.mp4`)
      const args = ['-hide_banner', '-nostdin', '-y']
      const filters = [`color=c=${color(request.timeline.color, 'black')}:s=${width}x${height}:r=${fps}:d=${duration}[base]`, `anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[silence]`]
      const audioLabels = ['[silence]']
      let input = 0, picture = 'base', overlayIndex = 0
      const decorate: Clip[] = []
      for (const clip of clips) {
        checkCancelled()
        const d = clip.data || {}
        if (clip.type === 'FFMPEGDrawtextClip' || clip.type === 'FFMPEGAssSubtitlesClip') { decorate.push(clip); continue }
        if (!['FFMPEGVideoClip', 'FFMPEGAudioClip'].includes(clip.type)) throw new Error(`未支持的片段类型：${clip.type}`)
        const source = localPath(d.file_url || d.file)
        await fs.access(source)
        const start = number(d.start, 0), trim = number(d.trim_start, 0)
        const length = d.duration === -1 ? duration - start : number(d.duration, duration - start, 0.01)
        if (length <= 0) continue
        const endTrim = d.trim_end == null ? trim + length : number(d.trim_end, trim + length, trim + 0.001)
        const sourceLength = Math.min(length, endTrim - trim)
        const volume = number(d.volume, clip.type === 'FFMPEGVideoClip' ? 0 : 1, 0, 10)
        const { stdout } = await execute(this.executable('ffprobe'), ['-v', 'error', '-show_streams', '-of', 'json', source], { windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
        const streams = JSON.parse(stdout).streams as Array<{ codec_type: string }>
        const audio = streams.some(s => s.codec_type === 'audio')
        if (d.duration === -1) args.push('-stream_loop', '-1')
        args.push('-ss', String(trim), '-t', String(sourceLength), '-i', source)
        if (clip.type === 'FFMPEGVideoClip') {
          if (!streams.some(s => s.codec_type === 'video')) throw new Error('所选素材没有视频轨道')
          const x = number(d.position?.x, 0, -7680, 7680), y = number(d.position?.y, 0, -7680, 7680)
          const w = number(d.scale?.x, width, -1, 7680), h = number(d.scale?.y, height, -1, 7680)
          if (!w || !h) throw new Error('视频缩放尺寸不能为零')
          const scaling = w > 0 && h > 0 ? `scale=${w}:${h}` : `scale=${width}:${height}:force_original_aspect_ratio=decrease`
          filters.push(`[${input}:v]${scaling},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length},setpts=PTS-STARTPTS+${start}/TB[v${input}]`)
          const next = `overlay${overlayIndex++}`
          filters.push(`[${picture}][v${input}]overlay=x=${x}:y=${y}:eof_action=pass:repeatlast=0:enable='gte(t,${start})*lt(t,${start + length})'[${next}]`)
          picture = next
        } else if (!audio) throw new Error('所选配音或音乐文件没有音轨')
        if (audio && volume > 0) {
          const label = `a${input}`
          filters.push(`[${input}:a]atrim=duration=${length},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${volume},adelay=${Math.round(start * 48000)}S:all=1[${label}]`)
          audioLabels.push(`[${label}]`)
        }
        input++
      }
      let decoration = 0
      for (const clip of decorate) {
        checkCancelled()
        const d = clip.data, index = decoration++, next = `text${index}`
        const font = await this.fontPath(d.font_file)
        const fontName = `font${index}${path.extname(font)}`
        await fs.copyFile(font, path.join(scratch, fontName))
        if (clip.type === 'FFMPEGDrawtextClip') {
          const textName = `title${index}.txt`
          await fs.writeFile(path.join(scratch, textName), String(d.text || ''), 'utf8')
          const start = number(d.start, 0), end = start + number(d.duration, duration)
          filters.push(`[${picture}]drawtext=fontfile=${fontName}:textfile=${textName}:expansion=none:fontsize=${number(d.font_size, 48, 1, 1000)}:fontcolor=${color(d.color)}:x=${number(d.position?.x, 0, -7680, 7680)}:y=${number(d.position?.y, 0, -7680, 7680)}:borderw=${number(d.stroke_width, 0, 0, 50)}:bordercolor=${color(d.stroke_color, 'black')}:shadowx=${number(d.shadow_x, 0, -100, 100)}:shadowy=${number(d.shadow_y, 0, -100, 100)}:shadowcolor=${color(d.shadow_color, 'black')}:enable='gte(t,${start})*lt(t,${end})'[${next}]`)
        } else {
          const source = localPath(d.file)
          const extension = path.extname(source).toLowerCase()
          const subtitle = `subtitle${index}.ass`
          if (!['.srt', '.ass'].includes(extension)) throw new Error('字幕仅支持 SRT / ASS')
          const family = await fontFamily(font)
          if (extension === '.srt') {
            const style = `Default,${family},${number(d.font_size, 48, 1, 1000)},${assColor(d.color)},&H000000FF,${assColor(d.outline_color || '#000000')},&H00000000,0,0,0,0,100,100,0,0,1,${number(d.outline_width, 0, 0, 50)},0,2,10,10,${number(d.margin_v, 30, 0, 7680)},1`
            await fs.writeFile(path.join(scratch, subtitle), srtToAss(await fs.readFile(source, 'utf8'), width, height, style, String(d.effect || '')), 'utf8')
          } else {
            if (d.effect && !['none', 'normal'].includes(String(d.effect))) throw new Error('ASS 已包含样式，请清空额外字幕效果')
            await fs.copyFile(source, path.join(scratch, subtitle))
          }
          filters.push(`[${picture}]subtitles=filename=${subtitle}:fontsdir=.:force_style='Fontname=${family}'[${next}]`)
        }
        picture = next
      }
      filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,atrim=duration=${duration}[mixed]`)
      await fs.writeFile(path.join(scratch, 'graph.txt'), filters.join(';\n'), 'utf8')
      args.push('-filter_complex_script', 'graph.txt', '-map', `[${picture}]`, '-map', '[mixed]', '-c:v', encoder, '-b:v', bitrate, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', String(duration), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', partial)
      checkCancelled()
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.executable('ffmpeg'), args, { cwd: scratch, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        state.process = child
        let log = '', progressBuffer = ''
        child.stdout!.on('data', chunk => {
          progressBuffer += chunk.toString()
          const lines = progressBuffer.split(/\r?\n/); progressBuffer = lines.pop() || ''
          for (const line of lines) if (line.startsWith('out_time_us=')) state.job.progress = Math.max(state.job.progress, Math.min(99, Math.round(Number(line.slice(12)) / 1000000 / duration * 100)))
        })
        child.stderr!.on('data', chunk => { log = (log + chunk.toString()).slice(-6000) })
        child.once('error', reject)
        child.once('close', code => code === 0 && !state.cancelled ? resolve() : reject(new Error(state.cancelled ? '任务已取消' : `FFmpeg 合成失败 (${code})：${log.slice(-2500)}`)))
      })
      checkCancelled()
      if (!(await fs.stat(partial)).size) throw new Error('FFmpeg 未生成有效文件')
      // Both paths are in the same directory. link atomically refuses an existing
      // destination, including one created by another process during rendering.
      await fs.link(partial, output)
      await fs.unlink(partial)
      partial = ''
      state.job.status = 'done'; state.job.progress = 100; state.job.url = pathToFileURL(output).href
    } finally {
      if (partial) await fs.rm(partial, { force: true }).catch(() => {})
      if (scratch && path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('liying-render-')) await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
    }
  }
}
