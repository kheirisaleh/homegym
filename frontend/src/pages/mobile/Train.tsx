import { type TouchEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { EFFORT_LABELS, formatClock, formatSet, MEASURE_UNITS, num, relativeDay, todayIso, WEEKDAYS } from "@/lib/format";
import type { CoachMessage, Effort, Persona, Program, Session, SessionExercise, SetEntry, Suggestions } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { estimatePreviewMinutes, isComplete } from "@/lib/workout";
import { useFocusMode, useTopBar } from "@/app/MobileShell";
import { Page } from "@/app/Page";
import { refreshActive } from "@/app/state";
import { openCoach } from "@/coach/overlay";
import { coachPersona } from "@/coach/persona";
import { preloadCoach } from "@/three/coachEngine";
import { MediaTag } from "@/ui/common";
import { openModal } from "@/ui/modal";
import { slideIn } from "@/ui/motion";
import { LoopVideo } from "@/ui/youtube";
import { FEEL_OPTIONS, FinishSummary, openAddExercise, useTimerLabel, useWorkout, type WorkoutController } from "@/workout/controller";
import { beginSession, firstDemoPattern, PreviewList } from "@/workout/flows";
import { vibrate } from "@/workout/sound";
import { useStartWorkout } from "./workoutStart";

const EFFORTS: Effort[] = [1, 2, 3];

function StartList({ suggestions }: { suggestions: Suggestions }) {
  const start = useStartWorkout();
  const today = todayIso();
  return (
    <>
      <div className="m-section-title">Pick a workout</div>
      <div className="m-list">
        {suggestions.options.map((option) => (
          <button key={option.program.id} type="button" className="m-item" onClick={() => void start(today, option.program.id)}>
            <span className="grow">
              <b>{option.program.name}</b>
              <span>
                {option.reason}, {option.program.items.length} exercises, {option.program.total_sets} sets
              </span>
            </span>
            {option.suggested ? (
              <span className="chip priority">Today</span>
            ) : (
              <span className="chev" aria-hidden="true">
                ›
              </span>
            )}
          </button>
        ))}
      </div>
      {suggestions.options.length ? null : <p className="muted">No programs yet.</p>}
      <button type="button" className="btn m-btn-xl" onClick={() => void start(today, null)}>
        Free workout
      </button>
    </>
  );
}

function editSetSheet(item: SessionExercise, set: SetEntry, workout: WorkoutController): void {
  const handle = openModal(
    () => (
      <SetSheet
        item={item}
        set={set}
        onSave={(weight, value) => {
          handle.close();
          void workout.editSet(set, weight, value);
        }}
        onDelete={() => {
          handle.close();
          void workout.deleteSet(set);
        }}
      />
    ),
    { label: "Set " + String(set.set_number) },
  );
}

function SetSheet({ item, set, onSave, onDelete }: { item: SessionExercise; set: SetEntry; onSave: (weight: string, value: string) => void; onDelete: () => void }) {
  const [weight, setWeight] = useState(set.weight === null ? "" : String(set.weight));
  const [value, setValue] = useState(set.value === null ? "" : String(set.value));
  return (
    <>
      <div className="modal-head">
        <h2>Set {set.set_number}</h2>
      </div>
      <div className="form-grid">
        {item.track_weight ? (
          <label className="field">
            <span>Weight kg</span>
            <input type="number" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} />
          </label>
        ) : null}
        {item.measure !== "none" ? (
          <label className="field">
            <span>{MEASURE_UNITS[item.measure] || "value"}</span>
            <input type="number" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
        ) : null}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn danger left" onClick={onDelete}>
          Delete
        </button>
        <button type="button" className="btn primary" onClick={() => onSave(weight, value)}>
          Save
        </button>
      </div>
    </>
  );
}

function exerciseSheet(workout: WorkoutController, onDiscarded: () => void): void {
  openModal(
    (close) => (
      <>
        <div className="modal-head">
          <h2>Exercises</h2>
        </div>
        <div className="m-sheet-list">
          {workout.session.exercises.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              className="m-option"
              aria-pressed={index === workout.index}
              onClick={() => {
                close();
                workout.goTo(index);
              }}
            >
              <span className="grow">
                <b>{entry.exercise_name}</b>
                <br />
                <span className="small muted">
                  {entry.sets.length} of {entry.planned_sets} sets
                </span>
              </span>
              {isComplete(entry) ? <span className="chip">done</span> : null}
            </button>
          ))}
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn danger left"
            onClick={() => {
              close();
              void workout.discard().then((discarded) => {
                if (discarded) onDiscarded();
              });
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              close();
              void openAddExercise(workout, true);
            }}
          >
            Add exercise
          </button>
        </div>
      </>
    ),
    { label: "Exercises" },
  );
}

