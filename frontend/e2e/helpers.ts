import type { APIRequestContext, Page } from "@playwright/test";

export interface SeededUser {
  id: number;
  name: string;
  programId: number;
}

let counter = 0;

export async function seedUser(request: APIRequestContext, sex: "male" | "female" = "male"): Promise<SeededUser> {
  counter += 1;
  const name = "Tester" + String(Date.now() % 100000) + String(counter);
  const created = await request.post("/api/users", {
    data: { name, sex, age: 30, height_cm: 180, weight_kg: 80, experience: "6_to_24_months", trained_recently: true, goal: "muscle", days_per_week: 3, session_minutes: 60, priority_muscles: ["chest"] },
  });
  const user = (await created.json()) as { id: number };
  const headers = { "X-User-Id": String(user.id) };
  const exercises = (await (await request.get("/api/exercises", { headers })).json()) as { id: number; measure: string; track_weight: boolean; available: boolean }[];
  const picks = exercises.filter((exercise) => exercise.measure === "reps" && exercise.track_weight && exercise.available).slice(0, 2);
  const weekday = (new Date().getDay() + 6) % 7;
  const program = await request.post("/api/programs", {
    headers,
    data: { name: "Push Day", weekday, description: "", items: picks.map((exercise) => ({ exercise_id: exercise.id, sets: 1, target: "", rep_min: 8, rep_max: 12, target_weight: 20, rest_seconds: 30 })) },
  });
  const saved = (await program.json()) as { id: number };
  return { id: user.id, name, programId: saved.id };
}

export async function signIn(page: Page, user: SeededUser): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("user-id", String(id));
    window.localStorage.setItem("force-desktop", "1");
  }, user.id);
}
