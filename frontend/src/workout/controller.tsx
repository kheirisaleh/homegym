import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatClock, num } from "@/lib/format";
import { invalidate } from "@/lib/store";
import type { CoachMessage, Effort, Exercise, SavedSet, Session, SessionExercise, SetEntry } from "@/lib/types";
import { firstIncomplete, isComplete, stepValue, stepWeight, suggested } from "@/lib/workout";
import { activeStore } from "@/app/state";
import { openCoach } from "@/coach/overlay";
import { coachPersona } from "@/coach/persona";
import { confirmDialog, openModal } from "@/ui/modal";
import { celebrate } from "@/ui/motion";
import { errorToast, toast } from "@/ui/toast";
import { NoteDialog, painNote } from "./flows";
import { closeRest, showRest } from "./rest";
import { beep, vibrate } from "./sound";

export type FeelRating = "good" | "weak" | "pain";

export const FEEL_OPTIONS: [FeelRating, string][] = [
  ["good", "Felt it"],
  ["weak", "Didn't feel it"],
  ["pain", "Pain"],
];

export const CHANGE_LABELS: Record<string, string> = {
  weight_up: "heavier",
  weight_down: "lighter",
  reps_up: "more reps",
  time_up: "longer",
  weight_set: "starting weight",
};

interface Feedback {
  rating: FeelRating;
  note?: string;
}

interface Draft {
  key: string;
  weight: string;
  value: string;
}

interface Timer {
  start: number;
  goal: number;
  measure: SessionExercise["measure"];
}

export interface FinishOptions {
  mobile: boolean;
  onDone: (session: Session) => void;
  summary?: (session: Session) => ReactNode;
}

function asText(value: number | null): string {
  return value === null ? "" : String(value);
}