function Stepper({ field, label, value, placeholder, onChange, onStep }: { field: string; label: string; value: string; placeholder: string; onChange: (value: string) => void; onStep: (direction: number) => void }) {
  return (
    <div className="mw-stepper">
      <button type="button" aria-label={"Less " + label} onClick={() => onStep(-1)}>
        −
      </button>
      <label>
        <input type="number" inputMode="decimal" id={"mw-" + field} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        <span>{label}</span>
      </label>
      <button type="button" aria-label={"More " + label} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  );
}

function Dock({ item, workout }: { item: SessionExercise; workout: WorkoutController }) {
  const complete = isComplete(item);
  const timerLabel = useTimerLabel(workout.timer, true);
  const step = (action: (direction: number) => void) => (direction: number) => {
    action(direction);
    vibrate(8);
  };
  if (item.measure === "none") {
    return (
      <div className="mw-dock">
        <button type="button" className="btn primary mw-save" disabled={workout.busy} onClick={() => void workout.logSet()}>
          {complete ? "Done again" : "Done"}
        </button>
      </div>
    );
  }
  const valueLabel = item.measure === "reps" ? "reps" : item.measure === "sec" ? "seconds" : "minutes";
  return (
    <div className="mw-dock">
      <div className={"mw-steppers" + (item.track_weight ? "" : " one")}>
        {item.track_weight ? <Stepper field="weight" label="kg" placeholder="?" value={workout.values.weight} onChange={workout.setWeight} onStep={step(workout.adjustWeight)} /> : null}
        <Stepper field="value" label={valueLabel} placeholder="" value={workout.values.value} onChange={workout.setValue} onStep={step(workout.adjustValue)} />
      </div>
      {item.measure === "reps" ? (
        <div className="mw-effort" role="group" aria-label="How hard was the set">
          {EFFORTS.map((level) => (
            <button key={level} type="button" aria-pressed={workout.effort === level} onClick={() => workout.setEffort(level)}>
              {EFFORT_LABELS[level]}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className={"btn" + (timerLabel ? " running" : "")} onClick={workout.toggleTimer}>
          {timerLabel ?? (item.measure === "sec" ? "Start countdown" : "Start stopwatch")}
        </button>
      )}
      <button type="button" className="btn primary mw-save" disabled={workout.busy} onClick={() => void workout.logSet()}>
        {complete ? "Save extra set" : "Save set"}
      </button>
    </div>
  );
}

function Media({ item }: { item: SessionExercise }) {
  const [media, setMedia] = useState<"loop" | "muscles">("loop");
  const hasLoop = Boolean(item.media_loop ?? item.video_id);
  if (!hasLoop && !item.media_muscles) {
    return (
      <div className="mw-media empty">
        <span>No tutorial yet.</span>
        {item.exercise_id ? (
          <Link className="btn small" to={"/m/more/exercises/" + String(item.exercise_id)}>
            Add media
          </Link>
        ) : null}
      </div>
    );
  }
  const showMuscles = media === "muscles" && Boolean(item.media_muscles);
  let content = null;
  if (showMuscles || !hasLoop) content = <MediaTag name={item.media_muscles} />;
  else if (item.media_loop) content = <MediaTag name={item.media_loop} />;
  else if (item.video_id) content = <LoopVideo videoId={item.video_id} start={item.video_start} end={item.video_end} className="mw-media-video" />;
  return (
    <div className="mw-media">
      {content}
      {hasLoop && item.media_muscles ? (
        <div className="mw-media-switch" role="group" aria-label="Media">
          <button type="button" aria-pressed={!showMuscles} onClick={() => setMedia("loop")}>
            How to
          </button>
          <button type="button" aria-pressed={showMuscles} onClick={() => setMedia("muscles")}>
            Muscles
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Exercise({ item, workout }: { item: SessionExercise; workout: WorkoutController }) {
  const { session, index } = workout;
  const complete = isComplete(item);
  const showFeel = item.exercise_id && item.sets.length && item.measure !== "min" && item.measure !== "none";
  const pending = Math.max(0, item.planned_sets - item.sets.length);
  return (
    <>
      <div className="mw-dots" role="tablist" aria-label="Exercises">
        {session.exercises.map((entry, position) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={position === index}
            className={position === index ? "current" : isComplete(entry) ? "done" : undefined}
            aria-label={entry.exercise_name}
            onClick={() => workout.goTo(position)}
          />
        ))}
      </div>
      <div className="mw-head">
        <span className="mw-set">
          {complete ? "All sets done" : "Set " + String(item.sets.length + 1) + " of " + String(item.planned_sets)} · exercise {index + 1} of {session.exercises.length}
        </span>
        <h1>{item.exercise_name}</h1>
        <span className="mw-target">
          Target {item.target || "free"}
          {item.track_weight && item.target_weight ? " at " + num(item.target_weight) + " kg" : ""}, rest {formatClock(item.rest_seconds)}
          {session.deload ? ", deload" : ""}
        </span>
      </div>
      <Media key={item.id} item={item} />
      {item.plan_cue ? (
        <p className="cues">
          <b>Coach:</b> {item.plan_cue}
        </p>
      ) : item.cues ? (
        <p className="cues">{item.cues}</p>
      ) : null}
      {item.previous?.sets.length ? (
        <div className="mw-prev">
          Last time {relativeDay(item.previous.day)}:{" "}
          {item.previous.sets.map((set) => (
            <button key={set.set_number} type="button" className="prev-chip" title="Use these values" onClick={() => workout.prefill(set)}>
              {formatSet(set, item.measure, item.track_weight)}
            </button>
          ))}
        </div>
      ) : item.track_weight && !item.target_weight && !item.sets.length ? (
        <p className="mw-first">First time: pick a weight you can lift for the top of the range with 2 to 3 reps left. The coach takes it from there.</p>
      ) : null}
      <div className="mw-sets">
        {item.sets.map((set) => (
          <button key={set.id} type="button" className="mw-set-row" onClick={() => editSetSheet(item, set, workout)}>
            <span className="n">{set.set_number}</span>
            <span className="grow">
              {formatSet(set, item.measure, item.track_weight)}
              {set.record ? <span className="badge-pr">Best</span> : null}
            </span>
            <span className="tag">{set.effort ? EFFORT_LABELS[set.effort] : ""}</span>
          </button>
        ))}
        {Array.from({ length: pending }, (_, offset) => (
          <div key={"p" + String(offset)} className="mw-set-row pending">
            <span className="n">{item.sets.length + offset + 1}</span>
            <span className="grow">{item.target || ""}</span>
          </div>
        ))}
      </div>
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
    </>
  );
}

function Workout({ session, feedback }: { session: Session; feedback: Record<string, { rating: "good" | "weak" | "pain" }> }) {
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const first = useRef(true);
  const workout = useWorkout(session, feedback, {
    mobile: true,
    summary: (result) => <FinishSummary session={result} />,
    onDone: () => void navigate("/m"),
  });
  useFocusMode(true);
  useTopBar({ title: workout.session.program_name, back: "/m", action: { label: "Finish", run: () => workout.finish(false) } });

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    slideIn(contentRef.current, workout.direction);
  }, [workout.index, workout.direction]);

  const onTouchStart = (event: TouchEvent) => {
    const target = event.target as HTMLElement;
    const point = event.touches[0];
    if (!point || target.closest(".body-viewer, input, .mw-media")) return;
    touch.current = { x: point.clientX, y: point.clientY };
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current;
    const point = event.changedTouches[0];
    touch.current = null;
    if (!start || !point) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) workout.goTo(workout.index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  };

  const item = workout.item;
  return (
    <div className="mw-swipe" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="mw-content" ref={contentRef}>
        {item ? (
          <>
            <Exercise item={item} workout={workout} />
            <div className="mw-tools">
              <button type="button" className="btn" onClick={() => exerciseSheet(workout, () => void navigate("/m"))}>
                Exercises
              </button>
              <button type="button" className="btn" onClick={() => workout.changePlanned(item.planned_sets + 1)}>
                + Set
              </button>
              <button type="button" className="btn" disabled={item.planned_sets <= Math.max(1, item.sets.length)} onClick={() => workout.changePlanned(item.planned_sets - 1)}>
                − Set
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="empty">No exercises in this workout yet.</div>
            <button type="button" className="btn primary m-btn-xl" onClick={() => void openAddExercise(workout, true)}>
              Add exercise
            </button>
          </>
        )}
      </div>
      {item ? <Dock key={item.id} item={item} workout={workout} /> : null}
    </div>
  );
}

type TrainData = { kind: "active"; session: Session; feedback: Record<string, { rating: "good" | "weak" | "pain" }> } | { kind: "start"; suggestions: Suggestions };

async function loadTrain(signal: AbortSignal): Promise<TrainData> {
  const active = await refreshActive();
  if (active) {
    const feedback = await api.get<Record<string, { rating: "good" | "weak" | "pain" }>>("/api/sessions/" + String(active.id) + "/feedback", { signal }).catch(() => ({}));
    return { kind: "active", session: active, feedback };
  }
  return { kind: "start", suggestions: await api.get<Suggestions>("/api/suggestions?day=" + todayIso(), { signal }) };
}

function StartTitle() {
  useTopBar({ title: "Train" });
  return null;
}

export function TrainPage() {
  const resource = useResource(loadTrain, [], ["session"]);
  const data = resource.data;
  return (
    <Page mobile ready={Boolean(data)} error={resource.error} onRetry={resource.reload}>
      {() =>
        data?.kind === "active" ? (
          <Workout key={data.session.id} session={data.session} feedback={data.feedback} />
        ) : data ? (
          <>
            <StartTitle />
            <StartList suggestions={data.suggestions} />
          </>
        ) : null
      }
    </Page>
  );
}

function Preview({ program, persona }: { program: Program; persona: Persona | null }) {
  const navigate = useNavigate();
  const day = todayIso();
  useTopBar({ title: program.name, back: "/m/train" });
  const [brief] = useState(() => {
    const request = api.get<CoachMessage>("/api/coach/brief?day=" + day + "&program_id=" + String(program.id));
    request.catch(() => undefined);
    return request;
  });
  const start = () => {
    openCoach({
      persona,
      load: () => brief,
      primary: "Let's go",
      secondary: "Not yet",
      demoPattern: firstDemoPattern(program),
      onPrimary: () => {
        void beginSession(day, program.id).then((ok) => {
          if (ok) void navigate("/m/train", { replace: true });
        });
      },
    });
  };
  return (
    <>
      <section className="preview-hero">
        <div className="when muted">
          {program.weekday !== null ? WEEKDAYS[program.weekday] : "Any day"}
          {program.last_done ? ", last time " + relativeDay(program.last_done) : ""}
        </div>
        <h1>{program.name}</h1>
        {program.description ? <p className="muted">{program.description}</p> : null}
        <div className="m-stat-row">
          <div className="m-stat">
            <span>Exercises</span>
            <b>{program.items.length}</b>
          </div>
          <div className="m-stat">
            <span>Sets</span>
            <b>{program.total_sets}</b>
          </div>
          <div className="m-stat">
            <span>About</span>
            <b>
              {estimatePreviewMinutes(program.items)}
              <small>min</small>
            </b>
          </div>
        </div>
      </section>
      {persona ? (
        <div className="preview-coach">
          <div className="avatar" style={{ background: persona.color }}>
            {persona.name.slice(0, 1)}
          </div>
          <div>
            <b>{persona.name}</b> <span className="muted small">{persona.title}</span>
            <br />
            <span className="small muted">Briefs you when you press Start.</span>
          </div>
        </div>
      ) : null}
      <PreviewList program={program} />
      <div className="preview-start">
        <button type="button" className="btn primary" onClick={start}>
          Start workout
        </button>
      </div>
    </>
  );
}

export function PreviewPage() {
  const { programId = "" } = useParams();
  const navigate = useNavigate();
  const resource = useResource(
    async (signal) => {
      const active = await api.get<Session | null>("/api/sessions/active", { signal });
      if (active) return null;
      const [program, persona] = await Promise.all([api.get<Program>("/api/programs/" + programId, { signal }), coachPersona()]);
      if (persona) preloadCoach(persona.coach);
      return { program, persona };
    },
    [programId],
  );
  useEffect(() => {
    if (resource.data === null) void navigate("/m/train", { replace: true });
  }, [resource.data, navigate]);
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <Preview program={resource.data.program} persona={resource.data.persona} />}
    </Page>
  );
}
