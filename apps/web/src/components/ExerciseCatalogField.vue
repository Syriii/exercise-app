<script setup lang="ts">
import { onBeforeUnmount, ref, useId } from "vue";

import { trainingApi, type ExerciseCatalogItem } from "../api/training";

withDefaults(defineProps<{
  label: string;
  placeholder?: string;
  required?: boolean;
}>(), {
  placeholder: "输入中文关键词或英文动作名称",
  required: false,
});

const model = defineModel<string>({ required: true });
const inputId = `exercise-catalog-${useId()}`;
const results = ref<readonly ExerciseCatalogItem[]>([]);
const open = ref(false);
const loading = ref(false);
const failed = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let requestSequence = 0;

function clearTimer() {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
}

function scheduleSearch() {
  clearTimer();
  failed.value = false;
  const query = model.value.trim();
  if (query.length === 0) {
    results.value = [];
    open.value = false;
    return;
  }
  searchTimer = setTimeout(() => void search(query), 180);
}

async function search(query: string) {
  const sequence = ++requestSequence;
  loading.value = true;
  try {
    const found = await trainingApi.listExercises(query);
    if (sequence !== requestSequence) return;
    results.value = found;
    open.value = true;
  } catch {
    if (sequence !== requestSequence) return;
    results.value = [];
    failed.value = true;
    open.value = true;
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

function choose(item: ExerciseCatalogItem) {
  model.value = item.name;
  results.value = [];
  open.value = false;
}

function closeLater() {
  clearTimer();
  setTimeout(() => {
    requestSequence += 1;
    loading.value = false;
    open.value = false;
  }, 120);
}

onBeforeUnmount(clearTimer);
</script>

<template>
  <div class="exercise-catalog-field">
    <label :for="inputId"><span>{{ label }}</span></label>
    <div class="exercise-catalog-field__control">
      <input
        :id="inputId"
        v-model="model"
        :required="required"
        maxlength="100"
        :placeholder="placeholder"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="`${inputId}-results`"
        @input="scheduleSearch"
        @focus="scheduleSearch"
        @blur="closeLater"
      />
      <div v-if="open" :id="`${inputId}-results`" class="exercise-catalog-results" role="listbox">
        <p v-if="loading">正在查找动作…</p>
        <p v-else-if="failed">动作库暂时不可用，仍可直接填写。</p>
        <p v-else-if="results.length === 0">没有匹配项，仍可直接填写自定义动作。</p>
        <template v-else>
          <button
            v-for="item in results"
            :key="item.id"
            type="button"
            role="option"
            @mousedown.prevent="choose(item)"
          >
            <img v-if="item.imageUrl" :src="item.imageUrl" alt="" loading="lazy" />
            <span class="exercise-catalog-results__copy">
              <strong>{{ item.name }}</strong>
              <span>{{ item.bodyPartLabel }} · {{ item.equipmentLabel }} · {{ item.target }}</span>
            </span>
          </button>
        </template>
      </div>
    </div>
    <small>可搜索 1,324 个动作，也可以保留自己的名称。</small>
  </div>
</template>
