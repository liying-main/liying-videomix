<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Calendar,
  FolderOpened,
  Grid,
  Headset,
  Setting,
  Share,
  User,
  VideoCamera,
} from '@element-plus/icons-vue'
import { BRAND } from '@/constants/channel'
import logoImg from '@/assets/logo.png'

const collapsed = inject<Ref<boolean>>('sidebarCollapsed')!

const route = useRoute()
const router = useRouter()

const navItems = [
  { path: '/workbench', title: '工作台', icon: Grid },
  { path: '/account', title: '账号档案', icon: User },
  { path: '/assets', title: '素材中心', icon: FolderOpened },
  { path: '/shot-edit', title: '镜头剪辑', icon: VideoCamera },
  { path: '/batch', title: '任务中心', icon: Headset },
  { path: '/publish-accounts', title: '发布账号', icon: Share },
  { path: '/schedule', title: '发布排期', icon: Calendar },
]

function isActive(path: string) {
  const current = route.path.replace(/^\//, '') || ''
  const target = path.replace(/^\//, '')
  if (target === 'shot-edit') {
    return current === 'shot-edit' || current.startsWith('shot-edit/')
  }
  if (target === 'settings') {
    return current === 'settings'
  }
  return current === target
}

function goSettings() {
  router.push({ name: 'SystemSettings' })
}
</script>

<template>
  <aside class="app-sidebar" :class="{ 'app-sidebar--collapsed': collapsed }">
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">
        <img :src="logoImg" :alt="BRAND.productName" width="32" height="32" />
      </div>
      <div v-show="!collapsed" class="sidebar-logo-copy">
        <span class="sidebar-logo-text">
          {{ BRAND.titleLeft }}<em>{{ BRAND.titleMiddle }}</em>
        </span>
        <span v-if="BRAND.titleRight" class="sidebar-logo-sub">{{ BRAND.titleRight }}</span>
      </div>
    </div>

    <nav class="sidebar-nav" aria-label="主导航">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="sidebar-nav-item"
        :class="{ 'sidebar-nav-item--active': isActive(item.path) }"
        :title="collapsed ? item.title : undefined"
      >
        <span class="sidebar-nav-icon">
          <el-icon :size="16"><component :is="item.icon" /></el-icon>
        </span>
        <span v-show="!collapsed" class="sidebar-nav-label">{{ item.title }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar-bottom">
      <button
        type="button"
        class="sidebar-nav-item"
        :class="{ 'sidebar-nav-item--active': isActive('/settings') }"
        :title="collapsed ? '系统设置' : undefined"
        @click="goSettings"
      >
        <span class="sidebar-nav-icon">
          <el-icon :size="16"><Setting /></el-icon>
        </span>
        <span v-show="!collapsed" class="sidebar-nav-label">系统设置</span>
      </button>
    </div>
  </aside>
</template>
