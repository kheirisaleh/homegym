import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { EXPERIENCE, GOALS, MUSCLE_NAMES, REGIONS, shortMuscleName } from "@/lib/catalog";
import type { CoachKey, Sex, User } from "@/lib/types";
import { gateStore, showGenerating } from "@/app/session";
import { CoachPicker } from "@/coach/CoachPicker";
import { SELECTABLE_MUSCLES } from "@/three/anatomy";
import { BodyModel, type BodyModelHandle } from "@/three/BodyModel";
import { SexIcon } from "@/ui/icons";
import { errorToast } from "@/ui/toast";

export interface Answers {
  name: string;
  sex: Sex | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  experience: string | null;
  trained_recently: boolean | null;
  goal: string | null;
  priority_muscles: string[];
  days_per_week: number;
  session_minutes: number;
  limitations: string;
  coach: CoachKey | null;
}

export const EMPTY_ANSWERS: Answers = {
  name: "", sex: null, age: null, height_cm: null, weight_kg: null, experience: null, trained_recently: null, goal: null, priority_muscles: [],
  days_per_week: 3, session_minutes: 60, limitations: "", coach: null,
};

export function splitDescription(answers: Pick<Answers, "days_per_week" | "experience" | "trained_recently">): string {
  const days = answers.days_per_week;
  const beginner = answers.experience === "none" || answers.experience === "under_6_months" || (answers.experience === "6_to_24_months" && !answers.trained_recently);
  if (days <= 3) return "Full body workouts, every muscle twice a week.";
  if (beginner) return "3 full body workouts plus " + String(days - 3) + " cardio day" + (days - 3 > 1 ? "s" : "") + ", the best start for beginners.";
  if (days === 4) return "Upper and lower body split.";
  if (days === 5) return "Upper, lower, push, pull and legs.";
  return "Push, pull and legs, twice a week.";
}

export function stepValid(index: number, answers: Answers): boolean {
  switch (index) {
    case 0:
      return answers.name.trim().length > 0;
    case 1:
      return answers.sex !== null;
    case 2:
      return (
        answers.age !== null && answers.age >= 12 && answers.age <= 100 && answers.height_cm !== null && answers.height_cm >= 120 && answers.height_cm <= 230 &&
        answers.weight_kg !== null && answers.weight_kg >= 30 && answers.weight_kg <= 300
      );
    case 3:
      return answers.experience !== null && (answers.experience === "none" || answers.trained_recently !== null);
    case 4:
      return answers.goal !== null;
    case 7:
      return answers.coach !== null;
    default:
      return true;
  }
}

const STEPS = [
  { title: "What is your name?", lead: "Everyone in this gym picks their name to log in. No password." },
  { title: "Your body", lead: "This picks the 3D model you choose your target muscles on." },
  { title: "Age, height and weight", lead: "Used for your BMI, joint friendly cardio when needed, and to track your weight trend." },
  { title: "Have you trained before?", lead: "Your experience sets how much volume your first program has." },
  { title: "Why do you want to train?", lead: "Your main goal shapes reps, rest and how much cardio you get." },
  { title: "Which muscles matter most to you?", lead: "Tap muscles on the model or pick them from the list. Drag to turn the body around. These get extra training.", wide: true },
  { title: "How often can you train?", lead: "Be realistic. A plan you can keep beats a perfect plan you skip." },
  { title: "Choose your coach", lead: "Tap a coach to meet them. Your coach briefs you before every workout, debriefs you after it and keeps improving your program.", wide: true },
  { title: "Anything the coach should know?", lead: "Injuries, pain, things you hate or love. Optional.", last: true },
];

function NumField({ id, label, unit, value, min, max, step, onChange, autoFocus }: {
  id: string; label: string; unit: string; value: number | null; min: number; max: number; step: number; onChange: (value: number | null) => void; autoFocus?: boolean;
}) {
  return (
    <label className="num-field" htmlFor={id}>
      <span>{label}</span>
      <div>
        <input
          type="number"
          inputMode="decimal"
          id={id}
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
        <em>{unit}</em>
      </div>
    </label>
  );
}

