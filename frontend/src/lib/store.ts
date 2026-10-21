import { useSyncExternalStore } from "react";

export interface Store<T> {
  get: () => T;
  set: (next: T | ((current: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? (next as (current: T) => T)(value) : next;
      listeners.forEach((listener) => {
        listener();
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export type Tag = "programs" | "exercises" | "equipment" | "session" | "user" | "coach" | "dashboard" | "cycle";

const versions = createStore<Record<Tag, number>>({ programs: 0, exercises: 0, equipment: 0, session: 0, user: 0, coach: 0, dashboard: 0, cycle: 0 });

export function invalidate(...tags: Tag[]): void {
  versions.set((current) => {
    const next = { ...current };
    for (const tag of tags) next[tag] += 1;
    return next;
  });
}

export function useTagVersion(tags: readonly Tag[]): string {
  const current = useStore(versions);
  return tags.map((tag) => current[tag]).join(".");
}
