import { type ReactNode, useEffect, useRef, useState } from "react";
import { createStore, useStore } from "@/lib/store";

export interface ModalOptions {
  wide?: boolean;
  onClose?: () => void;
  label?: string;
}

interface ModalEntry {
  id: number;
  render: (close: () => void) => ReactNode;
  options: ModalOptions;
  leaving: boolean;
}

export interface ModalHandle {
  close: () => void;
}

const modals = createStore<ModalEntry[]>([]);
let counter = 0;

function closeModal(id: number): void {
  const entry = modals.get().find((item) => item.id === id);
  if (!entry || entry.leaving) return;
  modals.set((list) => list.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
  window.setTimeout(() => {
    modals.set((list) => list.filter((item) => item.id !== id));
    entry.options.onClose?.();
  }, 160);
}

export function openModal(render: (close: () => void) => ReactNode, options: ModalOptions = {}): ModalHandle {
  counter += 1;
  const id = counter;
  modals.set((list) => [...list, { id, render, options, leaving: false }]);
  return {
    close: () => {
      closeModal(id);
    },
  };
}

export function closeAllModals(): void {
  modals.set([]);
}

export function hasOpenModal(): boolean {
  return modals.get().some((item) => !item.leaving);
}

export function useModalOpen(): boolean {
  return useStore(modals).some((item) => !item.leaving);
}

interface ConfirmProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onAnswer: (value: boolean) => void;
}

function ConfirmDialog({ title, message, confirmLabel, danger, onAnswer }: ConfirmProps) {
  return (
    <>
      <div className="modal-head">
        <h2>{title}</h2>
      </div>
      <p className="muted">{message}</p>
      <div className="modal-foot">
        <button type="button" className="btn ghost" onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button type="button" className={"btn " + (danger ? "danger" : "primary")} data-autofocus onClick={() => onAnswer(true)}>
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

export function confirmDialog(title: string, message: string, confirmLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const handle = openModal(
      () => (
        <ConfirmDialog
          title={title}
          message={message}
          confirmLabel={confirmLabel}
          danger={danger}
          onAnswer={(value) => {
            answered = true;
            resolve(value);
            handle.close();
          }}
        />
      ),
      {
        onClose: () => {
          if (!answered) resolve(false);
        },
      },
    );
  });
}

function ModalFrame({ entry, top }: { entry: ModalEntry; top: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [previous] = useState<Element | null>(() => document.activeElement);
  const close = () => {
    closeModal(entry.id);
  };

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const timer = window.setTimeout(() => {
      const target = element.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ?? element.querySelector<HTMLElement>("input, select, textarea, button");
      target?.focus();
    }, 30);
    return () => {
      window.clearTimeout(timer);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [previous]);

  useEffect(() => {
    if (!top) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeModal(entry.id);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [top, entry.id]);

  return (
    <div
      className={"modal-backdrop" + (entry.leaving ? " leaving" : "")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div ref={ref} className={"modal" + (entry.options.wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={entry.options.label}>
        {entry.render(close)}
      </div>
    </div>
  );
}

export function ModalHost() {
  const list = useStore(modals);
  useEffect(() => closeAllModals, []);
  const lastOpen = [...list].reverse().find((item) => !item.leaving);
  return (
    <div id="modal-root">
      {list.map((entry) => (
        <ModalFrame key={entry.id} entry={entry} top={entry === lastOpen} />
      ))}
    </div>
  );
}
