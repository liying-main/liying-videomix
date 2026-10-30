const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { build } = require('esbuild')
const { LocalRenderer } = require('../dist-electron/local-renderer.js')
const execute = promisify(execFile)
const ffmpeg = process.env.LIYING_FFMPEG_PATH || 'ffmpeg'
const ffprobe = process.env.LIYING_FFPROBE_PATH || 'ffprobe'
let root, renderer, buildClipV3Request, uploadMiniMaxVoiceFile, miniMaxTextToAudio, systemFont, importedFont, sources, voices, musicDir

async function run(exe, args, extra = {}) {
  return execute(exe, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...extra })
}
async function metadata(file) {
  return JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])).stdout)
}
async function finish(id, progress = []) {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const job = renderer.progress(id).data
    progress.push(job.progress)
    if (job.status !== 'running') { await new Promise(r => setTimeout(r, 20)); return job }
    await new Promise(r => setTimeout(r, 40))
  }
  renderer.cancel(id)
  throw new Error('Local render timed out')
}
async function render(request, progress = []) {
  return finish((await renderer.start(request)).data.job_id, progress)
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'liying-integration-中文 空格-'))
  renderer = new LocalRenderer(path.join(root, 'absent resources'), root)
  assert.equal((await renderer.runtime()).available, true, 'Install FFmpeg and FFprobe or configure LIYING_*_PATH')
  for (const candidate of [process.env.LIYING_TEST_FONT, 'C:\\Windows\\Fonts\\msyh.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Helvetica.ttc'].filter(Boolean)) {
    try { await fs.access(candidate); systemFont = candidate; break } catch {}
  }
  assert.ok(systemFont, 'Set LIYING_TEST_FONT to an existing TTF / TTC font')
  importedFont = path.join(root, `自有 字体${path.extname(systemFont)}`)
  await fs.copyFile(systemFont, importedFont)
  const bundle = path.join(root, 'frontend.cjs')
  await build({ stdin: { contents: "export { buildClipV3Request } from './src/services/mixRenderPipeline'; export { uploadMiniMaxVoiceFile, miniMaxTextToAudio } from './src/api/minimax'", resolveDir: process.cwd(), loader: 'ts' }, outfile: bundle,
    bundle: true, platform: 'node', format: 'cjs', alias: { '@': path.resolve('src') },
    define: { 'import.meta.env': '{}' }, logLevel: 'silent' })
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.window = { electronAPI: {
    platform: process.platform,
    getPath: async () => root,
    defaultFontsDirectory: async () => path.join(root, 'fonts not distributed'),
    systemFontsDirectory: async () => path.dirname(systemFont),
    listFontFiles: async dir => dir === path.dirname(systemFont) ? [{ file: systemFont, label: path.basename(systemFont) }] : [],
    pathExists: async file => { try { await fs.access(file); return true } catch { return false } },
    pathToFileUrl: async file => pathToFileURL(file).href,
    ensureDir: async dir => fs.mkdir(dir, { recursive: true }),
    writeFileUtf8: async (file, text) => fs.writeFile(file, text, 'utf8'),
    writeFileBuffer: async (file, data) => fs.writeFile(file, data),
    readDir: async dir => (await fs.readdir(dir, { withFileTypes: true })).map(e => ({ name: e.name, path: path.join(dir, e.name), isDirectory: e.isDirectory() })),
    probeVideoMeta: async file => { const m = await metadata(file); const v = m.streams.find(s => s.codec_type === 'video'); return { duration: Number(m.format.duration), width: v.width, height: v.height } },
  } }
  ;({ buildClipV3Request, uploadMiniMaxVoiceFile, miniMaxTextToAudio } = require(bundle))
  sources = [path.join(root, '红色 video.mp4'), path.join(root, '蓝色 video.mp4')]
  voices = [path.join(root, '用户 配音1.wav'), path.join(root, '用户 配音2.wav')]
  musicDir = path.join(root, '用户 音乐')
  await fs.mkdir(musicDir)
  for (let i = 0; i < 2; i++) {
    await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${i ? 'blue' : 'red'}:s=320x240:r=24:d=1.4`, '-f', 'lavfi', '-i', 'sine=frequency=180:duration=1.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sources[i]])
    await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${500 + i * 200}:duration=0.7`, voices[i]])
  }
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=120:duration=0.3', path.join(musicDir, '音乐.wav')])
})
after(async () => {
  renderer?.cancel()
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('liying-integration-')) await fs.rm(root, { recursive: true, force: true })
})

