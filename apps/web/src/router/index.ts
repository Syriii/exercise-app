import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

import { useSessionStore } from "../stores/session";
import AdminPage from "../views/AdminPage.vue";
import AuthPage from "../views/AuthPage.vue";
import ChangePasswordPage from "../views/ChangePasswordPage.vue";
import FeedbackPage from "../views/FeedbackPage.vue";
import HistoryPage from "../views/HistoryPage.vue";
import NutritionPage from "../views/NutritionPage.vue";
import SettingsPage from "../views/SettingsPage.vue";
import TodayPage from "../views/TodayPage.vue";
import TrainingPage from "../views/TrainingPage.vue";

const sectionRoutes: RouteRecordRaw[] = [
  { path: "/today", name: "today", component: TodayPage, meta: { section: "today" } },
  { path: "/training", name: "training", component: TrainingPage, meta: { section: "training" } },
  { path: "/nutrition", name: "nutrition", component: NutritionPage, meta: { section: "nutrition" } },
  { path: "/history", name: "history", component: HistoryPage, meta: { section: "history" } },
  { path: "/settings/:section?", name: "settings", component: SettingsPage, meta: { section: "settings" } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/today" },
    { path: "/login", name: "login", component: AuthPage, meta: { public: true } },
    { path: "/register", name: "register", component: AuthPage, meta: { public: true } },
    { path: "/account/password", name: "change-password", component: ChangePasswordPage },
    { path: "/feedback", name: "feedback", component: FeedbackPage, meta: { section: "settings" } },
    { path: "/admin", name: "admin", component: AdminPage, meta: { admin: true } },
    ...sectionRoutes,
    { path: "/:pathMatch(.*)*", redirect: "/today" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  await session.restore();

  if (to.meta.public === true) {
    if (session.account !== null) {
      return session.account.passwordChangeRequired ? { name: "change-password" } : { name: "today" };
    }
    return true;
  }
  if (session.account === null) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (session.account.passwordChangeRequired && to.name !== "change-password") {
    return { name: "change-password" };
  }
  if (to.meta.admin === true && session.account.role !== "admin") {
    return { name: "today" };
  }
  return true;
});
