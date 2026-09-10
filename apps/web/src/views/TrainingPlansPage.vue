<script setup lang="ts">
import { onActivated, reactive, ref } from "vue";
import { useRouter } from "vue-router";
const router = useRouter();


import { ApiError } from "../api/client";
import AppShell from "../app/AppShell.vue";
import ExerciseNameField from "../components/ExerciseNameField.vue";
import ExerciseGuidanceCard from "../components/ExerciseGuidanceCard.vue";
import { trainingSuggestionApi, type TrainingSuggestion, type TrainingSuggestionPreferences } from "../api/training-suggestions";
import {
  trainingApi,
  type ExerciseGuidance,
  type TrainingProgram,
  type TrainingProgramUnit,
  type TrainingTemplate,
  type TrainingTemplateInput,
} from "../api/training";

interface TemplateItemForm {
  exerciseName: string;
  targetSets: string | number;
  targetRepsMin: string | number;
  targetRepsMax: string | number;
  targetWeightKg: string;
  note: string;
}

const templates = ref<TrainingTemplate[]>([]);
const programs = ref<TrainingProgram[]>([]);
const suggestions = ref<TrainingSuggestion[]>([]);
const suggestionFormOpen = ref(false);
const suggestionForm = reactive<TrainingSuggestionPreferences>({ goal: "general", experience: "beginner", equipment: "full_gym", availableDaysPerWeek: 2, sessionMinutes: 60, hasInjuryOrMedicalLimitation: false });
const planTab = ref<"templates" | "programs">("templates");
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref("");
const notice = ref("");
const editorOpen = ref(false);
const editingTemplate = ref<TrainingTemplate | null>(null);
const templateForm = reactive({
  name: "",
  note: "",
  items: [emptyTemplateItem()] as TemplateItemForm[],
});
const programEditorOpen = ref(false);
const editingProgram = ref<TrainingProgram | null>(null);
const selectedProgramId = ref<string | null>(null);
const programForm = reactive({ name: "", note: "", weekCount: "4" as string | number });
const unitEditorOpen = ref(false);
const editingUnit = ref<TrainingProgramUnit | null>(null);
const unitProgramId = ref<string | null>(null);
const unitForm = reactive({
  weekNumber: "1" as string | number,
  name: "",
  note: "",
  sourceTemplateId: "",
  items: [emptyTemplateItem()] as TemplateItemForm[],
});
const scheduleEditorOpen = ref(false);
const scheduleSource = reactive({
  templateId: null as string | null,
  programId: null as string | null,
  programUnitId: null as string | null,
});
const scheduleForm = reactive({ localDate: currentLocalDate(), title: "", note: "" });
const guidanceOpenItemId = ref<string | null>(null);
const guidanceByItem = reactive<Record<string, ExerciseGuidance | null>>({});

function emptyTemplateItem(): TemplateItemForm {
  return {
    exerciseName: "",
    targetSets: "",
    targetRepsMin: "",
    targetRepsMax: "",
    targetWeightKg: "",
    note: "",
  };
}

function currentLocalDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weekNumbers(program: TrainingProgram): number[] {
  return Array.from({ length: program.weekCount }, (_, index) => index + 1);
}

function unitsForWeek(program: TrainingProgram, weekNumber: number): TrainingProgramUnit[] {
  return program.units.filter((unit) => unit.weekNumber === weekNumber);
}

function sourceTemplateName(unit: TrainingProgramUnit): string | null {
  if (unit.sourceTemplateId === null) return null;
  return templates.value.find((template) => template.id === unit.sourceTemplateId)?.name ?? "已归档的单次方案";
}

function guidanceKey(scope: string, parentId: string, itemId: string): string {
  return `${scope}:${parentId}:${itemId}`;
}

function openScheduleEditor(options: {
  title: string;
  templateId?: string;
  programId?: string;
  programUnitId?: string;
}) {
  scheduleSource.templateId = options.templateId ?? null;
  scheduleSource.programId = options.programId ?? null;
  scheduleSource.programUnitId = options.programUnitId ?? null;
  scheduleForm.localDate = currentLocalDate();
  scheduleForm.title = options.title;
  scheduleForm.note = "";
  scheduleEditorOpen.value = true;
}

