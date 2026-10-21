import { type CSSProperties, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { createStore, useStore } from "@/lib/store";
import type { RestTip } from "@/lib/types";
import { CoachStage, type CoachStageHandle } from "@/coach/CoachStage";
import { coachInfo } from "@/three/coachModels";
import { beep } from "./sound";

interface RestRequest {
  id: number;
  seconds: number;
  nextLabel: string;
  sessionExerciseId: number | null;
}

const restStore = createStore<RestRequest | null>(null);
let counter = 0;

export function showRest(seconds: number, nextLabel: string, sessionExerciseId: number | null): void {
  counter += 1;
  restStore.set({ id: counter, seconds, nextLabel, sessionExerciseId });
}

export function closeRest(): void {
  restStore.set(null);
}

export function useRestOpen(): boolean {
  return useStore(restStore) !== null;
}

const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function RestOverlay({ request }: { request: RestRequest }) {
  const [endAt, setEndAt] = useState(() => Date.now() + request.seconds * 1000);
  const [total, setTotal] = useState(request.seconds);
  const [now, setNow] = useState(() => Date.now());
  const [tip, setTip] = useState<RestTip | null>(null);
  const beeped = useRef(false);
  const cheered = useRef(false);
  const stage = useRef<CoachStageHandle | null>(null);
  const remaining = (endAt - now) / 1000;
  const over = remaining <= 0;

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 200);
    return () => {
      window.clearInterval(handle);
    };
  }, []);

  useEffect(() => {
    if (!request.sessionExerciseId) return;
    const controller = new AbortController();
    api.get<RestTip>("/api/session-exercises/" + String(request.sessionExerciseId) + "/tip", { signal: controller.signal }).then(setTip, () => undefined);
    return () => {
      controller.abort();
    };
  }, [request.sessionExerciseId]);

  useEffect(() => {
    if (remaining <= 3 && remaining > 0 && !cheered.current) {
      cheered.current = true;
      stage.current?.action("go");
    }
    if (over && !beeped.current) {
      beeped.current = true;
      beep(3);
      stage.current?.action("clap");
    }
  }, [remaining, over]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        closeRest();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);

  const add = (delta: number) => {
    const next = endAt + delta * 1000;
    setEndAt(next);
    setTotal((value) => Math.max(value + delta, 1));
    if (next > Date.now()) {
      beeped.current = false;
      cheered.current = (next - Date.now()) / 1000 <= 3;
    }
  };

  const coach = tip ? coachInfo(tip.persona.coach) : null;
  const offset = over ? 0 : CIRCUMFERENCE * (1 - remaining / total);

  return (
    <div className="rest-overlay" role="dialog" aria-modal="true" aria-label="Rest timer">
      <div className="label">Rest</div>
      <div className={"rest-ring" + (over ? " over" : "")}>
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="track" cx="100" cy="100" r={RADIUS} />
          <circle className="prog" cx="100" cy="100" r={RADIUS} strokeDasharray={CIRCUMFERENCE} style={{ strokeDashoffset: offset }} />
        </svg>
        <div className="count" role="timer" aria-live="off">
          {over ? "+" + formatClock(-remaining) : formatClock(Math.ceil(remaining))}
        </div>
      </div>
      <div className="next">
        Up next: <strong>{request.nextLabel}</strong>
      </div>
      <div className="rest-coach-slot">
        {tip && coach && tip.tips.length ? (
          <div className="rest-coach" style={{ "--coach-color": coach.color } as CSSProperties}>
            <span className="avatar">{coach.name[0]}</span>
            <div>
              <b>{coach.name}</b>
              {tip.tips.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {coach ? <CoachStage coach={coach.key} mode="rest" className="rest-coach-stage" greetOnClick handleRef={stage} /> : null}
      <div className="controls">
        <button type="button" className="btn big" onClick={() => add(-15)}>
          − 15 s
        </button>
        <button type="button" className="btn big" onClick={() => add(30)}>
          + 30 s
        </button>
        <button type="button" className="btn primary big" onClick={closeRest} data-autofocus>
          Continue <span className="kbd">Enter</span>
        </button>
      </div>
    </div>
  );
}

export function RestHost() {
  const request = useStore(restStore);
  useEffect(() => closeRest, []);
  return request ? <RestOverlay key={request.id} request={request} /> : null;
}
