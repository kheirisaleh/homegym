import type { Program, ProgramItem, SessionExercise } from "./types";

export interface Suggested {
  weight: number | null;
  value: number | null;
}

export function isComplete(item: Pick<SessionExercise, "sets" | "planned_sets">): boolean {
  return item.sets.length >= item.planned_sets;
}

export function firstIncomplete(items: Pick<SessionExercise, "sets" | "planned_sets">[], fromIndex: number): number {
  for (let offset = 0; offset < items.length; offset++) {
    const index = (fromIndex + offset) % items.length;
    const item = items[index];
    if (item && !isComplete(item)) return index;
  }
  return -1;
}

export function suggested(item: SessionExercise): Suggested {
  const last = item.sets.at(-1);
  const setNumber = item.sets.length + 1;
  const previousSets = item.previous ? item.previous.sets : [];
  const previousSame = previousSets.find((set) => set.set_number === setNumber) ?? previousSets.at(-1);
  let weight: number | null = null;
  if (item.track_weight) {
    if (last && last.weight !== null) weight = last.weight;
    else if (item.target_weight) weight = item.target_weight;
    else if (previousSame && previousSame.weight !== null) weight = previousSame.weight;
  }
  let value: number | null = null;
  if (last && last.value !== null) value = last.value;
  else if (previousSame && previousSame.value !== null && (!item.track_weight || previousSame.weight === weight)) value = previousSame.value;
  else if (item.rep_min) value = item.rep_min;
  else {
    const match = /\d+(\.\d+)?/.exec(item.target || "");
    if (match) value = Number(match[0]);
  }
  return { weight, value };
}

export function stepWeight(steps: number[] | null, weight: number | string | null, direction: number): number {
  const current = Number(weight) || 0;
  if (steps?.length) {
    if (direction > 0) return steps.find((value) => value > current + 1e-6) ?? current;
    const lower = steps.filter((value) => value < current - 1e-6);
    return lower.length ? lower[lower.length - 1]! : current;
  }
  return Math.max(0, Math.round((current + direction * 2.5) * 100) / 100);
}

export function stepValue(measure: SessionExercise["measure"]): number {
  return measure === "sec" ? 5 : 1;
}

export function targetText(item: SessionExercise): string {
  const parts = [String(item.planned_sets) + " × " + (item.target || "free")];
  if (item.track_weight && item.target_weight) parts.push("at " + String(item.target_weight) + " kg");
  return parts.join(" ");
}

export function estimateProgramMinutes(program: Pick<Program, "items">, deload = false): number {
  let seconds = 0;
  for (const item of program.items) {
    if (item.measure === "min") {
      seconds += (Number(/\d+/.exec(item.target)?.[0]) || 20) * 60 * item.sets;
      continue;
    }
    const sets = deload ? Math.ceil(item.sets / 2) : item.sets;
    seconds += sets * (45 + item.rest_seconds);
  }
  return Math.max(5, Math.round(seconds / 300) * 5);
}

export function estimatePreviewMinutes(items: Pick<ProgramItem, "measure" | "rep_min" | "sets" | "rest_seconds">[]): number {
  let seconds = 300;
  for (const item of items) {
    if (item.measure === "min") seconds += (item.rep_min || 20) * 60;
    else if (item.measure === "none") seconds += item.sets * 150;
    else seconds += item.sets * (50 + (item.rest_seconds || 60));
  }
  return Math.round(seconds / 60);
}

export function programItemAmount(item: Pick<ProgramItem, "measure" | "target" | "sets">): string {
  if (item.measure === "min") return item.target;
  if (item.measure === "none") return String(item.sets) + " rounds";
  return String(item.sets) + " × " + (item.target || "");
}

export function sessionVolume(exercises: Pick<SessionExercise, "sets">[]): number {
  return exercises.reduce((sum, item) => sum + item.sets.reduce((inner, set) => inner + (set.weight ?? 0) * (set.value ?? 0), 0), 0);
}

export function sessionSetCount(exercises: Pick<SessionExercise, "sets">[]): number {
  return exercises.reduce((sum, item) => sum + item.sets.length, 0);
}

export function newProgramItem(exercise: { id: number; name: string; measure: ProgramItem["measure"]; track_weight: boolean; primary_muscle: string | null }): ProgramItem {
  const measure = exercise.measure;
  return {
    exercise_id: exercise.id,
    name: exercise.name,
    measure,
    track_weight: exercise.track_weight,
    primary_muscle: exercise.primary_muscle,
    sets: measure === "min" ? 1 : 3,
    rep_min: measure === "reps" ? 8 : measure === "sec" ? 30 : measure === "min" ? 20 : null,
    rep_max: measure === "reps" ? 12 : measure === "sec" ? 45 : measure === "min" ? 20 : null,
    target: "",
    target_weight: null,
    rest_seconds: measure === "min" ? 0 : 90,
  };
}

export interface ProgramBody {
  name: string;
  weekday: number | null;
  description: string;
  items: {
    exercise_id: number;
    sets: number;
    target: string;
    rep_min: number | null;
    rep_max: number | null;
    target_weight: number | null;
    rest_seconds: number;
  }[];
}

export interface EditableItem {
  exercise_id: number;
  sets: number | null;
  target: string;
  rep_min: number | null;
  rep_max: number | null;
  target_weight: number | null;
  rest_seconds: number | null;
}

export function programBody(program: Pick<Program, "name" | "weekday" | "description">, items: EditableItem[], overrides: Partial<ProgramBody> = {}): ProgramBody {
  return {
    name: program.name,
    weekday: program.weekday,
    description: program.description || "",
    items: items.map((item) => ({
      exercise_id: item.exercise_id,
      sets: Math.max(1, item.sets || 1),
      target: item.target || "",
      rep_min: item.rep_min,
      rep_max: item.rep_max,
      target_weight: item.target_weight,
      rest_seconds: item.rest_seconds || 0,
    })),
    ...overrides,
  };
}
