import { num, plural } from "./format";
import type { LeaderboardRow, LogEntry, WeekProgress } from "./types";

export type LogTone = "k-up" | "k-down" | "k-swap" | "k-block" | "k-ai" | "k-neutral";

export function logTone(kind: string): LogTone {
  if (["weight_up", "reps_up", "time_up", "volume_up", "cardio_up", "weight_set"].includes(kind)) return "k-up";
  if (["weight_down", "volume_down", "ai_waiting"].includes(kind)) return "k-down";
  if (["swap", "redesign", "restore", "edit"].includes(kind)) return "k-swap";
  if (["block_review", "deload_start", "fatigue"].includes(kind)) return "k-block";
  if (kind === "ai_note") return "k-ai";
  return "k-neutral";
}

const ICONS: Record<string, string> = {
  ai_note: "AI",
  ai_waiting: "!",
  weight_up: "↑",
  reps_up: "↑",
  time_up: "↑",
  volume_up: "+",
  cardio_up: "+",
  weight_set: "•",
  weight_down: "↓",
  volume_down: "−",
  swap: "⇄",
  redesign: "✎",
  edit: "✎",
  restore: "↺",
  undo: "↺",
  block_review: "B",
  deload_start: "D",
  fatigue: "D",
};

export function logIcon(kind: string): string {
  return ICONS[kind] ?? "i";
}

export function canUndo(entry: LogEntry): boolean {
  return Boolean(entry.version_id) && !entry.undone && entry.kind !== "undo";
}

export function coachSays(week: WeekProgress | null | undefined, label: (muscle: string) => string): string {
  if (!week?.rows.length) return "";
  const behind = week.rows.filter((row) => row.priority && row.done < row.planned * 0.5 && week.days_left <= 3);
  if (week.rows.every((row) => row.done >= row.planned)) return "Every muscle hit its weekly target. That is a complete week.";
  if (behind.length) return "Your priority " + behind.map((row) => label(row.muscle).toLowerCase()).join(" and ") + " still need work this week.";
  const best = week.rows.filter((row) => row.done >= row.planned && row.planned > 0).map((row) => label(row.muscle).toLowerCase());
  if (best.length) return "Done for the week: " + best.slice(0, 3).join(", ") + ".";
  return "Fresh week. Every session moves these bars.";
}

export type WeekRowState = "done" | "half" | "open";

export function weekRowState(row: WeekProgress["rows"][number]): { state: WeekRowState; share: number; left: number } {
  const share = row.planned ? Math.min(1, row.done / row.planned) : 1;
  const left = Math.max(0, row.planned - row.done);
  const state: WeekRowState = row.done >= row.planned ? "done" : share >= 0.5 ? "half" : "open";
  return { state, share, left };
}

export const BOARD_PARTS: [keyof LeaderboardRow["points"], string, string][] = [
  ["consistency", "Consistency", "--plate-green"],
  ["improvement", "Improvement", "--plate-blue"],
  ["records", "Personal bests", "--accent-line"],
  ["volume", "Volume", "--plate-purple"],
];

export const CATEGORY_TEXT: Record<keyof LeaderboardRow["points"], (value: number) => string> = {
  consistency: (value) => num(value * 100, 0) + " % of planned workouts",
  improvement: (value) => "+" + num(value * 100, 1) + " % strength",
  records: (value) => String(value) + " new bests",
  volume: (value) => String(value) + " working sets",
};

export function nextGapText(rows: LeaderboardRow[], userId: number | null): string {
  const mine = rows.find((row) => row.id === userId);
  if (!mine) return "";
  const points = (value: number) => plural(value, "point");
  if (mine.rank === 1) {
    const second = rows[1];
    return second ? "You lead. " + points(mine.score - second.score) + " ahead of " + second.name + "." : "You are the only one on the board this period.";
  }
  const ahead = rows[mine.rank - 2];
  if (!ahead) return "";
  return points(ahead.score - mine.score + 1) + " to pass " + ahead.name + ". One more workout is worth up to " + String(Math.ceil(40 / Math.max(1, mine.planned))) + ".";
}

export interface ReportBlock {
  kind: "h2" | "h3" | "h4" | "item" | "sub" | "p";
  text: string;
}

export function parseReport(markdown: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("### ")) blocks.push({ kind: "h4", text: line.slice(4) });
    else if (line.startsWith("## ")) blocks.push({ kind: "h3", text: line.slice(3) });
    else if (line.startsWith("# ")) blocks.push({ kind: "h2", text: line.slice(2) });
    else if (line.startsWith("    * ")) blocks.push({ kind: "sub", text: line.slice(6) });
    else if (line.startsWith("* ")) blocks.push({ kind: "item", text: line.slice(2) });
    else if (line.trim()) blocks.push({ kind: "p", text: line });
  }
  return blocks;
}
