import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { createStore, useStore } from "@/lib/store";
import type { CoachMessage, Persona } from "@/lib/types";
import { coachInfo } from "@/three/coachModels";
import { reducedMotion } from "@/three/coachEngine";
import { CoachStage, type CoachStageHandle } from "./CoachStage";

export interface CoachOverlayOptions {
  persona?: Persona | null;
  load?: () => Promise<CoachMessage>;
  message?: CoachMessage;
  fallback?: CoachMessage;
  primary?: string;
  secondary?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  extra?: ReactNode;
  demoPattern?: string | null;
}

interface OverlayEntry {
  id: number;
  options: CoachOverlayOptions;
}

const overlays = createStore<OverlayEntry | null>(null);
let counter = 0;

export function openCoach(options: CoachOverlayOptions): void {
  counter += 1;
  overlays.set({ id: counter, options });
}

export function closeCoach(): void {
  overlays.set(null);
}

const DEFAULT_FALLBACK: CoachMessage = {
  title: "Let's go",
  message: "Your coach could not be reached right now, but your plan is ready. Train with focus and log every set.",
  points: [],
  mood: "focused",
};

function useTypewriter(text: string | null, onTick: (chunk: string) => void, onDone: () => void) {
  const [progress, setProgress] = useState<{ source: string | null; shown: string; finished: boolean }>({ source: text, shown: "", finished: false });
  if (progress.source !== text) setProgress({ source: text, shown: "", finished: false });
  const shown = progress.source === text ? progress.shown : "";
  const finished = progress.source === text && progress.finished;
  const setShown = (value: string) => setProgress((current) => ({ ...current, shown: value }));
  const setFinished = (value: boolean) => setProgress((current) => ({ ...current, finished: value }));
  const callbacks = useRef({ onTick, onDone });
  const skip = useRef<() => void>(() => undefined);

  useEffect(() => {
    callbacks.current = { onTick, onDone };
  });

  useEffect(() => {
    if (text === null) return;
    let index = 0;
    let stopped = false;
    let timer = 0;
    const complete = () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timer);
      setShown(text);
      setFinished(true);
      callbacks.current.onDone();
    };
    skip.current = complete;
    if (reducedMotion()) {
      complete();
      return;
    }
    const step = () => {
      if (stopped) return;
      const chunk = text.slice(index, Math.min(text.length, index + 2));
      index = Math.min(text.length, index + 2);
      setShown(text.slice(0, index));
      callbacks.current.onTick(chunk);
      if (index < text.length) timer = window.setTimeout(step, /[.!?]/.test(chunk) ? 180 : chunk.includes(",") ? 90 : 22);
      else complete();
    };
    step();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [text]);

  return { shown, finished, skip: () => skip.current() };
}

function CoachOverlay({ entry }: { entry: OverlayEntry }) {
  const { options } = entry;
  const persona = options.persona;
  const info = coachInfo(persona?.coach);
  const stage = useRef<CoachStageHandle | null>(null);
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<CoachMessage | null>(null);
  const closing = useRef(false);
  const mood = message?.mood ?? "focused";

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShow(true));
    document.body.classList.add("coach-open");
    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove("coach-open");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    if (options.message) {
      const message = options.message;
      const timer = window.setTimeout(() => {
        if (!cancelled) setMessage(message);
      }, 900);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
    if (!options.load) return;
    const thinkTimer = window.setTimeout(() => {
      if (!cancelled && !stage.current?.isTalking()) stage.current?.think();
    }, 1300);
    options.load().then(
      (loaded) => {
        const wait = Math.max(0, 1300 - (Date.now() - started));
        window.setTimeout(() => {
          if (!cancelled) setMessage(loaded);
        }, wait);
      },
      () => {
        if (!cancelled) setMessage(options.fallback ?? DEFAULT_FALLBACK);
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(thinkTimer);
    };
  }, [options]);

  useEffect(() => {
    if (message) stage.current?.talk(message.mood ?? "focused");
  }, [message]);

  const typing = useTypewriter(
    message ? message.message : null,
    (chunk) => {
      if (/[.!?]/.test(chunk)) stage.current?.beat(0.9);
      else if (chunk.includes(",")) stage.current?.beat(0.4);
      else if (chunk.includes(" ") && Math.random() < 0.12) stage.current?.beat(0.25);
    },
    () => {
      if (!closing.current) stage.current?.finish(mood);
    },
  );

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    typing.skip();
    setShow(false);
    window.setTimeout(() => {
      if (overlays.get()?.id === entry.id) overlays.set(null);
    }, 250);
    then?.();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(options.onSecondary);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  });

  const personaName = message?.persona?.name ?? persona?.name ?? info.name;
  const personaTitle = message?.persona?.title ?? persona?.title ?? info.title;

  return (
    <div
      className={"coach-overlay" + (show ? " show" : "")}
      style={{ "--coach-color": persona?.color ?? info.color } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={"Coach " + personaName}
    >
      <CoachStage coach={info.key} framing="portrait" mode="overlay" className="coach-stage" demoPattern={options.demoPattern ?? null} handleRef={stage} />
      <div
        className="coach-card"
        onClick={(event) => {
          if (!(event.target as Element).closest("button")) typing.skip();
        }}
      >
        <div className="coach-tag">
          <b className="coach-name">{personaName}</b>
          <span className="coach-title">{personaTitle}</span>
        </div>
        <h2 className="coach-heading">{message?.title ?? ""}</h2>
        <p className="coach-text" aria-live="polite">
          {message ? (
            typing.shown
          ) : (
            <span className="coach-dots" aria-label="Your coach is thinking">
              <i />
              <i />
              <i />
            </span>
          )}
        </p>
        <ul className={"coach-points" + (typing.finished ? " show" : "")}>
          {typing.finished ? message?.points.map((point) => <li key={point}>{point}</li>) : null}
        </ul>
        {options.extra ? <div className="coach-extra">{options.extra}</div> : null}
        <div className="coach-actions">
          {options.secondary ? (
            <button type="button" className="btn" onClick={() => close(options.onSecondary)}>
              {options.secondary}
            </button>
          ) : null}
          <button type="button" className="btn primary" data-autofocus onClick={() => close(options.onPrimary)}>
            {options.primary ?? "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CoachOverlayHost() {
  const entry = useStore(overlays);
  useEffect(() => closeCoach, []);
  return entry ? <CoachOverlay key={entry.id} entry={entry} /> : null;
}
