import { useEffect } from "react";
import { createStore, useStore } from "@/lib/store";

export type ToastKind = "" | "error" | "pr";

export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action: ToastAction | undefined;
  leaving: boolean;
}

const toasts = createStore<ToastItem[]>([]);
let counter = 0;

function dismiss(id: number): void {
  toasts.set((list) => list.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
  window.setTimeout(() => {
    toasts.set((list) => list.filter((item) => item.id !== id));
  }, 220);
}

export function toast(message: string, kind: ToastKind = "", action?: ToastAction): void {
  counter += 1;
  const id = counter;
  toasts.set((list) => [...list, { id, message, kind, action, leaving: false }]);
  window.setTimeout(() => {
    dismiss(id);
  }, kind === "error" ? 6000 : action ? 7000 : 3200);
}

export function errorToast(error: unknown): void {
  toast(error instanceof Error ? error.message : String(error), "error");
}

export function clearToasts(): void {
  toasts.set([]);
}

export function ToastHost({ mobile }: { mobile: boolean }) {
  const list = useStore(toasts);
  useEffect(() => clearToasts, []);
  return (
    <div className={"toast-root" + (mobile ? " m-toasts" : "")} aria-live="polite" role="status">
      {list.map((item) => (
        <div key={item.id} className={"toast " + item.kind + (item.leaving ? " leaving" : "")}>
          <span>{item.message}</span>
          {item.action ? (
            <button
              type="button"
              onClick={() => {
                item.action?.run();
                dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
