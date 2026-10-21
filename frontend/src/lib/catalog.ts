export const MUSCLE_NAMES: Record<string, string> = {
  chest: "Chest",
  front_delts: "Front shoulders",
  side_delts: "Side shoulders",
  rear_delts: "Rear shoulders",
  biceps: "Biceps (front of the arm)",
  triceps: "Triceps (back of the arm)",
  forearms: "Forearms",
  lats: "Lats (wide back)",
  upper_back: "Upper back",
  lower_back: "Lower back",
  abs: "Abs (belly)",
  obliques: "Obliques (waist)",
  glutes: "Glutes (butt)",
  quads: "Front thighs",
  hamstrings: "Back thighs",
  calves: "Calves",
};

export function shortMuscleName(muscle: string): string {
  return (MUSCLE_NAMES[muscle] ?? muscle).replace(/ \(.*\)/, "");
}

export const REGIONS: [string, string[]][] = [
  ["Arms", ["biceps", "triceps"]],
  ["Shoulders", ["front_delts", "side_delts", "rear_delts"]],
  ["Chest", ["chest"]],
  ["Back", ["lats", "upper_back"]],
  ["Belly", ["abs", "obliques"]],
  ["Butt", ["glutes"]],
  ["Legs", ["quads", "hamstrings", "calves"]],
];

export const GOALS: [string, string, string][] = [
  ["fat_loss", "Lose fat fast", "Burn fat while keeping your muscle. More cardio, full body training."],
  ["tone", "Tone and shape", "Firm, defined look. Moderate weights, more reps, some cardio."],
  ["muscle", "Build muscle", "Grow size where you want it. More sets on your target muscles."],
  ["strength", "Get stronger", "Lift heavier. Lower reps on the big exercises, longer rests."],
  ["health", "Health and fitness", "Feel better, move better, stay healthy for years."],
];

export const GOAL_NAMES: Record<string, string> = Object.fromEntries(GOALS.map(([key, label]) => [key, label]));

export const EXPERIENCE: [string, string, string][] = [
  ["none", "Never", "I have never trained with weights"],
  ["under_6_months", "A little", "Less than 6 months"],
  ["6_to_24_months", "Some", "Between 6 months and 2 years"],
  ["over_2_years", "A lot", "More than 2 years"],
];

export const EXPERIENCE_NAMES: Record<string, string> = {
  none: "Never trained",
  under_6_months: "Less than 6 months",
  "6_to_24_months": "6 to 24 months",
  over_2_years: "More than 2 years",
};

export const PATTERNS: Record<string, string> = {
  horizontal_push: "Horizontal press",
  incline_push: "Incline press",
  vertical_push: "Overhead press",
  dip: "Dips",
  chest_fly: "Fly",
  lateral_raise: "Lateral raise",
  rear_delt: "Rear delt",
  elbow_flexion: "Curl",
  elbow_flexion_stretch: "Stretched curl",
  elbow_flexion_neutral: "Neutral grip curl",
  elbow_extension: "Triceps extension",
  elbow_extension_overhead: "Overhead triceps",
  vertical_pull: "Vertical pull",
  horizontal_pull: "Row",
  squat: "Squat",
  lunge: "Lunge",
  hinge: "Hip hinge",
  knee_flexion: "Leg curl",
  calf: "Calves",
  hip_flexion: "Leg raise",
  core_flexion: "Crunch",
  anti_extension: "Plank",
  anti_lateral: "Side plank",
  rotation: "Rotation",
  cardio_steady: "Steady cardio",
  cardio_interval: "Intervals",
  mobility: "Mobility",
};

export const EQUIPMENT_CATEGORIES: Record<string, string> = {
  free_weight: "Free weights",
  machine: "Machines",
  bench: "Benches",
  bodyweight: "Bodyweight stations",
  cardio: "Cardio",
  accessory: "Accessories",
};

const MUSCLE_COLORS: Record<string, string> = {
  chest: "--plate-red",
  triceps: "--plate-red",
  front_delts: "--plate-red",
  biceps: "--accent-line",
  forearms: "--accent-line",
  lats: "--plate-blue",
  upper_back: "--plate-blue",
  rear_delts: "--plate-blue",
  lower_back: "--plate-blue",
  side_delts: "--plate-blue",
  quads: "--plate-green",
  glutes: "--plate-green",
  hamstrings: "--plate-green",
  calves: "--plate-green",
  abs: "--plate-purple",
  obliques: "--plate-purple",
  cardio: "--chalk-3",
  mobility: "--chalk-3",
};

export function muscleColorVar(muscle: string | null | undefined): string {
  return "var(" + (MUSCLE_COLORS[muscle ?? ""] ?? "--chalk-3") + ")";
}

const PLATE_VARS = ["--accent-line", "--plate-blue", "--plate-red", "--plate-green", "--plate-purple", "--plate-cyan", "--plate-orange", "--chalk-2"];

export function plateVar(index: number): string {
  return PLATE_VARS[((index % PLATE_VARS.length) + PLATE_VARS.length) % PLATE_VARS.length]!;
}

export function cssVar(name: string): string {
  if (!name.startsWith("--")) return name;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function plateColor(index: number): string {
  return cssVar(plateVar(index));
}

export function parseWeights(text: string): number[] {
  const values = new Set<number>();
  for (const part of text.split(/[\s;,]+/).filter(Boolean)) {
    const range = /^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = Number(range[3] ?? "2.5");
      if (step <= 0) continue;
      for (let value = start; value <= end + 1e-9; value += step) values.add(Math.round(value * 100) / 100);
      continue;
    }
    const value = Number(part);
    if (value > 0) values.add(value);
  }
  return [...values].sort((left, right) => left - right);
}

export function extractVideoId(value: string): string | null {
  const text = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const match = /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/.exec(text);
  return match?.[1] ?? null;
}

export function thumbUrl(videoId: string): string {
  return "https://i.ytimg.com/vi/" + encodeURIComponent(videoId) + "/hqdefault.jpg";
}

export function mediaUrl(name: string | null | undefined): string {
  return name ? "/media/" + encodeURIComponent(name) : "";
}

export function isVideo(name: string | null | undefined): boolean {
  return /\.(mp4|webm|mov)$/i.test(name ?? "");
}
