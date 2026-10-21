import { EQUIPMENT_CATEGORIES } from "./catalog";
import { addDays, formatDay, mondayOf, toIso, weekdayIndex } from "./format";
import type { BlockState, CyclePlanItem, Dashboard, Equipment, Exercise, Program, SessionSummary, SettingsField, VolumeRow } from "./types";

export type VolumeState = "over" | "good" | "low" | "far";

export const VOLUME_LABELS: Record<VolumeState, string> = { over: "Above range", good: "In range", low: "Below range", far: "Far below" };

export function volumeState(row: VolumeRow): VolumeState {
  if (row.done >= row.max) return "over";
  if (row.done >= row.min) return "good";
  if (row.done >= row.min * 0.5) return "low";
  return "far";
}

export interface HeatCell {
  day: string;
  level: number;
  future: boolean;
  title: string;
}

export function heatmapCells(entries: Dashboard["heatmap"], end: Date = new Date()): HeatCell[] {
  const byDay = new Map(entries.map((entry) => [entry.day, entry]));
  const max = Math.max(1, ...entries.map((entry) => entry.sets));
  const today = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const start = addDays(today, -(7 * 30 + weekdayIndex(today)));
  const last = addDays(today, 6 - weekdayIndex(today));
  const cells: HeatCell[] = [];
  for (let cursor = start; cursor <= last; cursor = addDays(cursor, 1)) {
    const iso = toIso(cursor);
    if (cursor > today) {
      cells.push({ day: iso, level: 0, future: true, title: "" });
      continue;
    }
    const entry = byDay.get(iso);
    const level = entry ? Math.min(3, 1 + Math.floor((entry.sets / max) * 2.99)) : 0;
    cells.push({ day: iso, level, future: false, title: formatDay(iso) + (entry ? ": " + String(entry.sets) + " sets" : "") });
  }
  return cells;
}

export type MediaFilter = "" | "none" | "used";

export interface ExerciseFilter {
  query: string;
  muscle: string;
  media: MediaFilter;
}

export function filterExercises(exercises: Exercise[], filter: ExerciseFilter): Exercise[] {
  const query = filter.query.trim().toLowerCase();
  return exercises
    .filter(
      (exercise) =>
        (!query || exercise.name.toLowerCase().includes(query)) &&
        (!filter.muscle || exercise.primary_muscle === filter.muscle || exercise.secondary_muscles.includes(filter.muscle)) &&
        (filter.media !== "none" || (!exercise.media_loop && !exercise.media_muscles)) &&
        (filter.media !== "used" || exercise.program_count > 0),
    )
    .sort((left, right) => Number(right.program_count > 0) - Number(left.program_count > 0) || left.name.localeCompare(right.name));
}

export type ExerciseScope = "plan" | "all" | "nomedia";

export function filterMobileExercises(exercises: Exercise[], query: string, scope: ExerciseScope, label: (muscle: string | null) => string): Exercise[] {
  const text = query.trim().toLowerCase();
  return exercises
    .filter(
      (exercise) =>
        (!text || exercise.name.toLowerCase().includes(text) || label(exercise.primary_muscle).toLowerCase().includes(text)) &&
        (scope !== "plan" || exercise.program_count > 0) &&
        (scope !== "nomedia" || (!exercise.media_loop && !exercise.media_muscles)),
    )
    .sort((left, right) => Number(right.program_count > 0) - Number(left.program_count > 0) || left.name.localeCompare(right.name));
}

export function firstOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function calendarDays(month: Date): Date[] {
  const start = mondayOf(firstOfMonth(month));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function groupByMonth(sessions: SessionSummary[]): [string, SessionSummary[]][] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const key = session.day.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return [...groups.entries()];
}

export function muscleStripe(program: Pick<Program, "items">): { muscle: string; share: number }[] {
  const totals = new Map<string, number>();
  for (const item of program.items) {
    if (item.measure === "min" || item.measure === "none" || !item.primary_muscle) continue;
    totals.set(item.primary_muscle, (totals.get(item.primary_muscle) ?? 0) + item.sets);
  }
  const sum = [...totals.values()].reduce((left, right) => left + right, 0) || 1;
  return [...totals.entries()].sort((left, right) => right[1] - left[1]).map(([muscle, sets]) => ({ muscle, share: sets / sum }));
}

export function groupEquipment(items: Equipment[]): [string, string, Equipment[]][] {
  return Object.entries(EQUIPMENT_CATEGORIES)
    .map(([key, label]): [string, string, Equipment[]] => [key, label, items.filter((item) => item.category === key)])
    .filter(([, , list]) => list.length > 0);
}

export function changedValues(fields: SettingsField[], values: Record<string, string | boolean>): Record<string, string | boolean> {
  const changed: Record<string, string | boolean> = {};
  for (const field of fields) {
    if (!(field.key in values)) continue;
    const raw = values[field.key];
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === undefined) continue;
    if (field.kind === "secret" && !value) continue;
    if (field.kind !== "secret" && String(value) === String(field.value)) continue;
    changed[field.key] = value;
  }
  return changed;
}

export function blockWeeks(block: BlockState): { week: number; classes: string; deload: boolean }[] {
  return Array.from({ length: block.weeks }, (_, index) => {
    const week = index + 1;
    const deload = week === block.weeks || (block.early_deload && week >= block.week && block.deload);
    const classes = [week < block.week ? "done" : "", week === block.week ? "now" : "", deload ? "deload" : ""].filter(Boolean).join(" ");
    return { week, classes, deload };
  });
}

export function planItemAmount(item: CyclePlanItem): string {
  const range = (low: number | null, high: number | null) => (low ? String(low) : "") + (high && high !== low ? " to " + String(high) : "");
  if (item.measure === "min") return range(item.rep_min, item.rep_max) + " min";
  return String(item.sets) + " × " + (item.rep_min ? range(item.rep_min, item.rep_max) : item.target || "free") + (item.measure === "sec" ? " s" : "");
}

export interface SummaryRow {
  exercise_id: number;
  measure: Exercise["measure"];
  sets: number | null;
  rep_max: number | null;
  rest_seconds: number | null;
}

export function editorSummary(rows: SummaryRow[], byId: Map<number, Exercise>) {
  const strength = rows.filter((row) => {
    const measure = byId.get(row.exercise_id)?.measure ?? row.measure;
    return measure !== "min" && measure !== "none";
  });
  const sets = strength.reduce((sum, row) => sum + (row.sets ?? 0), 0);
  const seconds = rows.reduce((sum, row) => {
    const measure = byId.get(row.exercise_id)?.measure ?? row.measure;
    if (measure === "min") return sum + (row.rep_max || 20) * 60 * (row.sets ?? 0);
    return sum + (row.sets ?? 0) * (45 + (row.rest_seconds ?? 0));
  }, 0);
  const muscles = new Map<string, number>();
  for (const row of strength) {
    const exercise = byId.get(row.exercise_id);
    if (!exercise?.primary_muscle) continue;
    muscles.set(exercise.primary_muscle, (muscles.get(exercise.primary_muscle) ?? 0) + (row.sets ?? 0));
    for (const muscle of exercise.secondary_muscles) muscles.set(muscle, (muscles.get(muscle) ?? 0) + (row.sets ?? 0) * 0.5);
  }
  return { sets, minutes: Math.round(seconds / 60), muscles: [...muscles.entries()].sort((left, right) => right[1] - left[1]) };
}
