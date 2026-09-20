<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useSessionStore } from "../stores/session";
import { navigationItems, type AppSection } from "./modules";
import AppIcon from "../components/AppIcon.vue";
const sectionIcons = { today: "today", nutrition: "food", training: "train", history: "history", settings: "user" };

withDefaults(
  defineProps<{
    pageClass: string;
    railNote: string;
    showFooter?: boolean;
  }>(),
  {
    showFooter: false,
  },
);

const route = useRoute();
const router = useRouter();
const sessionStore = useSessionStore();

const activeSection = computed<AppSection | null>(() => {
  const routeSection = route.meta.section;
  if (
    typeof routeSection === "string"
    && navigationItems.some((item) => item.id === routeSection)
  ) {
    return routeSection as AppSection;
  }

  return navigationItems.some((item) => item.id === route.name)
    ? route.name as AppSection
    : null;
});

const username = computed(() => sessionStore.account?.username ?? "");
const historyReturn = computed(() => typeof route.query.returnTo === "string" && /^\/history(?:\?|$)/.test(route.query.returnTo) ? route.query.returnTo : null);

function openSection(section: AppSection) {
  void router.push({ name: section });
}
</script>

<template>
  <div class="prototype-shell" :class="pageClass">
    <aside class="desktop-rail" aria-label="主要导航">
      <div class="brand-block">
        <span class="brand-mark" aria-hidden="true"><AppIcon name="leaf" /></span>
        <div><strong>Exercise App</strong><small>训练与饮食记录</small></div>
      </div>
      <nav class="rail-nav">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          class="nav-button"
          :class="{ 'is-active': item.id === activeSection }"
          type="button"
          :aria-current="item.id === activeSection ? 'page' : undefined"
          @click="openSection(item.id)"
        >
          <AppIcon :name="sectionIcons[item.id]" />
          <span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
        </button>
      </nav>
    </aside>

    <div class="app-column">
      <header class="mobile-header">
        <strong class="mobile-brand" aria-label="Exercise App"><AppIcon name="leaf" /> Exercise App</strong>
        <span
          class="mobile-account-name"
          :title="username"
          :aria-label="username ? `当前账号：${username}` : undefined"
        >{{ username }}</span>
      </header>

      <main class="app-main">
        <button v-if="historyReturn" type="button" class="text-action history-return" @click="router.push(historyReturn)">← 返回原历史位置</button>
        <slot />
      </main>

      <footer v-if="showFooter" class="prototype-footer">
        <slot name="footer"><p>Exercise App · MIT License</p></slot>
      </footer>

      <nav class="mobile-dock" aria-label="主要导航">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          class="dock-button"
          :class="{ 'is-active': item.id === activeSection }"
          type="button"
          :aria-current="item.id === activeSection ? 'page' : undefined"
          @click="openSection(item.id)"
        >
          <AppIcon :name="sectionIcons[item.id]" />
          <strong>{{ item.label }}</strong>
        </button>
      </nav>
    </div>
  </div>
</template>
