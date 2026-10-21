import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "@/lib/api";
import { cssVar, plateColor } from "@/lib/catalog";
import { EFFORT_LABELS, formatDay, formatSet, fromIso, MEASURE_UNITS, num, todayIso } from "@/lib/format";
import { storageGet, storageSet } from "@/lib/storage";
import { invalidate } from "@/lib/store";
import type { BodyEntry, BodyTrend, Dashboard, Exercise, ExerciseHistory, Session, SessionSummary } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { sessionSetCount } from "@/lib/workout";
import { useTopBar } from "@/app/MobileShell";
import { Page } from "@/app/Page";
import { BarChart, LineChart, type Series } from "@/ui/charts";
import { useEnter } from "@/ui/motion";
import { errorToast, toast } from "@/ui/toast";
import { useSessionActions } from "../desktop/SessionDetail";

type Tab = "strength" | "exercise" | "history" | "body";

const TABS: [Tab, string][] = [
  ["strength", "Strength"],
  ["exercise", "Exercise"],
  ["history", "Workouts"],
  ["body", "Body"],
];

function Loading() {
  return <div className="skeleton" aria-busy="true" />;
}

function StrengthTab() {
  const resource = useResource((signal) => api.get<Dashboard>("/api/dashboard?today=" + todayIso(), { signal }), [], ["dashboard", "session"]);
  const data = resource.data;
  const indexLabels = useMemo(() => (data ? data.strength_index.map((point) => point.week) : []), [data]);
  const indexSeries = useMemo<Series[]>(
    () => (data ? [{ label: "Strength index", data: data.strength_index.map((point) => point.value), color: cssVar("--accent-line"), pointRadius: 0 }] : []),
    [data],
  );
  const weekLabels = useMemo(() => (data ? data.weekly.map((week) => week.week) : []), [data]);
  const weekSeries = useMemo<Series[]>(() => (data ? [{ label: "Volume", data: data.weekly.map((week) => week.volume), color: cssVar("--plate-blue") }] : []), [data]);
  if (!data) return <Loading />;
  const last = data.strength_index.at(-1);
  if (!last) return <div className="empty">Log sets with weight and your strength curve appears here.</div>;
  const gains = [...data.strength].sort((left, right) => right.change - left.change).slice(0, 8);
  return (
    <>
      <div className="m-hero">
        <span className="when">Strength compared with your start</span>
        <h1>{num(last.value, 0)} %</h1>
        <LineChart className="m-chart" labels={indexLabels} series={indexSeries} unit="%" />
      </div>
      <div className="m-section-title">Biggest gains</div>
      <div className="m-list">
        {gains.map((entry, index) => (
          <div key={entry.id} className="m-item">
            <span className="dot" style={{ background: plateColor(index) }} />
            <span className="grow">
              <b>{entry.name}</b>
              <span>{num(entry.last)} kg 1RM</span>
            </span>
            <b className={entry.change >= 0 ? "delta up" : "delta down"}>
              {entry.change >= 0 ? "+" : ""}
              {num(entry.change * 100, 0)} %
            </b>
          </div>
        ))}
      </div>
      <div className="m-card">
        <h2>Weekly volume</h2>
        <BarChart className="m-chart" labels={weekLabels} series={weekSeries} unit="kg" />
      </div>
    </>
  );
}

function ExerciseChart({ history }: { history: ExerciseHistory }) {
  const weighted = history.exercise.track_weight && history.exercise.measure === "reps";
  const entries = useMemo(() => [...history.entries].reverse(), [history.entries]);
  const labels = useMemo(() => entries.map((entry) => entry.day), [entries]);
  const series = useMemo<Series[]>(() => [{ label: weighted ? "Estimated 1RM" : "Best", data: entries.map((entry) => entry.metric), color: cssVar("--accent-line") }], [entries, weighted]);
  return (
    <>
      {entries.length ? (
        <div className="m-card">
          <LineChart className="m-chart" labels={labels} series={series} unit={weighted ? "kg" : MEASURE_UNITS[history.exercise.measure]} />
        </div>
      ) : null}
      <div className="m-list">
        {history.entries.map((entry) => (
          <Link key={entry.id} className="m-item" to={"/m/progress/session/" + String(entry.session_id)}>
            <span className="grow">
              <b>{formatDay(entry.day, false)}</b>
              <span>{entry.sets.map((set) => formatSet(set, entry.measure, entry.track_weight)).join(", ")}</span>
            </span>
            <b className="num">{num(entry.metric)}</b>
          </Link>
        ))}
      </div>
    </>
  );
}

