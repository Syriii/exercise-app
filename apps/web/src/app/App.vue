<script setup lang="ts">
import { RouterView } from "vue-router";
import { useSessionStore } from "../stores/session";
const session = useSessionStore();
</script>

<template>
  <RouterView v-slot="{ Component }">
    <!-- Session memory only; no health drafts or photos enter browser storage. -->
    <KeepAlive :key="session.draftScopeVersion" :include="['NutritionPage', 'TrainingPage']">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