function asNumber(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

function draftKey(item: SessionExercise | undefined): string {
  return item ? String(item.id) + ":" + String(item.sets.length) : "";
}

export function sessionMinutes(session: Pick<Session, "started_at" | "finished_at">): number {
  if (!session.finished_at) return 0;
  return Math.round((new Date(session.finished_at).getTime() - new Date(session.started_at).getTime()) / 60000);
}

export function useWorkout(initial: Session, initialFeedback: Record<string, Feedback>, finishOptions: FinishOptions) {
  const [session, setSession] = useState(initial);
  const [index, setIndex] = useState(() => Math.min(initial.current_index || 0, Math.max(0, initial.exercises.length - 1)));
  const [direction, setDirection] = useState(1);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>(initialFeedback);
  const [draft, setDraft] = useState<Draft>({ key: "", weight: "", value: "" });
  const [timer, setTimer] = useState<Timer | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const finishRef = useRef(finishOptions);
  const sessionRef = useRef(session);

  useEffect(() => {
    finishRef.current = finishOptions;
    sessionRef.current = session;
  });

  const item = session.exercises[index];
  const key = draftKey(item);
  const values = useMemo(() => {
    if (draft.key === key || !item) return draft;
    const next = suggested(item);
    return { key, weight: asText(next.weight), value: asText(next.value) };
  }, [draft, key, item]);

  const update = useCallback((fields: Partial<Pick<Draft, "weight" | "value">>) => {
    setDraft({ ...values, ...fields, key });
  }, [values, key]);

  const apply = useCallback((next: Session, nextIndex?: number) => {
    setSession(next);
    activeStore.set(next);
    setIndex((current) => Math.min(nextIndex ?? current, Math.max(0, next.exercises.length - 1)));
  }, []);

  const saveIndex = useCallback((value: number) => {
    api.put("/api/sessions/" + String(sessionRef.current.id) + "/state", { current_index: value }).catch(() => undefined);
  }, []);

  const goTo = useCallback(
    (target: number, forced?: number) => {
      const count = sessionRef.current.exercises.length;
      if (!count) return;
      const next = (target + count) % count;
      setDirection(forced ?? (next >= index ? 1 : -1));
      setIndex(next);
      setEffort(null);
      setTimer(null);
      saveIndex(next);
    },
    [index, saveIndex],
  );

  const reload = useCallback(async () => {
    apply(await api.get<Session>("/api/sessions/" + String(sessionRef.current.id)));
  }, [apply]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await reload();
      } catch (error) {
        errorToast(error);
      }
    },
    [reload],
  );

  const adjustWeight = useCallback(
    (step: number) => {
      if (!item) return;
      update({ weight: String(stepWeight(item.weight_steps, values.weight, step)) });
    },
    [item, values.weight, update],
  );

  const adjustValue = useCallback(
    (step: number) => {
      if (!item) return;
      update({ value: String(Math.max(0, (Number(values.value) || 0) + step * stepValue(item.measure))) });
    },
    [item, values.value, update],
  );

  const prefill = useCallback(
    (set: Pick<SetEntry, "weight" | "value">) => {
      update({ weight: asText(set.weight), value: asText(set.value) });
      vibrate(8);
    },
    [update],
  );

  const changePlanned = useCallback(
    (sets: number) => {
      if (!item || sets < Math.max(1, item.sets.length)) return;
      void run(() => api.put("/api/session-exercises/" + String(item.id) + "/planned", { sets }));
    },
    [item, run],
  );

  const editSet = useCallback(
    (set: SetEntry, weight: string, value: string) =>
      run(() => api.put("/api/sets/" + String(set.id), { weight: asNumber(weight), value: asNumber(value), effort: set.effort })),
    [run],
  );

  const deleteSet = useCallback((set: SetEntry) => run(() => api.delete("/api/sets/" + String(set.id))), [run]);

  const addExercise = useCallback(
    async (body: { exercise_id: number; sets: number; target: string; rest_seconds: number }) => {
      const next = await api.post<Session>("/api/sessions/" + String(sessionRef.current.id) + "/exercises", body);
      const last = next.exercises.length - 1;
      apply(next, last);
      setDirection(1);
      saveIndex(last);
    },
    [apply, saveIndex],
  );

  const saveFeel = useCallback(
    async (rating: FeelRating) => {
      if (!item) return;
      const previous = feedback[String(item.id)];
      try {
        if (previous?.rating === rating) {
          await api.delete("/api/session-exercises/" + String(item.id) + "/feedback");
          setFeedback((current) => {
            const next = { ...current };
            delete next[String(item.id)];
            return next;
          });
          return;
        }
        const note = rating === "pain" ? await painNote() : "";
        const saved = await api.post<Feedback>("/api/session-exercises/" + String(item.id) + "/feedback", { rating, note });
        setFeedback((current) => ({ ...current, [String(item.id)]: saved }));
        toast(rating === "good" ? "Noted" : "Noted, your coach will look at it");
      } catch (error) {
        errorToast(error);
      }
    },
    [item, feedback],
  );

  const completeWorkout = useCallback(async (notes: string) => {
    const current = sessionRef.current;
    const result = await api.post<Session>("/api/sessions/" + String(current.id) + "/finish", { notes });
    closeRest();
    activeStore.set(null);
    invalidate("programs", "session", "dashboard", "coach");
    celebrate();
    const persona = await coachPersona();
    const options = finishRef.current;
    const fallback: CoachMessage = { title: "Saved", message: "Workout saved. Great job showing up today.", points: [], mood: "celebrate" };
    openCoach({
      persona,
      load: () => api.get<CoachMessage>("/api/sessions/" + String(result.id) + "/outro"),
      primary: options.mobile ? "Done" : "See summary",
      fallback,
      extra: options.summary?.(result),
      onPrimary: () => options.onDone(result),
    });
  }, []);

  const finish = useCallback(
    (allDone: boolean) => {
      const mobile = finishRef.current.mobile;
      const handle = openModal(
        (close) => (
          <NoteDialog
            title={allDone ? "All done" : "Finish workout"}
            lead={
              mobile
                ? "The coach adjusts weights and reps for next time and writes a short note."
                : "The coach evaluates the workout right away and adjusts weights and rep targets. The AI coach then writes a short note about it."
            }
            placeholder={mobile ? "Sleep, energy, pain" : "Sleep, energy, pain, anything you noticed"}
            actionLabel="Save workout"
            onCancel={close}
            onSubmit={async (notes) => {
              await completeWorkout(notes);
              handle.close();
            }}
          />
        ),
        { label: allDone ? "All done" : "Finish workout" },
      );
    },
    [completeWorkout],
  );

  const discard = useCallback(async (): Promise<boolean> => {
    const ok = await confirmDialog("Discard workout", "All sets of this workout will be deleted.", "Discard", true);
    if (!ok) return false;
    try {
      await api.delete("/api/sessions/" + String(sessionRef.current.id));
    } catch (error) {
      errorToast(error);
      return false;
    }
    closeRest();
    activeStore.set(null);
    invalidate("session", "dashboard");
    return true;
  }, []);

  const logSet = useCallback(async () => {
    if (busyRef.current || !item) return;
    const weight = item.track_weight ? asNumber(values.weight) : null;
    const value = asNumber(values.value);
    if (item.measure !== "none" && value === null) {
      toast("Enter the " + (item.measure === "reps" ? "reps" : "time") + " first", "error");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setTimer(null);
    try {
      const saved = await api.post<SavedSet>("/api/sets", { session_exercise_id: item.id, value, weight, effort });
      setEffort(null);
      const before = index;
      const next = await api.get<Session>("/api/sessions/" + String(sessionRef.current.id));
      const updated = next.exercises[before];
      if (!updated) {
        apply(next);
        return;
      }
      if (saved.record) {
        const set = updated.sets.find((entry) => entry.id === saved.id);
        if (set) set.record = true;
        toast("New personal best: " + num(saved.record.current) + (updated.track_weight ? " kg 1RM" : ""), "pr");
        vibrate([30, 60, 30]);
      }
      let nextIndex = before;
      let nextLabel = updated.exercise_name + ", set " + String(updated.sets.length + 1);
      if (isComplete(updated)) {
        const candidate = firstIncomplete(next.exercises, before + 1);
        if (candidate !== -1) {
          nextIndex = candidate;
          nextLabel = next.exercises[candidate]?.exercise_name ?? nextLabel;
        }
      }
      apply(next, nextIndex);
      if (nextIndex !== before) setDirection(1);
      saveIndex(nextIndex);
      if (firstIncomplete(next.exercises, 0) === -1) finish(true);
      else if (updated.rest_seconds > 0) showRest(updated.rest_seconds, nextLabel, updated.id);
    } catch (error) {
      errorToast(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [item, values, effort, index, apply, saveIndex, finish]);

  const toggleTimer = useCallback(() => {
    if (!item) return;
    if (timer) {
      const elapsed = (Date.now() - timer.start) / 1000;
      update({ value: String(item.measure === "min" ? Math.round((elapsed / 60) * 2) / 2 : Math.round(elapsed)) });
      setTimer(null);
      return;
    }
    setTimer({ start: Date.now(), goal: Number(values.value) || 0, measure: item.measure });
  }, [item, timer, values.value, update]);

  return {
    session,
    index,
    item,
    direction,
    effort,
    setEffort: (level: Effort) => setEffort((current) => (current === level ? null : level)),
    feedback: item ? feedback[String(item.id)]?.rating ?? null : null,
    values,
    setWeight: (weight: string) => update({ weight }),
    setValue: (value: string) => update({ value }),
    adjustWeight,
    adjustValue,
    prefill,
    goTo,
    logSet,
    busy,
    changePlanned,
    editSet,
    deleteSet,
    addExercise,
    saveFeel,
    finish,
    discard,
    timer,
    toggleTimer,
  };
}

export type WorkoutController = ReturnType<typeof useWorkout>;

export function useTimerLabel(timer: Timer | null, mobile: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());
  const beeped = useRef(false);
  useEffect(() => {
    if (!timer) return;
    beeped.current = false;
    const handle = window.setInterval(() => setNow(Date.now()), 200);
    return () => {
      window.clearInterval(handle);
    };
  }, [timer]);
  const remaining = timer ? timer.goal - (now - timer.start) / 1000 : 0;
  useEffect(() => {
    if (timer?.measure !== "sec" || !timer.goal || remaining > 0 || beeped.current) return;
    beeped.current = true;
    beep(2, 990);
    vibrate([200, 100, 200]);
  }, [timer, remaining]);
  if (!timer) return null;
  const suffix = mobile ? ", tap to stop" : " · stop";
  if (timer.measure === "sec" && timer.goal) {
    return (remaining > 0 ? formatClock(Math.ceil(remaining)) : "+" + formatClock(-remaining)) + suffix;
  }
  return formatClock(Math.max(0, (now - timer.start) / 1000)) + suffix;
}

export function useElapsed(startedAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(handle);
    };
  }, []);
  return formatClock(Math.max(0, (now - new Date(startedAt).getTime()) / 1000));
}

