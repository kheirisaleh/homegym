import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { muscleColorVar } from "@/lib/catalog";
import { MEASURE_UNITS, num, todayIso, WEEKDAYS } from "@/lib/format";
import { invalidate } from "@/lib/store";
import type { Exercise, Program, ProgramItem } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { editorSummary } from "@/lib/insights";
import { newProgramItem, programBody } from "@/lib/workout";
import { Page } from "@/app/Page";
import { muscleLabel, useMeta } from "@/app/state";
import { AdjustedPlan } from "@/features/cycle";
import { openExerciseEditor } from "@/features/ExerciseEditor";
import { redesignDialog } from "@/features/programDialogs";
import { confirmDialog } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";
import { startWorkoutFlow } from "@/workout/flows";

interface Row extends Omit<ProgramItem, "sets" | "rest_seconds"> {
  key: string;
  sets: number | null;
  rest_seconds: number | null;
}

type NumericField = "sets" | "rep_min" | "rep_max" | "target_weight" | "rest_seconds";

let rowCounter = 0;

function toRow(item: ProgramItem): Row {
  rowCounter += 1;
  return { ...item, key: "r" + String(rowCounter) };
}

const EMPTY_PROGRAM: Program = { id: 0, name: "", weekday: null, description: "", archived: 0, created_at: "", user_id: 0, items: [], last_done: null, total_sets: 0, versions: [] };


function EditorRow({ row, exercise, index, onChange, onRemove, onDropAt }: {
  row: Row;
  exercise: Exercise | undefined;
  index: number;
  onChange: (fields: Partial<Row>) => void;
  onRemove: () => void;
  onDropAt: (index: number, event: DragEvent) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const measure = exercise?.measure ?? row.measure;
  const unit = MEASURE_UNITS[measure];
  const numeric = (field: NumericField) => ({
    value: row[field] === null ? "" : String(row[field]),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ [field]: event.target.value === "" ? null : Number(event.target.value) }),
  });
  return (
    <div
      className={"ed-row" + (dragging ? " dragging" : "") + (over ? " over" : "")}
      draggable
      onDragStart={(event) => {
        if (event.target !== event.currentTarget) return;
        event.dataTransfer.setData("text/row", String(index));
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        onDropAt(index, event);
      }}
    >
      <span className="grip" title="Drag to reorder" aria-hidden="true">
        ⠿
      </span>
      <div className="name">
        <b>{exercise?.name ?? row.name}</b>
        <span>
          {muscleLabel(exercise?.primary_muscle ?? row.primary_muscle)}
          {exercise && !exercise.available ? " · equipment missing" : ""}
        </span>
      </div>
      <label>
        Sets
        <input type="number" min={1} max={10} {...numeric("sets")} />
      </label>
      {measure !== "none" ? (
        <label>
          {unit}
          <span className="range">
            <input type="number" min={0} step={1} aria-label="Minimum" {...numeric("rep_min")} />
            <input type="number" min={0} step={1} aria-label="Maximum" {...numeric("rep_max")} />
          </span>
        </label>
      ) : (
        <label>
          Target
          <input type="text" value={row.target} onChange={(event) => onChange({ target: event.target.value })} />
        </label>
      )}
      {exercise?.track_weight ?? row.track_weight ? (
        <label>
          Weight
          <input type="number" min={0} step={0.5} placeholder="auto" {...numeric("target_weight")} />
        </label>
      ) : (
        <span />
      )}
      <label>
        Rest
        <input type="number" min={0} step={15} {...numeric("rest_seconds")} />
      </label>
      <button type="button" className="btn ghost small" title="Remove" aria-label={"Remove " + (exercise?.name ?? row.name)} onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

function Library({ exercises, onAdd, onCreate }: { exercises: Exercise[]; onAdd: (exercise: Exercise) => void; onCreate: () => void }) {
  const meta = useMeta();
  const [search, setSearch] = useState("");
  const [muscle, setMuscle] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const query = search.trim().toLowerCase();
  const list = exercises.filter(
    (exercise) =>
      (!query || exercise.name.toLowerCase().includes(query)) &&
      (!muscle || exercise.primary_muscle === muscle || exercise.secondary_muscles.includes(muscle)) &&
      (!onlyAvailable || exercise.available),
  );
  return (
    <aside className="library panel">
      <div className="panel-head">
        <h3>Exercises</h3>
        <button type="button" className="btn ghost small" onClick={onCreate}>
          New exercise
        </button>
      </div>
      <input type="search" placeholder="Search" aria-label="Search exercises" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label="Muscle" value={muscle} onChange={(event) => setMuscle(event.target.value)}>
        <option value="">All muscles</option>
        {meta.muscles.map((key) => (
          <option key={key} value={key}>
            {muscleLabel(key)}
          </option>
        ))}
      </select>
      <label className="check small">
        <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} /> Only with my equipment
      </label>
      <div className="library-list">
        {list.length ? (
          list.map((exercise) => (
            <button
              key={exercise.id}
              type="button"
              className={"lib-item" + (exercise.available ? "" : " unavailable")}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/exercise", String(exercise.id))}
              onClick={() => onAdd(exercise)}
            >
              <span className="dot" style={{ background: muscleColorVar(exercise.primary_muscle) }} />
              <span className="grow">
                {exercise.name}
                <span>{muscleLabel(exercise.primary_muscle)}</span>
              </span>
              <span className="add" aria-hidden="true">
                +
              </span>
            </button>
          ))
        ) : (
          <p className="muted small">No exercise matches.</p>
        )}
      </div>
      <p className="small faint">Drag or click to add</p>
    </aside>
  );
}

