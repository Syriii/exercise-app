import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

import Dashboard from "../app/Dashboard.vue";
import { useSessionStore } from "../stores/session";
import AdminPage from "../views/AdminPage.vue";
import AuthPage from "../views/AuthPage.vue";
import ChangePasswordPage from "../views/ChangePasswordPage.vue";

const sectionRoutes: RouteRecordRaw[] = [
  { path: "/today", name: "today", component: Dashboard, meta: { section: "today" } },
  { path: "/training", name: "training", component: Dashboard, meta: { section: "training" } },
  { path: "/nutrition", name: "nutrition", component: Dashboard, meta: { section: "nutrition" } },
  { path: "/history", name: "history", component: Dashboard, meta: { section: "history" } },
  { path: "/settings", name: "settings", component: Dashboard, meta: { section: "settings" } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/today" },
    { path: "/login", name: "login", component: AuthPage, meta: { public: true } },
    { path: "/register", name: "register", component: AuthPage, meta: { public: true } },
    { path: "/account/password", name: "change-password", component: ChangePasswordPage },
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
