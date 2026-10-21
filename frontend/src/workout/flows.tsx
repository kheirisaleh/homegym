import { useState } from "react";
import { api } from "@/lib/api";
import { formatClock, num } from "@/lib/format";
import { invalidate } from "@/lib/store";
import type { CoachMessage, Persona, Program } from "@/lib/types";
import { programItemAmount } from "@/lib/workout";
import { refreshActive } from "@/app/state";
import { openCoach } from "@/coach/overlay";
import { preloadCoach, demoForPattern } from "@/three/coachEngine";
import { openModal } from "@/ui/modal";
import { errorToast } from "@/ui/toast";

export function firstDemoPattern(program: Pick<Program, "items">): string | null {
  const item = program.items.find((entry) => entry.measure !== "min" && entry.measure !== "none" && demoForPattern(entry.pattern));
  return item?.pattern ?? null;
}

export function PreviewList({ program }: { program: Program }) {
  return (
    <div className="preview-list">
      {program.items.map((item, index) => (
        <div key={String(item.id ?? index)} className="preview-item">
          <span className="n">{index + 1}</span>
          <div>
            <b>{item.name}</b>
            <div className="meta">
              {programItemAmount(item)}
              {item.track_weight && item.target_weight ? " · " + num(item.target_weight) + " kg" : ""}
              {item.rest_seconds ? " · rest " + formatClock(item.rest_seconds) : ""}
            </div>
            {item.cue ? <div className="cue">{item.cue}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export async function beginSession(day: string, programId: number | null): Promise<boolean> {
  try {
    const active = await api.get<unknown>("/api/sessions/active");
    if (!active) await api.post("/api/sessions", { day, program_id: programId });
    await refreshActive();
    invalidate("session");
    return true;
  } catch (error) {
    errorToast(error);
    return false;
  }
}

export function briefCoach(day: string, program: Program, persona: Persona | null, onGo: () => void): void {
  const brief = api.get<CoachMessage>("/api/coach/brief?day=" + day + "&program_id=" + String(program.id));
  brief.catch(() => undefined);
  openCoach({
    persona,
    load: () => brief,
    primary: "Let's go",
    secondary: "Not yet",
    onPrimary: onGo,
    demoPattern: firstDemoPattern(program),
  });
}

export async function startWorkoutFlow(day: string, programId: number | null, onStarted: () => void): Promise<void> {
  const active = await refreshActive().catch(() => null);
  if (active) {
    onStarted();
    return;
  }
  const begin = async () => {
    if (await beginSession(day, programId)) onStarted();
  };
  if (programId === null) {
    await begin();
    return;
  }
  let program: Program;
  let persona: Persona | null;
  try {
    [program, persona] = await Promise.all([api.get<Program>("/api/programs/" + String(programId)), api.get<Persona>("/api/coach/persona").catch(() => null)]);
  } catch (error) {
    errorToast(error);
    return;
  }
  if (persona) preloadCoach(persona.coach);
  openModal(
    (close) => (
      <>
        <div className="modal-head">
          <h2>{program.name}</h2>
        </div>
        {program.description ? <p className="muted">{program.description}</p> : null}
        <PreviewList program={program} />
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={close}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            data-autofocus
            onClick={() => {
              close();
              briefCoach(day, program, persona, () => void begin());
            }}
          >
            Start workout
          </button>
        </div>
      </>
    ),
    { wide: true, label: program.name },
  );
}

function PainNote({ onSave, onSkip }: { onSave: (text: string) => void; onSkip: () => void }) {
  const [text, setText] = useState("");
  return (
    <>
      <div className="modal-head">
        <h2>Where did it hurt?</h2>
      </div>
      <p className="muted">Your coach replaces or changes this exercise. Optional.</p>
      <label className="field">
        <textarea maxLength={300} placeholder="e.g. front of the right shoulder at the bottom" value={text} onChange={(event) => setText(event.target.value)} aria-label="Where did it hurt" />
      </label>
      <div className="modal-foot">
        <button type="button" className="btn ghost" onClick={onSkip}>
          Skip
        </button>
        <button type="button" className="btn primary" onClick={() => onSave(text.trim())}>
          Save
        </button>
      </div>
    </>
  );
}

export function painNote(): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const handle = openModal(
      (close) => (
        <PainNote
          onSave={(text) => {
            done = true;
            resolve(text.slice(0, 300));
            handle.close();
          }}
          onSkip={close}
        />
      ),
      {
        onClose: () => {
          if (!done) resolve("");
        },
      },
    );
  });
}

export function NoteDialog({ title, lead, placeholder, actionLabel, onSubmit, onCancel }: {
  title: string; lead: string; placeholder: string; actionLabel: string; onSubmit: (notes: string) => Promise<void>; onCancel: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="modal-head">
        <h2>{title}</h2>
      </div>
      <p className="muted">{lead}</p>
      <label className="field">
        <span>Note (optional)</span>
        <textarea placeholder={placeholder} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="modal-foot">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Keep training
        </button>
        <button
          type="button"
          className="btn primary"
          data-autofocus
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onSubmit(notes).catch((error: unknown) => {
              setBusy(false);
              errorToast(error);
            });
          }}
        >
          {actionLabel}
        </button>
      </div>
    </>
  );
}
