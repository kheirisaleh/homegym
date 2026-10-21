import { api } from "@/lib/api";
import type { Persona } from "@/lib/types";

let cached: Promise<Persona | null> | null = null;

export function coachPersona(): Promise<Persona | null> {
  cached ??= api.get<Persona>("/api/coach/persona").catch(() => {
    cached = null;
    return null;
  });
  return cached;
}

export function resetCoachPersona(): void {
  cached = null;
}
