<script setup lang="ts">
import { computed } from "vue";
import type { IntakeDraft } from "./intake-draft";
import { intakeMethodLabels } from "./intake-draft";
import IntakeCalculation from "./IntakeCalculation.vue";

const props = defineProps<{ draft: IntakeDraft; busy: boolean; disabled?: boolean; changed: boolean }>();
defineEmits<{ preview: []; save: []; cancel: []; refresh: [] }>();
const fields = computed(() => props.draft.fields);
function invalidate() { props.draft.preview = null; props.draft.previewKey = null; props.draft.error = ""; }
</script>
<template>
  <form class="intake-editor" :aria-label="`记录吃入量：${draft.item.label}`" @submit.prevent="$emit('preview')" @input="invalidate" @change="invalidate">
    <fieldset :disabled="busy || disabled">
      <div class="intake-heading"><strong>{{ draft.item.label }} · 实际吃入量</strong><span class="field-help">保存前原记录保持生效</span></div>
      <label>份量依据<select v-model="fields.method"><option v-for="(label, method) in intakeMethodLabels" :key="method" :value="method">{{ label }}</option></select></label>
      <template v-if="fields.method === 'net_weight'">
        <label>食物净重 g<input v-model="fields.netGrams" type="number" min="0" max="100000" step="any" required /></label>
        <p class="field-help">填写秤上的食物净重，容器已经去皮。</p>
      </template>
      <template v-else-if="fields.method === 'gross_tare'">
        <div class="intake-fields"><label>含盒重量 g<input v-model="fields.grossGrams" type="number" min="0" max="100000" step="any" required /></label><label>容器重量 g<input v-model="fields.tareGrams" type="number" min="0" max="100000" step="any" required /></label></div>
        <p class="field-help">容器只扣一次。未称的盒重先用其他依据，不填作实测。</p>
      </template>
      <template v-else-if="fields.method === 'before_after'">
        <div class="intake-fields"><label>餐前重量 g<input v-model="fields.beforeGrams" type="number" min="0" max="100000" step="any" required /></label><label>餐后重量 g<input v-model="fields.afterGrams" type="number" min="0" max="100000" step="any" required /></label></div>
        <label class="checkbox-row"><input v-model="fields.sameContainer" type="checkbox" required />餐前、餐后使用相同容器和称量口径</label>
        <p class="field-help">餐后留下的食物、骨头和汤汁已通过差值排除，不再扣一遍。</p>
      </template>
      <template v-else-if="fields.method === 'count'">
        <div class="intake-fields"><label>取用数量<input v-model="fields.countAmount" type="number" min="0" max="100000" step="any" required /></label><label>份量单位<input v-model="fields.unit" maxlength="30" required placeholder="个、片、瓣、碗" /></label></div>
        <label>数量来源<select v-model="fields.source"><option value="user_estimate">我知道的数量或估计</option><option value="merchant">商家或包装标示</option><option value="measured">已经测量</option></select></label>
        <p class="field-help">个、碗等需与这项食物的营养基准一致；没有依据时不换算成克。</p>
      </template>
      <template v-else-if="fields.method === 'photo_estimate'">
        <div class="intake-fields"><label>照片估计份量<input v-model="fields.estimateAmount" type="number" min="0" max="100000" step="any" required /></label><label>份量单位<input v-model="fields.unit" maxlength="30" required /></label></div>
        <label>估计依据<input v-model="fields.reference" maxlength="1000" required placeholder="例如：图中一小碗，沿用本次照片估计" /></label>
      </template>
      <template v-else>
        <label>食物铺放形状<select v-model="fields.shape"><option value="box">近似长方体</option><option value="cylinder">近似圆柱</option></select></label>
        <div v-if="fields.shape === 'box'" class="intake-fields"><label>长度 cm<input v-model="fields.lengthCm" type="number" min="0.001" max="1000" step="any" required /></label><label>宽度 cm<input v-model="fields.widthCm" type="number" min="0.001" max="1000" step="any" required /></label></div>
        <label v-else>直径 cm<input v-model="fields.diameterCm" type="number" min="0.001" max="1000" step="any" required /></label>
        <div class="intake-fields"><label>平均厚度 cm<input v-model="fields.heightCm" type="number" min="0.001" max="1000" step="any" required /></label><label>估计密度 g/ml<input v-model="fields.density" type="number" min="0.001" max="30" step="any" required /></label></div>
        <label>尺寸和密度依据<input v-model="fields.reference" maxlength="1000" required placeholder="说明同框参照尺寸、厚度与密度假设" /></label>
        <p class="field-help">尺寸、厚度和松紧仍会带来误差，参数不会被自动填成实测值。</p>
      </template>
      <details>
        <summary>只吃了部分或有其他说明</summary>
        <label>这份实际吃入 %<input v-model="fields.fractionPercent" type="number" min="0" max="100" step="any" required /></label>
        <label v-if="fields.method === 'net_weight' || fields.method === 'gross_tare'">另外未食用的皮核等 g<input v-model="fields.excludedGrams" type="number" min="0" max="100000" step="any" /></label>
        <label v-if="fields.method === 'before_after'">另外倒掉或移走的重量 g<input v-model="fields.discardedGrams" type="number" min="0" max="100000" step="any" /></label>
        <label>补充说明<input v-model="fields.note" maxlength="1000" placeholder="例如：只吃米饭的一半，菜已吃完" /></label>
      </details>
      <label>营养依据<select v-model="fields.basisKind"><option value="current_record">使用这项食物已有的营养基准</option><option value="label">补充包装或商家标签</option></select></label>
      <template v-if="fields.basisKind === 'label'">
        <div class="intake-fields"><label>标签基准量<input v-model="fields.labelAmount" type="number" min="0.001" max="100000" step="any" required /></label><label>标签基准单位<input v-model="fields.labelUnit" required maxlength="30" placeholder="g、ml、个、份" /></label></div>
        <div class="intake-fields"><label>标签能量<input v-model="fields.labelEnergy" type="number" min="0" max="418400" step="any" /></label><label>能量单位<select v-model="fields.energyUnit"><option value="kcal">千卡 kcal</option><option value="kJ">千焦 kJ</option></select></label></div>
        <details><summary>标签三项营养（可选）</summary><div class="intake-fields"><label>标签蛋白质 g<input v-model="fields.labelProtein" type="number" min="0" max="10000" step="any" /></label><label>标签碳水 g<input v-model="fields.labelCarbs" type="number" min="0" max="10000" step="any" /></label><label>标签脂肪 g<input v-model="fields.labelFat" type="number" min="0" max="10000" step="any" /></label></div></details>
        <label>标签来源<input v-model="fields.labelSource" required maxlength="1000" placeholder="例如：包装营养表，每100克" /></label>
        <p class="field-help">没有标示的项目留空；0表示明确标示为零。</p>
      </template>
      <p v-else class="field-help">优先使用已保存的食物基准；原先来自照片的营养仍属于估计。</p>
      <p v-if="changed" class="form-error">这项食物已有更新。输入保留，重新读取原食物后可继续计算。</p>
      <p v-if="draft.error" class="form-error" role="alert">{{ draft.error }}</p>
      <button v-if="changed || draft.error" class="text-action" type="button" @click="$emit('refresh')">重新读取原食物，保留输入</button>
      <IntakeCalculation v-if="draft.preview" :evidence="draft.preview" />
      <div class="intake-actions"><button class="action-button" type="submit">{{ busy ? '计算中…' : '预览计算' }}</button><button class="primary-button" type="button" :disabled="!draft.preview || !!draft.error || changed" @click="$emit('save')">保存吃入量</button><button class="text-action" type="button" @click="$emit('cancel')">取消</button></div>
    </fieldset>
  </form>
</template>
<style scoped>
/* Hallmark · component: intake editor · genre: modern-minimal · theme: existing-app
 * pre-emit critique: P5 H4 E4 S5 R4 V4 */
.intake-editor { min-width: 0; padding: var(--space-sm); border: var(--rule-thin) solid var(--color-rule); border-radius: var(--radius-sm); background: var(--color-paper-2); }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; display: grid; gap: .75rem; }
.intake-heading { display: grid; gap: .2rem; }
.intake-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.intake-fields > label, label { min-width: 0; }
input, select { min-width: 0; max-width: 100%; width: 100%; }
.checkbox-row input { width: auto; }
.intake-editor details { display: grid; gap: .65rem; }
.intake-editor details > label, .intake-editor details > div { margin-top: .65rem; }
.intake-editor .field-help, .intake-editor .form-error { margin: 0; }
.intake-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.intake-actions > button { flex-shrink: 0; max-width: 100%; }
@media (max-width: 359px) { .intake-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
