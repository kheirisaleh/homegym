import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { coachSays, weekRowState } from "@/lib/coaching";
import { num } from "@/lib/format";
import type { CoachToday, RestTip, Session, WeekProgress } from "@/lib/types";
import { muscleLabel } from "@/app/state";
import { coachInfo } from "@/three/coachModels";
import { CoachStage } from "./CoachStage";

export function WeekBars({ week }: { week: WeekProgress | null | undefined }) {
  if (!week?.rows.length) return <p className="muted small">Your weekly muscle plan appears here once you have a program.</p>;
  return (
    <>
      <div className="wk-bars">
        {week.rows.map((row) => {
          const { state, share, left } = weekRowState(row);
          return (
            <div key={row.muscle} className={"wk-row " + state + (row.priority ? " prio" : "")}>
              <span className="wk-name">
                {row.priority ? <i title="Priority">★</i> : null}
                {muscleLabel(row.muscle)}
              </span>
              <span className="wk-bar">
                <b style={{ width: String(Math.round(share * 100)) + "%" }} />
              </span>
              <span className="wk-num">
                {num(row.done, 0)}
                <small>/{num(row.planned, 0)}</small>
              </span>
              <span className="wk-left">{left <= 0 ? "done" : num(left, 0) + " left"}</span>
            </div>
          );
        })}
      </div>
      <p className="wk-foot small muted">
        Hard sets this week (Monday to Sunday) against your program.{" "}
        {week.days_left ? String(week.days_left) + " day" + (week.days_left === 1 ? "" : "s") + " left this week." : "Last day of the week."}
      </p>
    </>
  );
}

export function WeekSay({ week }: { week: WeekProgress | null | undefined }) {
  const text = coachSays(week, muscleLabel);
  return text ? <p className="wk-say">{text}</p> : null;
}

interface CardProps {
  today: CoachToday;
  active: Session | null;
  actions?: ReactNode;
  demoPattern?: string | null;
}

export function CoachHomeCard({ today, active, actions, demoPattern = null }: CardProps) {
  const coach = coachInfo(today.persona.coach);
  const { brief, program } = today;
  let body: ReactNode;
  if (active) {
    body = (
      <>
        <h2>Workout in progress</h2>
        <p>{active.program_name} is waiting for you. Let&apos;s finish what we started.</p>
      </>
    );
  } else if (brief) {
    body = (
      <>
        <h2>{brief.title}</h2>
        <p>{brief.message}</p>
        {brief.points.length ? (
          <ul className="cc-points">
            {brief.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        ) : null}
      </>
    );
  } else if (program) {
    const when = new Date(today.program_day + "T12:00:00").toLocaleDateString("en", { weekday: "long" });
    body = (
      <>
        <h2>Rest day</h2>
        <p>
          No session planned today. Next up: <b>{program.name}</b> on {when}. Walk, stretch and sleep well.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <h2>Let&apos;s build your plan</h2>
        <p>Once you have a program I brief you before every workout.</p>
      </>
    );
  }
  return (
    <section className="coach-card-home" style={{ "--coach-color": coach.color } as CSSProperties}>
      <CoachStage coach={coach.key} framing="portrait" className="cc-stage" demoPattern={demoPattern} />
      <div className="cc-bubble">
        <div className="cc-tag">
          <b>{coach.name}</b>
          <span>{coach.title}</span>
        </div>
        {body}
        <div className="cc-actions">{actions}</div>
      </div>
    </section>
  );
}

export function RestCoachTip({ sessionExerciseId }: { sessionExerciseId: number | null }) {
  const [tip, setTip] = useState<RestTip | null>(null);
  useEffect(() => {
    if (!sessionExerciseId) return;
    const controller = new AbortController();
    api.get<RestTip>("/api/session-exercises/" + String(sessionExerciseId) + "/tip", { signal: controller.signal }).then(setTip, () => undefined);
    return () => {
      controller.abort();
    };
  }, [sessionExerciseId]);
  if (!tip?.tips.length) return null;
  const coach = coachInfo(tip.persona.coach);
  return (
    <div className="rest-coach" style={{ "--coach-color": coach.color } as CSSProperties}>
      <span className="avatar">{coach.name[0]}</span>
      <div>
        <b>{coach.name}</b>
        {tip.tips.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}
