import { type DragEvent, useState } from "react";
import { api } from "@/lib/api";
import { extractVideoId, PATTERNS, thumbUrl } from "@/lib/catalog";
import { formatClock, MEASURE_LABELS } from "@/lib/format";
import { invalidate } from "@/lib/store";
import type { Equipment, Exercise, Measure, YoutubeResult } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { metaStore, muscleLabel } from "@/app/state";
import { MediaTag } from "@/ui/common";
import { confirmDialog, openModal } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";
import { LoopVideo } from "@/ui/youtube";

type Kind = "loop" | "muscles";

const SLOT_TEXT: Record<Kind, { title: string; help: string; accept: string }> = {
  loop: { title: "Loop animation", help: "GIF or short video (MP4, WEBM). Plays muted in a loop.", accept: "image/gif,video/mp4,video/webm,video/quicktime,image/webp" },
  muscles: { title: "Target muscles", help: "Image (PNG, JPG, WEBP, SVG) with the muscles highlighted.", accept: "image/*" },
};

export function MediaSlot({ exerciseId, kind, name, onUpdate }: { exerciseId: number; kind: Kind; name: string | null; onUpdate: (exercise: Exercise) => void }) {
  const [status, setStatus] = useState("");
  const [drag, setDrag] = useState(false);
  const text = SLOT_TEXT[kind];
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    setStatus("Uploading");
    try {
      onUpdate(await api.post<Exercise>("/api/exercises/" + String(exerciseId) + "/media/" + kind, data));
      setStatus("");
      toast("Uploaded");
    } catch (error) {
      errorToast(error);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const remove = async () => {
    try {
      onUpdate(await api.delete<Exercise>("/api/exercises/" + String(exerciseId) + "/media/" + kind));
    } catch (error) {
      errorToast(error);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDrag(false);
    void upload(event.dataTransfer.files[0]);
  };
  return (
    <div
      className={"slot" + (drag ? " drag" : "")}
      onDragOver={(event) => {
        event.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      <b>{text.title}</b>
      <div className="preview">{status || (name ? <MediaTag name={name} /> : text.help)}</div>
      <div className="row">
        <label className="btn small">
          <input type="file" hidden accept={text.accept} onChange={(event) => void upload(event.target.files?.[0])} />
          Choose file
        </label>
        {name ? (
          <button type="button" className="btn ghost small danger" onClick={() => void remove()}>
            Remove
          </button>
        ) : null}
        <span className="small faint">or drop it here</span>
      </div>
    </div>
  );
}

interface Draft {
  name: string;
  measure: Measure;
  track_weight: boolean;
  difficulty: number;
  primary_muscle: string;
  pattern: string;
  secondary_muscles: string[];
  equipment: string[];
  load_equipment: string;
  cues: string;
  notes: string;
  link: string;
  start: string;
  end: string;
  video_title: string | null;
}

function draftOf(exercise: Exercise | null): Draft {
  return {
    name: exercise?.name ?? "",
    measure: exercise?.measure ?? "reps",
    track_weight: exercise?.track_weight ?? true,
    difficulty: exercise?.difficulty ?? 1,
    primary_muscle: exercise?.primary_muscle ?? "",
    pattern: exercise?.pattern ?? "",
    secondary_muscles: exercise?.secondary_muscles ?? [],
    equipment: exercise?.equipment ?? [],
    load_equipment: exercise?.load_equipment ?? "",
    cues: exercise?.cues ?? "",
    notes: exercise?.notes ?? "",
    link: exercise?.video_id ? "https://youtu.be/" + exercise.video_id : "",
    start: exercise?.video_start ? String(exercise.video_start) : "",
    end: exercise?.video_end ? String(exercise.video_end) : "",
    video_title: exercise?.video_title ?? null,
  };
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}

function ExerciseEditor({ exercise, close, onChanged, onCreated }: { exercise: Exercise | null; close: () => void; onChanged: () => void; onCreated: (exercise: Exercise) => void }) {
  const isNew = !exercise;
  const [current, setCurrent] = useState<Exercise | null>(exercise);
  const [draft, setDraft] = useState<Draft>(() => draftOf(exercise));
  const [preview, setPreview] = useState(() => ({ id: extractVideoId(draft.link), start: Number(draft.start) || 0, end: Number(draft.end) || 0 }));
  const [query, setQuery] = useState((exercise?.name ?? "") + " form");
  const [shortOnly, setShortOnly] = useState(true);
  const [results, setResults] = useState<YoutubeResult[] | string | null>(null);
  const [saving, setSaving] = useState(false);
  const equipment = useResource((signal) => api.get<Equipment[]>("/api/equipment", { signal }), [], ["equipment"]);
  const muscles = metaStore.get()?.muscles ?? [];
  const set = (fields: Partial<Draft>) => setDraft((value) => ({ ...value, ...fields }));
  const refreshPreview = (next: Draft) => setPreview({ id: extractVideoId(next.link), start: Number(next.start) || 0, end: Number(next.end) || 0 });

  const search = async () => {
    setResults("Searching");
    try {
      let items = await api.get<YoutubeResult[]>("/api/youtube/search?q=" + encodeURIComponent(query) + (shortOnly ? "&short=true" : ""));
      if (shortOnly) items = items.filter((item) => !item.length || item.length <= 120);
      setResults(items);
    } catch (error) {
      setResults(error instanceof Error ? error.message : String(error));
    }
  };

  const save = async () => {
    const body = {
      name: draft.name.trim(),
      measure: draft.measure,
      track_weight: draft.track_weight,
      difficulty: draft.difficulty,
      primary_muscle: draft.primary_muscle || null,
      pattern: draft.pattern || null,
      secondary_muscles: draft.secondary_muscles,
      equipment: draft.equipment,
      load_equipment: draft.load_equipment || null,
      cues: draft.cues,
      notes: draft.notes,
      video: draft.link.trim() || null,
      video_start: Number(draft.start) || null,
      video_end: Number(draft.end) || null,
      video_title: draft.video_title,
    };
    if (!body.name) {
      toast("Give the exercise a name", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = isNew ? await api.post<Exercise>("/api/exercises", body) : await api.put<Exercise>("/api/exercises/" + String(exercise.id), body);
      invalidate("exercises", "programs");
      toast(isNew ? "Exercise created. Now you can upload media." : "Exercise saved");
      onChanged();
      close();
      if (isNew) onCreated(saved);
    } catch (error) {
      setSaving(false);
      errorToast(error);
    }
  };

  const remove = async () => {
    if (!current) return;
    const ok = await confirmDialog("Delete exercise", "The exercise disappears from all programs. Logged sets stay in your history.", "Delete", true);
    if (!ok) return;
    try {
      await api.delete("/api/exercises/" + String(current.id));
      invalidate("exercises", "programs");
      onChanged();
      close();
    } catch (error) {
      errorToast(error);
    }
  };

  const equipmentList = equipment.data ?? [];

  return (
    <>
      <div className="modal-head">
        <h2>{isNew ? "New exercise" : exercise.name}</h2>
        <button type="button" className="btn ghost small" onClick={close}>
          Close
        </button>
      </div>
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "span 2" }}>
          <span>Name</span>
          <input type="text" value={draft.name} data-autofocus onChange={(event) => set({ name: event.target.value })} />
        </label>
        <label className="field">
          <span>Measure</span>
          <select value={draft.measure} onChange={(event) => set({ measure: event.target.value as Measure })}>
            {Object.entries(MEASURE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Difficulty</span>
          <select value={draft.difficulty} onChange={(event) => set({ difficulty: Number(event.target.value) })}>
            <option value={1}>Beginner</option>
            <option value={2}>Intermediate</option>
            <option value={3}>Advanced</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={draft.track_weight} onChange={(event) => set({ track_weight: event.target.checked })} /> Log weight
      </label>
      {current ? (
        <>
          <h3>Media for training</h3>
          <div className="media-slots">
            {(["loop", "muscles"] as const).map((kind) => (
              <MediaSlot
                key={kind}
                exerciseId={current.id}
                kind={kind}
                name={kind === "loop" ? current.media_loop : current.media_muscles}
                onUpdate={(updated) => {
                  setCurrent(updated);
                  invalidate("exercises");
                  onChanged();
                }}
              />
            ))}
          </div>
        </>
      ) : null}
      <h3>Muscles and movement</h3>
      <div className="form-grid">
        <label className="field">
          <span>Target muscle</span>
          <select value={draft.primary_muscle} onChange={(event) => set({ primary_muscle: event.target.value })}>
            <option value="">None</option>
            {muscles.map((muscle) => (
              <option key={muscle} value={muscle}>
                {muscleLabel(muscle)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Movement pattern</span>
          <select value={draft.pattern} onChange={(event) => set({ pattern: event.target.value })}>
            <option value="">None</option>
            {Object.entries(PATTERNS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <span>Secondary muscles (count half)</span>
        <div className="chips">
          {muscles.map((muscle) => (
            <button key={muscle} type="button" className="chip" aria-pressed={draft.secondary_muscles.includes(muscle)} onClick={() => set({ secondary_muscles: toggle(draft.secondary_muscles, muscle) })}>
              {muscleLabel(muscle)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Required equipment</span>
        <div className="chips">
          {equipmentList.map((item) => (
            <button key={item.key} type="button" className="chip" aria-pressed={draft.equipment.includes(item.key)} onClick={() => set({ equipment: toggle(draft.equipment, item.key) })}>
              {item.name}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Weight steps from</span>
        <select value={draft.load_equipment} onChange={(event) => set({ load_equipment: event.target.value })}>
          <option value="">No equipment, steps of 2.5 kg</option>
          {equipmentList
            .filter((item) => item.weights)
            .map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        <span>Technique cues (shown during training)</span>
        <textarea value={draft.cues} onChange={(event) => set({ cues: event.target.value })} />
      </label>
      <h3>YouTube as fallback</h3>
      <p className="muted small">Only shown when no own loop animation is uploaded. Use start and end to loop just the important part.</p>
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "span 2" }}>
          <span>Link or video ID</span>
          <input type="text" value={draft.link} onChange={(event) => set({ link: event.target.value })} onBlur={() => refreshPreview(draft)} />
        </label>
        <label className="field">
          <span>Start s</span>
          <input type="number" min={0} value={draft.start} onChange={(event) => set({ start: event.target.value })} onBlur={() => refreshPreview(draft)} />
        </label>
        <label className="field">
          <span>End s</span>
          <input type="number" min={0} value={draft.end} onChange={(event) => set({ end: event.target.value })} onBlur={() => refreshPreview(draft)} />
        </label>
      </div>
      {preview.id ? (
        <LoopVideo key={preview.id + String(preview.start) + String(preview.end)} videoId={preview.id} start={preview.start} end={preview.end} className="media-frame video-preview" />
      ) : (
        <div className="media-frame video-preview">
          <div className="media-empty">No YouTube video selected</div>
        </div>
      )}
      <div className="toolbar" style={{ margin: 0 }}>
        <input
          type="search"
          aria-label="Search YouTube"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
        />
        <label className="check small">
          <input type="checkbox" checked={shortOnly} onChange={(event) => setShortOnly(event.target.checked)} /> Short only
        </label>
        <button type="button" className="btn" onClick={() => void search()}>
          Search
        </button>
      </div>
      <div className="yt-results">
        {typeof results === "string" ? <p className="muted small">{results}</p> : null}
        {Array.isArray(results) && !results.length ? <p className="muted small">No results.</p> : null}
        {Array.isArray(results)
          ? results.map((item) => (
              <button
                key={item.video_id}
                type="button"
                className={"yt-result" + (item.embeddable ? "" : " blocked")}
                disabled={!item.embeddable}
                onClick={() => {
                  const next = { ...draft, link: "https://youtu.be/" + item.video_id, start: "", end: "", video_title: item.title };
                  setDraft(next);
                  refreshPreview(next);
                }}
              >
                <img src={thumbUrl(item.video_id)} alt="" />
                <div>
                  {item.title}
                  <div className="len">
                    {item.length ? formatClock(item.length) : ""} · {item.channel}
                    {item.embeddable ? "" : " · cannot be embedded"}
                  </div>
                </div>
              </button>
            ))
          : null}
      </div>
      <div className="modal-foot">
        {current ? (
          <button type="button" className="btn ghost danger left" onClick={() => void remove()}>
            Delete exercise
          </button>
        ) : null}
        <button type="button" className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}

export function openExerciseEditor(exercise: Exercise | null, options: { onChanged?: () => void; onClose?: () => void; onCreated?: (exercise: Exercise) => void } = {}): void {
  openModal(
    (close) => (
      <ExerciseEditor
        exercise={exercise}
        close={close}
        onChanged={() => options.onChanged?.()}
        onCreated={(created) => options.onCreated?.(created)}
      />
    ),
    { wide: true, label: exercise ? exercise.name : "New exercise", ...(options.onClose ? { onClose: options.onClose } : {}) },
  );
}
