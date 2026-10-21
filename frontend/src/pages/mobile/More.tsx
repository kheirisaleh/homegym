import { Fragment, type ReactNode, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { GOAL_NAMES, mediaUrl, MUSCLE_NAMES, thumbUrl } from "@/lib/catalog";
import { BOARD_PARTS, CATEGORY_TEXT, nextGapText } from "@/lib/coaching";
import { formatDay, formatSet, num } from "@/lib/format";
import { blockWeeks, type ExerciseScope, filterMobileExercises, groupEquipment } from "@/lib/insights";
import { storageGet, storageSet } from "@/lib/storage";
import { invalidate } from "@/lib/store";
import type { CoachState, Equipment, Exercise, ExerciseHistory, Leaderboard, Program, User } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { useTopBar } from "@/app/MobileShell";
import { Page } from "@/app/Page";
import { logout } from "@/app/session";
import { muscleLabel, setUser, useUser } from "@/app/state";
import { AdminSettings } from "@/features/AdminSettings";
import { AiState, aiView, type CoachAction, CoachLogFeed, deleteAccount, GoalsForm, ProfileFields, profileDraft, saveProfile, TrainerSettings, TrainingBrief, useAiCheck, useCoachAction } from "@/features/coachTools";
import { type HealthHeaderProps, HealthView } from "@/features/cycle";
import { equipmentBody, openEquipmentEditor, reportSwaps } from "@/features/EquipmentEditor";
import { openExerciseEditor } from "@/features/ExerciseEditor";
import { BoardRows } from "@/features/Leaderboard";
import { NutritionCard } from "@/features/NutritionCard";
import { rebuildDialog, redesignDialog } from "@/features/programDialogs";
import { BodyModel, type BodyModelHandle } from "@/three/BodyModel";
import { Avatar, MediaTag, Switch } from "@/ui/common";
import { CameraIcon, CompassIcon, DumbbellIcon, FilmIcon, GearIcon, HeartIcon, MonitorIcon, TrophyIcon, UsersIcon, WhistleIcon } from "@/ui/icons";
import { confirmDialog, openModal } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";
import { LoopVideo } from "@/ui/youtube";
import { BoardLegend, type Period, PERIODS, usePeriod } from "../desktop/Leaderboard";
import { priorityText } from "../desktop/Profile";

function Row({ to, title, subtitle, icon }: { to: string; title: string; subtitle: string; icon: ReactNode }) {
  return (
    <Link className="m-item" to={to}>
      <span className="m-ico">{icon}</span>
      <span className="grow">
        <b>{title}</b>
        <span>{subtitle}</span>
      </span>
      <span className="chev" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

export function MorePage() {
  useTopBar({ title: "More" });
  const user = useUser();
  if (!user) return null;
  const openDesktop = () => {
    storageSet("force-desktop", "1");
    window.location.href = "/";
  };
  return (
    <Page mobile ready>
      {() => (
        <>
          <Link className="m-card m-profile-card" to="/m/more/profile">
            <Avatar name={user.name} color={user.color} size="big" />
            <span className="grow">
              <b>{user.name}</b>
              <span>
                {GOAL_NAMES[user.goal] ?? ""}, {user.days_per_week} days a week
              </span>
            </span>
            <span className="chev" aria-hidden="true">
              ›
            </span>
          </Link>
          <div className="m-list">
            <Row to="/m/more/leaderboard" title="Leaderboard" subtitle="Race against everyone in your gym" icon={<TrophyIcon />} />
            <Row to="/m/more/trainer" title="My coach" subtitle="Choose Max or Lena" icon={<WhistleIcon />} />
            <Row to="/m/more/coach" title="Coach log" subtitle="Block, deload, goals, log" icon={<CompassIcon />} />
            {user.sex === "female" ? <Row to="/m/more/health" title="Health" subtitle="Cycle, symptoms and training, private" icon={<HeartIcon className="health-icon" />} /> : null}
          </div>
          <div className="m-list">
            <Row to="/m/more/exercises" title="Exercises" subtitle="Loop animations, muscle images, cues" icon={<FilmIcon />} />
            <Row to="/m/more/equipment" title="Equipment" subtitle="What stands in your gym" icon={<DumbbellIcon />} />
          </div>
          {user.is_superuser ? (
            <div className="m-list">
              <Row to="/m/more/settings" title="Settings" subtitle="AI key, models, Alexa, app behaviour" icon={<GearIcon />} />
            </div>
          ) : null}
          <div className="m-list">
            <button type="button" className="m-item" onClick={openDesktop}>
              <span className="m-ico">
                <MonitorIcon />
              </span>
              <span className="grow">
                <b>Desktop version</b>
                <span>Full layout and projector mode</span>
              </span>
              <span className="chev" aria-hidden="true">
                ›
              </span>
            </button>
            <button type="button" className="m-item" onClick={logout}>
              <span className="m-ico">
                <UsersIcon />
              </span>
              <span className="grow">
                <b>Switch account</b>
                <span>Back to the account list</span>
              </span>
              <span className="chev" aria-hidden="true">
                ›
              </span>
            </button>
          </div>
        </>
      )}
    </Page>
  );
}


const SCOPES: [ExerciseScope, string][] = [
  ["plan", "In my plan"],
  ["all", "All"],
  ["nomedia", "Without media"],
];


function ExerciseThumb({ exercise }: { exercise: Exercise }) {
  if (exercise.media_loop) return <MediaTag name={exercise.media_loop} lazy />;
  if (exercise.media_muscles) return <MediaTag name={exercise.media_muscles} lazy />;
  if (exercise.video_id) return <img src={thumbUrl(exercise.video_id)} alt="" loading="lazy" />;
  return <span className="ph">{(muscleLabel(exercise.primary_muscle) || exercise.name).slice(0, 2)}</span>;
}

export function ExerciseListPage() {
  const navigate = useNavigate();
  useTopBar({ title: "Exercises", back: "/m/more", action: { label: "New", run: () => openExerciseEditor(null, { onCreated: (created) => void navigate("/m/more/exercises/" + String(created.id)) }) } });
  const resource = useResource((signal) => api.get<Exercise[]>("/api/exercises", { signal }), [], ["exercises"]);
  const [query, setQuery] = useState(() => storageGet("m-ex-q", ""));
  const [scope, setScope] = useState<ExerciseScope>(() => {
    const saved = storageGet("m-ex-scope", "plan");
    return saved === "all" || saved === "nomedia" ? saved : "plan";
  });
  const list = useMemo(() => filterMobileExercises(resource.data ?? [], query, scope, muscleLabel), [resource.data, query, scope]);
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => (
        <>
          <input
            type="search"
            placeholder="Search exercises or muscles"
            aria-label="Search exercises or muscles"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              storageSet("m-ex-q", event.target.value);
            }}
          />
          <div className="m-tabs-inline" role="group" aria-label="Filter">
            {SCOPES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={scope === key}
                onClick={() => {
                  setScope(key);
                  storageSet("m-ex-scope", key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="m-list">
            {list.length ? (
              list.slice(0, 150).map((exercise) => {
                const tags = [muscleLabel(exercise.primary_muscle) || "No target muscle"];
                if (exercise.program_count) tags.push("in plan");
                if (!exercise.available) tags.push("equipment missing");
                return (
                  <Link key={exercise.id} className="m-item" to={"/m/more/exercises/" + String(exercise.id)}>
                    <span className="thumb">
                      <ExerciseThumb exercise={exercise} />
                    </span>
                    <span className="grow">
                      <b>{exercise.name}</b>
                      <span>{tags.join(", ")}</span>
                    </span>
                    <span className="chev" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                );
              })
            ) : (
              <div className="empty">Nothing matches.</div>
            )}
          </div>
        </>
      )}
    </Page>
  );
}

function MediaCard({ exercise, kind }: { exercise: Exercise; kind: "loop" | "muscles" }) {
  const [busy, setBusy] = useState(false);
  const name = kind === "loop" ? exercise.media_loop : exercise.media_muscles;
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    setBusy(true);
    try {
      await api.post("/api/exercises/" + String(exercise.id) + "/media/" + kind, data);
      invalidate("exercises");
      toast("Uploaded");
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog("Remove media", "The file is deleted from the server.", "Remove", true);
    if (!ok) return;
    try {
      await api.delete("/api/exercises/" + String(exercise.id) + "/media/" + kind);
      invalidate("exercises");
    } catch (error) {
      errorToast(error);
    }
  };
  return (
    <div className="m-card">
      <div className="m-card-head">
        <h2>{kind === "loop" ? "Loop animation" : "Target muscles"}</h2>
        {name ? (
          <button type="button" className="link" onClick={() => void remove()}>
            Remove
          </button>
        ) : null}
      </div>
      {name ? (
        <div className="mw-media">
          <MediaTag name={name} />
        </div>
      ) : (
        <p className="small muted">{kind === "loop" ? "GIF or short video. Record one with your camera." : "Image with the target muscles highlighted."}</p>
      )}
      <label className={"btn m-btn-xl" + (busy ? " busy" : "")}>
        <input type="file" hidden accept={kind === "loop" ? "image/gif,video/*" : "image/*"} onChange={(event) => void upload(event.target.files?.[0])} />
        {busy ? "Uploading" : name ? "Replace" : "Upload"}
      </label>
    </div>
  );
}

function ExerciseDetail({ exercise, history }: { exercise: Exercise; history: ExerciseHistory["entries"] }) {
  useTopBar({ title: exercise.name, back: "/m/more/exercises", action: { label: "Edit", run: () => openExerciseEditor(exercise) } });
  const facts: [string, string][] = [
    ["Target", muscleLabel(exercise.primary_muscle) || "none"],
    ["Also works", exercise.secondary_muscles.map(muscleLabel).join(", ") || "none"],
    ["Level", ["", "Beginner", "Intermediate", "Advanced"][exercise.difficulty] ?? ""],
    ["Status", exercise.available ? "Equipment available" : "Equipment missing"],
  ];
  return (
    <>
      <div className="m-card flat">
        {facts.map(([label, value]) => (
          <div key={label} className="m-switch-row">
            <span className="muted">{label}</span>
            <b className="fact-value">{value}</b>
          </div>
        ))}
      </div>
      {exercise.cues ? (
        <div className="m-card">
          <h2>Technique</h2>
          <p className="pre-line">{exercise.cues}</p>
        </div>
      ) : null}
      <MediaCard exercise={exercise} kind="loop" />
      <MediaCard exercise={exercise} kind="muscles" />
      {!exercise.media_loop && exercise.video_id ? (
        <div className="m-card">
          <h2>YouTube fallback</h2>
          <div className="mw-media video-wide">
            <LoopVideo videoId={exercise.video_id} start={exercise.video_start} end={exercise.video_end} />
          </div>
        </div>
      ) : null}
      {history.length ? (
        <>
          <div className="m-section-title">Recent workouts</div>
          <div className="m-list">
            {history.slice(0, 6).map((entry) => (
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
      ) : null}
    </>
  );
}

function MissingExercise() {
  useTopBar({ title: "Exercise", back: "/m/more/exercises" });
  return <div className="empty">Exercise not found.</div>;
}

export function ExerciseDetailPage() {
  const { exerciseId = "" } = useParams();
  const id = Number(exerciseId);
  const resource = useResource(
    async (signal) => {
      const [exercises, history] = await Promise.all([
        api.get<Exercise[]>("/api/exercises", { signal }),
        api.get<ExerciseHistory>("/api/exercises/" + exerciseId + "/history", { signal }).catch(() => null),
      ]);
      return { exercise: exercises.find((entry) => entry.id === id) ?? null, history: history?.entries ?? [] };
    },
    [exerciseId],
    ["exercises"],
  );
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => (resource.data?.exercise ? <ExerciseDetail exercise={resource.data.exercise} history={resource.data.history} /> : <MissingExercise />)}
    </Page>
  );
}

function photoSheet(item: Equipment, onReplace: () => void): void {
  openModal(
    (close) => (
      <>
        <div className="modal-head">
          <h2>{item.name}</h2>
        </div>
        <div className="mw-media">
          <img src={mediaUrl(item.photo)} alt="" />
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn danger left"
            onClick={() => {
              close();
              api.delete("/api/equipment/" + item.key + "/photo").then(() => invalidate("equipment"), errorToast);
            }}
          >
            Remove
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              close();
              onReplace();
            }}
          >
            Replace photo
          </button>
        </div>
      </>
    ),
    { label: item.name },
  );
}

function EquipmentRow({ item, onPhoto }: { item: Equipment; onPhoto: (item: Equipment) => void }) {
  const toggle = async (available: boolean) => {
    try {
      const result = await api.put<Equipment & { swapped?: string[]; pending?: string | null }>("/api/equipment/" + item.key, { ...equipmentBody(item), available });
      invalidate("equipment", "exercises", "programs");
      reportSwaps(result, item.name + (available ? " available" : " not available"));
    } catch (error) {
      errorToast(error);
    }
  };
  const detail = item.weights?.length
    ? String(item.weights.length) + " weights, " + num(item.weights[0]) + " to " + num(item.weights[item.weights.length - 1]) + " kg"
    : "Used by " + String(item.exercise_count) + " exercises";
  return (
    <div className={"m-item" + (item.available ? "" : " off")}>
      <button type="button" className="m-eq-photo" aria-label={"Photo of " + item.name} onClick={() => onPhoto(item)}>
        {item.photo ? (
          <img src={mediaUrl(item.photo)} alt="" loading="lazy" />
        ) : (
          <span className="m-ico">
            <CameraIcon />
          </span>
        )}
      </button>
      <button type="button" className="grow m-plain" onClick={() => openEquipmentEditor(item)}>
        <b>{item.name}</b>
        <span>{detail}</span>
      </button>
      <Switch checked={item.available} label={item.name + " available"} onChange={(value) => void toggle(value)} />
    </div>
  );
}

export function EquipmentListPage() {
  useTopBar({ title: "Equipment", back: "/m/more", action: { label: "Add", run: () => openEquipmentEditor(null) } });
  const resource = useResource((signal) => api.get<Equipment[]>("/api/equipment", { signal }), [], ["equipment"]);
  const fileInput = useRef<HTMLInputElement>(null);
  const target = useRef<Equipment | null>(null);
  const pickFile = (item: Equipment) => {
    target.current = item;
    fileInput.current?.click();
  };
  const upload = async (file: File | undefined) => {
    const item = target.current;
    if (!file || !item) return;
    const data = new FormData();
    data.append("file", file);
    toast("Uploading photo");
    try {
      await api.post("/api/equipment/" + item.key + "/photo", data);
      invalidate("equipment");
      toast("Photo saved");
    } catch (error) {
      errorToast(error);
    }
  };
  const items = resource.data ?? [];
  const available = items.filter((item) => item.available).length;
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => (
        <>
          <p className="small muted">
            {available} of {items.length} available. Switch something off and the AI coach replaces the exercises that need it.
          </p>
          {groupEquipment(items).map(([key, label, list]) => (
            <Fragment key={key}>
              <div className="m-section-title">{label}</div>
              <div className="m-list">
                {list.map((item) => (
                  <EquipmentRow key={item.key} item={item} onPhoto={(entry) => (entry.photo ? photoSheet(entry, () => pickFile(entry)) : pickFile(entry))} />
                ))}
              </div>
            </Fragment>
          ))}
          <input
            ref={fileInput}
            type="file"
            hidden
            accept="image/*"
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </>
      )}
    </Page>
  );
}

