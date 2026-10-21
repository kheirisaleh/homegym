import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { relativeDay, todayIso, WEEKDAYS } from "@/lib/format";
import { invalidate } from "@/lib/store";
import type { Exercise, Program, ProgramItem, RebuildState } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { type EditableItem, newProgramItem, programBody } from "@/lib/workout";
import { useTopBar } from "@/app/MobileShell";
import { Page } from "@/app/Page";
import { muscleLabel } from "@/app/state";
import { AdjustedPlan, CycleCard, useCycleState } from "@/features/cycle";
import { rebuildDialog, redesignDialog, restoreDialog } from "@/features/programDialogs";
import { confirmDialog, openModal } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";
import { useStartWorkout } from "./workoutStart";

function ProgramRow({ program }: { program: Program }) {
  return (
    <Link className="m-item" to={"/m/plan/" + String(program.id)}>
      <span className="grow">
        <b>{program.name}</b>
        <span>
          {program.items.length} exercises, {program.total_sets} sets, {program.last_done ? "last " + relativeDay(program.last_done) : "not done yet"}
        </span>
      </span>
      <span className="chev" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

function PlanView({ programs, rebuild }: { programs: Program[]; rebuild: RebuildState | null }) {
  const cycle = useCycleState();
  const unassigned = programs.filter((program) => program.weekday === null);
  return (
    <>
      {cycle?.eligible ? <CycleCard cycle={cycle} compact healthHref="/m/more/health" /> : null}
      <section className="m-card">
        <div className="m-card-head">
          <h2>Not happy with your program?</h2>
        </div>
        <p className="small muted">Tell your coach what did not work. You get a new program built from your history, feedback and equipment.</p>
        <div className="m-row-actions">
          <button type="button" className="btn primary" onClick={() => void rebuildDialog()}>
            New program
          </button>
          {rebuild?.can_restore ? (
            <button type="button" className="btn" onClick={() => void restoreDialog()}>
              Previous program
            </button>
          ) : null}
        </div>
      </section>
      {programs.length ? null : <div className="empty">No programs yet.</div>}
      {WEEKDAYS.map((day, index) => {
        const list = programs.filter((program) => program.weekday === index);
        if (!list.length) return null;
        return (
          <Fragment key={day}>
            <div className="m-section-title">{day}</div>
            <div className="m-list">
              {list.map((program) => (
                <ProgramRow key={program.id} program={program} />
              ))}
            </div>
          </Fragment>
        );
      })}
      {unassigned.length ? (
        <>
          <div className="m-section-title">No fixed day</div>
          <div className="m-list">
            {unassigned.map((program) => (
              <ProgramRow key={program.id} program={program} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

export function PlanPage() {
  const navigate = useNavigate();
  const create = async () => {
    try {
      const program = await api.post<Program>("/api/programs", { name: "New program", weekday: null, description: "", items: [] });
      invalidate("programs");
      void navigate("/m/plan/" + String(program.id));
    } catch (error) {
      errorToast(error);
    }
  };
  useTopBar({ title: "Plan", action: { label: "New", run: () => void create() } });
  const resource = useResource(
    async (signal) => {
      const [programs, rebuild] = await Promise.all([api.get<Program[]>("/api/programs", { signal }), api.get<RebuildState>("/api/me/rebuild", { signal }).catch(() => null)]);
      return { programs, rebuild };
    },
    [],
    ["programs"],
  );
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <PlanView programs={resource.data.programs} rebuild={resource.data.rebuild} />}
    </Page>
  );
}

function numberOrNull(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

function ItemSheet({ item, canUp, canDown, onSave, onRemove, onMove }: {
  item: ProgramItem;
  canUp: boolean;
  canDown: boolean;
  onSave: (fields: Partial<EditableItem>) => void;
  onRemove: () => void;
  onMove: (direction: number) => void;
}) {
  const [sets, setSets] = useState(String(item.sets));
  const [rest, setRest] = useState(String(item.rest_seconds));
  const [low, setLow] = useState(item.rep_min === null ? "" : String(item.rep_min));
  const [high, setHigh] = useState(item.rep_max === null ? "" : String(item.rep_max));
  const [weight, setWeight] = useState(item.target_weight === null ? "" : String(item.target_weight));
  return (
    <>
      <div className="modal-head">
        <h2>{item.name}</h2>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Sets</span>
          <input type="number" inputMode="numeric" min={1} max={10} value={sets} onChange={(event) => setSets(event.target.value)} />
        </label>
        <label className="field">
          <span>Rest s</span>
          <input type="number" inputMode="numeric" min={0} step={15} value={rest} onChange={(event) => setRest(event.target.value)} />
        </label>
        <label className="field">
          <span>From</span>
          <input type="number" inputMode="numeric" min={0} value={low} onChange={(event) => setLow(event.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="number" inputMode="numeric" min={0} value={high} onChange={(event) => setHigh(event.target.value)} />
        </label>
        <label className="field span-2">
          <span>Weight kg (empty means automatic)</span>
          <input type="number" inputMode="decimal" step="0.5" min={0} value={weight} onChange={(event) => setWeight(event.target.value)} />
        </label>
      </div>
      <div className="m-switch-row">
        <span>Position</span>
        <div className="m-move">
          <button type="button" aria-label="Move up" disabled={!canUp} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" aria-label="Move down" disabled={!canDown} onClick={() => onMove(1)}>
            ↓
          </button>
        </div>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn danger left" onClick={onRemove}>
          Remove
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            onSave({
              sets: Math.max(1, numberOrNull(sets) || 1),
              rest_seconds: numberOrNull(rest) || 0,
              rep_min: numberOrNull(low),
              rep_max: numberOrNull(high),
              target_weight: numberOrNull(weight),
            })
          }
        >
          Save
        </button>
      </div>
    </>
  );
}

function ProgramSheet({ program, onSave, onCancel }: { program: Program; onSave: (name: string, weekday: number | null) => void; onCancel: () => void }) {
  const [name, setName] = useState(program.name);
  const [weekday, setWeekday] = useState(program.weekday === null ? "" : String(program.weekday));
  return (
    <>
      <div className="modal-head">
        <h2>Program</h2>
      </div>
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} data-autofocus onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span>Day</span>
        <select value={weekday} onChange={(event) => setWeekday(event.target.value)}>
          <option value="">No fixed day</option>
          {WEEKDAYS.map((day, index) => (
            <option key={day} value={index}>
              {day}
            </option>
          ))}
        </select>
      </label>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => onSave(name.trim() || program.name, weekday === "" ? null : Number(weekday))}>
          Save
        </button>
      </div>
    </>
  );
}

function ExercisePicker({ exercises, onPick }: { exercises: Exercise[]; onPick: (exercise: Exercise) => void }) {
  const [query, setQuery] = useState("");
  const available = useMemo(() => exercises.filter((exercise) => exercise.available), [exercises]);
  const text = query.trim().toLowerCase();
  const list = available.filter((exercise) => exercise.name.toLowerCase().includes(text) || muscleLabel(exercise.primary_muscle).toLowerCase().includes(text)).slice(0, 50);
  return (
    <>
      <div className="modal-head">
        <h2>Add exercise</h2>
      </div>
      <input type="search" placeholder="Search exercises" aria-label="Search exercises" value={query} data-autofocus onChange={(event) => setQuery(event.target.value)} />
      <div className="m-sheet-list">
        {list.map((exercise) => (
          <button key={exercise.id} type="button" className="m-option" onClick={() => onPick(exercise)}>
            <span className="grow">
              <b>{exercise.name}</b>
              <br />
              <span className="small muted">{muscleLabel(exercise.primary_muscle)}</span>
            </span>
          </button>
        ))}
        {list.length ? null : <p className="small muted">No exercise matches.</p>}
      </div>
    </>
  );
}

function PlanDetail({ program }: { program: Program }) {
  const navigate = useNavigate();
  const start = useStartWorkout();
  const items = program.items;

  const save = async (next: EditableItem[], meta: { name: string; weekday: number | null } = program, message?: string) => {
    try {
      await api.put("/api/programs/" + String(program.id), programBody({ ...program, ...meta }, next));
      invalidate("programs");
      if (message) toast(message);
    } catch (error) {
      errorToast(error);
    }
  };

  const editProgram = () => {
    const handle = openModal(
      (close) => (
        <ProgramSheet
          program={program}
          onCancel={close}
          onSave={(name, weekday) => {
            handle.close();
            void save(items, { name, weekday });
          }}
        />
      ),
      { label: "Program" },
    );
  };

  useTopBar({ title: program.name, back: "/m/plan", action: { label: "Edit", run: editProgram } });

  const editItem = (index: number) => {
    const item = items[index];
    if (!item) return;
    const handle = openModal(
      () => (
        <ItemSheet
          item={item}
          canUp={index > 0}
          canDown={index < items.length - 1}
          onSave={(fields) => {
            handle.close();
            void save(
              items.map((entry, position) => (position === index ? { ...entry, ...fields } : entry)),
              program,
              "Saved",
            );
          }}
          onRemove={() => {
            handle.close();
            void save(
              items.filter((_, position) => position !== index),
              program,
              "Removed",
            );
          }}
          onMove={(direction) => {
            handle.close();
            const next = [...items];
            const [moved] = next.splice(index, 1);
            if (moved) next.splice(index + direction, 0, moved);
            void save(next);
          }}
        />
      ),
      { label: item.name },
    );
  };

  const addExercise = async () => {
    let exercises: Exercise[];
    try {
      exercises = await api.get<Exercise[]>("/api/exercises");
    } catch (error) {
      errorToast(error);
      return;
    }
    const handle = openModal(
      () => (
        <ExercisePicker
          exercises={exercises}
          onPick={(exercise) => {
            handle.close();
            void save([...items, newProgramItem(exercise)], program, exercise.name + " added");
          }}
        />
      ),
      { label: "Add exercise" },
    );
  };

  const remove = async () => {
    const ok = await confirmDialog("Delete program", "Logged workouts are kept.", "Delete", true);
    if (!ok) return;
    try {
      await api.delete("/api/programs/" + String(program.id));
      invalidate("programs");
      void navigate("/m/plan");
    } catch (error) {
      errorToast(error);
    }
  };

  const startNow = () => void start(todayIso(), program.id);

  return (
    <>
      <AdjustedPlan programId={program.id} onStart={startNow} />
      <div className="m-card flat">
        <span className="muted small">
          {program.weekday !== null ? WEEKDAYS[program.weekday] : "No fixed day"}, {program.total_sets} working sets
        </span>
        {program.description ? <p>{program.description}</p> : null}
      </div>
      <div className="m-list">
        {items.map((item, index) => (
          <button key={String(item.id ?? index)} type="button" className="m-item" onClick={() => editItem(index)}>
            <span className="grow">
              <b>{item.name}</b>
              <span>
                {item.sets} × {item.target || "free"}
                {item.target_weight ? " at " + String(item.target_weight) + " kg" : ""}, rest {item.rest_seconds} s, {muscleLabel(item.primary_muscle)}
              </span>
            </span>
            <span className="chev" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
      <button type="button" className="btn m-btn-xl" onClick={() => void addExercise()}>
        Add exercise
      </button>
      <div className="m-row-actions">
        <button type="button" className="btn" onClick={() => redesignDialog(program.id)}>
          Redesign with AI
        </button>
        <button type="button" className="btn" onClick={startNow}>
          Start now
        </button>
      </div>
      <button type="button" className="btn ghost danger" onClick={() => void remove()}>
        Delete program
      </button>
    </>
  );
}

export function PlanDetailPage() {
  const { programId = "" } = useParams();
  const resource = useResource((signal) => api.get<Program>("/api/programs/" + programId, { signal }), [programId], ["programs"]);
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <PlanDetail program={resource.data} />}
    </Page>
  );
}
