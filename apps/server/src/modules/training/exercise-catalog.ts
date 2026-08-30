import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ExerciseCatalogItem, ExerciseGuidance } from "./types.js";

interface StoredExercise {
  readonly id: string;
  readonly name: string;
  readonly bodyPart: string;
  readonly equipment: string;
  readonly target: string;
  readonly muscleGroup: string;
  readonly secondaryMuscles: readonly string[];
  readonly steps: readonly string[];
}

interface StoredCatalog {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly exercises: readonly StoredExercise[];
}

export type ExerciseMediaKind = "image" | "animation";

export interface ExerciseMediaFile {
  readonly absolutePath: string;
  readonly contentType: "image/jpeg" | "image/gif";
}

interface ExerciseMediaEntry {
  readonly imageFileName?: string;
  readonly animationFileName?: string;
}

const bodyPartLabels: Readonly<Record<string, string>> = {
  back: "背部",
  cardio: "有氧",
  chest: "胸部",
  "lower arms": "前臂",
  "lower legs": "小腿",
  neck: "颈部",
  shoulders: "肩部",
  "upper arms": "上臂",
  "upper legs": "大腿",
  waist: "腰腹",
};

const equipmentLabels: Readonly<Record<string, string>> = {
  assisted: "辅助器械",
  band: "弹力带",
  barbell: "杠铃",
  "body weight": "自重",
  "bosu ball": "波速球",
  cable: "绳索器械",
  dumbbell: "哑铃",
  "elliptical machine": "椭圆机",
  "ez barbell": "曲杆杠铃",
  hammer: "锤子",
  kettlebell: "壶铃",
  "leverage machine": "杠杆器械",
  "medicine ball": "药球",
  "olympic barbell": "奥杆",
  "resistance band": "阻力带",
  roller: "滚轮",
  rope: "训练绳",
  "skierg machine": "滑雪机",
  "sled machine": "雪橇机",
  "smith machine": "史密斯机",
  "stability ball": "健身球",
  "stationary bike": "动感单车",
  "stepmill machine": "登阶机",
  "trap bar": "六角杠铃",
  tire: "轮胎",
  "upper body ergometer": "上肢功率车",
  weighted: "负重",
  "wheel roller": "健腹轮",
};

const catalog = JSON.parse(
  readFileSync(new URL("../../../data/exercises.zh.json", import.meta.url), "utf8"),
) as StoredCatalog;

if (catalog.schemaVersion !== 1 || catalog.exercises.length !== 1324) {
  throw new Error("Exercise catalog data is invalid");
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replaceAll(/\s+/g, " ");
}

function bodyPartLabel(value: string): string {
  return bodyPartLabels[value] ?? value;
}

function equipmentLabel(value: string): string {
  return equipmentLabels[value] ?? value;
}

const searchDocuments = catalog.exercises.map((exercise) => ({
  exercise,
  normalizedName: normalized(exercise.name),
  searchText: normalized([
    exercise.name,
    exercise.bodyPart,
    bodyPartLabel(exercise.bodyPart),
    exercise.equipment,
    equipmentLabel(exercise.equipment),
    exercise.target,
    exercise.muscleGroup,
    ...exercise.secondaryMuscles,
    ...exercise.steps,
  ].join(" ")),
}));

const exerciseIds = new Set(catalog.exercises.map((exercise) => exercise.id));
const mediaIndexes = new Map<string, ReadonlyMap<string, ExerciseMediaEntry>>();

function indexMediaDirectory(
  directory: string,
  extension: "jpg" | "gif",
  field: "imageFileName" | "animationFileName",
  entries: Map<string, ExerciseMediaEntry>,
): void {
  if (!existsSync(directory)) return;
  for (const fileName of readdirSync(directory).sort()) {
    const match = new RegExp(`^(\\d{4})-[A-Za-z0-9]+\\.${extension}$`, "i").exec(fileName);
    const exerciseId = match?.[1];
    if (exerciseId === undefined || !exerciseIds.has(exerciseId)) continue;
    const current = entries.get(exerciseId) ?? {};
    if (current[field] === undefined) entries.set(exerciseId, { ...current, [field]: fileName });
  }
}

