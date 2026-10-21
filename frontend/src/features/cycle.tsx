import { type ComponentType, type CSSProperties, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, request } from "@/lib/api";
import { cssVar } from "@/lib/catalog";
import { formatDay, num, plural, todayIso } from "@/lib/format";
import { planItemAmount } from "@/lib/insights";
import { sessionGet, sessionSet } from "@/lib/storage";
import { invalidate } from "@/lib/store";
import type { Checkin, CycleHealth, CycleLevel, CyclePlan, CyclePlanItem, CyclePrediction, CycleState } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { userStore, useUser } from "@/app/state";
import { BarChart } from "@/ui/charts";
import { confirmDialog, openModal } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";

const SCALE_SYMPTOM = ["None", "Mild", "Medium", "Strong"];
const SCALE_FLOW = ["None", "Light", "Medium", "Heavy"];
const SCALE_FIVE = ["1", "2", "3", "4", "5"];

type SymptomField = "cramps" | "back_pain" | "headache" | "bloating" | "flow";
type ScaleField = SymptomField | "energy" | "sleep" | "mood";

const SYMPTOM_FIELDS: [SymptomField, string, string[]][] = [
  ["cramps", "Cramps", SCALE_SYMPTOM],
  ["back_pain", "Back pain", SCALE_SYMPTOM],
  ["headache", "Headache", SCALE_SYMPTOM],
  ["bloating", "Bloating", SCALE_SYMPTOM],
  ["flow", "Flow", SCALE_FLOW],
];

export const LEVEL_TEXT: Record<CycleLevel, string> = {
  none: "Normal workout today",
  light: "Slightly lighter workout",
  moderate: "Clearly lighter workout",
  rest: "Recovery day",
};

const EMPTY_CHECKIN: Checkin = { energy: null, cramps: 0, back_pain: 0, headache: 0, bloating: 0, flow: 1, sleep: null, mood: null, note: "" };

export async function fetchCycleState(signal?: AbortSignal): Promise<CycleState> {
  const user = userStore.get();
  if (user?.sex !== "female") return { eligible: false };
  try {
    return await api.get<CycleState>("/api/cycle/state?day=" + todayIso(), signal ? { signal } : {});
  } catch {
    return { eligible: false };
  }
}

export function useCycleState(): CycleState | undefined {
  const user = useUser();
  const resource = useResource((signal) => fetchCycleState(signal), [user?.id, user?.sex], ["cycle"]);
  return resource.data;
}

function cycleChanged(): void {
  invalidate("cycle", "dashboard", "programs");
}

const dayLabel = (iso: string) => formatDay(iso, false);

export function predictionText(prediction: CyclePrediction | null | undefined): string {
  if (!prediction) return "";
  const days = prediction.days_until;
  const when = days > 1 ? "in about " + String(days) + " days" : days === 1 ? "tomorrow" : days === 0 ? "today" : "about " + String(Math.abs(days)) + " days ago";
  return (
    "Next period expected " + when + " (" + dayLabel(prediction.window_start) + " to " + dayLabel(prediction.window_end) + ")" +
    (prediction.confidence === "low" ? ", rough guess until more cycles are logged" : "")
  );
}

