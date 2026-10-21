import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { WEEKDAYS_SHORT } from "@/lib/format";
import type { Program, User } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { enterApp, gateStore } from "@/app/session";
import { setUser } from "@/app/state";
import { errorToast } from "@/ui/toast";

const LINES = [
  "Reading your answers",
  "Choosing a split for your week",
  "Setting sets for every muscle",
  "Matching exercises to the equipment in your gym",
  "The AI coach is picking your exercises",
  "Writing your first program",
];

export function Generating({ user, mobile }: { user: User; mobile: boolean }) {
  const [line, setLine] = useState(0);
  const [fresh, setFresh] = useState<User>(user);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setLine((value) => Math.min(LINES.length - 1, value + 1)), 2600);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await api.get<User>("/api/users/" + String(user.id));
        if (stopped) return;
        setFresh(next);
        setError("");
        if (next.status === "ready") {
          setUser(next);
          gateStore.set({ kind: "ready", user: next });
          return;
        }
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : String(caught));
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [user.id]);

  const retry = async () => {
    try {
      await api.post("/api/me/regenerate");
      setFresh((value) => ({ ...value, status: "generating", status_message: "Starting" }));
    } catch (caught) {
      errorToast(caught);
    }
  };

  const waiting = fresh.status === "waiting_ai" || fresh.status === "failed";

  return (
    <div className={"gate-inner generating" + (mobile ? " mobile" : "")}>
      <div className="gen-visual" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <h1>Hi {user.name}</h1>
      <p className="gate-lead" aria-live="polite">
        {LINES[line]}
      </p>
      <p className="small muted">{error || fresh.status_message}</p>
      <div>
        {waiting ? (
          <>
            <p className="muted small">
              {fresh.status === "waiting_ai"
                ? "Your answers are saved. The program is written automatically as soon as the AI coach is ready. You can already look around."
                : "Something went wrong. Try again."}
            </p>
            <div className="gate-actions">
              <button type="button" className="btn" onClick={() => void retry()}>
                Try again
              </button>
              <button type="button" className="btn primary" onClick={() => enterApp(fresh)}>
                Look around
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              A careful program takes your coach a few minutes: it is designed, checked by a second coach and improved. You can close the app or keep using it, the new program appears by itself.
            </p>
            <div className="gate-actions">
              <button type="button" className="btn" onClick={() => enterApp(fresh)}>
                Use the app while you wait
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Ready({ user, mobile }: { user: User; mobile: boolean }) {
  const programs = useResource((signal) => api.get<Program[]>("/api/programs", { signal }), []);
  return (
    <div className={"gate-inner ready" + (mobile ? " mobile" : "")}>
      <div className="step-count">Your first program</div>
      <h1>Ready, {user.name}</h1>
      {user.plan_summary ? <p className="gate-lead">{user.plan_summary}</p> : null}
      <div className="ready-week">
        {(programs.data ?? []).map((program) => (
          <div key={program.id} className="ready-day">
            <span className="ready-dow">{program.weekday !== null ? WEEKDAYS_SHORT[program.weekday] : ""}</span>
            <b>{program.name}</b>
            <span>
              {program.items.length} exercises, {program.total_sets} sets
            </span>
          </div>
        ))}
      </div>
      <button type="button" className="btn primary big" onClick={() => enterApp(user)}>
        Start training
      </button>
    </div>
  );
}
