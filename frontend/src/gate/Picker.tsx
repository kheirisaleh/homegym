import { useState } from "react";
import { api } from "@/lib/api";
import { relativeDay } from "@/lib/format";
import type { UserSummary } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { gateStore, selectUser } from "@/app/session";
import { setUser, userStore } from "@/app/state";
import { Avatar, LoadError } from "@/ui/common";
import { BrandMark } from "@/ui/icons";
import { confirmDialog } from "@/ui/modal";
import { errorToast } from "@/ui/toast";

export function Picker({ mobile }: { mobile: boolean }) {
  const users = useResource((signal) => api.get<UserSummary[]>("/api/users", { signal }), []);
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  if (users.error) return <LoadError error={users.error} onRetry={users.reload} />;
  const list = users.data ?? [];
  const hasUsers = list.length > 0;

  const pick = async (user: UserSummary) => {
    if (managing) {
      const ok = await confirmDialog("Delete " + user.name, "All workouts, programs and body data of " + user.name + " are deleted for good.", "Delete profile", true);
      if (!ok) return;
      try {
        await api.delete("/api/users/" + String(user.id));
        if (userStore.get()?.id === user.id) setUser(null);
        users.reload();
      } catch (error) {
        errorToast(error);
      }
      return;
    }
    setBusy(user.id);
    try {
      await selectUser(user.id);
    } catch (error) {
      errorToast(error);
      setBusy(null);
    }
  };

  return (
    <div className={"gate-inner picker" + (managing ? " managing" : "")}>
      <div className="gate-brand">
        <BrandMark />
        <span>Home Gym</span>
      </div>
      <h1>{managing ? "Tap a profile to delete it" : hasUsers || users.loading ? "Who is training?" : "Welcome to the gym"}</h1>
      {hasUsers ? (
        <div className="user-grid">
          {list.map((user) => (
            <button key={user.id} type="button" className="user-card" disabled={busy !== null} aria-busy={busy === user.id} onClick={() => void pick(user)}>
              <Avatar name={user.name} color={user.color} size="big" />
              <span className="user-name">{user.name}</span>
              <span className="user-meta">
                {user.status === "ready" ? (user.workouts ? String(user.workouts) + " workouts, last " + (user.last_day ? relativeDay(user.last_day) : "") : "No workouts yet") : "Program is being written"}
              </span>
            </button>
          ))}
        </div>
      ) : users.loading ? null : (
        <p className="gate-lead">Answer a few questions and the AI coach writes your first program.</p>
      )}
      <button type="button" className="btn primary big gate-new" onClick={() => gateStore.set({ kind: "onboarding", hasUsers })}>
        {hasUsers ? "I am new here" : "Start"}
      </button>
      {hasUsers ? (
        <button type="button" className="btn ghost gate-manage" onClick={() => setManaging((value) => !value)}>
          {managing ? "Done" : "Delete a profile"}
        </button>
      ) : null}
      {mobile ? null : <p className="gate-foot">No passwords. Just pick your name.</p>}
    </div>
  );
}