async function frontendRequest(name, customFont = false, effect = '') {
  const shots = sources.map((file, i) => ({ folder: root, scriptOriginal: `字幕测试 ${i + 1}`, scriptRewritten: '', audioUrl: pathToFileURL(voices[i]).href,
    baseDurationSec: 0.7, durationSec: 0.7, muteOriginal: true, status: 'ready', selectedFileIndex: 0 }))
  const task = { id: name, shots, clipSourcesPerShot: sources.map(url => ({ url: pathToFileURL(url).href })), selectionIndices: [0, 0],
    canvasSnapshot: { width: 320, height: 240, fps: 24, color: '#000000' }, voiceoverEnabledSnapshot: true,
    srtSettingsSnapshot: { enableSubtitle: true, font_file: customFont ? importedFont : '', font_size: 24, margin_v: 20, color: '#FFFFFF', outline_width: 1, outline_color: '#000000', subtitle_effect: effect },
    titleSettingsSnapshot: { titles: [{ text: "本地测试 100% : ' \\" }], timeStartSec: 0, timeEndSec: 0, font_file: customFont ? importedFont : '', font_size: 20,
      color: '#FFFFFF', centered: false, stroke_width: 1, stroke_color: '#000000', shadow_color: '#000000', shadow_x: 0, shadow_y: 0, position_x: 10, position_y: 12, title2: { text: '', position_x: 0, position_y: 0 } },
    bgMusicSnapshot: { enabled: true, folder: musicDir, volume: 0.3, selectedTrack: '音乐.wav' }, exportEncoderSnapshot: 'libx264', exportVideoBitrateSnapshot: '1M' }
  return buildClipV3Request(task, shots, { outputFilePath: path.join(root, `${name} 成片.mp4`), folderGroups: [], assetsScan: null, defaultVoiceEnabled: true, defaultVoiceVolume: 0.8, workDir: root })
}

async function frame(file, time) {
  return (await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout
}
function whitePixels(frame, top, bottom) {
  let count = 0
  for (let y = top; y < bottom; y++) for (let x = 0; x < 320; x++) {
    const p = (y * 320 + x) * 3
    if (frame[p] > 180 && frame[p + 1] > 180 && frame[p + 2] > 180) count++
  }
  return count
}

test('user reference audio imports locally and becomes data URI for speech (mock only)', async () => {
  const previousFetch = global.fetch
  let requests = 0
  global.fetch = async (url, options) => {
    requests++
    if (String(url).startsWith('file:')) return new Response(await fs.readFile(fileURLToPath(url)), { headers: { 'content-type': 'audio/wav' } })
    assert.ok(String(url).endsWith('/audio/speech'))
    assert.ok(JSON.parse(options.body).voice.startsWith('data:audio/wav;base64,'))
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } })
  }
  try {
    const bytes = await fs.readFile(voices[0])
    const result = await uploadMiniMaxVoiceFile('', new File([bytes], '用户 reference.wav', { type: 'audio/wav' }))
    assert.equal(requests, 0, 'import must not contact any service')
    assert.ok(result.file.file_id.startsWith('file:///'))
    assert.deepEqual(await fs.readFile(fileURLToPath(result.file.file_id)), bytes)
    const audio = await miniMaxTextToAudio('offline-test-only', { text: '离线模拟测试', voiceId: result.file.file_id })
    assert.equal(requests, 2)
    assert.equal(audio.audio_file, 'AQID')
  } finally { global.fetch = previousFetch }
})

test('real frontend timeline: system font, local user voices, music loop, title/subtitles, Unicode/space paths, video/audio timing', async () => {
  const req = await frontendRequest('system-font')
  const clips = req.timeline.tracks[0].clips
  assert.equal(clips.filter(c => c.type === 'FFMPEGVideoClip').length, 2)
  assert.equal(clips.filter(c => c.type === 'FFMPEGAudioClip').length, 3)
  assert.ok(clips.find(c => c.type === 'FFMPEGAssSubtitlesClip').data.font_file.toLowerCase().includes(path.basename(systemFont).toLowerCase()))
  const history = [], job = await render(req, history)
  assert.equal(job.status, 'done', job.message)
  assert.equal(job.progress, 100)
  assert.ok(history.every((p, i) => i === 0 || p >= history[i - 1]))
  const info = await metadata(req.exporter.output_file)
  const video = info.streams.find(s => s.codec_type === 'video')
  assert.equal(video.width, 320); assert.equal(video.height, 240)
  assert.ok(info.streams.some(s => s.codec_type === 'audio'))
  const videoClips = clips.filter(c => c.type === 'FFMPEGVideoClip')
  const end = videoClips.at(-1).data.start + videoClips.at(-1).data.duration
  assert.ok(Math.abs(Number(info.format.duration) - end) < 0.15)
  const first = await frame(req.exporter.output_file, 0.5), second = await frame(req.exporter.output_file, videoClips[1].data.start + 0.5)
  const pixel = (110 * 320 + 4) * 3
  assert.ok(first[pixel] > 180 && first[pixel + 2] < 70, 'first shot should be red')
  assert.ok(second[pixel + 2] > 180 && second[pixel] < 70, 'second shot should be blue')
  assert.ok(whitePixels(first, 5, 50) > 50, 'drawtext title must be visible')
  assert.ok(whitePixels(first, 175, 235) > 50, 'Chinese subtitles must be visible')
  const pcm = (await run(ffmpeg, ['-v', 'error', '-i', req.exporter.output_file, '-vn', '-f', 's16le', '-ac', '1', 'pipe:1'], { encoding: 'buffer' })).stdout
  let square = 0
  for (let i = 0; i < pcm.length; i += 2) square += pcm.readInt16LE(i) ** 2
  assert.ok(Math.sqrt(square / (pcm.length / 2)) > 200, 'output must contain audible local voices/music')
})

