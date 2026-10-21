import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { plateColor } from "@/lib/catalog";
import { EFFORT_LABELS, formatClock, formatDay, formatSet, MEASURE_UNITS, num, plural, relativeDay, todayIso } from "@/lib/format";
import type { Effort, Session, SessionExercise, Suggestions } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { isComplete, sessionVolume, targetText } from "@/lib/workout";
import { Page } from "@/app/Page";
import { muscleLabel, refreshActive } from "@/app/state";
import { MediaTag, PageHead } from "@/ui/common";
import { hasOpenModal, openModal } from "@/ui/modal";
import { slideIn } from "@/ui/motion";
import { LoopVideo } from "@/ui/youtube";
import { CHANGE_LABELS, FEEL_OPTIONS, openAddExercise, sessionMinutes, useElapsed, useTimerLabel, useWorkout, type WorkoutController } from "@/workout/controller";
import { startWorkoutFlow } from "@/workout/flows";
import { useRestOpen } from "@/workout/rest";

const EFFORTS: Effort[] = [1, 2, 3];

function StartList({ suggestions }: { suggestions: Suggestions }) {
  const navigate = useNavigate();
  const today = todayIso();
  const block = suggestions.block;
  const start = (programId: number | null) => {
    void startWorkoutFlow(today, programId, () => void navigate("/training", { replace: true }));
  };
  return (
    <>
      <PageHead
        title="Start a workout"
        lead={formatDay(today) + ". Week " + String(block.week) + " of " + String(block.weeks) + (block.deload ? ", deload with half the sets." : ".")}
        actions={
          <button type="button" className="btn" onClick={() => start(null)}>
            Free workout
          </button>
        }
      />
      <div className="alt-programs">
        {suggestions.options.map((option) => (
          <button key={option.program.id} type="button" className="alt-program start-option" onClick={() => start(option.program.id)}>
            <span className="dot" style={{ background: plateColor(option.program.id) }} />
            <span className="grow">
              <b>{option.program.name}</b>
              <span>
                {option.reason} · {plural(option.program.items.length, "exercise")} · {plural(option.program.total_sets, "set")}
              </span>
            </span>
            {option.suggested ? <span className="chip priority">Suggested</span> : null}
          </button>
        ))}
      </div>
      {suggestions.options.length ? null : (
        <div className="empty">
          No programs yet.{" "}
          <Link className="btn primary" to="/programs/new">
            Create program
          </Link>
        </div>
      )}
    </>
  );
}

function Clock({ startedAt }: { startedAt: string }) {
  return <b>{useElapsed(startedAt)}</b>;
}

function ExerciseList({ workout }: { workout: WorkoutController }) {
  const navigate = useNavigate();
  const { session, index } = workout;
  const done = session.exercises.reduce((sum, entry) => sum + entry.sets.length, 0);
  const planned = session.exercises.reduce((sum, entry) => sum + entry.planned_sets, 0);
  return (
    <aside className="w-list">
      <div className="head">
        <h3>{session.program_name}</h3>
        {session.deload ? <span className="deload-flag small">Deload</span> : null}
      </div>
      {session.exercises.map((entry, position) => (
        <button
          key={entry.id}
          type="button"
          className={"w-item" + (position === index ? " current" : "") + (isComplete(entry) ? " complete" : "")}
          aria-current={position === index ? "step" : undefined}
          onClick={() => workout.goTo(position)}
        >
          <span className="n">{entry.exercise_name}</span>
          <span className="c">
            {entry.sets.length}/{entry.planned_sets}
          </span>
          <span className="pips" aria-hidden="true">
            {Array.from({ length: entry.planned_sets }, (_, set) => (
              <i key={set} className={set < entry.sets.length ? "on" : undefined} />
            ))}
          </span>
        </button>
      ))}
      <div className="w-clock">
        <div>
          <Clock startedAt={session.started_at} />
          Duration
        </div>
        <div>
          <b>
            {done}/{planned}
          </b>
          Sets
        </div>
      </div>
      <div className="w-list-actions">
        <button type="button" className="btn" onClick={() => void openAddExercise(workout, false)}>
          Add exercise
        </button>
        <button type="button" className="btn primary" onClick={() => workout.finish(false)}>
          Finish workout
        </button>
        <button
          type="button"
          className="btn ghost danger"
          onClick={() => {
            void workout.discard().then((discarded) => {
              if (discarded) void navigate("/");
            });
          }}
        >
          Discard workout
        </button>
      </div>
    </aside>
  );
}

