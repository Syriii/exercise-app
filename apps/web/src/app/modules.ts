export type AppSection = "today" | "training" | "nutrition" | "history" | "settings";

export type NutritionScenario =
  | "waiting"
  | "tentative"
  | "failed"
  | "incomplete"
  | "correction";

export const navigationItems: ReadonlyArray<{
  id: AppSection;
  shortLabel: string;
  label: string;
  description: string;
}> = [
  { id: "today", shortLabel: "今", label: "今天", description: "安排与剩余" },
  { id: "training", shortLabel: "练", label: "训练", description: "计划与记录" },
  { id: "nutrition", shortLabel: "食", label: "饮食", description: "参考与餐食" },
  { id: "history", shortLabel: "史", label: "历史", description: "按天回看" },
  { id: "settings", shortLabel: "设", label: "设置", description: "资料与提醒" },
] as const;

export const scenarioOptions: ReadonlyArray<{ id: NutritionScenario; label: string }> = [
  { id: "waiting", label: "分析中" },
  { id: "tentative", label: "待确认" },
  { id: "failed", label: "识别失败" },
  { id: "incomplete", label: "今天没记全" },
  { id: "correction", label: "正在修改" },
] as const;

export const nutritionScenarioCopy: Record<
  NutritionScenario,
  { title: string; body: string; state: string; tone: "neutral" | "accent" | "danger" }
> = {
  waiting: {
    title: "照片存好了",
    body: "正在排队分析。你可以先去做别的，晚点再回来。",
    state: "分析中",
    tone: "neutral",
  },
  tentative: {
    title: "AI 给出了一版估算",
    body: "这份结果会先记入今天。最好看一眼，明显不对就改。",
    state: "待确认",
    tone: "accent",
  },
  failed: {
    title: "这次没识别出来",
    body: "照片还在。你可以再试一次，也可以自己填。",
    state: "识别失败",
    tone: "danger",
  },
  incomplete: {
    title: "今天可能还没记全",
    body: "现在只统计已经记下来的餐，漏掉的不会按 0 算。",
    state: "未记全",
    tone: "neutral",
  },
  correction: {
    title: "改一下这顿饭",
    body: "保存后使用你改过的数字。AI 原来的结果仍然可以查看。",
    state: "修改中",
    tone: "accent",
  },
};

export const nutritionItems = ["能量", "蛋白质", "碳水化合物", "脂肪"] as const;

export const nutritionStrategyOptions = [
  { id: "balanced", label: "均衡维持", description: "按当前身体情况和活动安排计算。" },
  { id: "muscle", label: "增肌 · 偏高蛋白", description: "适用时在已核验的运动蛋白质范围内分配。" },
  { id: "fat-loss", label: "减脂 · 控制油脂", description: "适用时在官方脂肪范围内选择较低分配。" },
] as const;

export const foodLibraryExamples = [
  { name: "食堂米饭", kind: "常见食物", note: "选择实际份量" },
  { name: "番茄炒蛋", kind: "混合菜", note: "份量和用油可以再确认" },
  { name: "纯牛奶", kind: "包装食品", note: "优先按包装标签记录" },
] as const;

export const trainingPlanItems = [
  { name: "卧推", detail: "组数和重量待填写" },
  { name: "上斜推", detail: "练完按实际情况记录" },
  { name: "夹胸", detail: "不想做可以跳过或换动作" },
] as const;
