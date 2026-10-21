import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateStore } from "@/app/session";
import { userStore } from "@/app/state";
import { Picker } from "../Picker";

const users = [
  { id: 1, name: "Saleh", sex: "male", color: "#f2c14e", status: "ready", status_message: "", created_at: "", last_seen: null, goal: "muscle", days_per_week: 3, coach: "max", is_superuser: 1, workouts: 4, last_day: null },
];
const me = { ...users[0], age: 30, height_cm: 180, weight_kg: 80, experience: "", trained_recently: true, session_minutes: 60, priority_muscles: [], limitations: "", plan_summary: "", level: "", bmi: null, bmi_label: "" };

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url === "/api/users" ? users : url === "/api/me" ? me : url.startsWith("/api/ai") ? null : null), { status: 200 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  gateStore.set({ kind: "loading" });
  userStore.set(null);
});

describe("account picker", () => {
  it("lists profiles and enters the app for a ready user", async () => {
    render(<Picker mobile={false} />);
    expect(await screen.findByRole("heading", { name: "Who is training?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Saleh/ }));
    await waitFor(() => {
      expect(gateStore.get().kind).toBe("app");
    });
    expect(userStore.get()?.name).toBe("Saleh");
  });

  it("opens onboarding for new people", async () => {
    render(<Picker mobile />);
    await userEvent.click(await screen.findByRole("button", { name: "I am new here" }));
    expect(gateStore.get()).toEqual({ kind: "onboarding", hasUsers: true });
  });
});
