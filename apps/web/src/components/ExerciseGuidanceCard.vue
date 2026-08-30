<script setup lang="ts">
import { ref } from "vue";

import type { ExerciseGuidance } from "../api/training";

defineProps<{
  exerciseName: string;
  guidance: ExerciseGuidance | null | undefined;
}>();

const showingAnimation = ref(false);
</script>

<template>
  <section class="exercise-guidance" :aria-label="`${exerciseName}动作预览`">
    <p v-if="guidance === undefined">正在读取动作要点…</p>
    <template v-else-if="guidance === null">
      <strong>这个动作还没有指导内容</strong>
      <p>可以继续安排或记录，不会影响训练数据。</p>
    </template>
    <template v-else>
      <div class="panel-heading">
        <div><strong>{{ guidance.exerciseName }}</strong><p>{{ guidance.overview }}</p></div>
        <span class="status-chip">{{ guidance.reviewStatus === 'reviewed' ? '已审阅' : '内容草案' }}</span>
      </div>
      <figure v-if="guidance.imageUrl || guidance.animationUrl" class="exercise-guidance-media">
        <img
          :src="showingAnimation && guidance.animationUrl ? guidance.animationUrl : (guidance.imageUrl ?? guidance.animationUrl ?? '')"
          :alt="`${guidance.exerciseName}${showingAnimation ? '动作动画' : '起始姿势示意'}`"
        />
        <figcaption>
          <button
            v-if="guidance.imageUrl && guidance.animationUrl"
            class="text-action"
            type="button"
            @click="showingAnimation = !showingAnimation"
          >{{ showingAnimation ? '查看静态图' : '播放动作动画' }}</button>
        </figcaption>
      </figure>
      <div v-if="guidance.commonMistakes.length > 0" class="guidance-columns">
        <div><strong>动作顺序</strong><ol><li v-for="step in guidance.steps" :key="step">{{ step }}</li></ol></div>
        <div><strong>注意</strong><ul><li v-for="mistake in guidance.commonMistakes" :key="mistake">{{ mistake }}</li></ul></div>
      </div>
      <div v-else class="guidance-columns guidance-columns--single">
        <div><strong>动作顺序</strong><ol><li v-for="step in guidance.steps" :key="step">{{ step }}</li></ol></div>
      </div>
      <p v-if="guidance.alternatives.length > 0"><strong>可以替换为：</strong>{{ guidance.alternatives.join('、') }}</p>
      <a v-if="guidance.videoUrl" class="text-action" :href="guidance.videoUrl" target="_blank" rel="noopener noreferrer">观看示范视频</a>
      <p v-else-if="!guidance.animationUrl" class="data-note">当前提供文字步骤；本地未配置可用的动作媒体。</p>
      <details class="guidance-source"><summary>来源与适用范围</summary><p class="safety-copy">{{ guidance.limitations }}</p><small>{{ guidance.sourceName }} · {{ guidance.license }} · {{ guidance.version }}</small></details>
    </template>
  </section>
</template>
