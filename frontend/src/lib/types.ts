export type Measure = "reps" | "sec" | "min" | "none";
export type Sex = "male" | "female";
export type CoachKey = "max" | "lena";
export type Effort = 1 | 2 | 3;

export interface Meta {
  muscles: string[];
  muscle_labels: Record<string, string>;
  measures: Measure[];
}

export interface UserSummary {
  id: number;
  name: string;
  sex: Sex;
  color: string;
  status: string;
  status_message: string;
  created_at: string;
  last_seen: string | null;
  goal: string;
  days_per_week: number;
  coach: CoachKey | null;
  is_superuser: number | boolean;
  workouts: number;
  last_day: string | null;
}

export interface User {
  id: number;
  name: string;
  sex: Sex;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  experience: string;
  trained_recently: boolean;
  goal: string;
  days_per_week: number;
  session_minutes: number;
  priority_muscles: string[];
  limitations: string;
  color: string;
  status: string;
  status_message: string;
  plan_summary: string;
  coach: CoachKey | null;
  is_superuser: boolean;
  level: string;
  bmi: number | null;
  bmi_label: string;
}

export interface Exercise {
  id: number;
  name: string;
  measure: Measure;
  track_weight: boolean;
  video_id: string | null;
  video_start: number | null;
  video_end: number | null;
  video_title: string | null;
  video_source: string | null;
  notes: string;
  cues: string;
  primary_muscle: string | null;
  secondary_muscles: string[];
  pattern: string | null;
  equipment: string[];
  load_equipment: string | null;
  difficulty: number;
  media_loop: string | null;
  media_muscles: string | null;
  program_count: number;
  times_logged: number;
  available: boolean;
}

export interface Equipment {
  key: string;
  name: string;
  category: string;
  available: boolean;
  weights: number[] | null;
  notes: string;
  photo: string | null;
  exercise_count: number;
}

export interface EquipmentResult extends Equipment {
  swapped?: string[];
  pending?: string | null;
}

export interface ProgramItem {
  id?: number;
  exercise_id: number;
  position?: number;
  sets: number;
  target: string;
  rest_seconds: number;
  rep_min: number | null;
  rep_max: number | null;
  target_weight: number | null;
  added_block?: number;
  cue?: string;
  name: string;
  measure: Measure;
  track_weight: boolean;
  video_id?: string | null;
  primary_muscle: string | null;
  media_loop?: string | null;
  equipment?: string[];
  pattern?: string | null;
}

export interface ProgramVersion {
  id: number;
  created_at: string;
  reason: string;
}

export interface Program {
  id: number;
  name: string;
  weekday: number | null;
  description: string;
  archived: number;
  created_at: string;
  user_id: number;
  items: ProgramItem[];
  last_done: string | null;
  total_sets: number;
  versions?: ProgramVersion[];
}

export interface BlockState {
  id: number;
  number: number;
  start_day: string;
  end_day: string;
  weeks: number;
  week: number;
  deload: boolean;
  deload_from: string;
  early_deload: boolean;
  days_left: number;
}

export interface SuggestionOption {
  program: Program;
  last_done_before: string | null;
  days_since: number | null;
  times_done: number;
  matches_weekday: boolean;
  suggested: boolean;
  reason: string;
}

export interface Suggestions {
  day: string;
  weekday: number;
  options: SuggestionOption[];
  block: BlockState;
}

export interface SetEntry {
  id: number;
  set_number: number;
  value: number | null;
  weight: number | null;
  effort: Effort | null;
  done_at?: string;
  record?: boolean;
}

export interface PreviousSets {
  day: string;
  sets: Pick<SetEntry, "set_number" | "value" | "weight" | "effort">[];
}

export interface SessionExercise {
  id: number;
  session_id: number;
  exercise_id: number | null;
  exercise_name: string;
  measure: Measure;
  track_weight: boolean;
  position: number;
  planned_sets: number;
  target: string;
  rest_seconds: number;
  program_exercise_id: number | null;
  rep_min: number | null;
  rep_max: number | null;
  target_weight: number | null;
  video_id: string | null;
  video_start: number | null;
  video_end: number | null;
  exercise_notes: string | null;
  cues: string | null;
  media_loop: string | null;
  media_muscles: string | null;
  primary_muscle: string | null;
  secondary_muscles: string[];
  load_equipment: string | null;
  plan_cue: string | null;
  sets: SetEntry[];
  previous: PreviousSets | null;
  best: number | null;
  weight_steps: number[] | null;
}

