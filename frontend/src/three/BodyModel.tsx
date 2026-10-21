import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { type BodyViewer, createBodyViewer } from "./anatomy";

export interface BodyModelHandle {
  front: () => void;
  back: () => void;
  setAutoRotate: (on: boolean) => void;
}

interface Props {
  sex: string;
  selected: string[];
  interactive?: boolean;
  autoRotate?: boolean;
  labels?: Record<string, string>;
  onToggle?: (muscle: string, on: boolean) => void;
  className?: string;
  handleRef?: Ref<BodyModelHandle | null>;
}

export function BodyModel({ sex, selected, interactive = true, autoRotate = false, labels, onToggle, className = "model-box", handleRef }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<BodyViewer | null>(null);
  const toggleRef = useRef(onToggle);
  const initial = useRef({ selected, autoRotate, interactive, labels });

  useEffect(() => {
    toggleRef.current = onToggle;
  });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const options = initial.current;
    const created = createBodyViewer(element, {
      sex,
      selected: options.selected,
      interactive: options.interactive,
      autoRotate: options.autoRotate,
      ...(options.labels ? { labels: options.labels } : {}),
      onToggle: (muscle, on) => toggleRef.current?.(muscle, on),
    });
    viewer.current = created;
    return () => {
      created?.destroy();
      viewer.current = null;
    };
  }, [sex]);

  useEffect(() => {
    viewer.current?.setSelected(selected);
  }, [selected]);

  useImperativeHandle(
    handleRef,
    () => ({
      front: () => viewer.current?.front(),
      back: () => viewer.current?.back(),
      setAutoRotate: (on) => viewer.current?.setAutoRotate(on),
    }),
    [],
  );

  return <div ref={container} className={className} />;
}
