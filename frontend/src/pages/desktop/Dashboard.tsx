import { type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { cssVar, plateColor } from "@/lib/catalog";
import { nextGapText } from "@/lib/coaching";
import { formatDay, fromIso, num, plural, relativeDay, todayIso, weekdayIndex, WEEKDAYS } from "@/lib/format";
import { heatmapCells, VOLUME_LABELS, type VolumeState, volumeState } from "@/lib/insights";
import { storageGet, storageSet } from "@/lib/storage";
import type { BlockState, CoachToday, Dashboard, Leaderboard, SuggestionOption, Suggestions, VolumeRow } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { estimateProgramMinutes } from "@/lib/workout";
import { Page } from "@/app/Page";
import { useActive, useUser } from "@/app/state";
import { CoachHomeCard, WeekBars, WeekSay } from "@/coach/CoachHome";
import { CycleCard, useCycleState } from "@/features/cycle";
import { BoardRows } from "@/features/Leaderboard";
import { BarChart, LineChart, type LineChartInstance, type Series } from "@/ui/charts";
import { LogItem, Seg } from "@/ui/common";
import { countUp } from "@/ui/motion";
import { errorToast, toast } from "@/ui/toast";
import { firstDemoPattern, startWorkoutFlow } from "@/workout/flows";

interface DashboardData {
  data: Dashboard;
  suggestions: Suggestions;
  board: Leaderboard;
  coachToday: CoachToday | null;
}

async function loadDashboard(signal: AbortSignal): Promise<DashboardData> {
  const today = todayIso();
  const [data, suggestions, board, coachToday] = await Promise.all([
    api.get<Dashboard>("/api/dashboard?today=" + today, { signal }),
    api.get<Suggestions>("/api/suggestions?day=" + today, { signal }),
    api.get<Leaderboard>("/api/leaderboard?period=week", { signal }),
    api.get<CoachToday>("/api/coach/today?day=" + today, { signal }).catch(() => null),
  ]);
  return { data, suggestions, board, coachToday };
}

const PLATE_SIZES: [number, string][] = [
  [150, "--plate-red"],
  [132, "--plate-blue"],
  [114, "--plate-yellow"],
  [96, "--plate-green"],
];

function Plates() {
  return (
    <div className="plates" aria-hidden="true">
      {PLATE_SIZES.map(([height, color]) => (
        <i key={color} style={{ height, marginTop: (150 - height) / 2, background: "var(" + color + ")" }} />
      ))}
    </div>
  );
}

function TodayCard({ option, block, onStart }: { option: SuggestionOption | undefined; block: BlockState; onStart: (programId: number | null) => void }) {
  const active = useActive();
  const when = (WEEKDAYS[weekdayIndex(new Date())] ?? "") + ", week " + String(block.week) + " of " + String(block.weeks) + " in block " + String(block.number);
  if (active) {
    return (
      <div className="today-card">
        <Plates />
        <div className="when">Workout in progress</div>
        <h1>{active.program_name}</h1>
        <div className="actions">
          <Link className="btn primary big" to="/training">
            Continue workout
          </Link>
        </div>
      </div>
    );
  }
  if (!option) {
    return (
      <div className="today-card">
        <div className="when">{when}</div>
        <h1>No program yet</h1>
        <p className="muted">Create a program and the overview suggests the right one every day.</p>
        <div className="actions">
          <Link className="btn primary big" to="/programs/new">
            Create program
          </Link>
          <button type="button" className="btn big" onClick={() => onStart(null)}>
            Free workout
          </button>
        </div>
      </div>
    );
  }
  const program = option.program;
  const strength = program.items.filter((item) => item.measure !== "min" && item.measure !== "none");
  const minutes = estimateProgramMinutes(program, block.deload);
  return (
    <div className="today-card">
      <Plates />
      <div className="when">
        {when}
        {block.deload ? (
          <>
            {" · "}
            <span className="deload-flag">Deload week, half the sets</span>
          </>
        ) : null}
      </div>
      <h1>{program.name}</h1>
      <div className="meta">
        <div>
          <b>{program.items.length}</b>exercises
        </div>
        <div>
          <b>{block.deload ? Math.ceil(program.total_sets / 2) : program.total_sets}</b>working sets
        </div>
        <div>
          <b>{minutes}</b>minutes approx.
        </div>
        <div>
          <b>{option.last_done_before ? relativeDay(option.last_done_before) : "new"}</b>last time
        </div>
      </div>
      <p className="muted">
        {strength
          .slice(0, 4)
          .map((item) => item.name)
          .join(", ")}
        {strength.length > 4 ? " and " + String(strength.length - 4) + " more" : ""}
      </p>
      <div className="actions">
        <button type="button" className="btn primary big" onClick={() => onStart(program.id)}>
          Start workout
        </button>
        <button type="button" className="btn big" onClick={() => onStart(null)}>
          Free workout
        </button>
      </div>
    </div>
  );
}

function Alternatives({ options, onStart }: { options: SuggestionOption[]; onStart: (programId: number) => void }) {
  if (!options.length) return <div />;
  return (
    <div className="panel flat">
      <div className="panel-head">
        <h3>Or today</h3>
      </div>
      <div className="alt-programs">
        {options.map((option) => (
          <button key={option.program.id} type="button" className="alt-program" onClick={() => onStart(option.program.id)}>
            <span className="dot" style={{ background: plateColor(option.program.id) }} />
            <span className="grow">
              <b>{option.program.name}</b>
              <span>
                {option.reason} · {plural(option.program.items.length, "exercise")}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CountValue({ value, digits = 0 }: { value: number; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) countUp(ref.current);
  }, [value]);
  return <span ref={ref}>{num(value, digits)}</span>;
}

function Tiles({ data }: { data: Dashboard }) {
  const { stats, cardio, body_trend: trend } = data;
  const cardioShare = cardio.target ? Math.min(100, (cardio.minutes / cardio.target) * 100) : 0;
  let bodySub = "Log your weight below";
  if (trend) bodySub = trend.weekly_rate === null ? "7 day average" : (trend.weekly_rate <= 0 ? "" : "+") + num(trend.weekly_rate * 100, 2) + " % per week";
  return (
    <>
      <div className="tile">
        <div className="label">This week</div>
        <div className="value">
          <CountValue value={stats.this_week} />
          <small>workouts</small>
        </div>
        <div className="sub">{stats.this_month} this month</div>
      </div>
      <div className="tile">
        <div className="label">Streak</div>
        <div className="value">
          <CountValue value={stats.streak_weeks} />
          <small>weeks</small>
        </div>
        <div className="sub">in a row with at least one workout</div>
      </div>
      <div className="tile">
        <div className="label">Cardio last 7 days</div>
        <div className="value">
          <CountValue value={cardio.minutes} />
          <small>/ {cardio.target} min</small>
        </div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={cardio.target} aria-valuenow={cardio.minutes} aria-label="Cardio minutes">
          <i style={{ width: String(cardioShare) + "%" }} />
        </div>
      </div>
      <div className="tile">
        <div className="label">Body weight</div>
        <div className="value">
          {trend ? (
            <>
              <CountValue value={trend.avg7 ?? trend.latest} digits={1} />
              <small>kg</small>
            </>
          ) : (
            "–"
          )}
        </div>
        <div className="sub">{bodySub}</div>
      </div>
    </>
  );
}




export function VolumeList({ rows }: { rows: VolumeRow[] }) {
  if (!rows.length) return <p className="muted">Once programs contain exercises with target muscles, your weekly volume shows up here.</p>;
  const scale = Math.max(20, ...rows.map((row) => Math.max(row.planned, row.done, row.max) + 2));
  const pct = (value: number) => (Math.min(value, scale) / scale) * 100;
  const sorted = [...rows].sort(
    (left, right) => (right.priority ? 1 : 0) - (left.priority ? 1 : 0) || left.done / Math.max(left.min, 1) - right.done / Math.max(right.min, 1),
  );
  const counts: Record<VolumeState, number> = { good: 0, low: 0, far: 0, over: 0 };
  for (const row of sorted) counts[volumeState(row)] += 1;
  return (
    <>
      <div className="vol-summary">
        <span className="vs-good">
          <b>{counts.good}</b> in range
        </span>
        <span className="vs-low">
          <b>{counts.low + counts.far}</b> below
        </span>
        {counts.over ? (
          <span className="vs-over">
            <b>{counts.over}</b> above
          </span>
        ) : null}
      </div>
      <div className="volume-list">
        {sorted.map((row) => {
          const state = volumeState(row);
          return (
            <div key={row.muscle} className="vol-row" data-state={state}>
              <div className="name">
                {row.label}
                {row.priority ? (
                  <span className="star" title="Priority">
                    ★
                  </span>
                ) : null}
              </div>
              <div
                className="vol-track"
                title={VOLUME_LABELS[state] + ": done " + num(row.done) + ", planned " + num(row.planned) + ", target " + String(row.min) + " to " + String(row.max)}
              >
                <div className="vol-band" style={{ left: String(pct(row.min)) + "%", width: String(pct(row.max) - pct(row.min)) + "%" }} />
                <div className="vol-plan" style={{ left: "calc(" + String(pct(row.planned)) + "% - 1px)" }} />
                <div className="vol-done" style={{ width: String(pct(row.done)) + "%" }} />
              </div>
              <div className="figs">
                <b>{num(row.done)}</b>
                <span> / {num(row.planned)}</span>
                <i className="vol-state">{VOLUME_LABELS[state]}</i>
              </div>
            </div>
          );
        })}
      </div>
      <div className="vol-legend">
        <span>
          <i className="lg-done" />
          done in the last 7 days
        </span>
        <span>
          <i className="lg-plan" />
          planned per week
        </span>
        <span>
          <i className="lg-band" />
          target range
        </span>
      </div>
    </>
  );
}



function Heatmap({ entries }: { entries: Dashboard["heatmap"] }) {
  const cells = useMemo(() => heatmapCells(entries), [entries]);
  return (
    <div className="heatmap" role="img" aria-label="Training days over the last 30 weeks">
      {cells.map((cell) => (cell.future ? <i key={cell.day} className="future" /> : <i key={cell.day} data-l={cell.level || undefined} title={cell.title} />))}
    </div>
  );
}

function PersonalBests({ prs }: { prs: Dashboard["prs"] }) {
  if (!prs.length) return <p className="muted">No new personal bests in the last 30 days. Double progression brings them step by step.</p>;
  return (
    <div className="pr-list">
      {prs.map((entry) => (
        <div key={entry.name + entry.day} className="pr">
          <div>
            <b>{entry.name}</b>
            <div className="small faint">
              {relativeDay(entry.day)} · {num(entry.weight)} kg
            </div>
          </div>
          <div className="w">
            {num(entry.e1rm)} <span className="small muted">kg 1RM</span> <span className="delta up small">+{num(entry.gain)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

type HeroMode = "index" | "lifts" | "volume";

const HERO_MODES: { value: HeroMode; label: string }[] = [
  { value: "index", label: "Strength index" },
  { value: "lifts", label: "Exercises" },
  { value: "volume", label: "Weekly volume" },
];

function readHidden(data: Dashboard): Set<number> {
  try {
    const saved = JSON.parse(storageGet("hero-hidden", "null")) as unknown;
    if (Array.isArray(saved)) return new Set(saved.map(Number));
  } catch {
    return new Set(data.strength.slice(6).map((entry) => entry.id));
  }
  return new Set(data.strength.slice(6).map((entry) => entry.id));
}

function HeroLifts({ data, head }: { data: Dashboard; head: (figure: React.ReactNode) => React.ReactNode }) {
  const [hidden, setHidden] = useState(() => readHidden(data));
  const chartRef = useRef<LineChartInstance | null>(null);
  const [initialHidden] = useState(hidden);
  const days = useMemo(() => [...new Set(data.strength.flatMap((entry) => entry.series.map((point) => point.day)))].sort(), [data.strength]);
  const series = useMemo<Series[]>(
    () =>
      data.strength.map((entry, index) => {
        const lookup = new Map(entry.series.map((point) => [point.day, point.e1rm]));
        return { label: entry.name, data: days.map((day) => lookup.get(day) ?? null), color: plateColor(index), hidden: initialHidden.has(entry.id) };
      }),
    [data.strength, days, initialHidden],
  );
  const visible = data.strength.filter((entry) => !hidden.has(entry.id));
  const best = [...visible].sort((left, right) => right.change - left.change)[0];
  const toggle = (id: number) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    storageSet("hero-hidden", JSON.stringify([...next]));
    const chart = chartRef.current;
    const index = data.strength.findIndex((entry) => entry.id === id);
    if (chart && index >= 0) {
      chart.setDatasetVisibility(index, !next.has(id));
      chart.update();
    }
  };
  return (
    <>
      {head(
        best ? (
          <div className="hero-figure" style={{ marginTop: 16 }}>
            <span className="big">
              {best.change >= 0 ? "+" : ""}
              {num(best.change * 100, 0)}
            </span>
            <span className="unit">%</span>
            <span className="muted">{best.name} since the start</span>
          </div>
        ) : null,
      )}
      <LineChart labels={days} series={series} unit="kg" onReady={(chart) => (chartRef.current = chart)} />
      <div className="lift-legend">
        {data.strength.map((entry, index) => (
          <button key={entry.id} type="button" aria-pressed={!hidden.has(entry.id)} onClick={() => toggle(entry.id)}>
            <span className="dot" style={{ background: plateColor(index) }} />
            {entry.name} <b>{num(entry.last)}</b>
          </button>
        ))}
      </div>
    </>
  );
}

function HeroVolume({ data, head }: { data: Dashboard; head: (figure: React.ReactNode) => React.ReactNode }) {
  const weeks = data.weekly;
  const last = weeks.at(-1);
  const labels = useMemo(() => weeks.map((week) => week.week), [weeks]);
  const series = useMemo<Series[]>(() => [{ label: "Volume", data: weeks.map((week) => week.volume), color: cssVar("--plate-blue") }], [weeks]);
  return (
    <>
      {head(
        last ? (
          <div className="hero-figure" style={{ marginTop: 16 }}>
            <span className="big">{num(last.volume / 1000, 1)}</span>
            <span className="unit">tonnes</span>
            <span className="muted">moved in the week of {formatDay(last.week, false)}</span>
          </div>
        ) : null,
      )}
      <BarChart labels={labels} series={series} unit="kg" />
    </>
  );
}

function HeroIndex({ data, head }: { data: Dashboard; head: (figure: React.ReactNode) => React.ReactNode }) {
  const points = data.strength_index;
  const last = points.at(-1);
  const compare = points.length > 4 ? points[points.length - 5] : points[0];
  const delta = last && compare ? last.value - compare.value : 0;
  const labels = useMemo(() => points.map((point) => point.week), [points]);
  const series = useMemo<Series[]>(
    () => [
      { label: "Strength index", data: points.map((point) => point.value), color: cssVar("--accent-line"), borderWidth: (Number(cssVar("--chart-line")) || 2) + 1 },
      { label: "Start", data: points.map(() => 100), color: cssVar("--chalk-3"), borderDash: [6, 6], pointRadius: 0, borderWidth: 1 },
    ],
    [points],
  );
  return (
    <>
      {head(
        last ? (
          <div className="hero-figure" style={{ marginTop: 16 }}>
            <span className="big">{num(last.value, 0)}</span>
            <span className="unit">%</span>
            <span className={"delta " + (delta >= 0 ? "up" : "down")}>
              {delta >= 0 ? "+" : ""}
              {num(delta, 0)}
            </span>
            <span className="muted">of your starting strength, change over 4 weeks</span>
          </div>
        ) : null,
      )}
      <LineChart labels={labels} series={series} unit="%" />
    </>
  );
}

export function HeroChart({ data }: { data: Dashboard }) {
  const [mode, setMode] = useState<HeroMode>(() => {
    const saved = storageGet("hero-mode", "index");
    return saved === "lifts" || saved === "volume" ? saved : "index";
  });
  const pick = (next: HeroMode) => {
    storageSet("hero-mode", next);
    setMode(next);
  };
  const head = (figure: React.ReactNode) => (
    <div className="hero-chart-top">
      <div>
        <h2>Strength curve</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          Estimated one rep max (Epley), calculated from your logged sets
        </p>
        {figure}
      </div>
      <Seg options={HERO_MODES} value={mode} onChange={pick} label="View" />
    </div>
  );
  let content;
  if (!data.strength.length) {
    content = (
      <>
        {head(null)}
        <div className="empty">Log sets with weight and this curve shows how much stronger you get.</div>
      </>
    );
  } else if (mode === "lifts") content = <HeroLifts data={data} head={head} />;
  else if (mode === "volume") content = <HeroVolume data={data} head={head} />;
  else content = <HeroIndex data={data} head={head} />;
  return <section className="hero-chart">{content}</section>;
}

function sevenDayAverage(entries: { day: string; weight_kg: number }[]): number[] {
  return entries.map((entry) => {
    const day = fromIso(entry.day).getTime();
    const window = entries.filter((other) => {
      const diff = (day - fromIso(other.day).getTime()) / 86400000;
      return diff >= 0 && diff < 7;
    });
    return window.reduce((sum, other) => sum + other.weight_kg, 0) / window.length;
  });
}

export function BodyPanel({ data, onSaved }: { data: Dashboard; onSaved: () => void }) {
  const today = todayIso();
  const existing = data.body.find((entry) => entry.day === today);
  const [day, setDay] = useState(today);
  const [weight, setWeight] = useState(existing?.weight_kg === null || existing?.weight_kg === undefined ? "" : String(existing.weight_kg));
  const [waist, setWaist] = useState(existing?.waist_cm === null || existing?.waist_cm === undefined ? "" : String(existing.waist_cm));
  const [busy, setBusy] = useState(false);
  const entries = useMemo(
    () => data.body.filter((entry): entry is { day: string; weight_kg: number; waist_cm: number | null } => entry.weight_kg !== null),
    [data.body],
  );
  const labels = useMemo(() => entries.map((entry) => entry.day), [entries]);
  const series = useMemo<Series[]>(
    () => [
      { label: "Weight", data: entries.map((entry) => entry.weight_kg), color: cssVar("--chalk-3"), borderWidth: 1, pointRadius: 2 },
      { label: "7 day average", data: sevenDayAverage(entries), color: cssVar("--plate-green"), pointRadius: 0 },
    ],
    [entries],
  );
  const save = async (event: SyntheticEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put("/api/body", { day, weight_kg: weight ? Number(weight) : null, waist_cm: waist ? Number(waist) : null });
      toast("Body values saved");
      onSaved();
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel col-12 proj-hide">
      <div className="panel-head">
        <h2>Body</h2>
        <span className="hint">{data.goals.fat_loss ? "Fat loss goal active. Your face gets leaner as the 7 day average drops." : ""}</span>
      </div>
      <form className="body-form" onSubmit={(event) => void save(event)}>
        <label className="field">
          <span>Date</span>
          <input type="date" value={day} max={today} onChange={(event) => setDay(event.target.value)} />
        </label>
        <label className="field">
          <span>Weight kg</span>
          <input type="number" step="0.1" min="20" max="400" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} />
        </label>
        <label className="field">
          <span>Waist cm</span>
          <input type="number" step="0.5" min="30" max="300" inputMode="decimal" value={waist} onChange={(event) => setWaist(event.target.value)} />
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          Save
        </button>
      </form>
      {entries.length > 1 ? (
        <LineChart className="chart-box short body-chart" labels={labels} series={series} unit="kg" />
      ) : (
        <p className="muted small" style={{ marginTop: 12 }}>
          From two entries on, the curve with its 7 day average appears here.
        </p>
      )}
    </section>
  );
}

function DashboardView({ bundle, reload }: { bundle: DashboardData; reload: () => void }) {
  const navigate = useNavigate();
  const user = useUser();
  const active = useActive();
  const cycle = useCycleState();
  const { data, suggestions, board, coachToday } = bundle;
  const suggestedOption = suggestions.options.find((option) => option.suggested);
  const others = suggestions.options.filter((option) => !option.suggested).slice(0, 4);
  const start = (programId: number | null) => {
    void startWorkoutFlow(todayIso(), programId, () => void navigate("/training"));
  };
  return (
    <>
      {cycle?.eligible ? (
        <div className="cycle-desktop cycle-slot">
          <CycleCard cycle={cycle} compact={false} healthHref="/health" />
        </div>
      ) : null}
      <div className="dash">
        <section className="today">
          <TodayCard option={suggestedOption} block={data.block} onStart={start} />
          <Alternatives options={others} onStart={start} />
        </section>
        {coachToday ? (
          <section className="hero-coach">
            <CoachHomeCard today={coachToday} active={active} demoPattern={suggestedOption ? firstDemoPattern(suggestedOption.program) : null} />
            <div className="hero-week">
              <div className="panel-head">
                <h2>This week</h2>
                <span className="hint">sets done against your program</span>
              </div>
              <WeekSay week={coachToday.week} />
              <WeekBars week={coachToday.week} />
            </div>
          </section>
        ) : (
          <HeroChart data={data} />
        )}
        <section className="tiles">
          <Tiles data={data} />
        </section>
        <section className="panel col-7">
          <div className="panel-head">
            <h2>Volume per muscle</h2>
            <span className="hint">Sets per week, counted fractionally</span>
          </div>
          <VolumeList rows={data.volume} />
        </section>
        <section className="panel col-5 board-panel">
          <div className="panel-head">
            <h2>This week&apos;s race</h2>
            <Link className="hint" to="/leaderboard">
              Leaderboard
            </Link>
          </div>
          <BoardRows rows={board.rows.slice(0, 6)} compact />
          <p className="small muted" style={{ marginTop: 12 }}>
            {nextGapText(board.rows, user?.id ?? null)}
          </p>
        </section>
        <section className="panel col-5 proj-hide">
          <div className="panel-head">
            <h2>Coach</h2>
            <Link className="hint" to="/coach">
              See all
            </Link>
          </div>
          <div className="feed">
            {data.log.length ? (
              data.log.slice(0, 5).map((entry) => <LogItem key={entry.id} entry={entry} />)
            ) : (
              <p className="muted">After your first workout the coach notes and changes appear here.</p>
            )}
          </div>
        </section>
        <section className="panel col-7 proj-hide">
          <div className="panel-head">
            <h2>Training days</h2>
            <span className="hint">{plural(data.stats.total, "workout")} in total</span>
          </div>
          <Heatmap entries={data.heatmap} />
        </section>
        <section className="panel col-12 proj-hide">
          <div className="panel-head">
            <h2>New personal bests</h2>
            <span className="hint">last 30 days</span>
          </div>
          <PersonalBests prs={data.prs} />
        </section>
        <BodyPanel key={data.body.length} data={data} onSaved={reload} />
      </div>
    </>
  );
}

export function DashboardPage() {
  const resource = useResource(loadDashboard, [], ["dashboard", "session", "programs", "cycle"]);
  return (
    <Page ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <DashboardView bundle={resource.data} reload={resource.reload} />}
    </Page>
  );
}
