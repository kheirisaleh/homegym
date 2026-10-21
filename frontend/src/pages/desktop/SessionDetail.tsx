import { Link, useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { EFFORT_LABELS, formatDay, formatSet, num, plural } from "@/lib/format";
import { invalidate } from "@/lib/store";
import type { Session } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { sessionSetCount, sessionVolume } from "@/lib/workout";
import { Page } from "@/app/Page";
import { activeStore, refreshActive } from "@/app/state";
import { PageHead } from "@/ui/common";
import { confirmDialog } from "@/ui/modal";
import { errorToast } from "@/ui/toast";
import { sessionMinutes } from "@/workout/controller";

export function sessionLead(session: Session): string {
  return formatDay(session.day) + (session.block_week ? ", week " + String(session.block_week) + " of the block" : "") + (session.deload ? ", deload" : "");
}

export function useSessionActions(session: Session | undefined, trainingPath: string, afterDelete: string) {
  const navigate = useNavigate();
  const reopen = async () => {
    if (!session) return;
    try {
      await api.post("/api/sessions/" + String(session.id) + "/reopen");
      await refreshActive();
      invalidate("session", "dashboard");
      void navigate(trainingPath);
    } catch (error) {
      errorToast(error);
    }
  };
  const remove = async () => {
    if (!session) return;
    const ok = await confirmDialog("Delete workout", "All sets of this workout will be deleted.", "Delete", true);
    if (!ok) return;
    try {
      await api.delete("/api/sessions/" + String(session.id));
      if (activeStore.get()?.id === session.id) activeStore.set(null);
      invalidate("session", "dashboard", "programs");
      void navigate(afterDelete);
    } catch (error) {
      errorToast(error);
    }
  };
  return { reopen, remove };
}

function Detail({ session }: { session: Session }) {
  const { reopen, remove } = useSessionActions(session, "/training", "/history");
  const minutes = session.finished_at ? sessionMinutes(session) : null;
  return (
    <>
      <PageHead
        back={
          <Link className="btn ghost small" to="/history">
            History
          </Link>
        }
        title={session.program_name}
        lead={sessionLead(session)}
        actions={
          <>
            {session.status === "done" ? (
              <button type="button" className="btn" onClick={() => void reopen()}>
                Reopen
              </button>
            ) : (
              <Link className="btn primary" to="/training">
                Continue workout
              </Link>
            )}
            <button type="button" className="btn ghost danger" onClick={() => void remove()}>
              Delete
            </button>
          </>
        }
      />
      <div className="editor-summary">
        <span>
          <b>{sessionSetCount(session.exercises)}</b>sets
        </span>
        <span>
          <b>{num(sessionVolume(session.exercises) / 1000, 2)}</b>tonnes
        </span>
        {minutes !== null ? (
          <span>
            <b>{minutes}</b>minutes
          </span>
        ) : null}
      </div>
      {session.notes ? <p className="cues session-notes">{session.notes}</p> : null}
      <div className="session-list">
        {session.exercises.map((item) => (
          <div key={item.id} className="panel">
            <div className="panel-head">
              <h3>{item.exercise_name}</h3>
              <span className="hint">
                {item.sets.length} of {plural(item.planned_sets, "set")} · target {item.target || "free"}
              </span>
            </div>
            {item.sets.length ? (
              <table className="sets-table">
                <tbody>
                  {item.sets.map((set) => (
                    <tr key={set.id}>
                      <td className="faint set-number">{set.set_number}</td>
                      <td className="num">{formatSet(set, item.measure, item.track_weight)}</td>
                      <td>{set.effort ? EFFORT_LABELS[set.effort] : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">Not done</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export function SessionDetailPage() {
  const { sessionId = "" } = useParams();
  const resource = useResource((signal) => api.get<Session>("/api/sessions/" + sessionId, { signal }), [sessionId]);
  return (
    <Page ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <Detail session={resource.data} />}
    </Page>
  );
}
