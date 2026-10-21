import type { Effort, Measure } from "./types";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MEASURE_LABELS: Record<Measure, string> = { reps: "Reps", sec: "Seconds", min: "Minutes", none: "Check off" };
export const MEASURE_UNITS: Record<Measure, string> = { reps: "reps", sec: "s", min: "min", none: "" };
export const EFFORT_LABELS: Record<Effort, string> = { 1: "Easy", 2: "Hard", 3: "Max effort" };

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toIso(value: Date): string {
  return String(value.getFullYear()) + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate());
}

export function todayIso(): string {
  return toIso(new Date());
}

export function fromIso(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function weekdayIndex(value: Date): number {
  return (value.getDay() + 6) % 7;
}

export function addDays(value: Date, days: number): Date {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function mondayOf(value: Date): Date {
  return addDays(new Date(value.getFullYear(), value.getMonth(), value.getDate()), -weekdayIndex(value));
}

export function formatDay(value: string, withWeekday = true): string {
  const date = fromIso(value);
  const text = String(date.getDate()) + " " + (MONTHS[date.getMonth()] ?? "") + " " + String(date.getFullYear());
  return withWeekday ? (WEEKDAYS[weekdayIndex(date)] ?? "") + ", " + text : text;
}

export function formatShortDay(value: string): string {
  const date = fromIso(value);
  return String(date.getDate()) + " " + (MONTHS_SHORT[date.getMonth()] ?? "");
}

export function relativeDay(value: string, today: string = todayIso()): string {
  const days = Math.round((fromIso(today).getTime() - fromIso(value).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days > 1 && days < 14) return String(days) + " days ago";
  return formatShortDay(value);
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? String(hours) + ":" + pad(minutes) + ":" + pad(rest) : String(minutes) + ":" + pad(rest);
}

export function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded.toLocaleString("en-GB", { maximumFractionDigits: digits });
}

export function plural(count: number, singular: string, pluralForm = singular + "s"): string {
  return String(count) + " " + (count === 1 ? singular : pluralForm);
}

export interface SetLike {
  value: number | null;
  weight: number | null;
}

export function formatSet(set: SetLike, measure: Measure, trackWeight: boolean | number): string {
  if (measure === "none") return "done";
  const value = set.value === null ? null : num(set.value);
  if (trackWeight && set.weight !== null) return num(set.weight) + " kg × " + (value ?? "?");
  return value === null ? "" : (value + " " + MEASURE_UNITS[measure]).trim();
}

export function minutesBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

export function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
}
