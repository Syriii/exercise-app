<script setup lang="ts">
import { RouterView } from "vue-router";
import { useSessionStore } from "../stores/session";
const session = useSessionStore();
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <!-- Auth owns its in-flight registration/settings step, outside account draft invalidation. -->
    <component :is="Component" v-if="route.meta.public" />
    <!-- Session memory only; no health drafts or photos enter browser storage. -->
    <KeepAlive v-else :key="session.draftScopeVersion" :include="['NutritionPage', 'TrainingPage', 'TrainingPlansPage', 'SettingsPage']">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
