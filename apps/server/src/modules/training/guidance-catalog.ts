import type { ExerciseGuidance } from "./types.js";
import { findCatalogExerciseGuidance } from "./exercise-catalog.js";

const sharedMetadata = {
  videoUrl: null,
  imageUrl: null,
  animationUrl: null,
  mediaAttribution: null,
  sourceName: "Exercise App 项目贡献者",
  sourceUrl: null,
  license: "MIT",
  version: "2026-08-26",
  reviewStatus: "draft",
  limitations: "内容尚未经过持证教练或医疗专业人员审阅。出现疼痛、眩晕或明显不适时请停止；既往伤病和特殊情况需要个别评估。",
} as const;

const guidanceCatalog: readonly ExerciseGuidance[] = [
  {
    ...sharedMetadata,
    id: "squat-draft-zh-cn-v1",
    exerciseName: "深蹲",
    aliases: ["杠铃深蹲", "高脚杯深蹲", "徒手深蹲", "腿举"],
    overview: "先用能够稳定控制的活动范围练习下蹲与站起，不以追求深度或重量代替控制。",
    steps: ["双脚稳定站立，先确认落脚和器械位置。", "屈髋屈膝下蹲，膝盖方向与脚尖大致一致。", "躯干保持可控制，脚掌持续接触地面，再稳定站起。"],
    commonMistakes: ["重量超过当前能稳定控制的范围。", "为了更深而丢失脚掌支撑或躯干控制。", "出现疼痛仍继续完成组数。"],
    alternatives: ["徒手深蹲", "箱式深蹲", "高脚杯深蹲"],
  },
  {
    ...sharedMetadata,
    id: "bench-press-draft-zh-cn-v1",
    exerciseName: "卧推",
    aliases: ["杠铃卧推", "哑铃卧推", "器械推胸"],
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
    aliases: ["前臂平板支撑", "核心稳定"],
    overview: "在正常呼吸下保持身体和支撑点稳定，时间以能够维持姿势为限。",
    steps: ["前臂或手掌稳定支撑，脚尖落地。", "保持头、躯干和骨盆处于可控制的位置。", "正常呼吸，姿势开始明显丢失时结束该组。"],
    commonMistakes: ["憋气追求更长时间。", "腰背明显塌陷仍继续计时。", "肩、腰或腕部疼痛时继续支撑。"],
    alternatives: ["跪姿平板支撑", "斜板支撑", "死虫式"],
  },
  {
    ...sharedMetadata,
    id: "row-draft-zh-cn-v1",
    exerciseName: "划船",
    aliases: ["单臂哑铃划船", "坐姿划船", "杠铃划船", "水平拉"],
    overview: "先稳定躯干和肩部，再把手柄或负重拉向身体；动作范围以肩部能够控制为准。",
    steps: ["固定脚和躯干，确认握持稳定。", "先保持肩部稳定，再把手肘向后带。", "到达可控位置后慢慢还原，不借摆动完成次数。"],
    commonMistakes: ["用身体大幅摆动代替背部发力。", "拉到肩部明显前顶或疼痛的位置。", "回放阶段突然卸力。"],
    alternatives: ["坐姿划船", "胸托划船", "弹力带划船"],
  },
  {
    ...sharedMetadata,
    id: "shoulder-press-draft-zh-cn-v1",
    exerciseName: "肩推",
    aliases: ["哑铃肩推", "杠铃肩推", "器械肩推", "垂直推"],
    overview: "从能够稳定控制肩部和躯干的位置向上推，不用腰部后仰换取更大的重量。",
    steps: ["坐稳或站稳，握持器械并收住躯干。", "沿可控路径向上推，手腕保持稳定。", "缓慢下放到肩部舒适的位置。"],
    commonMistakes: ["为了推起重量明显后仰。", "手腕过度折叠。", "肩部疼痛时仍继续扩大动作范围。"],
    alternatives: ["器械肩推", "地雷管推举", "较轻哑铃肩推"],
  },
  {
    ...sharedMetadata,
    id: "lunge-draft-zh-cn-v1",
    exerciseName: "弓步",
    aliases: ["反向弓步", "箭步蹲", "单腿动作"],
    overview: "先用稳定步幅练习单腿下蹲和站起，保持两侧脚掌有清楚支撑。",
    steps: ["站稳后向前或向后迈出合适一步。", "屈膝下沉，前脚脚掌保持接触地面。", "从可控深度站回起点，再换另一侧。"],
    commonMistakes: ["步幅过小或过大导致失去平衡。", "前脚脚跟抬起。", "膝、髋疼痛时仍继续加深。"],
    alternatives: ["扶物弓步", "分腿蹲", "台阶上步"],
  },
  {
    ...sharedMetadata,
    id: "hip-bridge-draft-zh-cn-v1",
    exerciseName: "臀桥",
    aliases: ["杠铃臀推"],
    overview: "脚掌和上背保持稳定，用髋部伸展抬起身体，不用腰部过伸追求高度。",
    steps: ["仰卧屈膝，双脚稳定踩地。", "收住躯干，用臀部发力抬起髋部。", "到躯干和大腿大致成一直线后受控下放。"],
    commonMistakes: ["在顶端明显反弓腰部。", "脚离身体太远导致腿后侧抽筋。", "快速弹起、下放失控。"],
    alternatives: ["徒手臀桥", "单腿臀桥", "器械臀推"],
  },
  {
    ...sharedMetadata,
    id: "vertical-pull-draft-zh-cn-v1",
    exerciseName: "高位下拉",
    aliases: ["引体向上", "辅助引体", "垂直拉"],
    overview: "保持躯干稳定，把手柄或身体拉向可控位置；不要用大幅后仰和摆动代替拉力。",
    steps: ["确认握持和器械稳定，肩部保持可控。", "带动手肘向下，保持躯干基本稳定。", "在舒适位置停住，再缓慢还原。"],
    commonMistakes: ["身体大幅后仰或摆动。", "把手柄猛拉到颈后。", "肩、肘疼痛时继续加重。"],
    alternatives: ["辅助引体向上", "弹力带下拉", "中立握高位下拉"],
  },
  {
    ...sharedMetadata,
    id: "push-up-draft-zh-cn-v1",
    exerciseName: "俯卧撑",
    aliases: ["跪姿俯卧撑", "斜板俯卧撑"],
    overview: "在能够保持躯干和肩部控制的高度完成推起；需要时提高支撑面，不必勉强做地面版本。",
    steps: ["双手和双脚或膝部稳定支撑。", "保持躯干位置，下放到肩部舒适的深度。", "推回起点，过程中保持正常呼吸。"],
    commonMistakes: ["腰背塌陷仍继续次数。", "双手位置让肩或腕明显不适。", "为了触地而失去控制。"],
    alternatives: ["斜板俯卧撑", "跪姿俯卧撑", "器械推胸"],
  },
];

function normalizeExerciseName(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replaceAll(/\s+/g, "");
}

export function findExerciseGuidance(exerciseName: string, mediaRoot: string | null = null): ExerciseGuidance | null {
  const normalized = normalizeExerciseName(exerciseName);
  return guidanceCatalog.find((guidance) =>
    [guidance.exerciseName, ...guidance.aliases].some((name) => {
      const candidate = normalizeExerciseName(name);
      return candidate === normalized || (candidate.length >= 2 && normalized.includes(candidate));
    }),
  ) ?? findCatalogExerciseGuidance(exerciseName, mediaRoot);
}
