<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useSessionStore } from "../stores/session";

import {
  foodLibraryExamples,
  navigationItems,
  nutritionItems,
  nutritionScenarioCopy,
  nutritionStrategyOptions,
  scenarioOptions,
  trainingPlanItems,
  type AppSection,
  type NutritionScenario,
} from "./modules";

type HistoryFilter = "all" | "training" | "nutrition";
type MealEntryMode = "photo" | "search";
type NutritionStrategy = (typeof nutritionStrategyOptions)[number]["id"];

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const sections = new Set<AppSection>(["today", "training", "nutrition", "history", "settings"]);
const activeSection = computed<AppSection>(() => {
  const section = route.meta.section;
  return typeof section === "string" && sections.has(section as AppSection)
    ? (section as AppSection)
    : "today";
});
const nutritionScenario = ref<NutritionScenario>("waiting");
const trainingStarted = ref(false);
const completedExercises = ref<string[]>([]);
const extraExerciseAdded = ref(false);
const nutritionStrategy = ref<NutritionStrategy>("balanced");
const mealEntryMode = ref<MealEntryMode>("photo");
const foodQuery = ref("");
const selectedFood = ref<string | null>(null);
const historyFilter = ref<HistoryFilter>("all");
const trainingReminder = ref(false);
const nutritionReminder = ref(false);

const activeNavigation = computed(() =>
  navigationItems.find((item) => item.id === activeSection.value),
);
const currentNutritionScenario = computed(() => nutritionScenarioCopy[nutritionScenario.value]);
const remainingTrainingItems = computed(() =>
  trainingPlanItems.filter((item) => !completedExercises.value.includes(item.name)),
);
const visibleFoodExamples = computed(() => {
  const query = foodQuery.value.trim();
  if (!query) return foodLibraryExamples;
  return foodLibraryExamples.filter((item) => item.name.includes(query) || item.kind.includes(query));
});

