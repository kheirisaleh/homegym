import { api, setApiUser } from "@/lib/api";
import { createStore, useStore } from "@/lib/store";
import { sessionGet, sessionSet, storageSet } from "@/lib/storage";
import type { AiStatus, Meta, Session, User } from "@/lib/types";

export const userStore = createStore<User | null>(null);
export const metaStore = createStore<Meta | null>(null);
export const activeStore = createStore<Session | null>(null);
export const aiStore = createStore<AiStatus | null>(null);

export function setUser(user: User | null): void {
  setApiUser(user ? user.id : null);
  userStore.set(user);
  storageSet("user-id", user ? String(user.id) : "");
  if (!user) {
    activeStore.set(null);
    aiStore.set(null);
  }
}

export function patchUser(fields: Partial<User>): void {
  const current = userStore.get();
  if (current) userStore.set({ ...current, ...fields });
}

export function useUser(): User | null {
  return useStore(userStore);
}

export function useRequiredUser(): User {
  const user = useStore(userStore);
  if (!user) throw new Error("No user selected");
  return user;
}

export function useMeta(): Meta {
  const meta = useStore(metaStore);
  if (!meta) throw new Error("Meta not loaded");
  return meta;
}

export function muscleLabel(key: string | null | undefined): string {
  if (!key) return "";
  return metaStore.get()?.muscle_labels[key] ?? key;
}

export async function loadMeta(): Promise<Meta> {
  const current = metaStore.get();
  if (current) return current;
  const meta = await api.get<Meta>("/api/meta");
  metaStore.set(meta);
  return meta;
}

export async function refreshActive(): Promise<Session | null> {
  const active = await api.get<Session | null>("/api/sessions/active");
  activeStore.set(active);
  return active;
}

export function useActive(): Session | null {
  return useStore(activeStore);
}

export async function refreshAiStatus(fresh = false): Promise<AiStatus | null> {
  try {
    const status = await api.get<AiStatus>("/api/ai/status" + (fresh ? "?fresh=true" : ""));
    aiStore.set(status);
    return status;
  } catch {
    return null;
  }
}

export function useAiStatus(): AiStatus | null {
  return useStore(aiStore);
}

const aiBannerStore = createStore(sessionGet("ai-banner-dismissed") === "1");

export function useAiBannerDismissed(): [boolean, () => void] {
  const dismissed = useStore(aiBannerStore);
  return [
    dismissed,
    () => {
      sessionSet("ai-banner-dismissed", "1");
      aiBannerStore.set(true);
    },
  ];
}
