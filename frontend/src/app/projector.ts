import { createStore, useStore } from "@/lib/store";
import { storageGet, storageSet } from "@/lib/storage";

export const projectorStore = createStore(storageGet("projector", "off") === "on");

export function applyProjector(on: boolean): void {
  document.documentElement.dataset.projector = on ? "on" : "off";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = on ? "#fbf8f1" : "#1b1e22";
}

export function toggleProjector(): void {
  const on = !projectorStore.get();
  projectorStore.set(on);
  storageSet("projector", on ? "on" : "off");
  applyProjector(on);
  if (on && document.fullscreenElement === null) {
    void document.documentElement.requestFullscreen().catch(() => undefined);
  } else if (!on && document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
}

export function useProjector(): boolean {
  return useStore(projectorStore);
}