export function AddExerciseForm({ exercises, mobile, onAdd, onCancel }: { exercises: Exercise[]; mobile: boolean; onAdd: (body: { exercise_id: number; sets: number; target: string; rest_seconds: number }) => Promise<void>; onCancel: () => void }) {
  const available = useMemo(() => exercises.filter((exercise) => exercise.available), [exercises]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<number | null>(available[0]?.id ?? null);
  const [sets, setSets] = useState("3");
  const [target, setTarget] = useState("");
  const [rest, setRest] = useState("90");
  const [busy, setBusy] = useState(false);
  const filtered = available.filter((exercise) => exercise.name.toLowerCase().includes(search.trim().toLowerCase()));
  const add = async (exerciseId: number | null) => {
    if (exerciseId === null) {
      toast("Pick an exercise first", "error");
      return;
    }
    setBusy(true);
    try {
      await onAdd({ exercise_id: exerciseId, sets: Number(sets) || 3, target, rest_seconds: Number(rest) || 0 });
    } catch (error) {
      setBusy(false);
      errorToast(error);
    }
  };
  if (mobile) {
    return (
      <>
        <div className="modal-head">
          <h2>Add exercise</h2>
        </div>
        <input type="search" placeholder="Search" aria-label="Search exercises" value={search} data-autofocus onChange={(event) => setSearch(event.target.value)} />
        <div className="m-sheet-list">
          {filtered.slice(0, 40).map((exercise) => (
            <button key={exercise.id} type="button" className="m-option" disabled={busy} onClick={() => void add(exercise.id)}>
              {exercise.name}
            </button>
          ))}
          {filtered.length ? null : <p className="small muted">No exercise matches.</p>}
        </div>
      </>
    );
  }
  const visiblePicked = filtered.some((exercise) => exercise.id === picked) ? picked : filtered[0]?.id ?? null;
  return (
    <>
      <div className="modal-head">
        <h2>Add exercise</h2>
      </div>
      <label className="field">
        <span>Exercise</span>
        <input type="search" placeholder="Search" value={search} data-autofocus onChange={(event) => setSearch(event.target.value)} />
      </label>
      <select size={8} aria-label="Exercise" value={visiblePicked ?? ""} onChange={(event) => setPicked(Number(event.target.value))} onDoubleClick={() => void add(visiblePicked)}>
        {filtered.map((exercise) => (
          <option key={exercise.id} value={exercise.id}>
            {exercise.name}
          </option>
        ))}
      </select>
      <div className="form-grid">
        <label className="field">
          <span>Sets</span>
          <input type="number" min={1} value={sets} onChange={(event) => setSets(event.target.value)} />
        </label>
        <label className="field">
          <span>Target</span>
          <input type="text" placeholder="e.g. 10 to 12" value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
        <label className="field">
          <span>Rest s</span>
          <input type="number" min={0} step={15} value={rest} onChange={(event) => setRest(event.target.value)} />
        </label>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void add(visiblePicked)}>
          Add
        </button>
      </div>
    </>
  );
}

