import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'

import App from './App.vue'
import router from './router'
import { appLog } from '@/utils/appLog'
import '@/stores/theme'
import '@/styles/themes.css'
import '@/styles/global.css'
import '@/styles/element-theme.css'
import '@/styles/shell.css'
import '@/styles/pages-dark.css'
import '@/styles/layout.css'

window.addEventListener('error', (event) => {
  appLog.error('window.error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  appLog.error('window.unhandledrejection', {
    reason: event.reason instanceof Error ? event.reason.message : String(event.reason || ''),
  })
})

createApp(App).use(createPinia()).use(router).use(ElementPlus, { locale: zhCn }).mount('#app')
