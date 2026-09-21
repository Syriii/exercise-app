<script setup lang="ts">
defineProps<{ names: string[]; time?: string; emptyLabel?: string }>();
</script>

<template>
  <small class="training-action-preview">
    <span>{{ time ? `${time} · ` : '' }}{{ names.length ? `${names.length} 个动作` : emptyLabel ?? '暂无动作' }}</span>
    <span v-if="names.length" class="action-preview-names">{{ names.slice(0, 3).join('、') }}{{ names.length > 3 ? '…' : '' }}</span>
  </small>
</template>

<style scoped>
.training-action-preview { display:grid; gap:var(--space-2xs); min-width:0; color:var(--color-muted); font-size:var(--text-sm); }
.action-preview-names { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; }
</style>