function mediaIndex(mediaRoot: string | null): ReadonlyMap<string, ExerciseMediaEntry> {
  if (mediaRoot === null) return new Map();
  const root = resolve(mediaRoot);
  const cached = mediaIndexes.get(root);
  if (cached !== undefined) return cached;
  const entries = new Map<string, ExerciseMediaEntry>();
  indexMediaDirectory(join(root, "images"), "jpg", "imageFileName", entries);
  indexMediaDirectory(join(root, "videos"), "gif", "animationFileName", entries);
  mediaIndexes.set(root, entries);
  return entries;
}

function publicMedia(exerciseId: string, mediaRoot: string | null) {
  const media = mediaIndex(mediaRoot).get(exerciseId);
  const imageUrl = media?.imageFileName === undefined
    ? null
    : `/api/v1/training/exercises/${exerciseId}/media/image`;
  const animationUrl = media?.animationFileName === undefined
    ? null
    : `/api/v1/training/exercises/${exerciseId}/media/animation`;
  return {
    imageUrl,
    animationUrl,
  } as const;
}

function publicItem(exercise: StoredExercise, mediaRoot: string | null): ExerciseCatalogItem {
  return {
    id: exercise.id,
    name: exercise.name,
    bodyPart: exercise.bodyPart,
    bodyPartLabel: bodyPartLabel(exercise.bodyPart),
    equipment: exercise.equipment,
    equipmentLabel: equipmentLabel(exercise.equipment),
    target: exercise.target,
    ...publicMedia(exercise.id, mediaRoot),
  };
}

export function listExerciseCatalog(options: {
  readonly query?: string;
  readonly bodyPart?: string;
  readonly equipment?: string;
  readonly limit?: number;
}, mediaRoot: string | null = null): readonly ExerciseCatalogItem[] {
  const query = normalized(options.query ?? "");
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 50);
  return searchDocuments
    .filter(({ exercise, searchText }) =>
      (query.length === 0 || searchText.includes(query))
      && (options.bodyPart === undefined || exercise.bodyPart === options.bodyPart)
      && (options.equipment === undefined || exercise.equipment === options.equipment))
    .sort((left, right) => {
      if (query.length > 0) {
        const leftRank = left.normalizedName === query ? 0 : left.normalizedName.startsWith(query) ? 1 : 2;
        const rightRank = right.normalizedName === query ? 0 : right.normalizedName.startsWith(query) ? 1 : 2;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return left.exercise.name.localeCompare(right.exercise.name, "en");
    })
    .slice(0, limit)
    .map(({ exercise }) => publicItem(exercise, mediaRoot));
}

export function findCatalogExerciseGuidance(exerciseName: string, mediaRoot: string | null = null): ExerciseGuidance | null {
  const name = normalized(exerciseName);
  const stored = searchDocuments.find((item) => item.normalizedName === name)?.exercise;
  if (stored === undefined) return null;
  return {
    id: stored.id,
    exerciseName: stored.name,
    aliases: [],
    overview: `该动作归类为${bodyPartLabel(stored.bodyPart)}训练，使用${equipmentLabel(stored.equipment)}，主要目标为 ${stored.target}。`,
    steps: stored.steps,
    commonMistakes: [],
    alternatives: [],
    videoUrl: null,
    ...publicMedia(stored.id, mediaRoot),
    sourceName: "Exercise App 动作目录",
    sourceUrl: null,
    license: "MIT",
    version: catalog.version,
    reviewStatus: "draft",
    limitations: "动作名称与中文步骤尚未经过本项目持证教练或医疗专业人员审阅。出现疼痛、眩晕或明显不适时请停止。",
  };
}

export function getExerciseMediaFile(
  exerciseId: string,
  kind: ExerciseMediaKind,
  mediaRoot: string | null,
): ExerciseMediaFile | null {
  if (mediaRoot === null || !exerciseIds.has(exerciseId)) return null;
  const root = resolve(mediaRoot);
  const media = mediaIndex(root).get(exerciseId);
  const fileName = kind === "image" ? media?.imageFileName : media?.animationFileName;
  if (fileName === undefined) return null;
  return {
    absolutePath: join(root, kind === "image" ? "images" : "videos", fileName),
    contentType: kind === "image" ? "image/jpeg" : "image/gif",
  };
}
