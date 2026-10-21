import { api, getApiUser, onUnauthorized, setApiUser } from "@/lib/api";
import { createStore, useStore } from "@/lib/store";
import { storageGet } from "@/lib/storage";
import type { User } from "@/lib/types";
import { loadMeta, refreshActive, refreshAiStatus, setUser, userStore } from "./state";

export type GateView = { kind: "loading" } | { kind: "offline" } | { kind: "picker" } | { kind: "onboarding"; hasUsers: boolean } | { kind: "generating"; user: User } | { kind: "ready"; user: User } | { kind: "app" };

export const gateStore = createStore<GateView>({ kind: "loading" });

export function useGate(): GateView {
  return useStore(gateStore);
}

export function enterApp(user: User): void {
  setUser(user);
  gateStore.set({ kind: "app" });
  void refreshActive().catch(() => undefined);
  void refreshAiStatus();
}

export function logout(): void {
  setUser(null);
  gateStore.set({ kind: "picker" });
}

export function showGenerating(user: User): void {
  setUser(user);
  gateStore.set({ kind: "generating", user });
}

export async function selectUser(id: number): Promise<void> {
  setApiUser(id);
  const user = await api.get<User>("/api/me");
  if (user.status === "ready") enterApp(user);
  else showGenerating(user);
}

export async function refreshUser(): Promise<User | null> {
  if (getApiUser() === null) return null;
  const user = await api.get<User>("/api/me");
  userStore.set(user);
  return user;
}

export async function boot(): Promise<void> {
  try {
    await loadMeta();
  } catch {
    gateStore.set({ kind: "offline" });
    return;
  }
  onUnauthorized(() => {
    if (gateStore.get().kind === "app") logout();
  });
  const saved = Number(storageGet("user-id", "")) || null;
  if (saved) {
    setApiUser(saved);
    try {
      const user = await api.get<User>("/api/me", { quietUnauthorized: true });
      if (user.status === "generating") showGenerating(user);
      else enterApp(user);
      return;
    } catch {
      setUser(null);
    }
  }
  gateStore.set({ kind: "picker" });
}