function ScaleRow({ label, options, value, offset, onPick }: { label: string; options: string[]; value: number | null; offset: number; onPick: (value: number) => void }) {
  return (
    <div className="cycle-scale">
      <span>{label}</span>
      <div className="cycle-seg" role="group" aria-label={label}>
        {options.map((text, index) => (
          <button key={text} type="button" aria-pressed={value === index + offset} onClick={() => onPick(index + offset)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckinForm({ existing, starting, onSaved, onCancel }: { existing: Checkin | null; starting: boolean; onSaved: () => void; onCancel: () => void }) {
  const [values, setValues] = useState<Checkin>(() => ({ ...EMPTY_CHECKIN, ...existing }));
  const [busy, setBusy] = useState(false);
  const pick = (field: ScaleField, value: number) => {
    setValues((current) => {
      const optional = field === "sleep" || field === "mood";
      return { ...current, [field]: optional && current[field] === value ? null : value };
    });
  };
  const save = async () => {
    if (!values.energy) {
      toast("Pick your energy first", "error");
      return;
    }
    const checkin: Checkin = { ...values, day: todayIso(), note: values.note.trim() };
    setBusy(true);
    try {
      if (starting) await api.post("/api/cycle/start", { day: todayIso(), checkin });
      else await api.put("/api/cycle/checkin", checkin);
      toast(starting ? "Period mode is on" : "Saved");
      onSaved();
    } catch (error) {
      setBusy(false);
      errorToast(error);
    }
  };
  return (
    <>
      <div className="modal-head">
        <h2>{starting ? "Period started" : "How do you feel today?"}</h2>
      </div>
      <p className="small muted">Your answers only shape today&apos;s workout and your private health page. Nobody else sees them.</p>
      <ScaleRow label="Energy (1 is empty, 5 is great)" options={SCALE_FIVE} value={values.energy} offset={1} onPick={(value) => pick("energy", value)} />
      {SYMPTOM_FIELDS.map(([field, label, options]) => (
        <ScaleRow key={field} label={label} options={options} value={values[field]} offset={0} onPick={(value) => pick(field, value)} />
      ))}
      <details className="cycle-more">
        <summary>Sleep, mood and a note</summary>
        <ScaleRow label="Sleep last night" options={SCALE_FIVE} value={values.sleep} offset={1} onPick={(value) => pick("sleep", value)} />
        <ScaleRow label="Mood" options={SCALE_FIVE} value={values.mood} offset={1} onPick={(value) => pick("mood", value)} />
        <label className="field">
          <span>Note</span>
          <input type="text" maxLength={300} value={values.note} onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} />
        </label>
      </details>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          {starting ? "Turn on" : "Save"}
        </button>
      </div>
    </>
  );
}

export function checkinSheet(existing: Checkin | null, starting: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    let saved = false;
    const handle = openModal(
      (close) => (
        <CheckinForm
          existing={existing}
          starting={starting}
          onCancel={close}
          onSaved={() => {
            saved = true;
            handle.close();
          }}
        />
      ),
      { label: starting ? "Period started" : "How do you feel today", onClose: () => resolve(saved) },
    );
  });
}

export function CycleCard({ cycle, compact, healthHref }: { cycle: CycleState; compact: boolean; healthHref: string }) {
  const [busy, setBusy] = useState(false);
  if (!cycle.eligible) return null;
  const toggle = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (on) {
        if (await checkinSheet(null, true)) cycleChanged();
        return;
      }
      const ok = await confirmDialog("Turn off period mode", "Your normal program comes back right away. The period is saved as ending today.", "Turn off");
      if (!ok) return;
      await api.post("/api/cycle/stop", { day: todayIso() });
      toast("Back to your normal program");
      cycleChanged();
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
    }
  };
  const switchRow = (sub: string, on: boolean) => (
    <label className="cycle-switch">
      <span>
        <b>I am on my period</b>
        <br />
        <span className="small muted">{sub}</span>
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={(event) => void toggle(event.target.checked)} />
      <i />
    </label>
  );
  if (cycle.active) {
    const level = cycle.level ? LEVEL_TEXT[cycle.level] : "";
    return (
      <section className="m-card cycle-card on" id="cycle-card">
        <div className="m-card-head">
          <h2>Period mode</h2>
          <span className="cycle-pill">Day {cycle.period_day}</span>
        </div>
        {switchRow(level || "Tell us how you feel to tune today's workout", true)}
        <div className="m-row-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void checkinSheet(cycle.checkin ?? null, false).then((saved) => {
                if (saved) cycleChanged();
              });
            }}
          >
            {cycle.checkin ? "Update how I feel" : "How do I feel?"}
          </button>
          <Link className="btn" to={healthHref}>
            Health
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className={"m-card cycle-card" + (cycle.due_soon ? " due" : "")} id="cycle-card">
      <div className="m-card-head">
        <h2>Period mode</h2>
        {compact ? null : <Link to={healthHref}>Health</Link>}
      </div>
      {switchRow(predictionText(cycle.prediction) || "Turn on to get a workout that fits how you feel", false)}
    </section>
  );
}