function SetRow({ item, set, workout }: { item: SessionExercise; set: SessionExercise["sets"][number]; workout: WorkoutController }) {
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState(set.weight === null ? "" : String(set.weight));
  const [value, setValue] = useState(set.value === null ? "" : String(set.value));
  if (editing) {
    return (
      <tr>
        <td className="faint">{set.set_number}</td>
        <td colSpan={2}>
          <div className="set-edit">
            {item.track_weight ? (
              <>
                <input type="number" step="0.5" aria-label="Weight" value={weight} onChange={(event) => setWeight(event.target.value)} /> kg
              </>
            ) : null}
            {item.measure !== "none" ? (
              <>
                <input type="number" step="0.5" aria-label="Value" value={value} onChange={(event) => setValue(event.target.value)} /> {MEASURE_UNITS[item.measure]}
              </>
            ) : null}
          </div>
        </td>
        <td className="row-actions">
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              void workout.editSet(set, weight, value).then(() => setEditing(false));
            }}
          >
            Save
          </button>
          <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="faint">{set.set_number}</td>
      <td className="num">
        {formatSet(set, item.measure, item.track_weight)}
        {set.record ? <span className="badge-pr">Best</span> : null}
      </td>
      <td>{set.effort ? EFFORT_LABELS[set.effort] : ""}</td>
      <td className="row-actions">
        <button type="button" className="btn ghost small" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn ghost small danger" onClick={() => void workout.deleteSet(set)}>
          Delete
        </button>
      </td>
    </tr>
  );
}