export interface Change {
  exercise: string;
  kind: string;
  weight?: number;
}

export interface Session {
  id: number;
  day: string;
  program_id: number | null;
  program_name: string;
  status: "active" | "done";
  current_index: number;
  started_at: string;
  finished_at: string | null;
  notes: string;
  block_id: number | null;
  block_week: number | null;
  deload: number;
  cycle_adjusted: number;
  user_id: number;
  exercises: SessionExercise[];
  changes?: Change[];
}

export interface SessionSummary {
  id: number;
  day: string;
  program_name: string;
  status: "active" | "done";
  deload: number;
  sets_done: number;
  sets_planned: number;
  volume: number;
}

export interface SavedSet extends Omit<SetEntry, "record"> {
  session_exercise_id: number;
  record: { previous: number; current: number } | null;
}

export interface LogEntry {
  id: number;
  created_at: string;
  level: string;
  kind: string;
  program_id: number | null;
  exercise_id: number | null;
  block_id: number | null;
  title: string;
  message: string;
  source: string;
  version_id: number | null;
  undone: number;
  program_name?: string | null;
}

export interface StrengthSeries {
  id: number;
  name: string;
  muscle: string | null;
  series: { day: string; e1rm: number; weight: number; deload: boolean }[];
  first: number;
  last: number;
  best: number;
  change: number;
  count: number;
}

export interface VolumeRow {
  muscle: string;
  label: string;
  planned: number;
  done: number;
  min: number;
  max: number;
  priority: boolean;
}

export interface BodyEntry {
  day: string;
  weight_kg: number | null;
  waist_cm: number | null;
}

export interface BodyTrend {
  latest: number;
  latest_day: string;
  avg7: number | null;
  weekly_rate: number | null;
}

export interface Dashboard {
  stats: { total: number; this_week: number; this_month: number; streak_weeks: number; last_day: string | null };
  heatmap: { day: string; count: number; sets: number; volume: number }[];
  weekly: { week: string; workouts: number; volume: number; sets: number }[];
  strength: StrengthSeries[];
  strength_index: { week: string; value: number; n: number }[];
  prs: { name: string; day: string; e1rm: number; weight: number; gain: number }[];
  volume: VolumeRow[];
  cardio: { minutes: number; target: number };
  body: BodyEntry[];
  body_trend: BodyTrend | null;
  block: BlockState;
  log: LogEntry[];
  goals: { priority: string[]; fat_loss: boolean };
}

export interface LeaderboardRow {
  id: number;
  name: string;
  color: string;
  sex: Sex;
  workouts: number;
  planned: number;
  adherence: number;
  improvement: number;
  records: number;
  sets: number;
  points: Record<"consistency" | "improvement" | "records" | "volume", number>;
  score: number;
  rank: number;
}

export interface Leaderboard {
  period: string;
  label: string;
  start: string;
  rows: LeaderboardRow[];
  categories: Partial<Record<"consistency" | "improvement" | "records" | "volume", { id: number; name: string; value: number }>>;
}

export interface Persona {
  coach: CoachKey;
  name: string;
  title: string;
  color: string;
  sex: Sex;
  options?: Persona[];
}

export interface CoachMessage {
  title: string;
  message: string;
  points: string[];
  mood?: string;
  source?: string;
  persona?: Persona;
}

export interface WeekProgress {
  start: string;
  days_left: number;
  rows: { muscle: string; done: number; planned: number; priority: boolean }[];
}

export interface CoachToday {
  persona: Persona;
  week: WeekProgress;
  program: { id: number; name: string; weekday: number | null } | null;
  brief: CoachMessage | null;
  program_day: string;
}

export interface CoachSettings {
  priority_muscles: string[];
  goal_fat_loss: boolean;
  block_weeks: number;
  cardio_target_min: number;
  ai_model: string;
  ollama_url: string;
  ai_provider: string;
}

