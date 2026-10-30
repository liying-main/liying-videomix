/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_LOC_API_URL?: string
  readonly VITE_DEV_SERVER_URL?: string
  readonly VITE_BRAND_PRODUCT_NAME?: string
  readonly VITE_BRAND_TITLE_LEFT?: string
  readonly VITE_BRAND_TITLE_MIDDLE?: string
  readonly VITE_BRAND_TITLE_RIGHT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.png' {
  const src: string
  export default src
}