function ActionItem({ title, text, disabled, busy, onRun }: { title: string; text: string; disabled?: boolean; busy: boolean; onRun: () => void }) {
  return (
    <button type="button" className="m-item" disabled={disabled || busy} aria-busy={busy} onClick={onRun}>
      <span className="grow">
        <b>{title}</b>
        <span>{text}</span>
      </span>
      <span className="chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function CoachMobile({ coach, programs }: { coach: CoachState; programs: Program[] }) {
  const { block, settings } = coach;
  const actions = useCoachAction(true);
  const ai = useAiCheck();
  const item = (action: CoachAction, title: string, text: string, disabled = false) => (
    <ActionItem title={title} text={text} disabled={disabled} busy={actions.busy === action} onRun={() => void actions.run(action)} />
  );
  return (
    <>
      <section className="m-hero">
        <div className="when">
          Block {block.number}
          {block.deload ? ", deload running" : ""}
        </div>
        <h1>
          Week {block.week} <span className="muted hero-of">of {block.weeks}</span>
        </h1>
        <div className="m-weeks" aria-hidden="true">
          {blockWeeks(block).map((week) => (
            <i key={week.week} className={week.classes || undefined} />
          ))}
        </div>
        <p className="small muted">
          {block.deload ? "Half the sets at the same weight this week." : "Deload from " + formatDay(block.deload_from, false) + "."} Review on {formatDay(block.end_day, false)}.
        </p>
      </section>
      <div className="m-card">
        <div className="m-card-head">
          <h2>AI coach</h2>
          <AiState status={ai.status} mobile />
        </div>
        <p className="small muted">
          {ai.status
            ? aiView(ai.status, true).help
            : (settings.ai_provider === "gemini" ? "Runs with Google Gemini." : "Runs locally with Ollama.") + " Weights follow fixed rules, the AI decides swaps, redesigns and notes inside them."}
        </p>
        <div className="m-row-actions">
          <button type="button" className="btn" onClick={() => void ai.check(true)}>
            Check connection
          </button>
          <a className="btn" href="/quality">
            Program quality tests
          </a>
        </div>
      </div>
      <div className="m-section-title">Adjust now</div>
      <div className="m-list">
        {item("progress", "Check progression", coach.pending_sessions ? String(coach.pending_sessions) + " workout(s) not evaluated yet" : "Checks again whether weights should go up")}
        {item("review", "Finish block now", "AI review, swaps stalled exercises, new block")}
        {item("deload", "Deload now", "One week with half the sets", block.deload)}
        {item("fatigue", "I am wiped out", "From week 2 on this starts a deload", block.deload)}
        {programs.map((program) => (
          <button key={program.id} type="button" className="m-item" onClick={() => redesignDialog(program.id)}>
            <span className="grow">
              <b>Redesign {program.name}</b>
              <span>Rebuilt by the AI coach</span>
            </span>
            <span className="chev" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
      <NutritionCard mobile />
      <GoalsForm key={JSON.stringify(settings)} settings={settings} mobile />
      <div className="m-section-title">Log</div>
      <div className="m-card">
        <CoachLogFeed log={coach.log} initial={15} step={30} mobile />
      </div>
    </>
  );
}

export function CoachPage() {
  useTopBar({ title: "Coach", back: "/m/more" });
  const resource = useResource(
    async (signal) => {
      const [coach, programs] = await Promise.all([api.get<CoachState>("/api/coach?log_limit=120", { signal }), api.get<Program[]>("/api/programs", { signal })]);
      return { coach, programs };
    },
    [],
    ["coach", "programs"],
  );
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <CoachMobile coach={resource.data.coach} programs={resource.data.programs} />}
    </Page>
  );
}

export function TrainerPage() {
  useTopBar({ title: "My coach", back: "/m/more" });
  return <Page mobile ready>{() => <TrainerSettings mobile />}</Page>;
}

function BoardMobile({ data, period, onPeriod }: { data: Leaderboard; period: Period; onPeriod: (period: Period) => void }) {
  const user = useUser();
  const me = data.rows.find((row) => row.id === user?.id);
  return (
    <>
      <div className="m-tabs-inline" role="group" aria-label="Period">
        {PERIODS.map((entry) => (
          <button key={entry.value} type="button" aria-pressed={period === entry.value} onClick={() => onPeriod(entry.value)}>
            {entry.label}
          </button>
        ))}
      </div>
      {me ? (
        <section className="m-hero">
          <div className="when">{data.label}</div>
          <h1>
            #{me.rank} <span className="muted hero-of">with {me.score} points</span>
          </h1>
          <p className="small muted">{nextGapText(data.rows, user?.id ?? null)}</p>
        </section>
      ) : null}
      <div className="m-card">
        <BoardRows rows={data.rows} compact={false} />
        <BoardLegend />
      </div>
      <div className="m-section-title">Category leaders</div>
      <div className="m-list">
        {BOARD_PARTS.map(([key, label]) => {
          const leader = data.categories[key];
          return (
            <div key={key} className="m-item">
              <span className="grow">
                <b>{label}</b>
                <span>{leader ? leader.name + ", " + CATEGORY_TEXT[key](leader.value) : "open"}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="m-card flat small muted">
        <p>
          <b>Consistency, up to 40.</b> Completed workouts compared with the days you planned.
        </p>
        <p>
          <b>Improvement, up to 30.</b> Growth of your estimated 1RM, relative to your own level.
        </p>
        <p>
          <b>Personal bests, up to 20.</b> 4 points per new best.
        </p>
        <p>
          <b>Volume, up to 10.</b> 1 point per 10 working sets.
        </p>
      </div>
    </>
  );
}

export function LeaderboardPage() {
  useTopBar({ title: "Leaderboard", back: "/m/more" });
  const [period, setPeriod] = usePeriod();
  const resource = useResource((signal) => api.get<Leaderboard>("/api/leaderboard?period=" + period, { signal }), [period], ["session"]);
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <BoardMobile data={resource.data} period={period} onPeriod={setPeriod} />}
    </Page>
  );
}

function HealthHeader({ lock }: HealthHeaderProps) {
  useTopBar({ title: "Health", back: "/m/more", ...(lock ? { action: { label: "Lock", run: lock } } : {}) });
  return null;
}

export function HealthPage() {
  return <Page mobile ready>{() => <HealthView Header={HealthHeader} home="/m" />}</Page>;
}

export function SettingsPage() {
  useTopBar({ title: "Settings", back: "/m/more" });
  return <Page mobile ready>{() => <AdminSettings />}</Page>;
}

function ProfileMobile({ user }: { user: User }) {
  const [draft, setDraft] = useState(() => profileDraft(user));
  const model = useRef<BodyModelHandle | null>(null);
  return (
    <>
      <div className="m-profile-head">
        <Avatar name={user.name} color={user.color} size="big" />
        <div>
          <h1>{user.name}</h1>
          <span className="muted">
            {GOAL_NAMES[user.goal] ?? user.goal}, {user.days_per_week} days, level {user.level}
          </span>
        </div>
      </div>
      <BodyModel className="m-model" sex={user.sex} selected={user.priority_muscles} interactive={false} autoRotate labels={MUSCLE_NAMES} handleRef={model} />
      <div className="m-row-actions">
        <button type="button" className="btn" onClick={() => model.current?.front()}>
          Front
        </button>
        <button type="button" className="btn" onClick={() => model.current?.back()}>
          Back
        </button>
      </div>
      <p className="small muted">Target muscles: {priorityText(user)}. Change them under Coach.</p>
      {user.plan_summary ? (
        <div className="m-card">
          <h2>Coach summary</h2>
          <p>{user.plan_summary}</p>
        </div>
      ) : null}
      <div className="m-card">
        <h2>Details</h2>
        <ProfileFields draft={draft} onChange={setDraft} mobile />
        <div className="m-switch-row">
          <span className="muted">BMI</span>
          <b>{user.bmi ? num(user.bmi) + " (" + user.bmi_label + ")" : "–"}</b>
        </div>
        <button type="button" className="btn primary m-btn-xl" onClick={() => void saveProfile(draft)}>
          Save
        </button>
      </div>
      <details className="m-card">
        <summary>
          <b>Training brief</b> <span className="muted small">what the AI coach received</span>
        </summary>
        <div className="report">
          <TrainingBrief />
        </div>
      </details>
      <button type="button" className="btn m-btn-xl" onClick={() => void rebuildDialog()}>
        New program with your coach
      </button>
      <button type="button" className="btn primary m-btn-xl" onClick={logout}>
        Log out
      </button>
      <button type="button" className="btn ghost danger" onClick={() => void deleteAccount(user)}>
        Delete account
      </button>
    </>
  );
}

export function ProfilePage() {
  useTopBar({ title: "Profile", back: "/m/more" });
  const resource = useResource(
    async (signal) => {
      const user = await api.get<User>("/api/me", { signal });
      setUser(user);
      return user;
    },
    [],
    ["user"],
  );
  return (
    <Page mobile ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <ProfileMobile key={resource.data.id} user={resource.data} />}
    </Page>
  );
}
