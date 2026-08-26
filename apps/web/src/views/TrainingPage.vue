<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";

import { ApiError } from "../api/client";
import { trainingSuggestionApi, type TrainingSuggestion, type TrainingSuggestionPreferences } from "../api/training-suggestions";
import {
  trainingApi,
  type ExerciseGuidance,
  type TrainingProgram,
  type TrainingProgramUnit,
  type TrainingSession,
  type TrainingSessionItem,
  type TrainingSetInput,
  type TrainingTemplate,
  type TrainingTemplateInput,
} from "../api/training";
import { navigationItems, type AppSection } from "../app/modules";
import { useSessionStore } from "../stores/session";

interface TemplateItemForm {
  exerciseName: string;
  targetSets: string | number;
  targetRepsMin: string | number;
  targetRepsMax: string | number;
  targetWeightKg: string;
  note: string;
}

interface SetForm {
  reps: string | number;
  weightKg: string;
  durationSeconds: string | number;
  distanceMeters: string;
}

interface ActualForm {
  performedExerciseName: string;
  actualNote: string;
  sets: SetForm[];
}

const router = useRouter();
const sessionStore = useSessionStore();
const templates = ref<TrainingTemplate[]>([]);
const programs = ref<TrainingProgram[]>([]);
const suggestions = ref<TrainingSuggestion[]>([]);
const suggestionFormOpen = ref(false);
const suggestionForm = reactive<TrainingSuggestionPreferences>({ goal: "general", experience: "beginner", equipment: "full_gym", availableDaysPerWeek: 2, sessionMinutes: 60, hasInjuryOrMedicalLimitation: false });
const planTab = ref<"templates" | "programs">("templates");
const activeSession = ref<TrainingSession | null>(null);
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref("");
const notice = ref("");
const editorOpen = ref(false);
const editingTemplate = ref<TrainingTemplate | null>(null);
const actualForms = reactive<Record<string, ActualForm>>({});
const extraName = ref("");
const extraNote = ref("");
const extraSets = reactive<SetForm[]>([{ reps: "", weightKg: "", durationSeconds: "", distanceMeters: "" }]);
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

const completedCount = computed(
  () => activeSession.value?.items.filter((item) => item.status === "completed").length ?? 0,
);
const remainingCount = computed(
  () => activeSession.value?.items.filter((item) => item.origin === "planned" && item.status === "pending").length ?? 0,
);
const activeSessionLabel = computed(() => {
  const training = activeSession.value;
  if (training === null) return "";
  if (training.sourceScheduleTitle !== null) return training.sourceScheduleTitle;
  if (training.sourceProgramName !== null) {
    return `${training.sourceProgramName} · 第 ${training.sourceWeekNumber} 周 · ${training.sourceTrainingDayName}`;
  }
  return training.sourceTemplateName ?? "空白训练";
});

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

