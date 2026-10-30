import { createRouter, createWebHashHistory } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: AppLayout,
      redirect: '/workbench',
      children: [
        {
          path: 'workbench',
          name: 'Workbench',
          component: () => import('@/pages/WorkbenchPage.vue'),
        },
        {
          path: 'account',
          name: 'Account',
          component: () => import('@/pages/AccountPage.vue'),
        },
        {
          path: 'assets',
          name: 'AssetsCenter',
          component: () => import('@/pages/AssetsCenterPage.vue'),
        },
        {
          path: 'voice',
          name: 'VoiceCenter',
          component: () => import('@/pages/VoiceCenterPage.vue'),
        },
        {
          path: 'shot-edit',
          name: 'VideoMix',
          component: () => import('@/pages/VideoMixPage.vue'),
        },
        { path: 'shot-edit/task', redirect: { name: 'VideoMix' } },
        { path: 'shot-edit/theme/:themeKey', redirect: { name: 'VideoMix' } },
        { path: 'template', redirect: { name: 'VideoMix' } },
        { path: 'mix', redirect: { name: 'VideoMix' } },
        { path: 'tasks', redirect: { name: 'VideoMix' } },
        {
          path: 'batch',
          name: 'BatchGeneration',
          component: () => import('@/pages/BatchGenerationPage.vue'),
        },
        {
          path: 'publish-accounts',
          name: 'PublishAccounts',
          component: () => import('@/pages/UnsupportedPublishPage.vue'),
        },
        {
          path: 'schedule',
          name: 'ReleaseSchedule',
          component: () => import('@/pages/UnsupportedPublishPage.vue'),
        },
        {
          path: 'settings',
          name: 'SystemSettings',
          component: () => import('@/pages/SystemSettingsPage.vue'),
        },
      ],
    },
  ],
})

export default router
