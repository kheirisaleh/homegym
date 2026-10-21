import { type CSSProperties, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CoachStage as Engine, type Framing, type StageMode, webglAvailable } from "@/three/coachEngine";
import { coachInfo } from "@/three/coachModels";
import type { CoachKey } from "@/lib/types";

export interface CoachStageHandle {
  greet: () => void;
  action: (name: string) => void;
  demo: (pattern: string | null) => boolean;
  think: () => void;
  talk: (mood: string) => void;
  finish: (mood: string) => void;
  beat: (strength: number) => void;
  intro: () => void;
  later: (seconds: number, fn: () => void) => void;
  isTalking: () => boolean;
}

interface Props {
  coach: CoachKey;
  framing?: Framing;
  mode?: StageMode;
  intro?: boolean;
  demoPattern?: string | null;
  className?: string;
  greetOnClick?: boolean;
  handleRef?: Ref<CoachStageHandle | null>;
  onReady?: () => void;
}

export function CoachStage({ coach, framing = "full", mode = "stage", intro = true, demoPattern = null, className = "", greetOnClick = true, handleRef, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const info = coachInfo(coach);
  const readyRef = useRef(onReady);

  useEffect(() => {
    readyRef.current = onReady;
  });

  useEffect(() => {
    const element = container.current;
    if (!element || !webglAvailable()) return;
    const stage = new Engine(element, info.key, info.color, framing, mode);
    engine.current = stage;
    stage.init().then(
      () => {
        if (stage.disposed) return;
        setReady(true);
        readyRef.current?.();
      },
      () => {
        engine.current = null;
      },
    );
    if (intro) stage.intro();
    return () => {
      stage.dispose();
      engine.current = null;
      setReady(false);
    };
  }, [info.key, info.color, framing, mode, intro]);

  useEffect(() => {
    engine.current?.setDemoPattern(demoPattern);
  }, [demoPattern, ready]);

  useImperativeHandle(
    handleRef,
    () => ({
      greet: () => engine.current?.greet(),
      action: (name) => engine.current?.action(name),
      demo: (pattern) => engine.current?.demo(pattern) ?? false,
      think: () => engine.current?.think(),
      talk: (mood) => engine.current?.talk(mood),
      finish: (mood) => engine.current?.finish(mood),
      beat: (strength) => engine.current?.beat(strength),
      intro: () => engine.current?.intro(),
      later: (seconds, fn) => {
        if (engine.current) engine.current.later(seconds, fn);
        else window.setTimeout(fn, seconds * 1000);
      },
      isTalking: () => engine.current?.talking ?? false,
    }),
    [],
  );

  return (
    <div
      ref={container}
      className={"coach-mini " + className + (ready ? " ready" : "")}
      style={{ "--coach-color": info.color } as CSSProperties}
      onClick={greetOnClick ? () => engine.current?.greet() : undefined}
      aria-hidden="true"
    >
      <div className="coach-fallback">
        <span style={{ background: info.color }}>{info.name[0]}</span>
      </div>
    </div>
  );
}
