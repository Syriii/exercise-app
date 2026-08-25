import { defineStore } from "pinia";
import { ref } from "vue";

import { ApiError, apiRequest } from "../api/client";

export interface Account {
  readonly id: string;
  readonly username: string;
  readonly role: "admin" | "user";
  readonly status: "active" | "disabled";
  readonly passwordChangeRequired: boolean;
}

export const useSessionStore = defineStore("session", () => {
  const account = ref<Account | null>(null);
  const restored = ref(false);

  async function restore(): Promise<void> {
    if (restored.value) return;
    try {
      account.value = await apiRequest<Account>("/api/v1/auth/me");
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        console.error("Unable to restore session", error);
      }
      account.value = null;
    } finally {
      restored.value = true;
    }
  }

  async function authenticate(mode: "login" | "register", username: string, password: string) {
    account.value = await apiRequest<Account>(`/api/v1/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    restored.value = true;
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    account.value = await apiRequest<Account>("/api/v1/auth/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async function logout() {
    await apiRequest<void>("/api/v1/auth/logout", { method: "POST" });
    account.value = null;
    restored.value = true;
  }

  return { account, restored, restore, authenticate, changePassword, logout };
});
