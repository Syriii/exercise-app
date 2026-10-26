import { defineStore } from "pinia";
import { shallowRef, watch } from "vue";
import { useSessionStore } from "./session";

// A selected file crosses the Today → Nutrition route only in account-scoped memory.
export const usePhotoIntakeStore = defineStore("photo-intake", () => {
  const session = useSessionStore();
  const pending = shallowRef<{ file: File; date: string; owner: string } | null>(null);
  watch(() => [session.account?.id, session.draftScopeVersion], () => { pending.value = null; });
  function select(file: File, date: string) {
    if (session.account) pending.value = { file, date, owner: session.account.id };
  }
  function take(date: string): File | null {
    const value = pending.value;
    if (!value || value.owner !== session.account?.id || value.date !== date) return null;
    pending.value = null;
    return value.file;
  }
  function peek(date: string): File | null {
    return pending.value?.owner === session.account?.id && pending.value?.date === date ? pending.value.file : null;
  }
  function pendingDate(): string | null { const value = pending.value; return value && value.owner === session.account?.id ? value.date : null; }
  return { select, take, peek, pendingDate };
});