function ExerciseTab() {
  const exercises = useResource((signal) => api.get<Exercise[]>("/api/exercises", { signal }), [], ["exercises", "session"]);
  const logged = useMemo(() => (exercises.data ?? []).filter((exercise) => exercise.times_logged > 0), [exercises.data]);
  const [picked, setPicked] = useState(() => Number(storageGet("m-progress-ex", "0")));
  const selected = logged.some((exercise) => exercise.id === picked) ? picked : logged[0]?.id ?? null;
  const history = useResource(
    (signal) => (selected === null ? Promise.resolve(null) : api.get<ExerciseHistory>("/api/exercises/" + String(selected) + "/history", { signal })),
    [selected],
    ["session"],
  );
  if (!exercises.data) return <Loading />;
  if (!logged.length) return <div className="empty">No logged exercises yet.</div>;
  return (
    <>
      <select
        aria-label="Exercise"
        value={selected ?? ""}
        onChange={(event) => {
          setPicked(Number(event.target.value));
          storageSet("m-progress-ex", event.target.value);
        }}
      >
        {logged.map((exercise) => (
          <option key={exercise.id} value={exercise.id}>
            {exercise.name}
          </option>
        ))}
      </select>
      {history.data ? <ExerciseChart key={history.data.exercise.id} history={history.data} /> : <Loading />}
    </>
  );
}

function HistoryTab() {
  const sessions = useResource((signal) => api.get<SessionSummary[]>("/api/sessions?limit=300", { signal }), [], ["session"]);
  if (!sessions.data) return <Loading />;
  if (!sessions.data.length) return <div className="empty">No workouts yet.</div>;
  return (
    <div className="m-list">
      {sessions.data.map((session) => (
        <Link key={session.id} className="m-item" to={"/m/progress/session/" + String(session.id)}>
          <span className="grow">
            <b>{session.program_name}</b>
            <span>
              {formatDay(session.day)}, {session.sets_done} sets{session.status === "active" ? ", in progress" : ""}
            </span>
          </span>
          <span className="chev" aria-hidden="true">
            ›
          </span>
        </Link>
      ))}
    </div>
  );
}

interface BodyLog {
  entries: BodyEntry[];
  trend: BodyTrend | null;
}

function BodyForm({ existing }: { existing: BodyEntry | undefined }) {
  const [weight, setWeight] = useState(existing?.weight_kg === null || existing?.weight_kg === undefined ? "" : String(existing.weight_kg));
  const [waist, setWaist] = useState(existing?.waist_cm === null || existing?.waist_cm === undefined ? "" : String(existing.waist_cm));
  const save = async () => {
    try {
      await api.put("/api/body", { day: todayIso(), weight_kg: weight ? Number(weight) : null, waist_cm: waist ? Number(waist) : null });
      invalidate("dashboard");
      toast("Saved");
    } catch (error) {
      errorToast(error);
    }
  };
  return (
    <div className="m-card">
      <h2>Log today</h2>
      <div className="form-grid">
        <label className="field">
          <span>Weight kg</span>
          <input type="number" inputMode="decimal" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} />
        </label>
        <label className="field">
          <span>Waist cm</span>
          <input type="number" inputMode="decimal" step="0.5" value={waist} onChange={(event) => setWaist(event.target.value)} />
        </label>
      </div>
      <button type="button" className="btn primary" onClick={() => void save()}>
        Save
      </button>
    </div>
  );
}