function Editor({ program, exercises, isNew, onReload }: { program: Program; exercises: Exercise[]; isNew: boolean; onReload: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(program.name);
  const [weekday, setWeekday] = useState<number | null>(program.weekday);
  const [description, setDescription] = useState(program.description || "");
  const [rows, setRows] = useState<Row[]>(() => program.items.map(toRow));
  const [dirty, setDirty] = useState(false);
  const [listDrop, setListDrop] = useState(false);
  const [saving, setSaving] = useState(false);
  const skipGuard = useRef(false);
  const byId = useMemo(() => new Map(exercises.map((exercise) => [exercise.id, exercise])), [exercises]);
  const summary = editorSummary(rows, byId);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !skipGuard.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog("Leave without saving?", "Your changes to this program are not saved yet.", "Leave", true).then((leave) => {
      if (leave) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
    };
  }, [dirty]);

  const change = (next: Row[]) => {
    setRows(next);
    setDirty(true);
  };

  const addExercise = (exercise: Exercise, at?: number) => {
    const row = toRow(newProgramItem(exercise));
    const next = [...rows];
    next.splice(at ?? next.length, 0, row);
    change(next);
  };

  const dropAt = (index: number, event: DragEvent) => {
    const from = event.dataTransfer.getData("text/row");
    const exerciseId = Number(event.dataTransfer.getData("text/exercise"));
    if (from !== "") {
      const next = [...rows];
      const [moved] = next.splice(Number(from), 1);
      if (moved) next.splice(index, 0, moved);
      change(next);
    } else if (exerciseId) {
      const exercise = byId.get(exerciseId);
      if (exercise) addExercise(exercise, index);
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast("Give the program a name", "error");
      return;
    }
    setSaving(true);
    try {
      const body = programBody({ name: trimmed, weekday, description }, rows);
      const saved = isNew ? await api.post<Program>("/api/programs", body) : await api.put<Program>("/api/programs/" + String(program.id), body);
      setDirty(false);
      skipGuard.current = true;
      invalidate("programs");
      toast("Program saved");
      if (isNew) void navigate("/programs/" + String(saved.id), { replace: true });
      else onReload();
    } catch (error) {
      errorToast(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog("Delete program", "Logged workouts are kept. The program is archived if it was already used.", "Delete", true);
    if (!ok) return;
    try {
      await api.delete("/api/programs/" + String(program.id));
      skipGuard.current = true;
      invalidate("programs");
      void navigate("/programs");
    } catch (error) {
      errorToast(error);
    }
  };

  const duplicate = async () => {
    try {
      const copy = await api.post<Program>("/api/programs/" + String(program.id) + "/duplicate");
      skipGuard.current = true;
      invalidate("programs");
      void navigate("/programs/" + String(copy.id));
    } catch (error) {
      errorToast(error);
    }
  };

  const restore = async (versionId: number) => {
    try {
      await api.post("/api/programs/" + String(program.id) + "/restore/" + String(versionId));
      toast("Version restored");
      invalidate("programs");
      onReload();
    } catch (error) {
      errorToast(error);
    }
  };

  const createExercise = () => {
    openExerciseEditor(null, {
      onCreated: (created) => {
        invalidate("exercises");
        addExercise(created);
      },
    });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="btn ghost small" to="/programs">
            All programs
          </Link>
          <h1 className="editor-title">{isNew ? "New program" : program.name}</h1>
        </div>
        <div className="page-actions">
          {!isNew ? (
            <>
              <button type="button" className="btn" onClick={() => redesignDialog(program.id, onReload)}>
                Redesign with AI coach
              </button>
              <button type="button" className="btn" onClick={() => void duplicate()}>
                Duplicate
              </button>
              <button type="button" className="btn ghost danger" onClick={() => void remove()}>
                Delete
              </button>
            </>
          ) : null}
          <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
            {dirty ? "Save changes" : "Save"}
          </button>
        </div>
      </div>
      {!isNew ? (
        <div className="cycle-desktop cycle-slot">
          <AdjustedPlan programId={program.id} onStart={() => void startWorkoutFlow(todayIso(), program.id, () => void navigate("/training"))} />
        </div>
      ) : null}
      <div className="form-grid editor-fields">
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            placeholder="e.g. Chest and triceps"
            value={name}
            data-autofocus={isNew || undefined}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="field">
          <span>Weekday</span>
          <select
            value={weekday === null ? "" : String(weekday)}
            onChange={(event) => {
              setWeekday(event.target.value === "" ? null : Number(event.target.value));
              setDirty(true);
            }}
          >
            <option value="">No fixed day</option>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span>Description</span>
          <input
            type="text"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setDirty(true);
            }}
          />
        </label>
      </div>
      <div className="editor-summary">
        <span>
          <b>{rows.length}</b>exercises
        </span>
        <span>
          <b>{summary.sets}</b>working sets
        </span>
        <span>
          <b>{summary.minutes}</b>minutes approx.
        </span>
        {summary.sets > 24 ? <span className="delta down">More than 24 sets, that gets long</span> : null}
        <span className="chips">
          {summary.muscles.map(([muscle, value]) => (
            <span key={muscle} className="chip">
              <span className="dot" style={{ background: muscleColorVar(muscle) }} />
              {muscleLabel(muscle)} {num(value)}
            </span>
          ))}
        </span>
      </div>
      <div className="editor">
        <div>
          <div
            className={"editor-items" + (listDrop ? " drop" : "")}
            onDragOver={(event) => {
              event.preventDefault();
              setListDrop(true);
            }}
            onDragLeave={() => setListDrop(false)}
            onDrop={(event) => {
              event.preventDefault();
              setListDrop(false);
              const exercise = byId.get(Number(event.dataTransfer.getData("text/exercise")));
              if (exercise) addExercise(exercise);
            }}
          >
            {rows.length ? (
              rows.map((row, index) => (
                <EditorRow
                  key={row.key}
                  row={row}
                  index={index}
                  exercise={byId.get(row.exercise_id)}
                  onChange={(fields) => change(rows.map((entry) => (entry.key === row.key ? { ...entry, ...fields } : entry)))}
                  onRemove={() => change(rows.filter((entry) => entry.key !== row.key))}
                  onDropAt={dropAt}
                />
              ))
            ) : (
              <div className="empty">Drag exercises from the list on the right in here.</div>
            )}
          </div>
          {!isNew && program.versions?.length ? (
            <div className="panel flat versions-panel">
              <div className="panel-head">
                <h3>Earlier versions</h3>
                <span className="hint">Every change is saved</span>
              </div>
              <div className="feed">
                {program.versions.map((version) => (
                  <div key={version.id} className="feed-item">
                    <div className="ico k-neutral" aria-hidden="true">
                      ↺
                    </div>
                    <div>
                      <div className="title">{version.reason}</div>
                      <div className="msg">{version.created_at.replace("T", " ").slice(0, 16)}</div>
                    </div>
                    <div className="when">
                      <button type="button" className="btn ghost small" onClick={() => void restore(version.id)}>
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <Library
          exercises={exercises}
          onCreate={createExercise}
          onAdd={(exercise) => {
            addExercise(exercise);
            toast(exercise.name + " added");
          }}
        />
      </div>
    </>
  );
}

export function ProgramEditorPage() {
  const { programId = "new" } = useParams();
  const isNew = programId === "new";
  const exercises = useResource((signal) => api.get<Exercise[]>("/api/exercises", { signal }), [], ["exercises"]);
  const program = useResource((signal) => (isNew ? Promise.resolve(EMPTY_PROGRAM) : api.get<Program>("/api/programs/" + programId, { signal })), [programId]);
  const [seen, setSeen] = useState(program.data);
  const [generation, setGeneration] = useState(0);
  if (program.data !== seen) {
    setSeen(program.data);
    setGeneration((value) => value + 1);
  }
  const error = program.error ?? exercises.error;
  return (
    <Page
      ready={Boolean(program.data && exercises.data)}
      error={error}
      onRetry={() => {
        program.reload();
        exercises.reload();
      }}
    >
      {() =>
        program.data &&
        exercises.data && <Editor key={programId + ":" + String(generation)} program={program.data} exercises={exercises.data} isNew={isNew} onReload={program.reload} />
      }
    </Page>
  );
}
