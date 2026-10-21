import { type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { parseReport } from "@/lib/coaching";
import { invalidate } from "@/lib/store";
import type { AiStatus, CoachKey, CoachSettings, LogEntry, Persona, User } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { logout } from "@/app/session";
import { muscleLabel, patchUser, refreshAiStatus, setUser, useMeta } from "@/app/state";
import { CoachPicker } from "@/coach/CoachPicker";
import { resetCoachPersona } from "@/coach/persona";
import { coachInfo } from "@/three/coachModels";
import { LogItem, Switch } from "@/ui/common";
import { confirmDialog } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";

export type CoachAction = "progress" | "review" | "deload" | "fatigue";

export async function runCoachAction(action: CoachAction, mobile: boolean): Promise<boolean> {
  try {
    if (action === "progress") {
      const result = await api.post<{ changes: unknown[] }>("/api/coach/progress");
      toast(result.changes.length ? String(result.changes.length) + " change(s)" : "No new changes");
    } else if (action === "review") {
      const ok = await confirmDialog(
        "Finish block",
        mobile
          ? "The block is reviewed now and a new one starts today. The AI coach may need a minute."
          : "The current block is reviewed now and a new one starts today. This can take a minute while the AI coach thinks.",
        "Finish block",
      );
      if (!ok) return false;
      toast("AI coach is reviewing the block");
      const result = await api.post<{ summary: string[] }>("/api/coach/review");
      toast(result.summary.join(" · "));
    } else if (action === "deload") {
      const result = await api.post<{ started: boolean }>("/api/coach/deload");
      toast(result.started ? "Deload started" : "Deload already running");
    } else {
      const result = await api.post<{ message: string }>("/api/coach/fatigue");
      toast(result.message);
    }
    invalidate("programs", "coach", "dashboard");
    return true;
  } catch (error) {
    errorToast(error);
    return false;
  }
}

export function useCoachAction(mobile: boolean) {
  const [busy, setBusy] = useState<CoachAction | null>(null);
  const run = async (action: CoachAction) => {
    setBusy(action);
    await runCoachAction(action, mobile);
    setBusy(null);
  };
  return { busy, run };
}


export function CoachLogFeed({ log, initial, step, mobile, footer }: { log: LogEntry[]; initial: number; step: number; mobile: boolean; footer?: ReactNode }) {
  const [limit, setLimit] = useState(initial);
  const undo = async (entry: LogEntry) => {
    const ok = await confirmDialog(
      "Undo change",
      mobile ? "The program goes back to the state before this change." : "The program goes back to the state before this change. Other changes from the same review are reset as well.",
      "Undo",
    );
    if (!ok) return;
    try {
      await api.post("/api/coach/log/" + String(entry.id) + "/undo");
      invalidate("programs", "coach");
      toast("Undone");
    } catch (error) {
      errorToast(error);
    }
  };
  const shown = log.slice(0, limit);
  return (
    <div className="feed">
      {shown.length ? shown.map((entry) => <LogItem key={entry.id} entry={entry} onUndo={(item) => void undo(item)} />) : <p className="muted">No entries yet.</p>}
      {log.length > limit ? (
        <button type="button" className={"btn ghost" + (mobile ? "" : " small show-older")} onClick={() => setLimit((value) => value + step)}>
          Show older
        </button>
      ) : null}
      {footer}
    </div>
  );
}

export function GoalsForm({ settings, mobile }: { settings: CoachSettings; mobile: boolean }) {
  const meta = useMeta();
  const [priority, setPriority] = useState(settings.priority_muscles);
  const [fatLoss, setFatLoss] = useState(settings.goal_fat_loss);
  const [cardio, setCardio] = useState(String(settings.cardio_target_min));
  const [weeks, setWeeks] = useState(settings.block_weeks);
  const [busy, setBusy] = useState(false);
  const muscles = meta.muscles.filter((muscle) => muscle !== "cardio" && muscle !== "mobility");
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/api/coach/settings", { priority_muscles: priority, goal_fat_loss: fatLoss, cardio_target_min: Number(cardio) || 0, block_weeks: weeks });
      invalidate("coach", "dashboard");
      toast("Goals saved. They apply from the next block review.");
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
    }
  };
  const chips = (
    <div className="chips">
      {muscles.map((muscle) => (
        <button
          key={muscle}
          type="button"
          className="chip"
          aria-pressed={priority.includes(muscle)}
          onClick={() => setPriority((list) => (list.includes(muscle) ? list.filter((entry) => entry !== muscle) : [...list, muscle]))}
        >
          {muscleLabel(muscle)}
        </button>
      ))}
    </div>
  );
  const fields = (
    <div className="form-grid goals-fields">
      <label className="field">
        <span>{mobile ? "Cardio min per week" : "Cardio target per week, min"}</span>
        <input type="number" inputMode="numeric" min={0} step={10} value={cardio} onChange={(event) => setCardio(event.target.value)} />
      </label>
      <label className="field">
        <span>Block length</span>
        <select value={weeks} onChange={(event) => setWeeks(Number(event.target.value))}>
          {[4, 5, 6].map((count) => (
            <option key={count} value={count}>
              {count} weeks{mobile ? "" : " incl. deload"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  if (mobile) {
    return (
      <div className="m-card">
        <h2>Your goals</h2>
        <span className="small muted">Priority muscles get more weekly sets</span>
        {chips}
        <div className="m-switch-row">
          <span>Fat loss focus</span>
          <Switch checked={fatLoss} onChange={setFatLoss} label="Fat loss focus" />
        </div>
        {fields}
        <button type="button" className="btn primary m-btn-xl" disabled={busy} onClick={() => void save()}>
          Save goals
        </button>
      </div>
    );
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Your goals</h2>
      </div>
      <div className="field">
        <span>Priority muscles get more volume (14 to 22 sets per week instead of 10 to 20)</span>
        {chips}
      </div>
      <label className="check goals-fat">
        <input type="checkbox" checked={fatLoss} onChange={(event) => setFatLoss(event.target.checked)} /> Fat loss, leaner face
      </label>
      <p className="small faint goals-note">
        Fat cannot be burned from the face alone. It drops together with total body fat. So the coach raises cardio when your weight stalls and reminds you of the calorie deficit.
      </p>
      {fields}
      <div className="modal-foot goals-foot">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          Save goals
        </button>
      </div>
    </section>
  );
}

interface AiView {
  color: string;
  label: string;
  help: string;
}

export function aiView(status: AiStatus | null, mobile: boolean): AiView {
  if (!status) return { color: "var(--chalk-3)", label: "unknown", help: "" };
  if (status.ready) return { color: "var(--plate-green)", label: "ready", help: mobile ? "Model " + status.model + " is ready." : "Installed models: " + status.models.join(", ") };
  if (status.reachable) return { color: "var(--plate-yellow)", label: "not ready", help: status.message || "The AI model is not ready yet." };
  return { color: "var(--plate-red)", label: "offline", help: status.message || "The AI service is not reachable." };
}

export function useAiCheck() {
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  const check = async (fresh: boolean) => {
    setStatus(undefined);
    setStatus(await refreshAiStatus(fresh));
  };
  useEffect(() => {
    let cancelled = false;
    void refreshAiStatus(false).then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { status, check };
}

export function AiState({ status, mobile }: { status: AiStatus | null | undefined; mobile: boolean }) {
  const view = status === undefined ? { color: "var(--chalk-3)", label: "checking" } : aiView(status, mobile);
  return (
    <span className="ai-state" role="status">
      <span className="dot" style={{ background: view.color }} />
      {view.label}
    </span>
  );
}

export function ReportView({ markdown }: { markdown: string }) {
  return (
    <>
      {parseReport(markdown).map((block, index) => {
        const key = String(index);
        if (block.kind === "h2") return <h2 key={key}>{block.text}</h2>;
        if (block.kind === "h3") return <h3 key={key}>{block.text}</h3>;
        if (block.kind === "h4") return <h4 key={key}>{block.text}</h4>;
        if (block.kind === "sub") return <div key={key} className="rep-sub">{block.text}</div>;
        if (block.kind === "item") {
          return (
            <div key={key} className="rep-item">
              {block.text.split(/`([^`]+)`/).map((part, position) => (position % 2 ? <code key={position}>{part}</code> : part))}
            </div>
          );
        }
        return <p key={key}>{block.text}</p>;
      })}
    </>
  );
}

export function TrainingBrief() {
  const report = useResource((signal) => api.get<{ report: string | null }>("/api/me/report", { signal }), []);
  if (!report.data) return <p className="muted">{report.error ? "The brief could not be loaded." : "Loading"}</p>;
  return report.data.report ? <ReportView markdown={report.data.report} /> : <p className="muted">No brief stored for this account.</p>;
}

export async function deleteAccount(user: Pick<User, "id" | "name">): Promise<void> {
  const ok = await confirmDialog("Delete " + user.name, "All workouts, programs and body data of " + user.name + " are deleted for good.", "Delete account", true);
  if (!ok) return;
  try {
    await api.delete("/api/users/" + String(user.id));
    setUser(null);
    logout();
  } catch (error) {
    errorToast(error);
  }
}

export interface ProfileDraft {
  name: string;
  age: string;
  height: string;
  weight: string;
  color: string;
}

export function profileDraft(user: User): ProfileDraft {
  return {
    name: user.name,
    age: user.age === null ? "" : String(user.age),
    height: user.height_cm === null ? "" : String(user.height_cm),
    weight: user.weight_kg === null ? "" : String(user.weight_kg),
    color: user.color,
  };
}

export async function saveProfile(draft: ProfileDraft): Promise<void> {
  const value = (text: string) => (text.trim() ? Number(text) : null);
  try {
    const updated = await api.put<User>("/api/me", {
      name: draft.name.trim(),
      age: value(draft.age),
      height_cm: value(draft.height),
      weight_kg: value(draft.weight),
      color: draft.color,
    });
    setUser(updated);
    invalidate("user");
    toast("Profile saved");
  } catch (error) {
    errorToast(error);
  }
}

export function ProfileFields({ draft, onChange, mobile }: { draft: ProfileDraft; onChange: (draft: ProfileDraft) => void; mobile: boolean }) {
  const set = (fields: Partial<ProfileDraft>) => onChange({ ...draft, ...fields });
  return (
    <div className="form-grid">
      <label className={"field" + (mobile ? " span-2" : "")}>
        <span>Name</span>
        <input type="text" value={draft.name} onChange={(event) => set({ name: event.target.value })} />
      </label>
      <label className="field">
        <span>Age</span>
        <input type="number" inputMode="numeric" min={10} max={100} value={draft.age} onChange={(event) => set({ age: event.target.value })} />
      </label>
      <label className="field">
        <span>Height cm</span>
        <input type="number" inputMode="numeric" min={100} max={250} value={draft.height} onChange={(event) => set({ height: event.target.value })} />
      </label>
      <label className="field">
        <span>Weight kg</span>
        <input type="number" inputMode="decimal" step="0.1" min={30} max={300} value={draft.weight} onChange={(event) => set({ weight: event.target.value })} />
      </label>
      <label className="field">
        <span>Colour</span>
        <input type="color" value={draft.color} onChange={(event) => set({ color: event.target.value })} />
      </label>
    </div>
  );
}

export function TrainerSettings({ mobile }: { mobile: boolean }) {
  const persona = useResource((signal) => api.get<Persona>("/api/coach/persona", { signal }), [], ["user"]);
  const [current, setCurrent] = useState<CoachKey | null>(null);
  const active = current ?? persona.data?.coach ?? null;
  const pick = async (key: CoachKey) => {
    if (key === active) return;
    try {
      await api.put("/api/coach/persona", { coach: key });
      setCurrent(key);
      patchUser({ coach: key });
      resetCoachPersona();
      invalidate("coach", "dashboard");
      toast("Your coach is now " + coachInfo(key).name);
    } catch (error) {
      errorToast(error);
    }
  };
  if (!persona.data) return <div className="skeleton" aria-busy="true" />;
  const info = active ? coachInfo(active) : null;
  return (
    <section className="trainer-settings">
      {mobile ? <p className="muted trainer-lead">Tap a coach to meet them. The choice is saved right away.</p> : null}
      <CoachPicker current={active} onPick={(key) => void pick(key)} />
      {info ? (
        <p className="small muted trainer-note" aria-live="polite">
          <b>{info.name}</b> is your coach. {info.style}
        </p>
      ) : null}
    </section>
  );
}