export interface CoachState {
  block: BlockState;
  blocks: unknown[];
  settings: CoachSettings;
  log: LogEntry[];
  pending_sessions: number;
  volume_targets: Record<string, [number, number]>;
}

export interface AiStatus {
  provider: string;
  url: string;
  model: string;
  reachable: boolean;
  model_installed: boolean;
  models: string[];
  key_set: boolean;
  error: string;
  ready: boolean;
  message: string;
}

export interface RebuildState {
  status: string;
  status_message: string;
  running: boolean;
  can_restore: boolean;
  last_run: unknown;
  reasons: { key: string; label: string }[];
}

export interface RestTip {
  persona: Persona;
  tips: string[];
}

export interface ExerciseHistoryEntry {
  id: number;
  session_id: number;
  day: string;
  program_name: string;
  measure: Measure;
  track_weight: number | boolean;
  deload: number;
  sets: PreviousSets["sets"];
  metric: number | null;
  top_weight: number | null;
  volume: number;
}

export interface ExerciseHistory {
  exercise: Exercise;
  entries: ExerciseHistoryEntry[];
}

export interface YoutubeResult {
  video_id: string;
  title: string;
  length: number | null;
  channel: string;
  embeddable: boolean;
}

export interface NutritionDay {
  day: string;
  kcal: number | null;
  protein: number | null;
  entries: { name?: string }[];
  complete: boolean;
}

export interface NutritionWeek {
  start: string;
  end: string;
  days: NutritionDay[];
  logged_days: number;
  average: Record<"kcal" | "protein" | "fat" | "carbs" | "fiber", number | null>;
  status: { enabled: boolean };
}

export interface Checkin {
  day?: string;
  energy: number | null;
  cramps: number;
  back_pain: number;
  headache: number;
  bloating: number;
  flow: number;
  sleep: number | null;
  mood: number | null;
  note: string;
}

export interface CyclePrediction {
  next_start: string;
  window_start: string;
  window_end: string;
  average_length: number;
  confidence: "good" | "fair" | "low";
  based_on: number;
  days_until: number;
}

export type CycleLevel = "none" | "light" | "moderate" | "rest";

export interface CycleState {
  eligible: boolean;
  active?: boolean;
  period_id?: number | null;
  period_day?: number | null;
  started?: string | null;
  checkin?: Checkin | null;
  level?: CycleLevel | null;
  prediction?: CyclePrediction | null;
  due_soon?: boolean;
  pin_set?: boolean;
}

export interface CyclePlanItem {
  exercise_id: number;
  name: string;
  measure: Measure;
  sets: number;
  rep_min: number | null;
  rep_max: number | null;
  target: string;
  target_weight: number | null;
  rest_seconds: number;
  cue: string;
  change: "swapped" | "added" | "lighter" | null;
  replaces: string | null;
}

export interface CyclePlan {
  active: boolean;
  program_id?: number;
  level: CycleLevel;
  source: "rules" | "ai";
  items: CyclePlanItem[];
  advice: string[];
  note: string;
  ai_error?: string;
}

export interface CycleHealth {
  summary: {
    cycles_tracked: number;
    average_cycle: number | null;
    shortest: number | null;
    longest: number | null;
    average_period: number | null;
    regularity: string;
    average_sleep: number | null;
    average_mood: number | null;
  };
  cycles: { id: number; start: string; end: string | null; period_length: number | null; cycle_length: number | null; ongoing: boolean }[];
  symptom_map: ({ cycle_day: number } & Record<string, number | null>)[];
  phases: { label: string; sessions: number; strength: number | null; effort: number | null; energy: number | null }[];
  prediction: CyclePrediction | null;
  active: unknown;
  flags: string[];
  lengths: { start: string; length: number }[];
  insight: { summary: string; points: string[]; created: string } | null;
}

export interface SettingsField {
  key: string;
  group: string;
  label: string;
  kind: "select" | "secret" | "text" | "list" | "int" | "bool";
  options: string[] | null;
  source: "app" | "environment" | "default";
  value: string | boolean;
  preview?: string;
  is_set?: boolean;
}

export interface SettingsView {
  groups: Record<string, string>;
  fields: SettingsField[];
}

export interface QualityReport {
  running: boolean;
  [key: string]: unknown;
}
