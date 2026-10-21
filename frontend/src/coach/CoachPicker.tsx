import { type CSSProperties, useRef } from "react";
import type { CoachKey } from "@/lib/types";
import { COACHES } from "@/three/coachModels";
import { CoachStage, type CoachStageHandle } from "./CoachStage";

export function CoachPicker({ current, onPick }: { current: CoachKey | null; onPick: (key: CoachKey) => void }) {
  const stages = useRef<Partial<Record<CoachKey, CoachStageHandle | null>>>({});
  return (
    <div className="coach-picker" role="radiogroup" aria-label="Choose your coach">
      {Object.values(COACHES).map((coach) => (
        <button
          key={coach.key}
          type="button"
          className="coach-pick"
          role="radio"
          aria-checked={current === coach.key}
          aria-pressed={current === coach.key}
          style={{ "--coach-color": coach.color } as CSSProperties}
          onClick={() => {
            stages.current[coach.key]?.action("celebrate");
            onPick(coach.key);
          }}
        >
          <CoachStage
            coach={coach.key}
            className="coach-pick-stage"
            mode="picker"
            greetOnClick={false}
            handleRef={(handle) => {
              stages.current[coach.key] = handle;
            }}
          />
          <div className="coach-pick-text">
            <b>{coach.name}</b>
            <span>{coach.title}</span>
            <small>{coach.style}</small>
          </div>
          <span className="coach-pick-badge">Your coach</span>
        </button>
      ))}
    </div>
  );
}
