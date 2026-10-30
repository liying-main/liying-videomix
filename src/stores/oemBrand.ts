import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BRAND, BRAND_LOGO_URL } from '@/constants/channel'

export const useOemBrandStore = defineStore('oemBrand', () => {
  const loading = ref(false)
  const info = ref<null>(null)

  const videoName = computed(() => BRAND.productName)
  const videoIcon = computed(() => BRAND_LOGO_URL)
  const videoIcon2 = computed(() => BRAND_LOGO_URL)

  function clear() {
    /* brand is static */
  }

  async function refreshByActivationCode(_code: string) {
    /* legacy no-op: brand comes from channel constants */
  }

  return {
    info,
    loading,
    videoName,
    videoIcon,
    videoIcon2,
    clear,
    refreshByActivationCode,
  }
})
