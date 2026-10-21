import { useState } from "react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { nextGapText } from "@/lib/coaching";
import { addDays, mondayOf, num, relativeDay, toIso, todayIso, weekdayIndex, WEEKDAYS, WEEKDAYS_SHORT } from "@/lib/format";
import { invalidate } from "@/lib/store";
import type { CoachToday, Dashboard, Leaderboard, Program, Session, SuggestionOption, Suggestions } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { useTopBar } from "@/app/MobileShell";
import { Page } from "@/app/Page";
import { useUser } from "@/app/state";
import { CoachHomeCard, WeekBars, WeekSay } from "@/coach/CoachHome";
import { CycleCard, useCycleState } from "@/features/cycle";
import { BoardRows } from "@/features/Leaderboard";
import { LogItem } from "@/ui/common";
import { openModal } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";
import { firstDemoPattern } from "@/workout/flows";
import { useStartWorkout } from "./workoutStart";

interface TodayData {
  data: Dashboard;
  suggestions: Suggestions;
  board: Leaderboard;
  active: Session | null;
  programs: Program[];
  coachToday: CoachToday | null;
}

async function loadToday(signal: AbortSignal): Promise<TodayData> {
  const today = todayIso();
  const [data, suggestions, board, active, programs, coachToday] = await Promise.all([
    api.get<Dashboard>("/api/dashboard?today=" + today, { signal }),
    api.get<Suggestions>("/api/suggestions?day=" + today, { signal }),
    api.get<Leaderboard>("/api/leaderboard?period=week", { signal }),
    api.get<Session | null>("/api/sessions/active", { signal }),
    api.get<Program[]>("/api/programs", { signal }),
    api.get<CoachToday>("/api/coach/today?day=" + today, { signal }).catch(() => null),
  ]);
  return { data, suggestions, board, active, programs, coachToday };
}

export function pickWorkout(options: SuggestionOption[], start: (programId: number | null) => void): void {
  openModal(
    (close) => (
      <>
        <div className="modal-head">
          <h2>Choose a workout</h2>
        </div>
        <div className="m-sheet-list">
          {options.map((option) => (
            <button
              key={option.program.id}
              type="button"
              className="m-option"
              onClick={() => {
                close();
                start(option.program.id);
              }}
            >
              <span className="grow">
                <b>{option.program.name}</b>
                <br />
                <span className="small muted">
                  {option.reason}, {option.program.items.length} exercises
                </span>
              </span>
            </button>
          ))}
          <button
            type="button"
            className="m-option"
            onClick={() => {
              close();
              start(null);
            }}
          >
            <b>Free workout</b>
          </button>
        </div>
      </>
    ),
    { label: "Choose a workout" },
  );
}

function WeightCard({ data }: { data: Dashboard }) {
  const today = todayIso();
  const existing = data.body.find((entry) => entry.day === today)?.weight_kg;
  const [weight, setWeight] = useState(existing === null || existing === undefined ? "" : String(existing));
  const trend = data.body_trend;
  const save = async () => {
    if (!weight) return;
    try {
      await api.put("/api/body", { day: today, weight_kg: Number(weight), waist_cm: null });
      invalidate("dashboard");
      toast("Weight saved");
    } catch (error) {
      errorToast(error);
    }
  };
  return (
    <section className="m-card">
      <div className="m-card-head">
        <h2>Body weight</h2>
      </div>
      <div className="m-edit-row">
        <input type="number" inputMode="decimal" step="0.1" placeholder="kg today" aria-label="Body weight in kg" value={weight} onChange={(event) => setWeight(event.target.value)} />
        <button type="button" className="btn primary" onClick={() => void save()}>
          Save
        </button>
      </div>
      {trend?.avg7 ? (
        <p className="small muted">
          7 day average {num(trend.avg7)} kg
          {trend.weekly_rate !== null ? ", " + (trend.weekly_rate > 0 ? "+" : "") + num(trend.weekly_rate * 100, 2) + " % per week" : ""}
        </p>
      ) : null}
    </section>
  );
}

