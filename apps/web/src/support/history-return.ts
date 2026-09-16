import type { RouteLocationNormalizedLoaded, Router } from "vue-router";

export function returnToHistory(route: RouteLocationNormalizedLoaded, router: Router): Promise<unknown> | undefined {
  const path = route.query.returnTo;
  if (typeof path === "string" && /^\/history(?:\?|$)/.test(path)) return router.push(path);
}