function openSection(section: AppSection) {
  void router.push({ name: section });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

async function logout() {
  await session.logout();
  await router.push({ name: "login" });
}

function openMealFlow() {
  mealEntryMode.value = "photo";
  nutritionScenario.value = "waiting";
  openSection("nutrition");
}

function toggleExercise(name: string) {
  completedExercises.value = completedExercises.value.includes(name)
    ? completedExercises.value.filter((item) => item !== name)
    : [...completedExercises.value, name];
}

function showHistory(kind: Exclude<HistoryFilter, "all">) {
  return historyFilter.value === "all" || historyFilter.value === kind;
}
</script>

<template>
  <div class="prototype-shell">
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
          :class="{ 'is-active': activeSection === item.id }"
          type="button"
          :aria-current="activeSection === item.id ? 'page' : undefined"
          @click="openSection(item.id)"
        >
          <span class="nav-button__short" aria-hidden="true">{{ item.shortLabel }}</span>
          <span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
        </button>
      </nav>

      <p class="rail-note">按计划练，也按实际记。</p>
    </aside>

    <div class="app-column">
      <header class="mobile-header">
        <a class="mobile-brand" href="#top" aria-label="Exercise App 顶部">EA / 日常训练</a>
        <span>{{ session.account?.username }}</span>
      </header>

      <main id="top" class="app-main">
        <header class="view-header">
          <div>
            <p class="date-line">8 月 24 日 · 今天</p>
            <h1>{{ activeNavigation?.label }}</h1>
            <p>{{ activeNavigation?.description }}</p>
          </div>

          <label class="scenario-control">
            <span>预览餐食状态</span>
            <select v-model="nutritionScenario">
              <option v-for="option in scenarioOptions" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </select>
          </label>
        </header>

        <div class="view-stack" aria-live="polite">
          <template v-if="activeSection === 'today'">
            <section class="daily-brief" aria-labelledby="daily-title">
              <div class="daily-brief__intro">
                <h2 id="daily-title">今天先做哪件事？</h2>
                <p>个人资料还没填完，所以今天的营养建议暂时算不了。你仍然可以先记饭或开始训练。</p>
              </div>
              <div class="primary-actions" aria-label="今日快速操作">
                <button class="action-button action-button--primary" type="button" @click="openMealFlow">
                  拍照记一餐
                </button>
                <button class="action-button" type="button" @click="openSection('training')">
                  查看训练
                </button>
              </div>
            </section>

            <section class="balance-panel" aria-labelledby="balance-title">
              <div class="panel-heading">
                <div><h2 id="balance-title">今天还可以吃</h2></div>
                <span class="status-chip">按已记录计算</span>
              </div>
              <dl class="metric-list">
                <div v-for="item in nutritionItems" :key="item">
                  <dt>{{ item }}</dt><dd>—</dd><span>补全资料后显示</span>
                </div>
              </dl>
              <p class="data-note">系统建议减去已经记下的内容。没记的餐不会按 0 计算。</p>
              <button class="text-action" type="button" @click="openSection('settings')">补全资料 →</button>
            </section>

            <div class="today-columns">
              <section class="work-panel" aria-labelledby="today-training-title">
                <div class="panel-heading">
                  <div><h2 id="today-training-title">今天还要练</h2></div>
                  <span class="status-chip" :data-tone="remainingTrainingItems.length === 0 ? 'accent' : undefined">
                    {{ remainingTrainingItems.length === 0 ? "已完成" : `还剩 ${remainingTrainingItems.length} 项` }}
                  </span>
                </div>
                <template v-if="remainingTrainingItems.length > 0">
                  <p>力量训练（示例）</p>
                  <ul class="plain-list">
                    <li v-for="item in remainingTrainingItems" :key="item.name">{{ item.name }}</li>
                  </ul>
                  <p>在训练页完成一项，这里就会同步减少。</p>
                </template>
                <template v-else>
                  <strong>今天的计划已经完成</strong>
                  <p>额外做的动作仍可以在训练页补充。</p>
                </template>
                <button class="text-action" type="button" @click="openSection('training')">
                  {{ remainingTrainingItems.length === 0 ? "查看记录 →" : "去训练 →" }}
                </button>
              </section>

              <section class="work-panel" aria-labelledby="today-meal-title">
                <div class="panel-heading">
                  <div><h2 id="today-meal-title">最近一餐</h2></div>
                  <span class="status-chip" :data-tone="currentNutritionScenario.tone">
                    {{ currentNutritionScenario.state }}
                  </span>
                </div>
                <strong>{{ currentNutritionScenario.title }}</strong>
                <p>{{ currentNutritionScenario.body }}</p>
                <button class="text-action" type="button" @click="openSection('nutrition')">去看看 →</button>
              </section>
            </div>

          </template>

          <template v-else-if="activeSection === 'training'">
            <section class="split-heading" aria-labelledby="training-title">
              <div><h2 id="training-title">今天怎么练？</h2></div>
              <p>照着计划做，完成一项就勾一项。临时加练的内容直接补在后面。</p>
            </section>

            <section class="work-panel training-plan" aria-labelledby="plan-title">
              <div class="panel-heading">
                <div>
                  <h2 id="plan-title">今天的计划</h2>
                  <p class="plan-source">这份计划由系统建议修改而来，保存后就是你的安排。</p>
                </div>
                <span class="status-chip">胸部训练 · 示例</span>
              </div>
              <div class="plan-actions">
                <button class="text-action" type="button">编辑计划</button>
                <button class="action-button" type="button" @click="trainingStarted = !trainingStarted">
                  {{ trainingStarted ? "结束训练" : "开始训练" }}
                </button>
              </div>
              <ol class="exercise-list">
                <li
                  v-for="item in trainingPlanItems"
                  :key="item.name"
                  :class="{ 'is-complete': completedExercises.includes(item.name) }"
                >
                  <label class="completion-control">
                    <input
                      type="checkbox"
                      :checked="completedExercises.includes(item.name)"
                      :aria-label="`标记${item.name}完成`"
                      @change="toggleExercise(item.name)"
                    />
                    <span>{{ completedExercises.includes(item.name) ? "已完成" : "待完成" }}</span>
                  </label>
                  <div class="exercise-body">
                    <strong>{{ item.name }}</strong><p>{{ item.detail }}</p>
                    <button class="text-action" type="button">动作指导</button>
                    <label v-if="completedExercises.includes(item.name)" class="actual-entry">
                      <span>实际做了多少</span>
                      <input type="text" placeholder="组数、重量或备注" />
                    </label>
                  </div>
                </li>
              </ol>
            </section>

            <section class="work-panel extra-training" aria-labelledby="extra-training-title">
              <div class="panel-heading">
                <div><h2 id="extra-training-title">计划外还做了什么？</h2></div>
                <span class="status-chip">额外记录</span>
              </div>
              <p>临时增加的动作放在这里，不需要先改原计划。</p>
              <label v-if="extraExerciseAdded" class="actual-entry">
                <span>新增动作</span>
                <input type="text" placeholder="动作、时长或训练量" />
              </label>
              <button class="text-action" type="button" @click="extraExerciseAdded = !extraExerciseAdded">
                {{ extraExerciseAdded ? "移除这条" : "添加一个动作 →" }}
              </button>
            </section>
          </template>

          <template v-else-if="activeSection === 'nutrition'">
            <section class="split-heading" aria-labelledby="nutrition-title">
              <div><h2 id="nutrition-title">今天还可以吃多少？</h2></div>
              <p>建议由系统按官方依据计算。你只选择当前策略，不需要自己填一套营养数字。</p>
            </section>

            <section class="recommendation-panel" aria-labelledby="recommendation-title">
              <div class="panel-heading">
                <div>
                  <h2 id="recommendation-title">今天的系统建议</h2>
                  <p>照片识别只影响已吃多少，不会反过来改计算方法。</p>
                </div>
                <span class="status-chip">官方依据</span>
              </div>
              <dl class="metric-list">
                <div v-for="item in nutritionItems" :key="item">
                  <dt>{{ item }}</dt><dd>—</dd><span>补全资料后显示</span>
                </div>
              </dl>
              <fieldset class="strategy-fieldset">
                <legend>当前策略</legend>
                <div class="strategy-options">
                  <label
                    v-for="option in nutritionStrategyOptions"
                    :key="option.id"
                    class="strategy-option"
                    :class="{ 'is-selected': nutritionStrategy === option.id }"
                  >
                    <input v-model="nutritionStrategy" type="radio" name="nutrition-strategy" :value="option.id" />
                    <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
                  </label>
                </div>
              </fieldset>
              <div class="recommendation-actions">
                <button class="text-action" type="button" @click="openSection('settings')">补全计算资料 →</button>
                <button class="text-action" type="button">安排今天的餐次 →</button>
              </div>
            </section>

            <section class="balance-panel" aria-labelledby="remaining-title">
              <div class="panel-heading">
                <div>
                  <h2 id="remaining-title">今天还可以吃</h2>
                  <p>系统建议减去已经记下来的内容。</p>
                </div>
                <span class="status-chip">仅按已记录</span>
              </div>
              <dl class="metric-list">
                <div v-for="item in nutritionItems" :key="item">
                  <dt>{{ item }}</dt><dd>—</dd><span>资料或记录不足</span>
                </div>
              </dl>
              <p class="data-note">没记的餐不会按 0 计算；照片估算仍会保留不确定性。</p>
            </section>

            <section class="capture-panel" aria-labelledby="capture-title">
              <div>
                <h2 id="capture-title">记下这顿饭</h2>
                <p>可以拍照估算，也可以从食物库里一项项添加。</p>
              </div>
              <div class="entry-mode-grid" aria-label="记录方式">
                <div class="entry-mode-option">
                  <button
                    class="entry-mode-button"
                    :class="{ 'is-active': mealEntryMode === 'photo' }"
                    type="button"
                    @click="mealEntryMode = 'photo'; nutritionScenario = 'waiting'"
                  >拍照记一餐</button>
                  <p>先保存照片，再由 AI 估算。</p>
                </div>
                <div class="entry-mode-option">
                  <button
                    class="entry-mode-button"
                    :class="{ 'is-active': mealEntryMode === 'search' }"
                    type="button"
                    @click="mealEntryMode = 'search'"
                  >从食物库添加</button>
                  <p>搜索食物、菜品或包装食品。</p>
                </div>
              </div>
            </section>

            <section
              v-if="mealEntryMode === 'photo'"
              class="analysis-panel"
              :data-tone="currentNutritionScenario.tone"
              aria-labelledby="analysis-title"
            >
              <div class="analysis-panel__status">
                <span>{{ currentNutritionScenario.state }}</span>
                <small>这是照片估算，之后还能修改</small>
              </div>
              <div><h2 id="analysis-title">{{ currentNutritionScenario.title }}</h2><p>{{ currentNutritionScenario.body }}</p></div>
              <div class="analysis-actions">
                <button v-if="nutritionScenario === 'failed'" class="action-button" type="button" @click="nutritionScenario = 'waiting'">再试一次</button>
                <button v-if="nutritionScenario === 'tentative'" class="action-button" type="button" @click="nutritionScenario = 'correction'">看看并修改</button>
                <button v-if="nutritionScenario === 'waiting'" class="action-button" type="button" @click="nutritionScenario = 'tentative'">查看示例结果</button>
              </div>
            </section>

            <section v-else class="food-search-panel" aria-labelledby="food-search-title">
              <div class="panel-heading">
                <div><h2 id="food-search-title">从食物库添加</h2><p>先找具体条目，再选择实际吃的份量。</p></div>
                <span v-if="selectedFood" class="status-chip" data-tone="accent">已加入：{{ selectedFood }}</span>
              </div>
              <label class="search-field">
                <span>搜索食物或菜名</span>
                <input v-model="foodQuery" type="search" placeholder="例如：米饭、番茄炒蛋" />
              </label>
              <ul class="food-results" aria-live="polite">
                <li v-for="food in visibleFoodExamples" :key="food.name">
                  <div><strong>{{ food.name }}</strong><p>{{ food.kind }} · {{ food.note }}</p></div>
                  <button class="text-action" type="button" @click="selectedFood = food.name">选择份量</button>
                </li>
                <li v-if="visibleFoodExamples.length === 0">
                  <div><strong>没有找到合适条目</strong><p>可以换个关键词，或直接手动填写。</p></div>
                </li>
              </ul>
              <button class="text-action" type="button" @click="mealEntryMode = 'photo'; nutritionScenario = 'correction'">直接填写营养 →</button>
            </section>

            <section v-if="mealEntryMode === 'photo' && nutritionScenario === 'correction'" class="correction-panel" aria-labelledby="correction-title">
              <div class="panel-heading">
                <div><h2 id="correction-title">这顿饭大概吃了多少？</h2></div>
                <span class="status-chip" data-tone="accent">原结果还在</span>
              </div>
              <div class="field-grid">
                <label v-for="item in nutritionItems" :key="item">
                  <span>{{ item }}</span><input inputmode="decimal" placeholder="待填写" />
                  <small>不知道可以不填。</small>
                </label>
              </div>
              <button class="action-button action-button--primary" type="button" @click="nutritionScenario = 'tentative'">保存修改</button>
            </section>
          </template>

          <template v-else-if="activeSection === 'history'">
            <section class="split-heading" aria-labelledby="history-title">
              <div><h2 id="history-title">按天回看</h2></div>
              <p>一天里同时放训练和饮食。只想看其中一类时，直接筛选。</p>
            </section>

            <div class="history-filters" aria-label="筛选历史内容">
              <button type="button" :aria-pressed="historyFilter === 'all'" @click="historyFilter = 'all'">全部</button>
              <button type="button" :aria-pressed="historyFilter === 'training'" @click="historyFilter = 'training'">训练</button>
              <button type="button" :aria-pressed="historyFilter === 'nutrition'" @click="historyFilter = 'nutrition'">饮食</button>
            </div>

            <section class="history-list" aria-label="按日期排列的历史">
              <article class="history-day">
                <time datetime="2026-08-24">今天</time>
                <div class="history-day__sections">
                  <section v-if="showHistory('training')">
                    <strong>训练</strong><p>计划已经建立，完成情况还在记录中。</p>
                  </section>
                  <section v-if="showHistory('nutrition')">
                    <strong>饮食</strong><p>午餐已经记了，全天是否记全还不知道。</p>
                  </section>
                </div>
                <span class="status-chip">未记全</span>
              </article>
              <article class="history-day">
                <time datetime="2026-08-23">8 月 23 日</time>
                <div class="history-day__sections">
                  <section v-if="showHistory('training')"><strong>训练</strong><p>没有记录，不代表没有训练。</p></section>
                  <section v-if="showHistory('nutrition')"><strong>饮食</strong><p>没有记录，不代表没有进食。</p></section>
                </div>
                <span class="status-chip">无记录</span>
              </article>
              <article class="history-day">
                <time datetime="2026-08-22">8 月 22 日</time>
                <div class="history-day__sections">
                  <section v-if="showHistory('training')"><strong>训练</strong><p>实际训练记录后来修正过。</p></section>
                  <section v-if="showHistory('nutrition')"><strong>饮食</strong><p>汇总使用当前采用值，旧结果仍然能查。</p></section>
                </div>
                <span class="status-chip" data-tone="accent">已修改</span>
              </article>
            </section>
          </template>

          <template v-else>
            <section class="split-heading" aria-labelledby="settings-title">
              <div><h2 id="settings-title">设置你的资料和提醒</h2></div>
              <p>资料没填完只会影响相关计算，不耽误记训练和饮食。</p>
            </section>

            <section class="settings-list" aria-label="设置分组">
              <article><div><strong>个人资料和目标</strong><p>身高、体重、活动情况和健身目标。</p></div><button class="text-action" type="button">去填写 →</button></article>
              <article><div><strong>图片分析</strong><p>还没接入模型。以后发送照片前会先征求你的同意。</p></div><span class="status-chip">未设置</span></article>
              <article><div><strong>训练提醒</strong><p>只提醒训练，不催打卡。</p></div><label class="switch-row"><input v-model="trainingReminder" type="checkbox" /><span>{{ trainingReminder ? "已开启" : "已关闭" }}</span></label></article>
              <article><div><strong>饮食提醒</strong><p>提醒你记饭，顺便看看今天还差多少。</p></div><label class="switch-row"><input v-model="nutritionReminder" type="checkbox" /><span>{{ nutritionReminder ? "已开启" : "已关闭" }}</span></label></article>
              <article><div><strong>账号</strong><p>{{ session.account?.username }} · {{ session.account?.role === "admin" ? "管理员" : "普通用户" }}</p></div><button class="text-action" type="button" @click="logout">退出登录 →</button></article>
              <article v-if="session.account?.passwordChangeRequired"><div><strong>修改初始密码</strong><p>完成修改后，部署时使用的初始密码和旧会话将不再有效。</p></div><button class="text-action" type="button" @click="router.push({ name: 'change-password' })">现在修改 →</button></article>
              <article v-if="session.account?.role === 'admin'"><div><strong>账号管理</strong><p>控制注册开关，查看和停用普通账号。</p></div><button class="text-action" type="button" @click="router.push({ name: 'admin' })">打开管理页 →</button></article>
              <article><div><strong>管理数据</strong><p>导出、备份或删除你的记录和照片。</p></div><button class="text-action" type="button">查看 →</button></article>
            </section>

            <aside class="safety-note"><strong>使用范围</strong><p>这里只做一般健身和饮食参考。如果你的身体情况不适合通用算法，系统不会硬算一个数字。</p></aside>
          </template>
        </div>
      </main>

      <footer class="prototype-footer"><p>Exercise App · MIT License</p></footer>

      <nav class="mobile-dock" aria-label="主要导航">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          class="dock-button"
          :class="{ 'is-active': activeSection === item.id }"
          type="button"
          :aria-current="activeSection === item.id ? 'page' : undefined"
          @click="openSection(item.id)"
        >
          <span aria-hidden="true">{{ item.shortLabel }}</span><strong>{{ item.label }}</strong>
        </button>
      </nav>
    </div>
  </div>
</template>