function openSection(section: AppSection) {
  void router.push({ name: section });
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

function setPayload(sets: readonly SetForm[]): TrainingSetInput[] {
  return sets
    .filter(
      (set) =>
        (typeof set.reps === "number" ? Number.isFinite(set.reps) : set.reps.trim().length > 0) ||
        set.weightKg.trim().length > 0 ||
        (typeof set.durationSeconds === "number" ? Number.isFinite(set.durationSeconds) : set.durationSeconds.trim().length > 0) ||
        set.distanceMeters.trim().length > 0,
    )
    .map((set) => ({
      reps: nullableInteger(set.reps),
      weightKg: nullableText(set.weightKg),
      durationSeconds: nullableInteger(set.durationSeconds),
      distanceMeters: nullableText(set.distanceMeters),
      note: null,
    }));
}

function describeTarget(item: TrainingSessionItem): string {
  const parts: string[] = [];
  if (item.target.targetSets !== null) parts.push(`${item.target.targetSets} 组`);
  if (item.target.targetRepsMin !== null) {
    parts.push(
      item.target.targetRepsMax !== null && item.target.targetRepsMax !== item.target.targetRepsMin
        ? `${item.target.targetRepsMin}–${item.target.targetRepsMax} 次`
        : `${item.target.targetRepsMin} 次`,
    );
  }
  if (item.target.targetWeightKg !== null) parts.push(`${Number(item.target.targetWeightKg)} kg`);
  return parts.length === 0 ? "没有预设训练量" : parts.join(" · ");
}

function syncActualForms(training: TrainingSession) {
  for (const item of training.items) {
    actualForms[item.id] = {
      performedExerciseName: item.performedExerciseName ?? item.exerciseName,
      actualNote: item.actualNote ?? "",
      sets:
        item.sets.length > 0
          ? item.sets.map((set) => ({
              reps: set.reps?.toString() ?? "",
              weightKg: set.weightKg === null ? "" : Number(set.weightKg).toString(),
              durationSeconds: set.durationSeconds?.toString() ?? "",
              distanceMeters: set.distanceMeters === null ? "" : Number(set.distanceMeters).toString(),
            }))
          : [{ reps: "", weightKg: "", durationSeconds: "", distanceMeters: "" }],
    };
  }
}

function applySession(training: TrainingSession) {
  activeSession.value = training.status === "in_progress" ? training : null;
  if (training.status === "in_progress") syncActualForms(training);
}

function reportError(error: unknown) {
  console.error("Training operation failed", error);
  errorMessage.value = error instanceof ApiError ? error.message : "暂时保存不了，请稍后再试";
}

async function toggleGuidance(item: TrainingSessionItem) {
  if (guidanceOpenItemId.value === item.id) {
    guidanceOpenItemId.value = null;
    return;
  }
  guidanceOpenItemId.value = item.id;
  if (guidanceByItem[item.id] !== undefined) return;
  try {
    guidanceByItem[item.id] = await trainingApi.getGuidance(item.exerciseName);
  } catch (error) {
    reportError(error);
    guidanceOpenItemId.value = null;
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [loadedTemplates, loadedPrograms, activeSessions, loadedSuggestions] = await Promise.all([
      trainingApi.listTemplates(),
      trainingApi.listPrograms(),
      trainingApi.listActiveSessions(),
      trainingSuggestionApi.list(),
    ]);
    templates.value = loadedTemplates;
    programs.value = loadedPrograms;
    suggestions.value = loadedSuggestions;
    activeSession.value = activeSessions[0] ?? null;
    if (activeSession.value !== null) syncActualForms(activeSession.value);
  } catch (error) {
    reportError(error);
  } finally {
    loading.value = false;
  }
}

async function generateSuggestion() {
  saving.value = true; errorMessage.value = "";
  try { suggestions.value = [await trainingSuggestionApi.generate(suggestionForm), ...suggestions.value]; suggestionFormOpen.value = false; notice.value = "系统建议已经生成；采用前先看适用范围和动作示例"; }
  catch (error) { reportError(error); }
  finally { saving.value = false; }
}

async function adoptSuggestion(value: TrainingSuggestion) {
  saving.value = true; errorMessage.value = "";
  try { const result = await trainingSuggestionApi.adopt(value.id, value.revision); suggestions.value = suggestions.value.map((item) => item.id === value.id ? result.suggestion : item); templates.value = await trainingApi.listTemplates(); planTab.value = "templates"; notice.value = "建议已保存为你的单次方案；现在可以继续编辑、安排或直接开始"; }
  catch (error) { reportError(error); }
  finally { saving.value = false; }
}

async function dismissSuggestion(value: TrainingSuggestion) {
  saving.value = true; errorMessage.value = "";
  try { const result = await trainingSuggestionApi.dismiss(value.id, value.revision); suggestions.value = suggestions.value.map((item) => item.id === value.id ? result : item); notice.value = "已放弃这份建议，没有生成训练方案"; }
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

async function startProgramUnit(program: TrainingProgram, unit: TrainingProgramUnit) {
  saving.value = true;
  errorMessage.value = "";
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    applySession(await trainingApi.startProgramUnit(program.id, unit.id, timeZone));
    notice.value = "周期训练日已开始，当前内容已保存为本次快照";
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
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

async function startTraining(templateId: string | null) {
  saving.value = true;
  errorMessage.value = "";
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    applySession(await trainingApi.startSession(templateId, timeZone));
    notice.value = templateId === null ? "空白训练已开始" : "训练已开始，计划内容已保存为本次快照";
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function saveItem(item: TrainingSessionItem, status: "completed" | "pending" | "skipped") {
  if (activeSession.value === null) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const form = actualForms[item.id] ?? { performedExerciseName: item.exerciseName, actualNote: "", sets: [] };
    const training = await trainingApi.updateItem(
      activeSession.value.id,
      item.id,
      activeSession.value.revision,
      status,
      status === "completed" ? nullableText(form.performedExerciseName) : null,
      nullableText(form.actualNote),
      status === "pending" ? [] : setPayload(form.sets),
    );
    applySession(training);
    notice.value = status === "completed" ? `${item.exerciseName} 已记下` : status === "skipped" ? `${item.exerciseName} 已跳过` : `${item.exerciseName} 已恢复为待完成`;
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

function addSet(itemId: string) {
  actualForms[itemId]?.sets.push({ reps: "", weightKg: "", durationSeconds: "", distanceMeters: "" });
}

async function addExtra() {
  if (activeSession.value === null) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const training = await trainingApi.addExtraItem(
      activeSession.value.id,
      activeSession.value.revision,
      extraName.value,
      nullableText(extraNote.value),
      setPayload(extraSets),
    );
    applySession(training);
    extraName.value = "";
    extraNote.value = "";
    extraSets.splice(0, extraSets.length, { reps: "", weightKg: "", durationSeconds: "", distanceMeters: "" });
    notice.value = "额外动作已加入本次训练";
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

async function finishTraining(status: "completed" | "abandoned") {
  if (activeSession.value === null) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const finished = await trainingApi.finishSession(
      activeSession.value.id,
      activeSession.value.revision,
      status,
    );
    applySession(finished);
    notice.value = status === "completed" ? "这次训练已保存" : "训练已结束，已经完成的内容仍会保留";
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="prototype-shell training-page">
    <aside class="desktop-rail" aria-label="主要导航">
      <div class="brand-block">
        <span class="brand-mark" aria-hidden="true">EA</span>
        <div><strong>Exercise App</strong><small>训练与饮食记录</small></div>
      </div>
      <nav class="rail-nav">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          class="nav-button"
          :class="{ 'is-active': item.id === 'training' }"
          type="button"
          :aria-current="item.id === 'training' ? 'page' : undefined"
          @click="openSection(item.id)"
        >
          <span class="nav-button__short" aria-hidden="true">{{ item.shortLabel }}</span>
          <span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
        </button>
      </nav>
      <p class="rail-note">计划可以改，练过的不会变。</p>
    </aside>

    <div class="app-column">
      <header class="mobile-header">
        <strong class="mobile-brand">EA / 训练</strong>
        <span>{{ sessionStore.account?.username }}</span>
      </header>

      <main class="app-main">
        <header class="view-header training-view-header">
          <div>
            <p class="date-line">训练</p>
            <h1>{{ activeSession === null ? "选一个方案，或者直接开始" : "这次实际练了什么" }}</h1>
            <p v-if="activeSession === null">方案只是备选。今天想练哪个就选哪个，也可以从空白开始。</p>
            <p v-else>{{ activeSessionLabel }} · {{ activeSession.localDate }}</p>
          </div>
          <button
            v-if="activeSession === null"
            class="action-button action-button--primary"
            type="button"
            @click="planTab === 'templates' ? openCreateTemplate() : openCreateProgram()"
          >
            {{ planTab === "templates" ? "新建方案" : "新建周期计划" }}
          </button>
          <span v-else class="status-chip" data-tone="accent">已完成 {{ completedCount }} 项 · 还需练 {{ remainingCount }} 项</span>
        </header>

        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <p v-if="notice" class="training-notice" role="status">{{ notice }}</p>

        <section v-if="loading" class="work-panel training-empty" aria-live="polite">
          <strong>正在读取训练内容…</strong>
        </section>

        <div v-else-if="activeSession === null" class="view-stack">
          <section class="work-panel training-suggestion-panel" aria-labelledby="training-suggestion-title">
            <div class="panel-heading">
              <div><h2 id="training-suggestion-title">需要一个训练起点？</h2><p>系统只生成可修改候选；采用后就是你的普通方案，不会自动排进日程。</p></div>
              <button class="action-button" type="button" @click="suggestionFormOpen = !suggestionFormOpen">{{ suggestionFormOpen ? '收起' : '生成系统建议' }}</button>
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
              <header><div><strong>{{ suggestion.candidate.title }}</strong><span>{{ suggestion.stale ? '档案或策略已有变化' : `方法 ${suggestion.methodVersion}` }}</span></div><span class="status-chip" :data-tone="suggestion.candidate.status === 'stopped' ? 'danger' : 'accent'">{{ suggestion.candidate.status === 'ready' ? '等待选择' : '已停止自动生成' }}</span></header>
              <p v-for="message in suggestion.candidate.messages" :key="message">{{ message }}</p>
              <template v-if="suggestion.candidate.template !== null">
                <p><strong>建议频率：</strong>每周 {{ suggestion.candidate.weeklyResistanceDays }} 次抗阻训练；具体日期由你安排。</p>
                <ul class="suggestion-exercises"><li v-for="item in suggestion.candidate.template.items" :key="item.exerciseName"><strong>{{ item.exerciseName }}</strong><span>{{ item.targetSets ?? '—' }} 组<span v-if="item.targetRepsMin !== null"> · {{ item.targetRepsMin }}–{{ item.targetRepsMax }} 次</span></span></li></ul>
                <ul class="suggestion-baseline"><li v-for="item in suggestion.candidate.publicHealthBaseline" :key="item">{{ item }}</li></ul>
              </template>
              <details><summary>适用范围和依据</summary><p>依据 {{ suggestion.evidenceIds.join('、') }}；生成于 {{ suggestion.inputSnapshot.generatedOn }}。</p><ul><li v-for="item in suggestion.candidate.limitations" :key="item">{{ item }}</li></ul></details>
              <div class="recommendation-actions"><button v-if="suggestion.candidate.template !== null" class="action-button action-button--primary" type="button" :disabled="saving" @click="adoptSuggestion(suggestion)">保存为我的方案</button><button class="text-action" type="button" :disabled="saving" @click="dismissSuggestion(suggestion)">不采用</button></div>
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
            <p>只想先记一个训练主题，也可以不选具体方案。</p>
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
                <p>以后选择这个方案时，会复制当时的内容作为本次训练。</p>
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
                  <label class="wide-field"><span>动作名称</span><input v-model="item.exerciseName" required maxlength="100" placeholder="例如：杠铃卧推" /></label>
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
            <p>这里不是按周排好的日历。你什么时候练、选哪一份，都由你决定。</p>
          </section>

          <section v-if="templates.length === 0" class="work-panel training-empty">
            <strong>还没有训练方案</strong>
            <p>可以先建一份常用方案，也可以直接开始空白训练，边练边补动作。</p>
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
                  <strong>{{ item.exerciseName }}</strong>
                  <span v-if="item.targetSets !== null">{{ item.targetSets }} 组</span>
                </li>
              </ol>
              <div class="form-actions">
                <button class="action-button action-button--primary" type="button" :disabled="saving" @click="startTraining(template.id)">用这份开始</button>
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
              <p>适合多周安排。每一周可以不同，训练日也不必绑定星期几。</p>
            </section>

            <section v-if="programs.length === 0" class="work-panel training-empty">
              <strong>还没有周期计划</strong>
              <p>如果单次方案已经够用，可以暂时不建。需要安排多周变化时再用这里。</p>
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
                    会复制方案当前的名称、动作和目标量。以后来源改变，这里不会自动跟着变。
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
                        <label class="wide-field"><span>动作名称</span><input v-model="item.exerciseName" required maxlength="100" placeholder="例如：杠铃卧推" /></label>
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
                        <li v-for="item in unit.items" :key="item.id"><strong>{{ item.exerciseName }}</strong><span v-if="item.targetSets !== null">{{ item.targetSets }} 组</span></li>
                      </ol>
                      <p v-if="sourceUpdated(unit) && !unit.started" class="source-update-note">来源方案有更新。当前内容不会自动改变。</p>
                      <div class="form-actions">
                        <button class="action-button action-button--primary" type="button" :disabled="saving" @click="startProgramUnit(program, unit)">{{ unit.started ? "再练一次" : "开始这天" }}</button>
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

        <div v-else class="view-stack">
          <section class="work-panel active-training" aria-labelledby="active-training-title">
            <div class="panel-heading">
              <div>
                <h2 id="active-training-title">计划动作</h2>
                <p>完成就勾上；没有记录的数字会保持为空，不会算成 0。</p>
              </div>
            </div>

            <ol v-if="activeSession.items.some((item) => item.origin === 'planned')" class="actual-exercise-list">
              <li v-for="item in activeSession.items.filter((entry) => entry.origin === 'planned')" :key="item.id" :class="`is-${item.status}`">
                <div class="actual-exercise-heading">
                  <div>
                    <span class="exercise-state">{{ item.status === "completed" ? "已完成" : item.status === "skipped" ? "已跳过" : "待完成" }}</span>
                    <h3>{{ item.exerciseName }}</h3>
                    <p>{{ describeTarget(item) }}</p>
                  </div>
                  <div class="item-status-actions">
                    <button class="text-action" type="button" @click="toggleGuidance(item)">{{ guidanceOpenItemId === item.id ? "收起要点" : "动作要点" }}</button>
                    <button class="action-button" type="button" :disabled="saving" @click="saveItem(item, item.status === 'completed' ? 'pending' : 'completed')">
                      {{ item.status === "completed" ? "取消完成" : "完成" }}
                    </button>
                    <button v-if="item.status !== 'skipped'" class="text-action" type="button" :disabled="saving" @click="saveItem(item, 'skipped')">跳过</button>
                  </div>
                </div>

                <section v-if="guidanceOpenItemId === item.id" class="exercise-guidance" :aria-label="`${item.exerciseName}动作指导`">
                  <p v-if="guidanceByItem[item.id] === undefined">正在读取动作要点…</p>
                  <template v-else-if="guidanceByItem[item.id] === null">
                    <strong>暂时没有许可和来源状态清楚的指导内容</strong>
                    <p>训练记录不受影响；应用不会用许可不明的视频或临时生成的内容冒充标准示范。</p>
                  </template>
                  <template v-else>
                    <div class="panel-heading"><div><strong>{{ guidanceByItem[item.id]!.exerciseName }}要点</strong><p>{{ guidanceByItem[item.id]!.overview }}</p></div><span class="status-chip">{{ guidanceByItem[item.id]!.reviewStatus === 'reviewed' ? '已审阅' : '原创草案' }}</span></div>
                    <div class="guidance-columns">
                      <div><strong>怎么做</strong><ol><li v-for="step in guidanceByItem[item.id]!.steps" :key="step">{{ step }}</li></ol></div>
                      <div><strong>常见问题</strong><ul><li v-for="mistake in guidanceByItem[item.id]!.commonMistakes" :key="mistake">{{ mistake }}</li></ul></div>
                    </div>
                    <p><strong>可选替代：</strong>{{ guidanceByItem[item.id]!.alternatives.join('、') }}</p>
                    <a v-if="guidanceByItem[item.id]!.videoUrl" class="text-action" :href="guidanceByItem[item.id]!.videoUrl!" target="_blank" rel="noopener noreferrer">查看外部示范视频</a>
                    <p v-else class="data-note">目前没有可以随项目提供的许可明确视频。</p>
                    <p class="safety-copy">{{ guidanceByItem[item.id]!.limitations }}</p>
                    <small>来源：{{ guidanceByItem[item.id]!.sourceName }} · {{ guidanceByItem[item.id]!.license }} · {{ guidanceByItem[item.id]!.version }}</small>
                  </template>
                </section>

                <div v-if="actualForms[item.id]" class="actual-data-form">
                  <label class="wide-field"><span>实际动作</span><input v-model="actualForms[item.id]!.performedExerciseName" required maxlength="100" :placeholder="item.exerciseName" /></label>
                  <div v-for="(set, setIndex) in actualForms[item.id]!.sets" :key="setIndex" class="set-row">
                    <strong>第 {{ setIndex + 1 }} 组</strong>
                    <label><span>次数</span><input v-model="set.reps" type="number" min="0" inputmode="numeric" placeholder="未记录" /></label>
                    <label><span>重量 kg</span><input v-model="set.weightKg" inputmode="decimal" placeholder="未记录" /></label>
                    <label><span>时长（秒）</span><input v-model="set.durationSeconds" type="number" min="0" inputmode="numeric" placeholder="未记录" /></label>
                    <label><span>距离（米）</span><input v-model="set.distanceMeters" inputmode="decimal" placeholder="未记录" /></label>
                  </div>
                  <label class="wide-field"><span>实际备注</span><input v-model="actualForms[item.id]!.actualNote" maxlength="1000" placeholder="体感、调整或其他记录" /></label>
                  <div class="form-actions">
                    <button class="text-action" type="button" @click="addSet(item.id)">再加一组 →</button>
                    <button class="text-action" type="button" :disabled="saving" @click="saveItem(item, 'completed')">保存实际数据</button>
                  </div>
                </div>
              </li>
            </ol>
            <p v-else>这次从空白开始，直接在下面添加实际动作。</p>
          </section>

          <section class="work-panel extra-training" aria-labelledby="extra-title">
            <div class="panel-heading">
              <div><h2 id="extra-title">额外做了什么</h2><p>这里只加入本次实际训练，不会改动原方案。</p></div>
              <span class="status-chip">实际记录</span>
            </div>

            <ul v-if="activeSession.items.some((item) => item.origin === 'extra')" class="recorded-extra-list">
              <li v-for="item in activeSession.items.filter((entry) => entry.origin === 'extra')" :key="item.id">
                <strong>{{ item.exerciseName }}</strong><span>{{ item.sets.length > 0 ? `${item.sets.length} 组` : "已记录" }}</span>
              </li>
            </ul>

            <form class="extra-form" @submit.prevent="addExtra">
              <label class="wide-field"><span>动作名称</span><input v-model="extraName" required maxlength="100" placeholder="例如：平板支撑" /></label>
              <div v-for="(set, index) in extraSets" :key="index" class="set-row">
                <strong>第 {{ index + 1 }} 组</strong>
                <label><span>次数</span><input v-model="set.reps" type="number" min="0" inputmode="numeric" placeholder="未记录" /></label>
                <label><span>重量 kg</span><input v-model="set.weightKg" inputmode="decimal" placeholder="未记录" /></label>
                <label><span>时长（秒）</span><input v-model="set.durationSeconds" type="number" min="0" inputmode="numeric" placeholder="未记录" /></label>
                <label><span>距离（米）</span><input v-model="set.distanceMeters" inputmode="decimal" placeholder="未记录" /></label>
              </div>
              <label class="wide-field"><span>实际备注</span><input v-model="extraNote" maxlength="1000" placeholder="可不填" /></label>
              <div class="form-actions">
                <button class="text-action" type="button" @click="extraSets.push({ reps: '', weightKg: '', durationSeconds: '', distanceMeters: '' })">再加一组 →</button>
                <button class="action-button" type="submit" :disabled="saving">加入本次训练</button>
              </div>
            </form>
          </section>

          <section class="training-finish-bar" aria-label="结束训练">
            <div><strong>训练结束了吗？</strong><p>没完成的动作会保留原状态，已经做过的内容不会丢。</p></div>
            <div class="form-actions">
              <button class="text-action" type="button" :disabled="saving" @click="finishTraining('abandoned')">提前结束</button>
              <button class="action-button action-button--primary" type="button" :disabled="saving" @click="finishTraining('completed')">保存并结束</button>
            </div>
          </section>
        </div>
      </main>

      <footer class="prototype-footer"><p>Exercise App · MIT License</p></footer>
      <nav class="mobile-dock" aria-label="主要导航">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          class="dock-button"
          :class="{ 'is-active': item.id === 'training' }"
          type="button"
          :aria-current="item.id === 'training' ? 'page' : undefined"
          @click="openSection(item.id)"
        >
          <span aria-hidden="true">{{ item.shortLabel }}</span><strong>{{ item.label }}</strong>
        </button>
      </nav>
    </div>
  </div>
</template>
