import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { thumbUrl } from "@/lib/catalog";
import { plural } from "@/lib/format";
import { type ExerciseFilter, filterExercises, type MediaFilter } from "@/lib/insights";
import { storageGet, storageSet } from "@/lib/storage";
import type { Exercise } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Page } from "@/app/Page";
import { muscleLabel, useMeta } from "@/app/state";
import { openExerciseEditor } from "@/features/ExerciseEditor";
import { MediaTag, PageHead } from "@/ui/common";




function Thumb({ exercise }: { exercise: Exercise }) {
  if (exercise.media_loop) {
    return (
      <>
        <MediaTag name={exercise.media_loop} lazy />
        <span className="src">Own</span>
      </>
    );
  }
  if (exercise.video_id) {
    return (
      <>
        <img src={thumbUrl(exercise.video_id)} alt="" loading="lazy" />
        <span className="src">YouTube</span>
      </>
    );
  }
  if (exercise.media_muscles) return <MediaTag name={exercise.media_muscles} lazy />;
  return <span className="none">No media</span>;
}

function ExerciseCard({ exercise, onOpen }: { exercise: Exercise; onOpen: () => void }) {
  return (
    <button type="button" className={"ex-card" + (exercise.available ? "" : " unavailable")} onClick={onOpen}>
      <div className="thumb">
        <Thumb exercise={exercise} />
      </div>
      <div className="body">
        <b>{exercise.name}</b>
        <div className="meta">
          <span>{muscleLabel(exercise.primary_muscle) || "No target muscle"}</span>
          {exercise.program_count ? <span className="chip">in {plural(exercise.program_count, "program")}</span> : null}
          {exercise.media_muscles ? <span className="chip">Muscle image</span> : null}
          {exercise.available ? null : <span className="chip">Equipment missing</span>}
        </div>
      </div>
    </button>
  );
}

function ExercisesView({ exercises, openId }: { exercises: Exercise[]; openId: number | null }) {
  const navigate = useNavigate();
  const meta = useMeta();
  const [filter, setFilter] = useState<ExerciseFilter>(() => {
    const media = storageGet("ex-media", "");
    return { query: storageGet("ex-q", ""), muscle: storageGet("ex-m", ""), media: media === "none" || media === "used" ? media : "" };
  });
  const list = useMemo(() => filterExercises(exercises, filter), [exercises, filter]);
  const opened = useRef<number | null>(null);

  const update = (fields: Partial<ExerciseFilter>) => {
    setFilter((current) => {
      const next = { ...current, ...fields };
      storageSet("ex-q", next.query);
      storageSet("ex-m", next.muscle);
      storageSet("ex-media", next.media);
      return next;
    });
  };

  useEffect(() => {
    if (openId === null || opened.current === openId) return;
    const exercise = exercises.find((entry) => entry.id === openId);
    if (!exercise) return;
    opened.current = openId;
    openExerciseEditor(exercise, {
      onClose: () => {
        opened.current = null;
        void navigate("/exercises", { replace: true });
      },
    });
  }, [openId, exercises, navigate]);

  return (
    <>
      <PageHead
        title="Exercises"
        lead="Upload a short loop animation and a target muscle image for every exercise. Both appear large during your workout."
        actions={
          <button type="button" className="btn primary" onClick={() => openExerciseEditor(null, { onCreated: (created) => void navigate("/exercises/" + String(created.id)) })}>
            New exercise
          </button>
        }
      />
      <div className="toolbar">
        <input type="search" placeholder="Search" aria-label="Search exercises" value={filter.query} onChange={(event) => update({ query: event.target.value })} />
        <select aria-label="Muscle" value={filter.muscle} onChange={(event) => update({ muscle: event.target.value })}>
          <option value="">All muscles</option>
          {meta.muscles.map((muscle) => (
            <option key={muscle} value={muscle}>
              {muscleLabel(muscle)}
            </option>
          ))}
        </select>
        <select aria-label="Media" value={filter.media} onChange={(event) => update({ media: event.target.value as MediaFilter })}>
          <option value="">All</option>
          <option value="none">Without own media</option>
          <option value="used">Used in programs</option>
        </select>
        <span className="faint small" aria-live="polite">
          {list.length} of {exercises.length}
        </span>
      </div>
      <div className="ex-grid">
        {list.length ? (
          list.map((exercise) => <ExerciseCard key={exercise.id} exercise={exercise} onOpen={() => void navigate("/exercises/" + String(exercise.id))} />)
        ) : (
          <div className="empty">No exercise matches the filter.</div>
        )}
      </div>
    </>
  );
}

export function ExercisesPage() {
  const { exerciseId } = useParams();
  const resource = useResource((signal) => api.get<Exercise[]>("/api/exercises", { signal }), [], ["exercises"]);
  return (
    <Page ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <ExercisesView exercises={resource.data} openId={exerciseId ? Number(exerciseId) : null} />}
    </Page>
  );
}
