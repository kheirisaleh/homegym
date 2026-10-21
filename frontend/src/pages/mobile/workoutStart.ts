import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";
import { errorToast } from "@/ui/toast";
import { beginSession } from "@/workout/flows";

export function useStartWorkout() {
  const navigate = useNavigate();
  return async (day: string, programId: number | null) => {
    try {
      const active = await api.get<Session | null>("/api/sessions/active");
      if (active) {
        void navigate("/m/train");
        return;
      }
      if (programId === null) {
        if (await beginSession(day, null)) void navigate("/m/train");
        return;
      }
      void navigate("/m/train/preview/" + String(programId));
    } catch (error) {
      errorToast(error);
    }
  };
}
