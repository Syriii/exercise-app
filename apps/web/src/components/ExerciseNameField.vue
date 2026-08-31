<script setup lang="ts">
import { useId } from "vue";

withDefaults(defineProps<{
  label: string;
  placeholder?: string;
  required?: boolean;
}>(), {
  placeholder: "输入动作名称",
  required: false,
});

const model = defineModel<string>({ required: true });
const inputId = `exercise-name-${useId()}`;
</script>

<template>
  <div class="exercise-name-field">
    <label :for="inputId"><span>{{ label }}</span></label>
    <input
      :id="inputId"
      v-model="model"
      :required="required"
      maxlength="100"
      :placeholder="placeholder"
      autocomplete="off"
    />
  </div>
</template>
