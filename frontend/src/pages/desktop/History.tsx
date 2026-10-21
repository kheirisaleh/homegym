import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { cssVar } from "@/lib/catalog";
import { formatDay, formatSet, MEASURE_UNITS, MONTHS, num, plural, toIso, todayIso, WEEKDAYS_SHORT } from "@/lib/format";
import { calendarDays, firstOfMonth, groupByMonth } from "@/lib/insights";
import { storageGet, storageSet } from "@/lib/storage";
import type { Exercise, ExerciseHistory, SessionSummary } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Page } from "@/app/Page";
import { BarChart, LineChart, type Series } from "@/ui/charts";
import { PageHead } from "@/ui/common";
import { confirmDialog } from "@/ui/modal";
import { startWorkoutFlow } from "@/workout/flows";

type Tab = "calendar" | "list" | "progress";

const TABS: [Tab, string][] = [
  ["calendar", "Calendar"],
  ["list", "Workouts"],
  ["progress", "Exercise progress"],
];

let rememberedMonth: Date | null = null;



function Calendar() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => rememberedMonth ?? firstOfMonth(new Date()));
  const days = useMemo(() => calendarDays(month), [month]);
  const start = toIso(days[0] ?? month);
  const end = toIso(days[days.length - 1] ?? month);
  const sessions = useResource((signal) => api.get<SessionSummary[]>("/api/sessions?start=" + start + "&end=" + end + "&limit=500", { signal }), [start, end], ["session"]);
  const byDay = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of sessions.data ?? []) map.set(session.day, [...(map.get(session.day) ?? []), session]);
    return map;
  }, [sessions.data]);
  const today = todayIso();
  const move = (offset: number) => {
    const next = offset === 0 ? firstOfMonth(new Date()) : new Date(month.getFullYear(), month.getMonth() + offset, 1);
    rememberedMonth = next;
    setMonth(next);
  };
  const open = async (day: string) => {
    const list = byDay.get(day) ?? [];
    const first = list[0];
    if (first) {
      void navigate("/history/training/" + String(first.id));
      return;
    }
    const ok = await confirmDialog("Log a workout", "Start or backfill a workout for " + formatDay(day) + "?", "Create workout");
    if (ok) void startWorkoutFlow(day, null, () => void navigate("/training"));
  };
  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn icon" aria-label="Previous month" onClick={() => move(-1)}>
          ‹
        </button>
        <h2 className="cal-title" aria-live="polite">
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </h2>
        <button type="button" className="btn icon" aria-label="Next month" onClick={() => move(1)}>
          ›
        </button>
        <button type="button" className="btn ghost small" onClick={() => move(0)}>
          Today
        </button>
      </div>
      <div className={"calendar" + (sessions.loading ? " loading" : "")}>
        {WEEKDAYS_SHORT.map((day) => (
          <div key={day} className="dow">
            {day}
          </div>
        ))}
        {days.map((date) => {
          const iso = toIso(date);
          const list = byDay.get(iso) ?? [];
          return (
            <button
              key={iso}
              type="button"
              className={"cal-day" + (date.getMonth() !== month.getMonth() ? " other" : "") + (iso === today ? " is-today" : "")}
              aria-label={formatDay(iso) + (list.length ? ", " + list.map((session) => session.program_name).join(", ") : "")}
              onClick={() => void open(iso)}
            >
              <span className="d">{date.getDate()}</span>
              {list.map((session) => (
                <span key={session.id} className={"s" + (session.status === "active" ? " active" : "")}>
                  {session.program_name}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </>
  );
}


function WorkoutList() {
  const sessions = useResource((signal) => api.get<SessionSummary[]>("/api/sessions?limit=1000", { signal }), [], ["session"]);
  if (!sessions.data) return <div className="skeleton" aria-busy="true" />;
  if (!sessions.data.length) {
    return (
      <div className="empty">
        No workouts logged yet.
        <br />
        <Link className="btn primary" to="/training">
          Start your first workout
        </Link>
      </div>
    );
  }
  return (
    <>
      {groupByMonth(sessions.data).map(([key, list]) => {
        const [year = 0, monthNumber = 1] = key.split("-").map(Number);
        return (
          <section key={key} className="history-month">
            <h2>
              {MONTHS[monthNumber - 1]} {year} <span className="muted small">{plural(list.length, "workout")}</span>
            </h2>
            <div className="session-list">
              {list.map((session) => (
                <Link key={session.id} className="session-row" to={"/history/training/" + String(session.id)}>
                  <span>{formatDay(session.day)}</span>
                  <span>
                    <b>{session.program_name}</b>
                    {session.deload ? <span className="deload-flag small"> Deload</span> : null}
                    {session.status === "active" ? <span className="chip priority">in progress</span> : null}
                  </span>
                  <span className="num">
                    {session.sets_done}/{session.sets_planned} <span className="small faint">sets</span>
                  </span>
                  <span className="num">
                    {num(session.volume / 1000, 2)} <span className="small faint">t</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function ProgressChart({ history }: { history: ExerciseHistory }) {
  const exercise = history.exercise;
  const weighted = exercise.track_weight && exercise.measure === "reps";
  const unit = weighted ? "kg" : MEASURE_UNITS[exercise.measure];
  const entries = useMemo(() => [...history.entries].reverse(), [history.entries]);
  const best = Math.max(0, ...entries.map((entry) => entry.metric ?? 0));
  const labels = useMemo(() => entries.map((entry) => entry.day), [entries]);
  const series = useMemo<Series[]>(() => {
    const list: Series[] = [{ label: weighted ? "Estimated 1RM" : "Best", data: entries.map((entry) => entry.metric), color: cssVar("--plate-yellow") }];
    if (weighted) list.push({ label: "Heaviest set", data: entries.map((entry) => entry.top_weight), color: cssVar("--plate-blue"), borderDash: [5, 5] });
    return list;
  }, [entries, weighted]);
  const volume = useMemo<Series[]>(() => [{ label: "Volume", data: entries.map((entry) => entry.volume), color: cssVar("--rubber-2") }], [entries]);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{exercise.name}</h2>
        <span className="hint">
          {plural(entries.length, "workout")} · best {num(best)} {unit}
          {weighted ? " 1RM" : ""}
        </span>
      </div>
      {entries.length ? <LineChart labels={labels} series={series} unit={unit} /> : null}
      {weighted && entries.length ? (
        <>
          <h3 className="chart-subtitle">Volume per workout</h3>
          <BarChart className="chart-box tiny" labels={labels} series={volume} unit="kg" />
        </>
      ) : null}
      <table className="progress-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Program</th>
            <th>Sets</th>
            <th>{weighted ? "Estimated 1RM" : "Best"}</th>
          </tr>
        </thead>
        <tbody>
          {history.entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <Link to={"/history/training/" + String(entry.session_id)}>{formatDay(entry.day, false)}</Link>
              </td>
              <td>
                {entry.program_name}
                {entry.deload ? <span className="deload-flag small"> Deload</span> : null}
              </td>
              <td>{entry.sets.map((set) => formatSet(set, entry.measure, entry.track_weight)).join(", ")}</td>
              <td className="num">{num(entry.metric)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExerciseProgress() {
  const exercises = useResource((signal) => api.get<Exercise[]>("/api/exercises", { signal }), [], ["exercises", "session"]);
  const logged = useMemo(() => (exercises.data ?? []).filter((exercise) => exercise.times_logged > 0), [exercises.data]);
  const [picked, setPicked] = useState(() => Number(storageGet("progress-ex", "0")));
  const selected = logged.some((exercise) => exercise.id === picked) ? picked : logged[0]?.id ?? null;
  const history = useResource(
    (signal) => (selected === null ? Promise.resolve(null) : api.get<ExerciseHistory>("/api/exercises/" + String(selected) + "/history", { signal })),
    [selected],
    ["session"],
  );
  if (!exercises.data) return <div className="skeleton" aria-busy="true" />;
  if (!logged.length) return <div className="empty">Once you have logged sets you see the progress of every exercise here.</div>;
  return (
    <>
      <div className="toolbar">
        <select
          className="progress-select"
          aria-label="Exercise"
          value={selected ?? ""}
          onChange={(event) => {
            setPicked(Number(event.target.value));
            storageSet("progress-ex", event.target.value);
          }}
        >
          {logged.map((exercise) => (
            <option key={exercise.id} value={exercise.id}>
              {exercise.name}
            </option>
          ))}
        </select>
      </div>
      {history.data ? <ProgressChart key={history.data.exercise.id} history={history.data} /> : <div className="skeleton" aria-busy="true" />}
    </>
  );
}

export function HistoryPage() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = storageGet("history-tab", "calendar");
    return saved === "list" || saved === "progress" ? saved : "calendar";
  });
  const pick = (next: Tab) => {
    storageSet("history-tab", next);
    setTab(next);
  };
  return (
    <Page ready>
      {() => (
        <>
          <PageHead title="History" lead="Every workout, and how each exercise develops." />
          <div className="tabs" role="tablist" aria-label="History views">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => pick(key)}>
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel">{tab === "calendar" ? <Calendar /> : tab === "list" ? <WorkoutList /> : <ExerciseProgress />}</div>
        </>
      )}
    </Page>
  );
}