export function Onboarding({ mobile, hasUsers }: { mobile: boolean; hasUsers: boolean }) {
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [spin, setSpin] = useState(false);
  const model = useRef<BodyModelHandle | null>(null);
  const advance = useRef(0);
  const current = STEPS[step]!;
  const valid = stepValid(step, answers);

  useEffect(() => () => window.clearTimeout(advance.current), []);

  const update = (fields: Partial<Answers>) => setAnswers((value) => ({ ...value, ...fields }));

  const goNext = (from: number, state: Answers) => {
    if (!stepValid(from, state)) return;
    if (STEPS[from]?.last) {
      void submit(state);
      return;
    }
    setStep(from + 1);
  };

  const pickAndAdvance = (fields: Partial<Answers>) => {
    const next = { ...answers, ...fields };
    setAnswers(next);
    window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => goNext(step, next), 180);
  };

  const submit = async (state: Answers) => {
    setSaving(true);
    try {
      const user = await api.post<User>("/api/users", { ...state, name: state.name.trim(), trained_recently: Boolean(state.trained_recently) });
      showGenerating(user);
    } catch (error) {
      errorToast(error);
      setSaving(false);
      if (error instanceof ApiError && /name/i.test(error.message)) setStep(0);
    }
  };

  const toggleMuscle = (muscle: string, on?: boolean) =>
    setAnswers((value) => {
      const has = value.priority_muscles.includes(muscle);
      const want = on ?? !has;
      if (want === has) return value;
      return { ...value, priority_muscles: want ? [...value.priority_muscles, muscle] : value.priority_muscles.filter((entry) => entry !== muscle) };
    });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && (event.target as HTMLElement).tagName !== "TEXTAREA" && !(event.target as HTMLElement).closest("button") && valid && !saving) {
      event.preventDefault();
      goNext(step, answers);
    }
  };

  let body: ReactNode;
  if (step === 0) {
    body = (
      <input
        className="big-input"
        type="text"
        maxLength={40}
        autoComplete="off"
        placeholder="Your name"
        aria-label="Your name"
        autoFocus
        value={answers.name}
        onChange={(event) => update({ name: event.target.value })}
      />
    );
  } else if (step === 1) {
    body = (
      <div className="choice-grid two">
        {(["male", "female"] as const).map((sex) => (
          <button key={sex} type="button" className={"choice sex-" + sex} aria-pressed={answers.sex === sex} onClick={() => pickAndAdvance({ sex })}>
            <span className="choice-icon">
              <SexIcon sex={sex} />
            </span>
            <b>{sex === "male" ? "Male" : "Female"}</b>
          </button>
        ))}
      </div>
    );
  } else if (step === 2) {
    body = (
      <div className="num-fields">
        <NumField id="o-age" label="Age" unit="years" value={answers.age} min={12} max={100} step={1} onChange={(age) => update({ age })} autoFocus />
        <NumField id="o-height" label="Height" unit="cm" value={answers.height_cm} min={120} max={230} step={1} onChange={(height_cm) => update({ height_cm })} />
        <NumField id="o-weight" label="Weight" unit="kg" value={answers.weight_kg} min={30} max={300} step={0.1} onChange={(weight_kg) => update({ weight_kg })} />
      </div>
    );
  } else if (step === 3) {
    body = (
      <>
        <div className="choice-grid">
          {EXPERIENCE.map(([key, label, text]) => (
            <button
              key={key}
              type="button"
              className="choice"
              aria-pressed={answers.experience === key}
              onClick={() => (key === "none" ? pickAndAdvance({ experience: key, trained_recently: false }) : update({ experience: key }))}
            >
              <b>{label}</b>
              <span>{text}</span>
            </button>
          ))}
        </div>
        {answers.experience && answers.experience !== "none" ? (
          <div className="toggle-row">
            <span>Did you train regularly in the last 3 months?</span>
            <div className="seg big-seg">
              {([[true, "Yes"], [false, "No"]] as const).map(([value, label]) => (
                <button key={label} type="button" aria-pressed={answers.trained_recently === value} onClick={() => pickAndAdvance({ trained_recently: value })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </>
    );
  } else if (step === 4) {
    body = (
      <div className="choice-grid">
        {GOALS.map(([key, label, text]) => (
          <button key={key} type="button" className="choice" aria-pressed={answers.goal === key} onClick={() => pickAndAdvance({ goal: key })}>
            <b>{label}</b>
            <span>{text}</span>
          </button>
        ))}
      </div>
    );
  } else if (step === 5) {
    const count = answers.priority_muscles.length;
    body = (
      <div className="muscle-step">
        <div className="model-wrap">
          <BodyModel
            sex={answers.sex ?? "male"}
            selected={answers.priority_muscles}
            labels={MUSCLE_NAMES}
            onToggle={(muscle, on) => toggleMuscle(muscle, on)}
            handleRef={model}
          />
          <div className="model-tools">
            <button type="button" className="btn small" onClick={() => model.current?.front()}>
              Front
            </button>
            <button type="button" className="btn small" onClick={() => model.current?.back()}>
              Back
            </button>
            <button
              type="button"
              className="btn small"
              aria-pressed={spin}
              onClick={() => {
                model.current?.setAutoRotate(!spin);
                setSpin(!spin);
              }}
            >
              Spin
            </button>
          </div>
        </div>
        <div className="muscle-pick-list">
          <div className="region-row">
            {REGIONS.map(([label, list]) => (
              <button
                key={label}
                type="button"
                className="chip region"
                onClick={() => {
                  const all = list.every((muscle) => answers.priority_muscles.includes(muscle));
                  list.forEach((muscle) => toggleMuscle(muscle, !all));
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="muscle-chips">
            {SELECTABLE_MUSCLES.map((muscle) => (
              <button key={muscle} type="button" className="chip muscle-chip" aria-pressed={answers.priority_muscles.includes(muscle)} onClick={() => toggleMuscle(muscle)}>
                {MUSCLE_NAMES[muscle]}
              </button>
            ))}
          </div>
          <p className="small muted">
            {count === 0
              ? "Pick at least one, or skip if you want a balanced program."
              : count > 4
                ? "Tip: more than 4 priorities means nothing is really a priority. The coach will still balance it."
                : String(count) + " selected."}
          </p>
        </div>
      </div>
    );
  } else if (step === 6) {
    body = (
      <>
        <div className="field-block">
          <span className="field-label">Days per week</span>
          <div className="day-picker">
            {[1, 2, 3, 4, 5, 6, 7].map((days) => (
              <button key={days} type="button" aria-pressed={answers.days_per_week === days} onClick={() => update({ days_per_week: days })}>
                {days}
              </button>
            ))}
          </div>
        </div>
        <div className="field-block">
          <span className="field-label">Minutes per session</span>
          <div className="day-picker minutes">
            {[30, 45, 60, 75, 90].map((minutes) => (
              <button key={minutes} type="button" aria-pressed={answers.session_minutes === minutes} onClick={() => update({ session_minutes: minutes })}>
                {minutes}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">{splitDescription(answers)}</p>
      </>
    );
  } else if (step === 7) {
    body = <CoachPicker current={answers.coach} onPick={(coach) => update({ coach })} />;
  } else {
    const goal = GOALS.find((entry) => entry[0] === answers.goal);
    body = (
      <>
        <textarea
          className="big-input"
          maxLength={600}
          aria-label="Anything the coach should know"
          placeholder="e.g. my left knee hurts when I run, I love dumbbell work"
          value={answers.limitations}
          onChange={(event) => update({ limitations: event.target.value })}
        />
        <div className="review">
          <div>
            <span>Name</span>
            <b>{answers.name}</b>
          </div>
          <div>
            <span>Body</span>
            <b>
              {answers.sex}, {answers.age} years, {answers.height_cm} cm, {answers.weight_kg} kg
            </b>
          </div>
          <div>
            <span>Goal</span>
            <b>{goal ? goal[1] : ""}</b>
          </div>
          <div>
            <span>Target muscles</span>
            <b>{answers.priority_muscles.map(shortMuscleName).join(", ") || "balanced"}</b>
          </div>
          <div>
            <span>Schedule</span>
            <b>
              {answers.days_per_week} days, {answers.session_minutes} minutes
            </b>
          </div>
          <div>
            <span>Coach</span>
            <b>{answers.coach === "lena" ? "Lena" : "Max"}</b>
          </div>
        </div>
      </>
    );
  }

  const nextLabel = saving ? "Saving" : current.last ? "Write my program" : step === 5 && !answers.priority_muscles.length ? "Skip" : "Next";

  return (
    <div className={"gate-inner wizard" + (mobile ? " mobile" : "")} onKeyDown={onKeyDown}>
      <div className="wizard-top">
        <button type="button" className="btn ghost small" onClick={() => gateStore.set({ kind: "picker" })}>
          {hasUsers ? "Back to users" : "Cancel"}
        </button>
        <div className="wizard-progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
          {STEPS.map((entry, index) => (
            <i key={entry.title} className={index < step ? "done" : index === step ? "now" : ""} />
          ))}
        </div>
      </div>
      <div className={"wizard-body" + (current.wide ? " wide" : "")} key={step}>
        <div className="step-count">
          Step {step + 1} of {STEPS.length}
        </div>
        <h1>{current.title}</h1>
        <p className="gate-lead">{current.lead}</p>
        <div className="step-content">{body}</div>
      </div>
      <div className="wizard-nav">
        <button type="button" className="btn big" style={{ visibility: step === 0 ? "hidden" : "visible" }} onClick={() => setStep((value) => Math.max(0, value - 1))}>
          Back
        </button>
        <button type="button" className="btn primary big" disabled={!valid || saving} onClick={() => goNext(step, answers)}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