function BodyTab() {
  const resource = useResource((signal) => api.get<BodyLog>("/api/body", { signal }), [], ["dashboard"]);
  const entries = useMemo(
    () => (resource.data?.entries ?? []).filter((entry): entry is BodyEntry & { weight_kg: number } => entry.weight_kg !== null),
    [resource.data],
  );
  const labels = useMemo(() => entries.map((entry) => entry.day), [entries]);
  const series = useMemo<Series[]>(() => {
    const average = entries.map((entry) => {
      const day = fromIso(entry.day).getTime();
      const window = entries.filter((other) => {
        const diff = (day - fromIso(other.day).getTime()) / 86400000;
        return diff >= 0 && diff < 7;
      });
      return window.reduce((sum, other) => sum + other.weight_kg, 0) / window.length;
    });
    return [
      { label: "Weight", data: entries.map((entry) => entry.weight_kg), color: cssVar("--chalk-3"), borderWidth: 1, pointRadius: 2 },
      { label: "7 day average", data: average, color: cssVar("--plate-green"), pointRadius: 0 },
    ];
  }, [entries]);
  if (!resource.data) return <Loading />;
  const today = todayIso();
  const trend = resource.data.trend;
  return (
    <>
      <BodyForm existing={resource.data.entries.find((entry) => entry.day === today)} />
      {entries.length > 1 ? (
        <div className="m-card">
          <h2>Trend</h2>
          <LineChart className="m-chart" labels={labels} series={series} unit="kg" />
          {trend && trend.weekly_rate !== null ? (
            <p className="small muted">
              {trend.weekly_rate > 0 ? "+" : ""}
              {num(trend.weekly_rate * 100, 2)} % per week
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function ProgressPage() {
  useTopBar({ title: "Progress" });
  const [tab, setTab] = useState<Tab>(() => {
    const saved = storageGet("m-progress-tab", "strength");
    return saved === "exercise" || saved === "history" || saved === "body" ? saved : "strength";
  });
  const body = useRef<HTMLDivElement>(null);
  useEnter(body, true, tab);
  return (
    <Page mobile ready>
      {() => (
        <>
          <div className="m-tabs-inline" role="tablist" aria-label="Progress views">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-pressed={tab === key}
                onClick={() => {
                  storageSet("m-progress-tab", key);
                  setTab(key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="m-progress-body" ref={body} role="tabpanel">
            {tab === "strength" ? <StrengthTab /> : tab === "exercise" ? <ExerciseTab /> : tab === "history" ? <HistoryTab /> : <BodyTab />}
          </div>
        </>
      )}
    </Page>
  );
}

function SessionView({ session }: { session: Session }) {
  useTopBar({ title: session.program_name, back: "/m/progress" });
  const { reopen, remove } = useSessionActions(session, "/m/train", "/m/progress");
  return (
    <>
      <div className="m-card flat">
        <b>{formatDay(session.day)}</b>
        <span className="muted small">
          {sessionSetCount(session.exercises)} sets{session.deload ? ", deload" : ""}
        </span>
        {session.notes ? <p>{session.notes}</p> : null}
      </div>
      {session.exercises.map((item) => (
        <div key={item.id} className="m-card">
          <div className="m-card-head">
            <h2>{item.exercise_name}</h2>
            <span className="muted small">
              {item.sets.length}/{item.planned_sets}
            </span>
          </div>
          {item.sets.length ? (
            item.sets.map((set) => (
              <div key={set.id} className="m-switch-row">
                <span className="num">{formatSet(set, item.measure, item.track_weight)}</span>
                <span className="muted small">{set.effort ? EFFORT_LABELS[set.effort] : ""}</span>
              </div>
            ))
          ) : (
            <span className="muted small">Not done</span>
          )}
        </div>
      ))}
      <div className="m-row-actions">
        {session.status === "done" ? (
          <button type="button" className="btn" onClick={() => void reopen()}>
            Reopen
          </button>
        ) : (
          <Link className="btn primary" to="/m/train">
            Continue
          </Link>
        )}
        <button type="button" className="btn danger" onClick={() => void remove()}>
          Delete
        </button>
      </div>
    </>
  );
}

export function SessionPage() {
  const { sessionId = "" } = useParams();
  const resource = useResource((signal) => api.get<Session>("/api/sessions/" + sessionId, { signal }), [sessionId]);
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <SessionView session={resource.data} />}
    </Page>
  );
}
