# 厉影AI混剪

免费的 MIT 开源桌面视频混剪客户端，使用本机 FFmpeg 合成视频。Electron + Vue 3 + TypeScript；本地合成无需登录或 API Key。可选的文案和语音生成由用户选择的云服务提供，费用按该服务的实际规则与额度结算。

## 可以做什么

- 按镜头组合本地视频，调整画布、原声、用户配音及循环背景音乐。
- 添加中文标题、字幕，使用系统字体或自行导入的 TTF / OTF / TTC 字体。
- 在本机执行合成，查看进度、取消任务；错误会显示原因，不会把失败任务显示为已出片。
- 在设置中配置兼容的 API 地址、模型与 Key，选择使用文案改写或语音生成。

当前开源版不含平台账号登录、定时发布及自动发布插件，相关页面已明确禁用；成片可自行上传。历史任务的本地元数据仍保留。不会启动或下载旧版闭源 backend。

## 本地运行

建议 Node.js 22、npm，以及支持 `libx264`、`drawtext`、`subtitles` / libass 的 FFmpeg 和 FFprobe。将两者加入 PATH，或设置以下环境变量。项目不附带 FFmpeg 二进制、内置音色或第三方字体。

```powershell
# 安装在自选目录时，可显式指定；已在 PATH 中则无需设置。
$env:LIYING_FFMPEG_PATH = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
$env:LIYING_FFPROBE_PATH = 'C:\Tools\ffmpeg\bin\ffprobe.exe'
npm ci
npm run electron:dev
```

首次打开会检查本机合成环境；缺少 FFmpeg / FFprobe 时先安装并重新检查。导入自己的视频、音频；字体默认留空会自动选择系统字体，也可在标题/字幕设置中导入字体。无内置音色时，请在设置中导入有权使用的参考音频，或关闭云端配音使用本地素材。仅运行 `npm run dev` 是浏览器界面预览，不能调用桌面的文件与合成功能。

```powershell
npm run typecheck
npm run build
npm run electron:start
# 可选：在本机制作 Windows 安装包，不会打包旧 backend、音色或字体。
npm run electron:build
```

`npm ci` 会下载 Electron 运行时。仅检查源码构建时可用 `npm ci --ignore-scripts`；随后如需启动桌面端，先执行 `node node_modules/electron/install.js`。当前本地合成和集成测试已在 Windows 验证，其他平台尚未验证。

## 可选云服务配置

系统设置支持自定义 Base URL、文案模型、配音模型和 API Key。默认服务入口为 [OpenAPI](https://api.openapi.cn)，默认地址 `https://api.openapi.cn/v1`；**OpenAPI 由本项目维护方提供，也可以选用其他兼容服务。** 软件本身免费，不承诺第三方或默认云服务的免费额度。

文案使用 `/chat/completions`；配音使用 `/audio/speech`，当前语音适配要求模型支持把参考音频的 data URI 作为 `voice` 参数（默认 `indextts2-v1`）。仅兼容聊天接口的服务不一定支持这种语音接口，请按服务方文档设置模型。设置保存不发送付费测试请求；本仓库的离线测试也不调用云端接口。

使用文案功能时文本会发送给选定服务；使用云端配音时文本和所选参考音频会发送给选定服务。本地视频合成本身不上传素材。Key 与设置保存在当前用户的本地应用数据中，未做额外加密；不要共享含 Key 的配置或日志。导入参考音频只保存到本机，实际调用配音时才发送。

## 本地合成支持范围

`electron/local-renderer.ts` 直接消费前端生成的时间线，支持 `FFMPEGVideoClip`、`FFMPEGAudioClip`、`FFMPEGDrawtextClip`、`FFMPEGAssSubtitlesClip`。支持本地路径 / `file://`、裁剪、缩放、位置和开始时间、音量、BGM 循环、SRT / ASS、字幕 `none` / `fade_pop` / `scroll` 效果。未知片段或缺少文件会明确失败；已有输出文件不会被覆盖。

一次运行一个本地合成任务。默认 `libx264` 已验证；`h264_nvenc` 需要合适的 NVIDIA 硬件、驱动与 FFmpeg 编译支持，尚未验证。画布需为偶数尺寸，范围 2–7680，帧率 1–120，每个请求最多 500 个片段。输出目录需支持硬链接（例如 Windows NTFS），用于原子保存并保护渲染期间新建的同名文件；不支持时任务会明确失败。此适配器不实现旧闭源后端的非核心插件。

## 离线集成测试

安装 FFmpeg / FFprobe 后运行：

```powershell
npm run test:renderer
# 找不到字体时可指定本机有权使用的字体，再运行测试。
$env:LIYING_TEST_FONT = 'C:\Windows\Fonts\msyh.ttc'
```

测试调用实际前端 `buildClipV3Request`，生成临时视频/声音，验证镜头顺序、时长、中文标题与字幕画面、音频、系统/导入字体、中文空格路径、进度、取消清理及同名输出保护。参考音频导入与语音请求格式使用离线 mock 验证。未安装 FFmpeg / FFprobe 时集成测试会明确失败，需先安装或配置上述环境变量；源码构建不需要 FFmpeg。测试不依赖随仓库发布的字体、音色或旧 backend，不发送付费 API 请求。

## 开源与参与

项目源码按 [MIT](LICENSE) 开源。第三方依赖、FFmpeg 以及用户自行安装的字体、音频按各自许可使用；本项目的 MIT 许可不授予第三方资源权利。详见 [第三方说明](THIRD_PARTY_NOTICES.md)、[贡献指南](CONTRIBUTING.md) 与 [安全说明](SECURITY.md)。

## 相关开源项目

- [数字人桌面版 / 口播智能体](https://github.com/liying-main/liying_ai)
- [数字人轻量版](https://github.com/liying-main/digitalhuman-open)
- [混剪桌面版](https://github.com/liying-main/liying-videomix)
- [混剪轻量版](https://github.com/liying-main/videomix-open)