export async function openAddExercise(controller: WorkoutController, mobile: boolean): Promise<void> {
  let exercises: Exercise[];
  try {
    exercises = await api.get<Exercise[]>("/api/exercises");
  } catch (error) {
    errorToast(error);
    return;
  }
  const handle = openModal(
    (close) => (
      <AddExerciseForm
        exercises={exercises}
        mobile={mobile}
        onCancel={close}
        onAdd={async (body) => {
          await controller.addExercise(body);
          handle.close();
        }}
      />
    ),
    { label: "Add exercise" },
  );
}

export function FinishSummary({ session }: { session: Session }) {
  const sets = session.exercises.reduce((sum, entry) => sum + entry.sets.length, 0);
  const changes = session.changes ?? [];
  return (
    <>
      <div className="m-stat-row">
        <div className="m-stat">
          <span>Sets</span>
          <b>{sets}</b>
        </div>
        <div className="m-stat">
          <span>Minutes</span>
          <b>{sessionMinutes(session)}</b>
        </div>
      </div>
      {changes.length ? (
        <>
          <div className="m-section-title">Next time</div>
          <div className="m-sheet-list">
            {changes.map((change, position) => (
              <div key={change.exercise + String(position)} className="m-option">
                <span className="chip priority">{CHANGE_LABELS[change.kind] ?? change.kind}</span>
                {change.exercise}
                {change.weight ? ", " + num(change.weight) + " kg" : ""}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
