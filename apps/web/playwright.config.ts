import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      testIgnore: ["**/*.desktop.spec.ts"],
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run e2e:serve --workspace @exercise-app/server",
    url: "http://127.0.0.1:4174/api/v1/health/live",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
