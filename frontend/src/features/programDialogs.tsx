import { useState } from "react";
import { api } from "@/lib/api";
import { invalidate } from "@/lib/store";
import type { RebuildState } from "@/lib/types";
import { gateStore } from "@/app/session";
import { userStore } from "@/app/state";
import { confirmDialog, openModal } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";

function RebuildForm({ reasons, onDone, onCancel }: { reasons: RebuildState["reasons"]; onDone: () => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [details, setDetails] = useState("");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/api/me/rebuild", { reasons: picked, details: details.trim(), keep_schedule: keep });
      onDone();
    } catch (error) {
      setBusy(false);
      errorToast(error);
    }
  };
  return (
    <>
      <div className="modal-head">
        <h2>What should change?</h2>
      </div>
      <p className="muted">Pick everything that applies. The more your coach knows, the better the new program.</p>
      <div className="rebuild-reasons">
        {reasons.map((reason) => (
          <label key={reason.key}>
            <input
              type="checkbox"
              checked={picked.includes(reason.key)}
              onChange={(event) => setPicked((list) => (event.target.checked ? [...list, reason.key] : list.filter((key) => key !== reason.key)))}
            />{" "}
            {reason.label}
          </label>
        ))}
      </div>
      <label className="field">
        <span>In your own words (optional)</span>
        <textarea
          maxLength={1000}
          placeholder="e.g. I never feel the incline press in my chest, I want more arm work, my knee hurts on lunges"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
        />
      </label>
      <label className="field inline">
        <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} /> <span>Keep my training days and the focus of each day</span>
      </label>
      <div className="modal-foot">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
          Build my new program
        </button>
      </div>
    </>
  );
}

export async function rebuildDialog(): Promise<void> {
  let info: RebuildState;
  try {
    info = await api.get<RebuildState>("/api/me/rebuild");
  } catch (error) {
    errorToast(error);
    return;
  }
  if (info.running) {
    toast("Your coach is already working on a new program");
    return;
  }
  const ok = await confirmDialog(
    "Build a new program?",
    "Your coach designs a new program from your workout history, your feedback and your exact equipment. Your current program is saved and you can switch back at any time.",
    "Yes, continue",
  );
  if (!ok) return;
  const handle = openModal((close) => (
    <RebuildForm
      reasons={info.reasons}
      onCancel={close}
      onDone={() => {
        handle.close();
        const user = userStore.get();
        if (user) gateStore.set({ kind: "generating", user: { ...user, status: "generating", status_message: "Your coach is preparing" } });
      }}
    />
  ));
}

export async function restoreDialog(onDone?: () => void): Promise<void> {
  const ok = await confirmDialog("Switch back?", "Your previous program becomes active again. The current one is kept and you can switch back.", "Restore previous program");
  if (!ok) return;
  try {
    await api.post("/api/me/rebuild/restore");
    invalidate("programs");
    toast("Previous program restored");
    onDone?.();
  } catch (error) {
    errorToast(error);
  }
}

function RedesignForm({ programId, onDone, onCancel }: { programId: number; onDone: (items: string[]) => void; onCancel: () => void }) {
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ items: string[] }>("/api/coach/redesign/" + String(programId), { instruction: wish });
      onDone(result.items);
    } catch (error) {
      setBusy(false);
      errorToast(error);
    }
  };
  return (
    <>
      <div className="modal-head">
        <h2>Redesign program</h2>
      </div>
      <p className="muted">
        The AI coach rebuilds the program from your exercises and equipment and keeps exercises that still bring progress. Weights you reached are carried over. The old version stays saved and can be restored.
      </p>
      <label className="field">
        <span>Wish (optional)</span>
        <textarea placeholder="e.g. more focus on the long head of the biceps, at most 45 minutes" value={wish} onChange={(event) => setWish(event.target.value)} />
      </label>
      <div className="modal-foot">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" data-autofocus disabled={busy} onClick={() => void submit()}>
          {busy ? "AI coach is thinking" : "Redesign"}
        </button>
      </div>
    </>
  );
}

export function redesignDialog(programId: number, onDone?: () => void): void {
  const handle = openModal((close) => (
    <RedesignForm
      programId={programId}
      onCancel={close}
      onDone={(items) => {
        handle.close();
        invalidate("programs", "coach");
        toast("Redesigned: " + items.join(", "));
        onDone?.();
      }}
    />
  ));
}
