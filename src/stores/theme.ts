import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type AppTheme =
  | 'midnight-gold'
  | 'dark-teal'
  | 'dark-indigo'
  | 'light-teal'
  | 'original-ui'
  | 'black-orange'
  | 'dark-crimson'

export const APP_THEMES: { id: AppTheme; label: string }[] = [
  { id: 'midnight-gold', label: '午夜金' },
  { id: 'dark-teal', label: '赛博青' },
  { id: 'dark-indigo', label: '极光蓝' },
  { id: 'light-teal', label: '冰晶绿' },
  { id: 'original-ui', label: '幻紫' },
  { id: 'black-orange', label: '暗夜橙' },
  { id: 'dark-crimson', label: '炽焰红' },
]

const STORAGE_KEY = 'videomix-theme'

function applyTheme(theme: AppTheme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

function readStoredTheme(): AppTheme {
  if (typeof localStorage === 'undefined') return 'midnight-gold'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && APP_THEMES.some((item) => item.id === stored)) {
      return stored as AppTheme
    }
  } catch {
    /* ignore */
  }
  return 'midnight-gold'
}

const initialTheme = readStoredTheme()
applyTheme(initialTheme)

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<AppTheme>(initialTheme)

  watch(
    theme,
    (next) => {
      applyTheme(next)
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
    },
    { immediate: true },
  )

  function setTheme(next: AppTheme) {
    theme.value = next
  }

  return { theme, setTheme }
})
