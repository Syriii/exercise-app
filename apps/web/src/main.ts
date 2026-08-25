import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./app/App.vue";
import { router } from "./router";
import "./styles/app.css";

const root = document.querySelector("#root");

if (!(root instanceof HTMLElement)) {
  throw new Error("找不到应用挂载节点 #root。");
}

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount(root);
