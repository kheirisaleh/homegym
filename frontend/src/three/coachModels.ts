import type { CoachKey } from "@/lib/types";

export interface CoachInfo {
  key: CoachKey;
  name: string;
  title: string;
  color: string;
  style: string;
}

export const COACHES: Record<CoachKey, CoachInfo> = {
  max: { key: "max", name: "Max", title: "Strength coach", color: "#d93a3f", style: "Direct, energetic, a bit of humor. Pushes you to beat last week." },
  lena: { key: "lena", name: "Lena", title: "Performance coach", color: "#3f7bf2", style: "Warm, precise, technique first. Makes every rep count." },
};

export function coachInfo(key: string | null | undefined): CoachInfo {
  return key === "lena" ? COACHES.lena : COACHES.max;
}