function ChangeTag({ item }: { item: CyclePlanItem }) {
  if (item.change === "swapped") return <span className="cycle-tag swap">instead of {item.replaces ?? ""}</span>;
  if (item.change === "added") return <span className="cycle-tag swap">new today</span>;
  if (item.change === "lighter") return <span className="cycle-tag">lighter</span>;
  return null;
}


function PlanItem({ item }: { item: CyclePlanItem }) {
  return (
    <div className="m-item">
      <span className="grow">
        <b>
          {item.name} <ChangeTag item={item} />
        </b>
        <span>
          {planItemAmount(item)}
          {item.target_weight ? " at " + num(item.target_weight) + " kg" : ""}
          {item.rest_seconds ? ", rest " + String(item.rest_seconds) + " s" : ""}
        </span>
        {item.cue ? <span className="cycle-cue">{item.cue}</span> : null}
      </span>
    </div>
  );
}

export function AdjustedPlan({ programId, onStart }: { programId: number; onStart: () => void }) {
  const cycle = useCycleState();
  const [fresh, setFresh] = useState(0);
  const active = Boolean(cycle?.eligible && cycle.active && cycle.checkin);
  const plan = useResource<CyclePlan | null>(
    (signal) => (active ? api.post<CyclePlan>("/api/cycle/plan/" + String(programId) + "?day=" + todayIso() + (fresh ? "&fresh=true" : ""), undefined, { signal }) : Promise.resolve(null)),
    [programId, active, fresh],
    ["cycle"],
  );
  if (!cycle?.eligible || !cycle.active) return null;
  const update = () => {
    void checkinSheet(cycle.checkin ?? null, false).then((saved) => {
      if (saved) cycleChanged();
    });
  };
  if (!cycle.checkin) {
    return (
      <section className="m-card cycle-plan">
        <div className="m-card-head">
          <h2>Today, adjusted</h2>
          <span className="cycle-pill">Day {cycle.period_day}</span>
        </div>
        <p className="small muted">Tell your coach how you feel and this workout gets tuned for today.</p>
        <button type="button" className="btn primary" onClick={update}>
          How do I feel?
        </button>
      </section>
    );
  }
  if (plan.error) {
    return (
      <section className="m-card cycle-plan">
        <p className="small muted">The adjusted plan could not be loaded: {plan.error.message}</p>
      </section>
    );
  }
  if (plan.loading || !plan.data) {
    if (!plan.loading) return null;
    return (
      <section className="m-card cycle-plan">
        <div className="m-card-head">
          <h2>Today, adjusted</h2>
          <span className="cycle-pill">Day {cycle.period_day}</span>
        </div>
        <p className="small muted">Your coach is tuning this workout to how you feel.</p>
      </section>
    );
  }
  const data = plan.data;
  if (!data.active) return null;
  return (
    <section className="m-card cycle-plan">
      <div className="m-card-head">
        <h2>Today, adjusted</h2>
        <span className="cycle-pill">{LEVEL_TEXT[data.level]}</span>
      </div>
      {data.note ? <p>{data.note}</p> : null}
      {data.advice.length ? (
        <div className="cycle-advice">
          {data.advice.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      <div className="m-list">
        {data.items.map((item, index) => (
          <PlanItem key={String(item.exercise_id) + "-" + String(index)} item={item} />
        ))}
      </div>
      <p className="small muted">
        {data.source === "ai" ? "Tuned by your AI coach within safe limits." : "Tuned by the built in rules" + (data.ai_error ? " because the AI coach was not available." : ".")} Your saved program is not changed.
      </p>
      {data.level === "none" ? null : (
        <button type="button" className="btn primary m-btn-xl" onClick={onStart}>
          Start adjusted workout
        </button>
      )}
      <div className="m-row-actions">
        <button type="button" className="btn" onClick={update}>
          Update how I feel
        </button>
        <button type="button" className="btn" onClick={() => setFresh((value) => value + 1)}>
          Ask the coach again
        </button>
      </div>
    </section>
  );
}

class LockedError extends Error {
  constructor() {
    super("locked");
    this.name = "LockedError";
  }
}

function tokenKey(): string {
  return "health-token-" + String(userStore.get()?.id ?? "");
}

export function healthToken(): string {
  return sessionGet(tokenKey());
}

function setHealthToken(value: string): void {
  sessionSet(tokenKey(), value);
}

async function healthApi<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  try {
    return await request<T>(method, path, body, { headers: { "X-Health-Token": healthToken() } });
  } catch (error) {
    if (error instanceof ApiError && error.status === 423) {
      setHealthToken("");
      throw new LockedError();
    }
    throw error;
  }
}

function PinGate({ pinSet, onUnlocked }: { pinSet: boolean; onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const value = pin.trim();
    if (!pinSet) {
      if (!/^\d{4,8}$/.test(value)) {
        toast("Use 4 to 8 digits", "error");
        return;
      }
      if (value !== repeat.trim()) {
        toast("The PINs do not match", "error");
        return;
      }
    }
    setBusy(true);
    try {
      const result = await api.post<{ token: string }>(pinSet ? "/api/cycle/unlock" : "/api/cycle/pin", { pin: value });
      setHealthToken(result.token);
      onUnlocked();
    } catch (error) {
      setBusy(false);
      errorToast(error);
    }
  };
  return (
    <section className="m-card pin-gate">
      <h2>{pinSet ? "Enter your health PIN" : "Protect your health page"}</h2>
      <p className="small muted">{pinSet ? "This page is private to you." : "Pick a PIN with 4 to 8 digits. Nobody else, not even the server admin in the app, can open this page without it."}</p>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        placeholder="PIN"
        aria-label="PIN"
        value={pin}
        autoFocus
        onChange={(event) => setPin(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void go();
        }}
      />
      {pinSet ? null : (
        <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="Repeat PIN" aria-label="Repeat PIN" value={repeat} onChange={(event) => setRepeat(event.target.value)} />
      )}
      <button type="button" className="btn primary m-btn-xl" disabled={busy} onClick={() => void go()}>
        {pinSet ? "Unlock" : "Set PIN"}
      </button>
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: string | number | null; unit?: string }) {
  return (
    <div className="m-stat">
      <span>{label}</span>
      <b>
        {value === null ? (
          "–"
        ) : (
          <>
            {String(value)}
            {unit ? <small>{unit}</small> : null}
          </>
        )}
      </b>
    </div>
  );
}

function heatColor(value: number | null | undefined, max: number, good: boolean): string {
  if (value === null || value === undefined) return "transparent";
  const share = Math.max(0, Math.min(1, value / max));
  const strength = good ? 1 - share : share;
  return "color-mix(in srgb, var(--plate-red, #e5484d) " + String(Math.round(strength * 85)) + "%, var(--iron-3))";
}

const SYMPTOM_ROWS: [string, string, number, boolean][] = [
  ["energy", "Energy", 5, true],
  ["cramps", "Cramps", 3, false],
  ["back_pain", "Back", 3, false],
  ["headache", "Head", 3, false],
  ["bloating", "Bloating", 3, false],
  ["flow", "Flow", 3, false],
  ["mood", "Mood", 5, true],
  ["sleep", "Sleep", 5, true],
];

function Insight({ insight }: { insight: CycleHealth["insight"] }) {
  if (!insight) return <p className="small muted">Your AI coach can look at your logs and point out your personal patterns.</p>;
  return (
    <>
      <p>{insight.summary}</p>
      {insight.points.length ? (
        <ul className="cycle-points">
          {insight.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      <p className="small muted">Written {dayLabel(insight.created)}. Not medical advice.</p>
    </>
  );
}

function PeriodForm({ cycle, onDone, onLocked }: { cycle: CycleHealth["cycles"][number] | null; onDone: () => void; onLocked: () => void }) {
  const [start, setStart] = useState(cycle?.start ?? "");
  const [end, setEnd] = useState(cycle?.end ?? "");
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      onDone();
    } catch (error) {
      if (error instanceof LockedError) onLocked();
      else errorToast(error);
    }
  };
  const save = () => {
    if (!start) {
      toast("Pick the first day", "error");
      return;
    }
    const body = { start_day: start, end_day: end || null };
    void run(() => (cycle ? healthApi("PUT", "/api/cycle/periods/" + String(cycle.id), body) : healthApi("POST", "/api/cycle/periods", body)));
  };
  return (
    <>
      <div className="modal-head">
        <h2>{cycle ? "Edit period" : "Add past period"}</h2>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>First day</span>
          <input type="date" max={todayIso()} value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="field">
          <span>Last day</span>
          <input type="date" max={todayIso()} value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      <div className="modal-foot">
        {cycle ? (
          <button type="button" className="btn danger left" onClick={() => void run(() => healthApi("DELETE", "/api/cycle/periods/" + String(cycle.id)))}>
            Delete
          </button>
        ) : null}
        <button type="button" className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </>
  );
}

function PinChange({ close }: { close: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = async () => {
    const pin = next.trim();
    if (!/^\d{4,8}$/.test(pin)) {
      toast("Use 4 to 8 digits", "error");
      return;
    }
    try {
      const result = await api.post<{ token: string }>("/api/cycle/pin", { pin, current_pin: current.trim() });
      setHealthToken(result.token);
      close();
      toast("PIN changed");
    } catch (error) {
      errorToast(error);
    }
  };
  return (
    <>
      <div className="modal-head">
        <h2>Change PIN</h2>
      </div>
      <input type="password" inputMode="numeric" maxLength={8} placeholder="Current PIN" aria-label="Current PIN" value={current} onChange={(event) => setCurrent(event.target.value)} />
      <input type="password" inputMode="numeric" maxLength={8} placeholder="New PIN" aria-label="New PIN" value={next} onChange={(event) => setNext(event.target.value)} />
      <div className="modal-foot">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}

function EraseForm({ close, onErased }: { close: () => void; onErased: () => void }) {
  const [pin, setPin] = useState("");
  const erase = async () => {
    try {
      await api.post("/api/cycle/erase", { pin: pin.trim() });
      setHealthToken("");
      close();
      toast("Deleted");
      cycleChanged();
      onErased();
    } catch (error) {
      errorToast(error);
    }
  };
  return (
    <>
      <div className="modal-head">
        <h2>Delete all cycle data</h2>
      </div>
      <p className="muted">All periods, check ins, the coach review and your PIN are deleted for good. Your workouts stay.</p>
      <input type="password" inputMode="numeric" maxLength={8} placeholder="Your PIN" aria-label="Your PIN" value={pin} onChange={(event) => setPin(event.target.value)} />
      <div className="modal-foot">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn danger" onClick={() => void erase()}>
          Delete
        </button>
      </div>
    </>
  );
}

function HealthBody({ data, onReload, onLocked, home }: { data: CycleHealth; onReload: () => void; onLocked: () => void; home: string }) {
  const navigate = useNavigate();
  const [insight, setInsight] = useState(data.insight);
  const [insightState, setInsightState] = useState<"idle" | "busy" | "failed">("idle");
  const summary = data.summary;
  const prediction = data.prediction;
  const userId = userStore.get()?.id ?? 0;
  const mapDays = data.symptom_map.filter((entry) => entry.cycle_day <= 35);
  const phaseHasData = data.phases.some((phase) => phase.strength !== null || phase.energy !== null || phase.effort !== null);
  const lengthLabels = useMemo(() => data.lengths.map((entry) => entry.start), [data.lengths]);
  const lengthSeries = useMemo(() => [{ label: "Cycle length", data: data.lengths.map((entry) => entry.length), color: cssVar("--action") || "#f2c14e" }], [data.lengths]);
  const authQuery = "?token=" + encodeURIComponent(healthToken()) + "&uid=" + String(userId);

  const writeInsight = async () => {
    setInsightState("busy");
    try {
      setInsight(await healthApi<NonNullable<CycleHealth["insight"]>>("POST", "/api/cycle/insight"));
      setInsightState("idle");
    } catch (error) {
      if (error instanceof LockedError) {
        onLocked();
        return;
      }
      errorToast(error);
      setInsightState("failed");
    }
  };

  const periodSheet = (cycle: CycleHealth["cycles"][number] | null) => {
    const handle = openModal(
      () => (
        <PeriodForm
          cycle={cycle}
          onDone={() => {
            handle.close();
            onReload();
          }}
          onLocked={() => {
            handle.close();
            onLocked();
          }}
        />
      ),
      { label: cycle ? "Edit period" : "Add past period" },
    );
  };

  return (
    <>
      {data.flags.length ? (
        <section className="m-card cycle-flags">
          <h2>Worth a look</h2>
          {data.flags.map((flag) => (
            <p key={flag}>{flag}</p>
          ))}
          <p className="small muted">These notes come from simple rules on your own logs. They are not a diagnosis.</p>
        </section>
      ) : null}
      <section className="m-card">
        <div className="m-card-head">
          <h2>Next period</h2>
        </div>
        {prediction ? (
          <>
            <p>
              <b>{dayLabel(prediction.next_start)}</b>, likely between {dayLabel(prediction.window_start)} and {dayLabel(prediction.window_end)}.
            </p>
            <p className="small muted">{prediction.based_on ? "Based on " + plural(prediction.based_on, "cycle") + "." : "Based on a typical 28 day cycle until you log more."}</p>
          </>
        ) : (
          <p className="small muted">Log your first period to see a forecast. You can also add past periods below.</p>
        )}
      </section>
      <section className="m-stat-row">
        <Stat label="Cycle" value={summary.average_cycle} unit="days" />
        <Stat label="Period" value={summary.average_period} unit="days" />
        <Stat label="Range" value={summary.shortest !== null ? String(summary.shortest) + " to " + String(summary.longest ?? "") : null} unit="days" />
        <Stat label="Pattern" value={summary.regularity || null} />
      </section>
      {data.lengths.length >= 2 ? (
        <section className="m-card">
          <h2>Cycle length</h2>
          <BarChart className="cycle-chart" labels={lengthLabels} series={lengthSeries} unit="days" suggestedMin={18} suggestedMax={38} formatLabel={dayLabel} weekTitles={false} />
        </section>
      ) : null}
      <section className="m-card">
        <h2>Your symptoms by cycle day</h2>
        {mapDays.length ? (
          <>
            <div className="cycle-heat" style={{ "--days": mapDays.length } as CSSProperties}>
              <span />
              {mapDays.map((entry) => (
                <em key={"d" + String(entry.cycle_day)}>{entry.cycle_day}</em>
              ))}
              {SYMPTOM_ROWS.map(([key, label, max, good]) => [
                <span key={key}>{label}</span>,
                ...mapDays.map((entry) => (
                  <i
                    key={key + String(entry.cycle_day)}
                    title={label + " day " + String(entry.cycle_day) + ": " + String(entry[key] ?? "no data")}
                    style={{ background: heatColor(entry[key], max, good) }}
                  />
                )),
              ])}
            </div>
            <p className="small muted">Darker means stronger symptoms, or lower energy, mood and sleep.</p>
          </>
        ) : (
          <p className="small muted">Fill in &quot;How do I feel?&quot; on period days to see your own pattern here.</p>
        )}
      </section>
      <section className="m-card">
        <h2>Training across your cycle</h2>
        {phaseHasData ? (
          <>
            <div className="cycle-table">
              <div className="head">
                <span>Cycle days</span>
                <span>Strength</span>
                <span>Effort</span>
                <span>Energy</span>
              </div>
              {data.phases.map((phase) => (
                <div key={phase.label}>
                  <span>
                    {phase.label}
                    <small>{plural(phase.sessions, "workout")}</small>
                  </span>
                  <span>{phase.strength !== null ? num(phase.strength, 0) + " %" : "–"}</span>
                  <span>{phase.effort !== null ? num(phase.effort, 1) : "–"}</span>
                  <span>{phase.energy !== null ? num(phase.energy, 1) : "–"}</span>
                </div>
              ))}
            </div>
            <p className="small muted">
              Strength is your normal workouts compared with your own typical level (100 %). Adjusted period workouts are left out so they do not pull the numbers down.
            </p>
          </>
        ) : (
          <p className="small muted">After a few cycles with workouts you will see here whether your training changes across your cycle. For most women it does not change much.</p>
        )}
      </section>
      <section className="m-card">
        <div className="m-card-head">
          <h2>Coach review</h2>
        </div>
        <div>
          <Insight insight={insight} />
        </div>
        <button type="button" className="btn" disabled={insightState === "busy"} onClick={() => void writeInsight()}>
          {insightState === "busy" ? "Your coach is reading your numbers" : insightState === "failed" ? "Try again" : insight ? "New review" : "Write my review"}
        </button>
      </section>
      <section className="m-card">
        <div className="m-card-head">
          <h2>Periods</h2>
          <button type="button" className="link" onClick={() => periodSheet(null)}>
            Add past period
          </button>
        </div>
        {data.cycles.length ? (
          <div className="m-list">
            {data.cycles.map((cycle) => (
              <button key={cycle.id} type="button" className="m-item" onClick={() => periodSheet(cycle)}>
                <span className="grow">
                  <b>
                    {dayLabel(cycle.start)}
                    {cycle.end ? " to " + dayLabel(cycle.end) : ", ongoing"}
                  </b>
                  <span>
                    {cycle.period_length ? String(cycle.period_length) + " days" : ""}
                    {cycle.cycle_length ? (cycle.period_length ? ", " : "") + "cycle " + String(cycle.cycle_length) + " days" : ""}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted">No periods logged yet.</p>
        )}
      </section>
      <section className="m-card">
        <h2>Your data</h2>
        <div className="m-row-actions">
          <a className="btn" href={"/api/cycle/report" + authQuery} target="_blank" rel="noreferrer">
            Report for a doctor
          </a>
          <a className="btn" href={"/api/cycle/export" + authQuery}>
            Download data
          </a>
        </div>
        <div className="m-row-actions">
          <button type="button" className="btn" onClick={() => openModal((close) => <PinChange close={close} />, { label: "Change PIN" })}>
            Change PIN
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => openModal((close) => <EraseForm close={close} onErased={() => void navigate(home)} />, { label: "Delete all cycle data" })}
          >
            Delete all
          </button>
        </div>
        <p className="small muted">
          Stored only on your home server. Your cycle never shows up in the team board, summaries or Alexa. The AI coach only gets anonymous numbers, never your name or dates.
        </p>
      </section>
    </>
  );
}

export interface HealthHeaderProps {
  lock: (() => void) | null;
}

export function HealthView({ Header, home, bodyClassName }: { Header: ComponentType<HealthHeaderProps>; home: string; bodyClassName?: string }) {
  const cycle = useCycleState();
  const [unlock, setUnlock] = useState(0);
  const unlocked = Boolean(healthToken());
  const health = useResource<CycleHealth | "locked" | null>(
    async () => {
      if (!unlocked) return null;
      try {
        return await healthApi<CycleHealth>("GET", "/api/cycle/health");
      } catch (error) {
        if (error instanceof LockedError) return "locked";
        throw error;
      }
    },
    [unlocked, unlock],
    ["cycle"],
  );
  const relock = () => {
    setHealthToken("");
    setUnlock((value) => value + 1);
  };
  const showData = unlocked && health.data && health.data !== "locked";
  let body;
  if (!cycle) body = <div className="skeleton m-skeleton" aria-busy="true" />;
  else if (!cycle.eligible) body = <div className="empty">This page is only available for female profiles.</div>;
  else if (!unlocked || health.data === "locked") body = <PinGate pinSet={Boolean(cycle.pin_set) || health.data === "locked"} onUnlocked={() => setUnlock((value) => value + 1)} />;
  else if (health.error) body = <div className="empty">{health.error.message}</div>;
  else if (!health.data) body = <div className="skeleton m-skeleton" aria-busy="true" />;
  else body = <HealthBody key={unlock} data={health.data} onReload={health.reload} onLocked={relock} home={home} />;
  return (
    <>
      <Header lock={showData ? relock : null} />
      {bodyClassName ? <div className={bodyClassName}>{body}</div> : body}
    </>
  );
}