async function saveSchedule() {
  saving.value = true;
  errorMessage.value = "";
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await trainingApi.createSchedule({
      localDate: scheduleForm.localDate,
      timeZone,
      title: scheduleForm.title,
      note: nullableText(scheduleForm.note),
      sourceTemplateId: scheduleSource.templateId,
      sourceProgramId: scheduleSource.programId,
      sourceProgramUnitId: scheduleSource.programUnitId,
    });
    scheduleEditorOpen.value = false;
    notice.value = `已安排到 ${scheduleForm.localDate}`;
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

function nullableText(value: string): string | null {
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : cleaned;
}

function nullableInteger(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : Number.parseInt(cleaned, 10);
}

function templatePayload(): TrainingTemplateInput {
  return {
    name: templateForm.name,
    note: nullableText(templateForm.note),
    items: templateForm.items.map((item) => ({
      exerciseName: item.exerciseName,
      targetSets: nullableInteger(item.targetSets),
      targetRepsMin: nullableInteger(item.targetRepsMin),
      targetRepsMax: nullableInteger(item.targetRepsMax),
      targetWeightKg: nullableText(item.targetWeightKg),
      targetDurationSeconds: null,
      targetDistanceMeters: null,
      note: nullableText(item.note),
    })),
  };
}

function reportError(error: unknown) {
  console.error("Training operation failed", error);
  errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了，请稍后再试";
}

async function toggleGuidance(key: string, exerciseName: string) {
  if (guidanceOpenItemId.value === key) {
    guidanceOpenItemId.value = null;
    return;
  }
  guidanceOpenItemId.value = key;
  if (guidanceByItem[key] !== undefined) return;
  try {
    guidanceByItem[key] = await trainingApi.getGuidance(exerciseName);
  } catch (error) {
    reportError(error);
    guidanceOpenItemId.value = null;
  }
}

async function load() {
  if (saving.value) return;
  loading.value = true;
  errorMessage.value = "";
  const results = await Promise.allSettled([trainingApi.listTemplates(), trainingApi.listPrograms(), trainingSuggestionApi.list()] as const);
  const [a, b, c] = results;
  if (a.status === "fulfilled") templates.value = a.value;
  if (b.status === "fulfilled") programs.value = b.value;
  if (c.status === "fulfilled") suggestions.value = c.value;
  const failed = results.find(value => value.status === "rejected");
  if (failed?.status === "rejected") reportError(failed.reason);
  loading.value = false;
}

async function generateSuggestion() {
  saving.value = true; errorMessage.value = "";
  try { suggestions.value = [await trainingSuggestionApi.generate(suggestionForm), ...suggestions.value]; suggestionFormOpen.value = false; notice.value = "草案已生成，先看动作是否合适。"; }
  catch (error) { reportError(error); }
  finally { saving.value = false; }
}

async function adoptSuggestion(value: TrainingSuggestion) {
  saving.value = true; errorMessage.value = "";
  try { const result = await trainingSuggestionApi.adopt(value.id, value.revision); suggestions.value = suggestions.value.map((item) => item.id === value.id ? result.suggestion : item); templates.value = await trainingApi.listTemplates(); planTab.value = "templates"; notice.value = "已经存到单次方案。"; }
  catch (error) { reportError(error); }
  finally { saving.value = false; }
}

async function dismissSuggestion(value: TrainingSuggestion) {
  saving.value = true; errorMessage.value = "";
  try { const result = await trainingSuggestionApi.dismiss(value.id, value.revision); suggestions.value = suggestions.value.map((item) => item.id === value.id ? result : item); notice.value = "这份草案已移除。"; }
  catch (error) { reportError(error); }
  finally { saving.value = false; }
}

function openCreateProgram() {
  editingProgram.value = null;
  programForm.name = "";
  programForm.note = "";
  programForm.weekCount = "4";
  programEditorOpen.value = true;
}

function openEditProgram(program: TrainingProgram) {
  editingProgram.value = program;
  programForm.name = program.name;
  programForm.note = program.note ?? "";
  programForm.weekCount = program.weekCount;
  programEditorOpen.value = true;
}

async function saveProgram() {
  saving.value = true;
  errorMessage.value = "";
  try {
    const input = {
      name: programForm.name,
      note: nullableText(programForm.note),
      weekCount: nullableInteger(programForm.weekCount) ?? 1,
    };
    if (editingProgram.value === null) {
      const created = await trainingApi.createProgram(input);
      selectedProgramId.value = created.id;
      notice.value = "周期计划已建立，可以开始添加训练日";
    } else {
      await trainingApi.updateProgram(editingProgram.value.id, editingProgram.value.revision, input);
      notice.value = "周期计划已更新";
    }
    programs.value = await trainingApi.listPrograms();
    programEditorOpen.value = false;
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function archiveProgram(program: TrainingProgram) {
  saving.value = true;
  errorMessage.value = "";
  try {
    await trainingApi.archiveProgram(program.id, program.revision);
    programs.value = await trainingApi.listPrograms();
    if (selectedProgramId.value === program.id) selectedProgramId.value = null;
    notice.value = "周期计划已归档；已经产生的训练记录仍会保留";
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

function openAddUnit(program: TrainingProgram) {
  editingUnit.value = null;
  unitProgramId.value = program.id;
  unitForm.weekNumber = 1;
  unitForm.name = "";
  unitForm.note = "";
  unitForm.sourceTemplateId = "";
  unitForm.items.splice(0, unitForm.items.length, emptyTemplateItem());
  unitEditorOpen.value = true;
}

function openEditUnit(program: TrainingProgram, unit: TrainingProgramUnit) {
  editingUnit.value = unit;
  unitProgramId.value = program.id;
  unitForm.weekNumber = unit.weekNumber;
  unitForm.name = unit.name;
  unitForm.note = unit.note ?? "";
  unitForm.sourceTemplateId = unit.sourceTemplateId ?? "";
  unitForm.items.splice(
    0,
    unitForm.items.length,
    ...unit.items.map((item) => ({
      exerciseName: item.exerciseName,
      targetSets: item.targetSets?.toString() ?? "",
      targetRepsMin: item.targetRepsMin?.toString() ?? "",
      targetRepsMax: item.targetRepsMax?.toString() ?? "",
      targetWeightKg: item.targetWeightKg === null ? "" : Number(item.targetWeightKg).toString(),
      note: item.note ?? "",
    })),
  );
  unitEditorOpen.value = true;
}

function unitPayload() {
  return {
    weekNumber: nullableInteger(unitForm.weekNumber) ?? 1,
    name: unitForm.name,
    note: nullableText(unitForm.note),
    items: unitForm.items.map((item) => ({
      exerciseName: item.exerciseName,
      targetSets: nullableInteger(item.targetSets),
      targetRepsMin: nullableInteger(item.targetRepsMin),
      targetRepsMax: nullableInteger(item.targetRepsMax),
      targetWeightKg: nullableText(item.targetWeightKg),
      targetDurationSeconds: null,
      targetDistanceMeters: null,
      note: nullableText(item.note),
    })),
  };
}

async function saveUnit() {
  const program = programs.value.find((candidate) => candidate.id === unitProgramId.value);
  if (program === undefined) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const input = unitPayload();
    if (editingUnit.value === null) {
      await trainingApi.addProgramUnit(
        program.id,
        program.revision,
        nullableText(unitForm.sourceTemplateId),
        unitForm.sourceTemplateId ? { ...input, items: [] } : input,
      );
      notice.value = unitForm.sourceTemplateId
        ? "训练方案已复制到周期中；以后不会自动同步"
        : "训练日已加入周期";
    } else {
      await trainingApi.updateProgramUnit(
        program.id,
        editingUnit.value.id,
        program.revision,
        input,
      );
      notice.value = "周期训练日已更新";
    }
    programs.value = await trainingApi.listPrograms();
    unitEditorOpen.value = false;
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

function sourceUpdated(unit: TrainingProgramUnit): boolean {
  if (unit.sourceTemplateId === null || unit.sourceTemplateRevision === null) return false;
  const source = templates.value.find((template) => template.id === unit.sourceTemplateId);
  return source !== undefined && source.revision > unit.sourceTemplateRevision;
}

async function reimportUnit(program: TrainingProgram, unit: TrainingProgramUnit) {
  if (!window.confirm("重新导入会用来源方案的当前内容覆盖这个训练日的本地调整。确定继续吗？")) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    await trainingApi.reimportProgramUnit(program.id, unit.id, program.revision);
    programs.value = await trainingApi.listPrograms();
    notice.value = "训练日已按来源方案的当前内容重新导入";
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

function startProgramUnit(program: TrainingProgram, unit: TrainingProgramUnit) {
  void router.push({ name: "training", query: { programId: program.id, unitId: unit.id } });
}

function openCreateTemplate() {
  editingTemplate.value = null;
  templateForm.name = "";
  templateForm.note = "";
  templateForm.items.splice(0, templateForm.items.length, emptyTemplateItem());
  editorOpen.value = true;
}

function openEditTemplate(template: TrainingTemplate) {
  editingTemplate.value = template;
  templateForm.name = template.name;
  templateForm.note = template.note ?? "";
  templateForm.items.splice(
    0,
    templateForm.items.length,
    ...template.items.map((item) => ({
      exerciseName: item.exerciseName,
      targetSets: item.targetSets?.toString() ?? "",
      targetRepsMin: item.targetRepsMin?.toString() ?? "",
      targetRepsMax: item.targetRepsMax?.toString() ?? "",
      targetWeightKg: item.targetWeightKg === null ? "" : Number(item.targetWeightKg).toString(),
      note: item.note ?? "",
    })),
  );
  editorOpen.value = true;
}

async function saveTemplate() {
  saving.value = true;
  errorMessage.value = "";
  try {
    if (editingTemplate.value === null) {
      await trainingApi.createTemplate(templatePayload());
      notice.value = "训练方案已保存";
    } else {
      await trainingApi.updateTemplate(
        editingTemplate.value.id,
        editingTemplate.value.revision,
        templatePayload(),
      );
      notice.value = "训练方案已更新；已保存的训练记录不会改变";
    }
    editorOpen.value = false;
    templates.value = await trainingApi.listTemplates();
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function archiveTemplate(template: TrainingTemplate) {
  saving.value = true;
  errorMessage.value = "";
  try {
    await trainingApi.archiveTemplate(template.id, template.revision);
    templates.value = await trainingApi.listTemplates();
    notice.value = "方案已归档，已有训练记录仍会保留";
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function copyTemplate(template: TrainingTemplate) {
  saving.value = true;
  errorMessage.value = "";
  try {
    await trainingApi.createTemplate({
      name: `${template.name.slice(0, 77)} 副本`,
      note: template.note,
      items: template.items.map((item) => ({
        exerciseName: item.exerciseName,
        targetSets: item.targetSets,
        targetRepsMin: item.targetRepsMin,
        targetRepsMax: item.targetRepsMax,
        targetWeightKg: item.targetWeightKg,
        targetDurationSeconds: item.targetDurationSeconds,
        targetDistanceMeters: item.targetDistanceMeters,
        note: item.note,
      })),
    });
    templates.value = await trainingApi.listTemplates();
    notice.value = `已复制“${template.name}”，两份方案之后可以分别修改`;
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

function startTraining(templateId: string | null) {
  void router.push({ name: "training", query: templateId ? { templateId } : { new: "1" } });
}

onActivated(() => void load());
</script>

<template>
  <AppShell page-class="training-page" rail-note="看计划、改计划；记录实际内容时再参考。" show-footer>
        <header class="view-header"><div><h1>训练计划</h1><p>查看和调整计划；实际做过什么，在训练记录中填写。</p></div>
          <div class="form-actions"><button class="action-button" @click="router.push('/training')">返回训练</button><button class="action-button" @click="planTab === 'templates' ? openCreateTemplate() : openCreateProgram()">{{ planTab === "templates" ? "新建方案" : "新建周期计划" }}</button></div>
        </header>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <p v-if="notice" class="training-notice" role="status">{{ notice }}</p>

        <section v-if="loading" class="work-panel training-empty" aria-live="polite">
          <strong>正在读取训练内容…</strong>
        </section>

        <div v-else class="view-stack">
          <section class="work-panel training-suggestion-panel" aria-labelledby="training-suggestion-title">
            <div class="panel-heading">
              <div><h2 id="training-suggestion-title">帮我排一份</h2><p>填写可用时间和器械，先生成一份草案。</p></div>
              <button class="action-button" type="button" @click="suggestionFormOpen = !suggestionFormOpen">{{ suggestionFormOpen ? '收起' : '填写条件' }}</button>
            </div>
            <form v-if="suggestionFormOpen" class="suggestion-form" @submit.prevent="generateSuggestion">
              <label><span>主要目标</span><select v-model="suggestionForm.goal"><option value="general">一般力量与健康</option><option value="strength">力量</option><option value="hypertrophy">肌肥大</option><option value="power">功率</option></select></label>
              <label><span>训练经验</span><select v-model="suggestionForm.experience"><option value="beginner">刚开始或重新开始</option><option value="intermediate">已有稳定训练</option><option value="advanced">经验较多</option></select></label>
              <label><span>可用器械</span><select v-model="suggestionForm.equipment"><option value="minimal">徒手或少量器械</option><option value="dumbbells">哑铃</option><option value="full_gym">完整健身房</option></select></label>
              <label><span>每周可练几天</span><input v-model.number="suggestionForm.availableDaysPerWeek" type="number" min="2" max="6" required /></label>
              <label><span>单次可用分钟</span><input v-model.number="suggestionForm.sessionMinutes" type="number" min="20" max="120" required /></label>
              <label class="checkbox-row"><input v-model="suggestionForm.hasInjuryOrMedicalLimitation" type="checkbox" />目前有伤病或需要医疗个别评估</label>
              <button class="action-button action-button--primary" type="submit" :disabled="saving">{{ saving ? '生成中…' : '按这些条件生成' }}</button>
            </form>
            <article v-for="suggestion in suggestions.filter((item) => item.status === 'active')" :key="suggestion.id" class="suggestion-card">
              <header><div><strong>{{ suggestion.candidate.title }}</strong><span>{{ suggestion.stale ? '资料变化后生成的旧草案' : `生成于 ${suggestion.inputSnapshot.generatedOn}` }}</span></div><span class="status-chip" :data-tone="suggestion.candidate.status === 'stopped' ? 'danger' : 'accent'">{{ suggestion.candidate.status === 'ready' ? '草案' : '需要自己安排' }}</span></header>
              <p v-for="message in suggestion.candidate.messages" :key="message">{{ message }}</p>
              <template v-if="suggestion.candidate.template !== null">
                <p><strong>建议频率：</strong>每周 {{ suggestion.candidate.weeklyResistanceDays }} 次抗阻训练；具体日期由你安排。</p>
                <ul class="suggestion-exercises"><li v-for="item in suggestion.candidate.template.items" :key="item.exerciseName"><div class="guidance-list-row"><strong>{{ item.exerciseName }}</strong><span>{{ item.targetSets ?? '—' }} 组<span v-if="item.targetRepsMin !== null"> · {{ item.targetRepsMin }}–{{ item.targetRepsMax }} 次</span></span><button class="text-action" type="button" @click="toggleGuidance(guidanceKey('suggestion', suggestion.id, item.exerciseName), item.exerciseName)">{{ guidanceOpenItemId === guidanceKey('suggestion', suggestion.id, item.exerciseName) ? '收起预览' : '动作预览' }}</button></div><ExerciseGuidanceCard v-if="guidanceOpenItemId === guidanceKey('suggestion', suggestion.id, item.exerciseName)" :exercise-name="item.exerciseName" :guidance="guidanceByItem[guidanceKey('suggestion', suggestion.id, item.exerciseName)]" /></li></ul>
                <ul class="suggestion-baseline"><li v-for="item in suggestion.candidate.publicHealthBaseline" :key="item">{{ item }}</li></ul>
              </template>
              <details><summary>适用范围和依据</summary><p>依据 {{ suggestion.evidenceIds.join('、') }}；生成于 {{ suggestion.inputSnapshot.generatedOn }}。</p><ul><li v-for="item in suggestion.candidate.limitations" :key="item">{{ item }}</li></ul></details>
              <div class="recommendation-actions"><button v-if="suggestion.candidate.template !== null" class="action-button action-button--primary" type="button" :disabled="saving" @click="adoptSuggestion(suggestion)">存成单次方案</button><button class="text-action" type="button" :disabled="saving" @click="dismissSuggestion(suggestion)">移除草案</button></div>
            </article>
          </section>

          <nav class="plan-kind-tabs" aria-label="训练计划类型">
            <button type="button" :aria-current="planTab === 'templates' ? 'page' : undefined" @click="planTab = 'templates'">
              <strong>单次方案</strong><span>选一份就开始</span>
            </button>
            <button type="button" :aria-current="planTab === 'programs' ? 'page' : undefined" @click="planTab = 'programs'">
              <strong>周期计划</strong><span>按周组织训练日</span>
            </button>
          </nav>

          <div class="schedule-toolbar">
            <p>也可以只安排一个训练主题。</p>
            <button class="action-button" type="button" @click="openScheduleEditor({ title: '' })">安排训练主题</button>
          </div>

          <section v-if="scheduleEditorOpen" class="work-panel schedule-editor" aria-labelledby="schedule-editor-title">
            <div class="panel-heading">
              <div><h2 id="schedule-editor-title">安排训练日期</h2><p>这只是当天安排，不会改变原方案。</p></div>
              <button class="text-action" type="button" @click="scheduleEditorOpen = false">取消</button>
            </div>
            <form class="template-form schedule-form" @submit.prevent="saveSchedule">
              <label><span>日期</span><input v-model="scheduleForm.localDate" required type="date" /></label>
              <label><span>当天显示名称</span><input v-model="scheduleForm.title" required maxlength="80" placeholder="例如：轻量恢复训练" /></label>
              <label class="wide-field"><span>备注（可选）</span><input v-model="scheduleForm.note" maxlength="1000" placeholder="时间、场地或当天提醒" /></label>
              <button class="action-button action-button--primary wide-field schedule-submit" type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存安排" }}</button>
            </form>
          </section>

          <template v-if="planTab === 'templates'">
          <section v-if="editorOpen" class="work-panel template-editor" aria-labelledby="template-editor-title">
            <div class="panel-heading">
              <div>
                <h2 id="template-editor-title">{{ editingTemplate === null ? "新建单次训练方案" : "编辑训练方案" }}</h2>
                <p>开始训练时会复制方案内容，之后互不影响。</p>
              </div>
              <button class="text-action" type="button" @click="editorOpen = false">收起</button>
            </div>
            <form class="template-form" @submit.prevent="saveTemplate">
              <label><span>方案名称</span><input v-model="templateForm.name" required maxlength="80" placeholder="例如：胸部 A" /></label>
              <label><span>方案备注（可选）</span><input v-model="templateForm.note" maxlength="1000" placeholder="例如：时间充足时使用" /></label>

              <div class="template-items">
                <article v-for="(item, index) in templateForm.items" :key="index" class="template-item-form">
                  <div class="template-item-form__heading">
                    <strong>动作 {{ index + 1 }}</strong>
                    <button v-if="templateForm.items.length > 1" class="text-action" type="button" @click="templateForm.items.splice(index, 1)">移除</button>
                  </div>
                  <ExerciseNameField v-model="item.exerciseName" class="wide-field" label="动作名称" required placeholder="例如：杠铃卧推或 barbell bench press" />
                  <label><span>目标组数</span><input v-model="item.targetSets" inputmode="numeric" type="number" min="1" placeholder="可不填" /></label>
                  <label><span>最低次数</span><input v-model="item.targetRepsMin" inputmode="numeric" type="number" min="1" placeholder="可不填" /></label>
                  <label><span>最高次数</span><input v-model="item.targetRepsMax" inputmode="numeric" type="number" min="1" placeholder="可不填" /></label>
                  <label><span>目标重量 kg</span><input v-model="item.targetWeightKg" inputmode="decimal" placeholder="可不填" /></label>
                  <label class="wide-field"><span>动作备注</span><input v-model="item.note" maxlength="500" placeholder="节奏、器械或注意事项" /></label>
                </article>
              </div>

              <div class="form-actions">
                <button class="text-action" type="button" @click="templateForm.items.push(emptyTemplateItem())">添加动作 →</button>
                <button class="action-button action-button--primary" type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存方案" }}</button>
              </div>
            </form>
          </section>

          <section class="split-heading" aria-labelledby="templates-title">
            <div><h2 id="templates-title">我的单次训练方案</h2></div>
            <p>把常练的动作放在一起，下次直接选。</p>
          </section>

          <section v-if="templates.length === 0" class="work-panel training-empty">
            <strong>还没有训练方案</strong>
            <p>创建常用方案，或从空白训练开始。</p>
            <div class="form-actions">
              <button class="action-button action-button--primary" type="button" @click="openCreateTemplate">建立第一份方案</button>
              <button class="action-button" type="button" :disabled="saving" @click="startTraining(null)">直接开始</button>
            </div>
          </section>

          <div v-else class="template-grid">
            <article v-for="template in templates" :key="template.id" class="work-panel template-card">
              <div class="panel-heading">
                <div><h2>{{ template.name }}</h2><p>{{ template.note ?? `${template.items.length} 个动作` }}</p></div>
                <span class="status-chip">{{ template.items.length }} 项</span>
              </div>
              <ol class="plain-list template-preview">
                <li v-for="item in template.items" :key="item.id">
                  <div class="guidance-list-row"><strong>{{ item.exerciseName }}</strong><span v-if="item.targetSets !== null">{{ item.targetSets }} 组</span><button class="text-action" type="button" @click="toggleGuidance(guidanceKey('template', template.id, item.id), item.exerciseName)">{{ guidanceOpenItemId === guidanceKey('template', template.id, item.id) ? '收起预览' : '动作预览' }}</button></div>
                  <ExerciseGuidanceCard v-if="guidanceOpenItemId === guidanceKey('template', template.id, item.id)" :exercise-name="item.exerciseName" :guidance="guidanceByItem[guidanceKey('template', template.id, item.id)]" />
                </li>
              </ol>
              <div class="form-actions">
                <button class="action-button action-button--primary" type="button" :disabled="saving" @click="startTraining(template.id)">参考这份记录</button>
                <button class="text-action" type="button" @click="openEditTemplate(template)">编辑</button>
                <button class="text-action" type="button" :aria-label="`复制${template.name}`" :disabled="saving" @click="copyTemplate(template)">复制</button>
                <button class="text-action" type="button" :aria-label="`安排${template.name}`" @click="openScheduleEditor({ title: template.name, templateId: template.id })">安排日期</button>
                <button class="text-action" type="button" :disabled="saving" @click="archiveTemplate(template)">归档</button>
              </div>
            </article>
          </div>

          <button v-if="templates.length > 0" class="action-button blank-start" type="button" :disabled="saving" @click="startTraining(null)">不使用方案，直接开始</button>
          </template>

          <template v-else>
            <section v-if="programEditorOpen" class="work-panel template-editor" aria-labelledby="program-editor-title">
              <div class="panel-heading">
                <div>
                  <h2 id="program-editor-title">{{ editingProgram === null ? "新建周期计划" : "编辑周期计划" }}</h2>
                  <p>周期只负责整理训练日，不会替你规定具体日期。</p>
                </div>
                <button class="text-action" type="button" @click="programEditorOpen = false">收起</button>
              </div>
              <form class="template-form program-form" @submit.prevent="saveProgram">
                <label><span>计划名称</span><input v-model="programForm.name" required maxlength="80" placeholder="例如：四周增肌计划" /></label>
                <label><span>包含几周</span><input v-model="programForm.weekCount" required type="number" inputmode="numeric" min="1" max="52" /></label>
                <label class="wide-field"><span>备注（可选）</span><input v-model="programForm.note" maxlength="1000" placeholder="训练目标、使用场景或注意事项" /></label>
                <div class="form-actions wide-field">
                  <button class="action-button action-button--primary" type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存周期计划" }}</button>
                </div>
              </form>
            </section>

            <section class="split-heading" aria-labelledby="programs-title">
              <div><h2 id="programs-title">我的周期计划</h2></div>
              <p>按周编排训练，每周都可以不同。</p>
            </section>

            <section v-if="programs.length === 0" class="work-panel training-empty">
              <strong>还没有周期计划</strong>
              <p>需要多周变化时再创建。</p>
              <button class="action-button action-button--primary" type="button" @click="openCreateProgram">建立第一个周期计划</button>
            </section>

            <section v-for="program in programs" :key="program.id" class="work-panel program-card">
              <div class="panel-heading">
                <div>
                  <h2>{{ program.name }}</h2>
                  <p>{{ program.note ?? `${program.weekCount} 周 · ${program.units.length} 个训练日` }}</p>
                </div>
                <span class="status-chip">{{ program.weekCount }} 周</span>
              </div>
              <div class="form-actions">
                <button class="action-button" type="button" @click="selectedProgramId = selectedProgramId === program.id ? null : program.id">
                  {{ selectedProgramId === program.id ? "收起" : "查看训练日" }}
                </button>
                <button class="text-action" type="button" @click="openEditProgram(program)">编辑计划</button>
                <button class="text-action" type="button" :disabled="saving" @click="archiveProgram(program)">归档</button>
              </div>

              <div v-if="selectedProgramId === program.id" class="program-detail">
                <div class="program-detail__heading">
                  <div><strong>周期内容</strong><p>可以从空白添加，也可以复制一份单次方案。</p></div>
                  <button class="action-button action-button--primary" type="button" @click="openAddUnit(program)">添加训练日</button>
                </div>

                <form v-if="unitEditorOpen && unitProgramId === program.id" class="template-form program-unit-editor" @submit.prevent="saveUnit">
                  <div class="panel-heading wide-field">
                    <div><h3>{{ editingUnit === null ? "添加训练日" : "编辑训练日" }}</h3></div>
                    <button class="text-action" type="button" @click="unitEditorOpen = false">取消</button>
                  </div>
                  <label>
                    <span>放在第几周</span>
                    <input v-model="unitForm.weekNumber" required type="number" inputmode="numeric" min="1" :max="program.weekCount" />
                  </label>
                  <label v-if="editingUnit === null">
                    <span>从单次方案复制（可选）</span>
                    <select v-model="unitForm.sourceTemplateId">
                      <option value="">从空白添加</option>
                      <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
                    </select>
                  </label>
                  <p v-if="editingUnit === null && unitForm.sourceTemplateId" class="source-copy-note wide-field">
                    会复制当前方案。来源方案以后发生变化时，这里保持不变。
                  </p>
                  <template v-if="editingUnit !== null || !unitForm.sourceTemplateId">
                    <label class="wide-field"><span>训练日名称</span><input v-model="unitForm.name" required maxlength="80" placeholder="例如：胸部训练 A" /></label>
                    <label class="wide-field"><span>备注（可选）</span><input v-model="unitForm.note" maxlength="1000" placeholder="当天的安排或注意事项" /></label>
                    <div class="template-items wide-field">
                      <article v-for="(item, index) in unitForm.items" :key="index" class="template-item-form">
                        <div class="template-item-form__heading">
                          <strong>动作 {{ index + 1 }}</strong>
                          <button v-if="unitForm.items.length > 1" class="text-action" type="button" @click="unitForm.items.splice(index, 1)">移除</button>
                        </div>
                        <ExerciseNameField v-model="item.exerciseName" class="wide-field" label="动作名称" required placeholder="例如：杠铃卧推或 barbell bench press" />
                        <label><span>目标组数</span><input v-model="item.targetSets" type="number" inputmode="numeric" min="1" placeholder="可不填" /></label>
                        <label><span>最低次数</span><input v-model="item.targetRepsMin" type="number" inputmode="numeric" min="1" placeholder="可不填" /></label>
                        <label><span>最高次数</span><input v-model="item.targetRepsMax" type="number" inputmode="numeric" min="1" placeholder="可不填" /></label>
                        <label><span>目标重量 kg</span><input v-model="item.targetWeightKg" inputmode="decimal" placeholder="可不填" /></label>
                        <label class="wide-field"><span>动作备注</span><input v-model="item.note" maxlength="500" placeholder="可不填" /></label>
                      </article>
                    </div>
                    <button class="text-action wide-field unit-add-action" type="button" @click="unitForm.items.push(emptyTemplateItem())">添加动作 →</button>
                  </template>
                  <div class="form-actions wide-field">
                    <button class="action-button action-button--primary" type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存训练日" }}</button>
                  </div>
                </form>

                <div class="program-weeks">
                  <section v-for="weekNumber in weekNumbers(program)" :key="weekNumber" class="program-week">
                    <header><strong>第 {{ weekNumber }} 周</strong><span>{{ unitsForWeek(program, weekNumber).length }} 个训练日</span></header>
                    <p v-if="unitsForWeek(program, weekNumber).length === 0" class="program-week__empty">这一周还没有安排。</p>
                    <article v-for="unit in unitsForWeek(program, weekNumber)" :key="unit.id" class="program-unit-card">
                      <div>
                        <span v-if="unit.started" class="exercise-state">已有训练记录</span>
                        <h3>{{ unit.name }}</h3>
                        <p>{{ unit.items.length }} 个动作<span v-if="sourceTemplateName(unit)"> · 复制自 {{ sourceTemplateName(unit) }}</span></p>
                      </div>
                      <ol class="plain-list template-preview">
                        <li v-for="item in unit.items" :key="item.id"><div class="guidance-list-row"><strong>{{ item.exerciseName }}</strong><span v-if="item.targetSets !== null">{{ item.targetSets }} 组</span><button class="text-action" type="button" @click="toggleGuidance(guidanceKey('unit', unit.id, item.id), item.exerciseName)">{{ guidanceOpenItemId === guidanceKey('unit', unit.id, item.id) ? '收起预览' : '动作预览' }}</button></div><ExerciseGuidanceCard v-if="guidanceOpenItemId === guidanceKey('unit', unit.id, item.id)" :exercise-name="item.exerciseName" :guidance="guidanceByItem[guidanceKey('unit', unit.id, item.id)]" /></li>
                      </ol>
                      <p v-if="sourceUpdated(unit) && !unit.started" class="source-update-note">来源方案有更新。当前内容不会自动改变。</p>
                      <div class="form-actions">
                        <button class="action-button action-button--primary" type="button" :disabled="saving" @click="startProgramUnit(program, unit)">参考这天记录</button>
                        <button class="text-action" type="button" :aria-label="`安排${program.name}第${unit.weekNumber}周${unit.name}`" @click="openScheduleEditor({ title: unit.name, programId: program.id, programUnitId: unit.id })">安排日期</button>
                        <button v-if="!unit.started" class="text-action" type="button" @click="openEditUnit(program, unit)">编辑</button>
                        <button v-if="sourceUpdated(unit) && !unit.started" class="text-action" type="button" :disabled="saving" @click="reimportUnit(program, unit)">重新导入</button>
                      </div>
                    </article>
                  </section>
                </div>
              </div>
            </section>
          </template>
        </div>


  </AppShell>
</template>

<style scoped>
.training-draft-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
</style>