test('frontend timeline supports imported font and fade_pop / scroll subtitle effects without distributed resources', async () => {
  for (const effect of ['fade_pop', 'scroll']) {
    const req = await frontendRequest(`imported-${effect}`, true, effect)
    assert.equal(req.timeline.tracks[0].clips.find(c => c.type === 'FFMPEGAssSubtitlesClip').data.effect, effect)
    const job = await render(req)
    assert.equal(job.status, 'done', job.message)
    assert.ok((await fs.stat(req.exporter.output_file)).size > 1000)
  }
})

test('cancel an active render and clean partial output', async () => {
  const req = await frontendRequest('cancel')
  req.timeline.width = 1920; req.timeline.height = 1080
  req.timeline.tracks[0].clips = req.timeline.tracks[0].clips.filter(c => c.type === 'FFMPEGVideoClip').slice(0, 1)
  Object.assign(req.timeline.tracks[0].clips[0].data, { duration: 120, trim_start: 0, trim_end: null, scale: { x: 1920, y: 1080 } })
  const id = (await renderer.start(req)).data.job_id
  const deadline = Date.now() + 15000
  while (!renderer.active?.process && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
  assert.ok(renderer.active?.process, 'cancel must reach the actual FFmpeg subprocess')
  renderer.cancel(id)
  assert.equal((await finish(id)).status, 'cancelled')
  await assert.rejects(fs.access(req.exporter.output_file))
  assert.equal((await fs.readdir(root)).filter(f => f.startsWith('.liying-')).length, 0)
})

test('output created by another process during rendering is preserved', async () => {
  const req = await frontendRequest('output-race')
  req.timeline.width = 1920; req.timeline.height = 1080
  req.timeline.tracks[0].clips = req.timeline.tracks[0].clips.filter(c => c.type === 'FFMPEGVideoClip').slice(0, 1)
  Object.assign(req.timeline.tracks[0].clips[0].data, { duration: 10, trim_start: 0, trim_end: null, scale: { x: 1920, y: 1080 } })
  const id = (await renderer.start(req)).data.job_id
  const deadline = Date.now() + 15000
  while (!renderer.active?.process && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
  assert.ok(renderer.active?.process, 'collision must occur after the initial output check')
  await fs.writeFile(req.exporter.output_file, 'another-process-file', { flag: 'wx' })
  const job = await finish(id)
  assert.equal(job.status, 'error')
  assert.equal(await fs.readFile(req.exporter.output_file, 'utf8'), 'another-process-file')
  assert.equal((await fs.readdir(root)).filter(f => f.startsWith('.liying-')).length, 0)
})

test('unknown clips, missing assets, and existing output fail explicitly; missing engine is detected', async () => {
  for (const mode of ['unsupported', 'missing-font', 'existing']) {
    const req = await frontendRequest(mode)
    if (mode === 'unsupported') req.timeline.tracks[0].clips.push({ type: 'ClosedPluginClip', data: {} })
    if (mode === 'missing-font') req.timeline.tracks[0].clips.find(c => c.type === 'FFMPEGDrawtextClip').data.font_file = path.join(root, 'absent.ttf')
    if (mode === 'existing') await fs.writeFile(req.exporter.output_file, 'keep-me')
    const job = await render(req)
    assert.equal(job.status, 'error'); assert.ok(job.message)
    if (mode === 'existing') assert.equal(await fs.readFile(req.exporter.output_file, 'utf8'), 'keep-me')
    else await assert.rejects(fs.access(req.exporter.output_file))
  }
  const previous = process.env.LIYING_FFMPEG_PATH
  process.env.LIYING_FFMPEG_PATH = path.join(root, 'not-installed.exe')
  try { assert.equal((await renderer.runtime()).available, false) }
  finally { if (previous === undefined) delete process.env.LIYING_FFMPEG_PATH; else process.env.LIYING_FFMPEG_PATH = previous }
})