function TodayView({ bundle }: { bundle: TodayData }) {
  const user = useUser();
  const cycle = useCycleState();
  const start = useStartWorkout();
  const { data, suggestions, board, active, programs, coachToday } = bundle;
  const suggested = suggestions.options.find((option) => option.suggested);
  const block = data.block;
  const today = todayIso();
  const monday = mondayOf(new Date());
  const doneDays = new Set(data.heatmap.map((entry) => entry.day));
  const plannedDays = new Set(programs.filter((program) => program.weekday !== null).map((program) => program.weekday));
  const lastIndex = data.strength_index.at(-1);
  const startProgram = (programId: number | null) => void start(today, programId);
  const other = (label: string) => (
    <button type="button" className="btn" onClick={() => pickWorkout(suggestions.options, startProgram)}>
      {label}
    </button>
  );

  let hero;
  if (coachToday) {
    let actions = null;
    if (active) {
      actions = (
        <Link className="btn primary m-btn-xl" to="/m/train">
          Continue
        </Link>
      );
    } else if (suggested) {
      actions = (
        <>
          <button type="button" className="btn primary m-btn-xl" onClick={() => startProgram(suggested.program.id)}>
            Start {suggested.program.name}
          </button>
          {suggestions.options.length > 1 ? other("Pick another workout") : null}
        </>
      );
    } else if (suggestions.options.length) actions = other("Pick a workout");
    hero = <CoachHomeCard today={coachToday} active={active} actions={actions} demoPattern={suggested ? firstDemoPattern(suggested.program) : null} />;
  } else if (active) {
    hero = (
      <section className="m-hero">
        <div className="when">Workout in progress</div>
        <h1>{active.program_name}</h1>
        <Link className="btn primary m-btn-xl" to="/m/train">
          Continue
        </Link>
      </section>
    );
  } else if (suggested) {
    const program = suggested.program;
    hero = (
      <section className="m-hero">
        <div className="when">
          {WEEKDAYS[weekdayIndex(new Date())]}, week {block.week} of {block.weeks}
          {block.deload ? ", deload" : ""}
        </div>
        <h1>{program.name}</h1>
        <div className="meta">
          <div>
            <b>{program.items.length}</b>exercises
          </div>
          <div>
            <b>{block.deload ? Math.ceil(program.total_sets / 2) : program.total_sets}</b>sets
          </div>
          <div>
            <b>{suggested.last_done_before ? relativeDay(suggested.last_done_before) : "new"}</b>last time
          </div>
        </div>
        <button type="button" className="btn primary m-btn-xl" onClick={() => startProgram(program.id)}>
          Start workout
        </button>
        {suggestions.options.length > 1 ? other("Pick another workout") : null}
      </section>
    );
  } else {
    hero = (
      <section className="m-hero">
        <div className="when">{user?.status === "ready" ? "No program yet" : "Your program is being written"}</div>
        <h1>Welcome</h1>
        <p className="muted">{user?.status_message || "The AI coach writes your program as soon as it is ready."}</p>
      </section>
    );
  }

  return (
    <>
      {hero}
      {cycle?.eligible ? <CycleCard cycle={cycle} compact={false} healthHref="/m/more/health" /> : null}
      <section className="week-strip" aria-label="This week">
        {WEEKDAYS_SHORT.map((label, offset) => {
          const iso = toIso(addDays(monday, offset));
          const done = doneDays.has(iso);
          return (
            <div key={label} className={iso === today ? "is-today" : undefined}>
              <span>{label}</span>
              <i className={done ? "done" : plannedDays.has(offset) ? "planned" : undefined} aria-label={done ? "trained" : plannedDays.has(offset) ? "planned" : "rest"} />
            </div>
          );
        })}
      </section>
      <section className="m-stat-row">
        <div className="m-stat">
          <span>Strength</span>
          <b>
            {lastIndex ? (
              <>
                {num(lastIndex.value, 0)}
                <small>%</small>
              </>
            ) : (
              "–"
            )}
          </b>
        </div>
        <div className="m-stat">
          <span>This week</span>
          <b>
            {data.stats.this_week}
            <small>workouts</small>
          </b>
        </div>
        <div className="m-stat">
          <span>Cardio 7 days</span>
          <b>
            {num(data.cardio.minutes, 0)}
            <small>/ {data.cardio.target} min</small>
          </b>
        </div>
        <div className="m-stat">
          <span>Streak</span>
          <b>
            {data.stats.streak_weeks}
            <small>weeks</small>
          </b>
        </div>
      </section>
      {coachToday ? (
        <section className="m-card">
          <div className="m-card-head">
            <h2>This week</h2>
            <Link to="/m/progress">Progress</Link>
          </div>
          <WeekSay week={coachToday.week} />
          <WeekBars week={coachToday.week} />
        </section>
      ) : null}
      <section className="m-card">
        <div className="m-card-head">
          <h2>This week&apos;s race</h2>
          <Link to="/m/more/leaderboard">All</Link>
        </div>
        <BoardRows rows={board.rows.slice(0, 5)} compact />
        <p className="small muted">{nextGapText(board.rows, user?.id ?? null)}</p>
      </section>
      <WeightCard key={data.body.length} data={data} />
      {data.log.length ? (
        <section className="m-card">
          <div className="m-card-head">
            <h2>Coach</h2>
            <Link to="/m/more/coach">All</Link>
          </div>
          <div className="feed">
            {data.log.slice(0, 3).map((entry) => (
              <LogItem key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function TodayPage() {
  const user = useUser();
  useTopBar({ title: "Hi " + (user?.name ?? "") });
  const resource = useResource(loadToday, [], ["dashboard", "session", "programs", "cycle"]);
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <TodayView bundle={resource.data} />}
    </Page>
  );
}