function SetsTable({ item, workout }: { item: SessionExercise; workout: WorkoutController }) {
  const pending = Math.max(0, item.planned_sets - item.sets.length);
  if (!item.sets.length && !pending) return null;
  return (
    <table className="sets-table">
      <thead>
        <tr>
          <th>Set</th>
          <th>Result</th>
          <th>Feel</th>
          <th>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {item.sets.map((set) => (
          <SetRow key={String(set.id) + ":" + String(set.weight) + ":" + String(set.value)} item={item} set={set} workout={workout} />
        ))}
        {Array.from({ length: pending }, (_, offset) => (
          <tr key={"p" + String(offset)} className="pending">
            <td>{item.sets.length + offset + 1}</td>
            <td className="num">
              {item.target || ""}
              {item.track_weight && item.target_weight ? " · " + num(item.target_weight) + " kg" : ""}
            </td>
            <td />
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Logger({ item, workout }: { item: SessionExercise; workout: WorkoutController }) {
  const complete = isComplete(item);
  const timerLabel = useTimerLabel(workout.timer, false);
  const previous = item.previous ? item.previous.sets.map((set) => formatSet(set, item.measure, item.track_weight)).join(", ") : "";
  const valueLabel = item.measure === "reps" ? "Reps" : item.measure === "sec" ? "Seconds" : "Minutes";
  return (
    <div className="logger">
      <div className="logger-top">
        <h2>{complete ? "All sets done" : "Set " + String(item.sets.length + 1) + " of " + String(item.planned_sets)}</h2>
        <div className="target-line">
          Target <b>{item.target || "free"}</b>
          {item.track_weight && item.target_weight ? (
            <>
              {" "}
              at <b>{num(item.target_weight)} kg</b>
            </>
          ) : null}
          {previous ? <span className="faint"> · last time {previous}</span> : null}
        </div>
      </div>
      {item.measure !== "none" ? (
        <div className="steppers">
          {item.track_weight ? (
            <div className="stepper">
              <span>Weight kg</span>
              <div className="stepper-row">
                <button type="button" title="Lighter (Shift ↓)" aria-label="Lighter" onClick={() => workout.adjustWeight(-1)}>
                  −
                </button>
                <input type="number" inputMode="decimal" step="0.5" min="0" aria-label="Weight" value={workout.values.weight} onChange={(event) => workout.setWeight(event.target.value)} />
                <button type="button" title="Heavier (Shift ↑)" aria-label="Heavier" onClick={() => workout.adjustWeight(1)}>
                  +
                </button>
              </div>
            </div>
          ) : null}
          <div className="stepper">
            <span>{valueLabel}</span>
            <div className="stepper-row">
              <button type="button" title="Less (↓)" aria-label="Less" onClick={() => workout.adjustValue(-1)}>
                −
              </button>
              <input
                type="number"
                inputMode="decimal"
                step={item.measure === "min" ? "0.5" : "1"}
                min="0"
                aria-label={valueLabel}
                value={workout.values.value}
                onChange={(event) => workout.setValue(event.target.value)}
              />
              <button type="button" title="More (↑)" aria-label="More" onClick={() => workout.adjustValue(1)}>
                +
              </button>
            </div>
          </div>
          {item.measure === "reps" ? (
            <div className="effort">
              <span>How hard was the set</span>
              <div className="seg" role="group" aria-label="How hard was the set">
                {EFFORTS.map((level) => (
                  <button key={level} type="button" aria-pressed={workout.effort === level} onClick={() => workout.setEffort(level)}>
                    {EFFORT_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="effort">
              <span>Timer</span>
              <button type="button" className={"btn big" + (timerLabel ? " running" : "")} onClick={workout.toggleTimer}>
                {timerLabel ?? (item.measure === "sec" ? "Start countdown" : "Start stopwatch")}
              </button>
            </div>
          )}
        </div>
      ) : null}
      <div className="log-actions">
        <button type="button" className="btn primary big" disabled={workout.busy} onClick={() => void workout.logSet()}>
          {item.measure === "none" ? "Done" : complete ? "Save extra set" : "Save set"} <span className="kbd">Enter</span>
        </button>
        <button type="button" className="btn small" title="Plan one more set" onClick={() => workout.changePlanned(item.planned_sets + 1)}>
          + Set
        </button>
        <button type="button" className="btn small" title="Plan one set less" disabled={item.planned_sets <= Math.max(1, item.sets.length)} onClick={() => workout.changePlanned(item.planned_sets - 1)}>
          − Set
        </button>
        <span className="hint">↑ ↓ reps · Shift ↑ ↓ weight · ← → exercise</span>
      </div>
      <SetsTable item={item} workout={workout} />
    </div>
  );
}

function MainPanel({ workout }: { workout: WorkoutController }) {
  const ref = useRef<HTMLElement>(null);
  const { item, index, direction } = workout;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    slideIn(ref.current, direction);
  }, [index, direction]);
  if (!item) {
    return (
      <section className="w-main" ref={ref}>
        <div className="empty">
          This workout has no exercises yet.
          <br />
          <button type="button" className="btn primary" onClick={() => void openAddExercise(workout, false)}>
            Add exercise
          </button>
        </div>
      </section>
    );
  }
  const muscles = [item.primary_muscle, ...item.secondary_muscles].filter((muscle): muscle is string => Boolean(muscle)).map(muscleLabel);
  const hasLoop = Boolean(item.media_loop ?? item.video_id);
  const notes = [item.cues, item.exercise_notes].filter(Boolean).join(" ");
  const showFeel = item.exercise_id && item.sets.length && item.measure !== "min" && item.measure !== "none";
  return (
    <section className="w-main" ref={ref}>
      <div className="w-title">
        <div>
          <h1>{item.exercise_name}</h1>
          <div className="sub">
            <span>{targetText(item)}</span>
            <span>Rest {formatClock(item.rest_seconds)}</span>
            {muscles.length ? <span>{muscles.join(", ")}</span> : null}
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn icon" title="Previous exercise (←)" aria-label="Previous exercise" onClick={() => workout.goTo(index - 1, -1)}>
            ‹
          </button>
          <button type="button" className="btn icon" title="Next exercise (→)" aria-label="Next exercise" onClick={() => workout.goTo(index + 1, 1)}>
            ›
          </button>
        </div>
      </div>
      <div className={"media-stage" + (item.media_muscles && hasLoop ? "" : " single")}>
        {item.media_loop ? (
          <div className="media-frame">
            <MediaTag name={item.media_loop} />
          </div>
        ) : item.video_id ? (
          <LoopVideo key={item.id} videoId={item.video_id} start={item.video_start} end={item.video_end} />
        ) : null}
        {item.media_muscles ? (
          <div className="media-frame muscles">
            <MediaTag name={item.media_muscles} />
            <span className="tag">Target muscles</span>
          </div>
        ) : null}
        {!hasLoop && !item.media_muscles ? (
          <div className="media-frame is-empty">
            <div className="media-empty">
              <span>No tutorial video and no muscle image yet.</span>
              {item.exercise_id ? (
                <Link className="btn small" to={"/exercises/" + String(item.exercise_id)}>
                  Upload media
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {item.plan_cue ? (
        <p className="cues">
          <b>Coach:</b> {item.plan_cue}
        </p>
      ) : null}
      {notes ? <p className="cues">{notes}</p> : null}
      {showFeel ? (
        <div className="feel" role="group" aria-label="How did it feel">
          <span>How did it feel?</span>
          {FEEL_OPTIONS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={workout.feedback === key} onClick={() => void workout.saveFeel(key)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <Logger key={item.id} item={item} workout={workout} />
    </section>
  );
}

function SidePanel({ workout }: { workout: WorkoutController }) {
  const item = workout.item;
  if (!item) return <aside className="w-side" />;
  const previous = item.previous;
  const strengthBest = item.track_weight && item.measure === "reps";
  const bestText = item.best ? num(item.best) + (strengthBest ? " kg" : " " + MEASURE_UNITS[item.measure]) : "none yet";
  return (
    <aside className="w-side">
      <div className="panel">
        <div className="panel-head">
          <h3>Last time</h3>
          <span className="hint">{previous ? relativeDay(previous.day) : ""}</span>
        </div>
        {previous ? (
          <div className="prev-sets">
            {previous.sets.map((set) => (
              <button key={set.set_number} type="button" className="prev-set" title="Use these values" onClick={() => workout.prefill(set)}>
                <span>Set {set.set_number}</span>
                <span>{formatSet(set, item.measure, item.track_weight)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small">First time with this exercise. The heaviest clean weight today becomes your starting weight.</p>
        )}
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Personal best</h3>
        </div>
        <div className="num best-value">{bestText}</div>
        {strengthBest ? <p className="small faint">estimated 1RM</p> : null}
      </div>
      {item.rep_max ? (
        <div className="panel">
          <div className="panel-head">
            <h3>How the weight goes up</h3>
          </div>
          <p className="small muted">
            Hit {num(item.rep_max)} reps in all {item.planned_sets} sets
            {item.target_weight ? " with " + num(item.target_weight) + " kg" : ""} and the coach raises the weight automatically next time.
          </p>
        </div>
      ) : null}
      {item.exercise_id ? (
        <Link className="btn ghost small" to={"/exercises/" + String(item.exercise_id)}>
          Edit media and cues
        </Link>
      ) : null}
    </aside>
  );
}

function SummaryDialog({ session, close, onDetails }: { session: Session; close: () => void; onDetails: () => void }) {
  const sets = session.exercises.reduce((sum, entry) => sum + entry.sets.length, 0);
  const changes = session.changes ?? [];
  return (
    <>
      <div className="modal-head">
        <h2>Saved</h2>
      </div>
      <div className="editor-summary">
        <span>
          <b>{sets}</b>sets
        </span>
        <span>
          <b>{num(sessionVolume(session.exercises) / 1000, 2)}</b>tonnes
        </span>
        <span>
          <b>{sessionMinutes(session)}</b>minutes
        </span>
      </div>
      {changes.length ? (
        <>
          <h3>Next time</h3>
          <div className="finish-summary">
            {changes.map((change, position) => (
              <div key={change.exercise + String(position)} className="change">
                <span className={"chip" + (change.kind === "weight_down" ? "" : " priority")}>{CHANGE_LABELS[change.kind] ?? change.kind}</span>
                {change.exercise}
                {change.weight ? " · " + num(change.weight) + " kg" : ""}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="muted">Weights stay the same. Add reps until you reach the top of the range in every set.</p>
      )}
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onDetails}>
          Details
        </button>
        <button type="button" className="btn primary" data-autofocus onClick={close}>
          Back to overview
        </button>
      </div>
    </>
  );
}

function Workout({ session, feedback }: { session: Session; feedback: Record<string, { rating: "good" | "weak" | "pain" }> }) {
  const navigate = useNavigate();
  const restOpen = useRestOpen();
  const workout = useWorkout(session, feedback, {
    mobile: false,
    onDone: (result) => {
      let leaving = false;
      const handle = openModal(
        (close) => (
          <SummaryDialog
            session={result}
            close={close}
            onDetails={() => {
              leaving = true;
              handle.close();
              void navigate("/history/training/" + String(result.id));
            }}
          />
        ),
        {
          label: "Workout saved",
          onClose: () => {
            if (!leaving) void navigate("/");
          },
        },
      );
    },
  });
  const workoutRef = useRef(workout);
  const restRef = useRef(restOpen);
  useEffect(() => {
    workoutRef.current = workout;
    restRef.current = restOpen;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (hasOpenModal() || restRef.current || document.querySelector(".coach-overlay")) return;
      const target = event.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      const inNumber = tag === "input" && (target as HTMLInputElement).type === "number";
      if ((tag === "input" && !inNumber) || tag === "textarea" || tag === "select") return;
      if (event.key === "Enter" && (tag === "button" || tag === "a")) return;
      const current = workoutRef.current;
      if (event.key === "Enter" && !target.closest(".sets-table")) {
        event.preventDefault();
        void current.logSet();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const step = event.key === "ArrowUp" ? 1 : -1;
        if (event.shiftKey) current.adjustWeight(step);
        else current.adjustValue(step);
      } else if (event.key === "ArrowLeft" && !inNumber) {
        current.goTo(current.index - 1, -1);
      } else if (event.key === "ArrowRight" && !inNumber) {
        current.goTo(current.index + 1, 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="workout">
      <ExerciseList workout={workout} />
      <MainPanel workout={workout} />
      <SidePanel workout={workout} />
    </div>
  );
}

type TrainingData = { kind: "active"; session: Session; feedback: Record<string, { rating: "good" | "weak" | "pain" }> } | { kind: "start"; suggestions: Suggestions };

async function loadTraining(signal: AbortSignal): Promise<TrainingData> {
  const active = await refreshActive();
  if (active) {
    const feedback = await api.get<Record<string, { rating: "good" | "weak" | "pain" }>>("/api/sessions/" + String(active.id) + "/feedback", { signal }).catch(() => ({}));
    return { kind: "active", session: active, feedback };
  }
  return { kind: "start", suggestions: await api.get<Suggestions>("/api/suggestions?day=" + todayIso(), { signal }) };
}

export function TrainingPage() {
  const resource = useResource(loadTraining, [], ["session"]);
  const data = resource.data;
  return (
    <Page ready={Boolean(data)} error={resource.error} onRetry={resource.reload}>
      {() => (data?.kind === "active" ? <Workout key={data.session.id} session={data.session} feedback={data.feedback} /> : data ? <StartList suggestions={data.suggestions} /> : null)}
    </Page>
  );
}
