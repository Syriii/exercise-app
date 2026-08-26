import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_BUILD_REVISION__: JSON.stringify(process.env.VITE_APP_BUILD_REVISION?.trim() || "local"),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
