import type { ExerciseGuidance } from "./types.js";

const sharedMetadata = {
  videoUrl: null,
  sourceName: "Exercise App contributors",
  sourceUrl: null,
  license: "MIT",
  version: "2026-08-26",
  reviewStatus: "draft",
  limitations: "这是一般动作提示，尚未经过持证教练或医疗专业人员审阅。疼痛、眩晕或明显不适时应停止动作；既往伤病和特殊情况需要个别评估。",
} as const;

const guidanceCatalog: readonly ExerciseGuidance[] = [
  {
    ...sharedMetadata,
    id: "squat-draft-zh-cn-v1",
    exerciseName: "深蹲",
    aliases: ["杠铃深蹲", "高脚杯深蹲", "徒手深蹲"],
    overview: "先用能够稳定控制的活动范围练习下蹲与站起，不以追求深度或重量代替控制。",
    steps: ["双脚稳定站立，先确认落脚和器械位置。", "屈髋屈膝下蹲，膝盖方向与脚尖大致一致。", "躯干保持可控制，脚掌持续接触地面，再稳定站起。"],
    commonMistakes: ["重量超过当前能稳定控制的范围。", "为了更深而丢失脚掌支撑或躯干控制。", "出现疼痛仍继续完成组数。"],
    alternatives: ["徒手深蹲", "箱式深蹲", "高脚杯深蹲"],
  },
  {
    ...sharedMetadata,
    id: "bench-press-draft-zh-cn-v1",
    exerciseName: "卧推",
    aliases: ["杠铃卧推", "哑铃卧推"],
    overview: "先固定卧凳、落脚和器械路径；使用自由重量时，应优先保证可控负荷与安全退出方式。",
    steps: ["确认卧凳和杠铃或哑铃稳定，双脚落地。", "肩胛和躯干保持稳定，在可控制范围内下放。", "平稳推起，不用突然弹震改变方向。"],
    commonMistakes: ["无人保护时使用无法自行退出的重量。", "下放失控或借反弹完成动作。", "手腕、肩部出现疼痛仍继续加重。"],
    alternatives: ["器械推胸", "俯卧撑", "较轻哑铃卧推"],
  },
  {
    ...sharedMetadata,
    id: "deadlift-draft-zh-cn-v1",
    exerciseName: "硬拉",
    aliases: ["罗马尼亚硬拉", "传统硬拉"],
    overview: "从稳定起始位置移动负重，保持负重接近身体；优先练习髋部发力和全程控制。",
    steps: ["站稳并确认握持，负重靠近身体。", "收紧躯干，在可控制的脊柱位置用腿和髋共同发力。", "站稳后再受控下放，不从高处直接丢落。"],
    commonMistakes: ["起始位置不稳定就突然发力。", "负重远离身体或下放失控。", "为完成重量而忽略疼痛或动作明显变形。"],
    alternatives: ["壶铃硬拉", "臀桥", "轻重量罗马尼亚硬拉"],
  },
  {
    ...sharedMetadata,
    id: "plank-draft-zh-cn-v1",
    exerciseName: "平板支撑",
    aliases: ["前臂平板支撑"],
    overview: "在正常呼吸下保持身体和支撑点稳定，时间以能够维持姿势为限。",
    steps: ["前臂或手掌稳定支撑，脚尖落地。", "保持头、躯干和骨盆处于可控制的位置。", "正常呼吸，姿势开始明显丢失时结束该组。"],
    commonMistakes: ["憋气追求更长时间。", "腰背明显塌陷仍继续计时。", "肩、腰或腕部疼痛时继续支撑。"],
    alternatives: ["跪姿平板支撑", "斜板支撑", "死虫式"],
  },
];

function normalizeExerciseName(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replaceAll(/\s+/g, "");
}

export function findExerciseGuidance(exerciseName: string): ExerciseGuidance | null {
  const normalized = normalizeExerciseName(exerciseName);
  return guidanceCatalog.find((guidance) =>
    [guidance.exerciseName, ...guidance.aliases].some((name) => normalizeExerciseName(name) === normalized),
  ) ?? null;
}
