/** 渠道/品牌配置（由 scripts/prepare-channel.mjs 生成，开发前可运行 default） */
export { CHANNEL, BRAND } from '@/shared/channel.generated'

/** 界面 Logo（无字 logo.png → src/assets/logo.png，仅侧栏/顶栏） */
export { default as BRAND_LOGO_URL } from '@/assets/logo.png'

declare const __APP_VERSION__: string

export function getClientApiVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.2'
}
