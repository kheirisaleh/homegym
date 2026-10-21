import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionExercise } from "@/lib/types";

const showRest = vi.fn();
const openModal = vi.fn(() => ({ close: vi.fn() }));

vi.mock("../rest", () => ({ showRest, closeRest: vi.fn() }));
vi.mock("@/coach/overlay", () => ({ openCoach: vi.fn() }));
vi.mock("@/ui/modal", () => ({ openModal, confirmDialog: vi.fn(() => Promise.resolve(true)) }));

const { useWorkout } = await import("../controller");

function item(id: number, overrides: Partial<SessionExercise> = {}): SessionExercise {
  return {
    id, session_id: 1, exercise_id: id, exercise_name: "Exercise " + String(id), measure: "reps", track_weight: true, position: id, planned_sets: 1, target: "8-12", rest_seconds: 60,
    program_exercise_id: null, rep_min: 8, rep_max: 12, target_weight: 40, video_id: null, video_start: null, video_end: null, exercise_notes: null, cues: null,
    media_loop: null, media_muscles: null, primary_muscle: "chest", secondary_muscles: [], load_equipment: null, plan_cue: null, sets: [], previous: null, best: null, weight_steps: [37.5, 40, 42.5],
    ...overrides,
  };
}

function session(exercises: SessionExercise[]): Session {
  return { id: 1, day: "2026-10-21", program_id: 1, program_name: "Push", status: "active", current_index: 0, started_at: "2026-10-21T10:00:00", finished_at: null, notes: "", block_id: 1, block_week: 1, deload: 0, cycle_adjusted: 0, user_id: 1, exercises };
}

const done = { id: 9, set_number: 1, value: 10, weight: 40, effort: null };
let fetchMock: ReturnType<typeof vi.fn>;

function reply(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  showRest.mockClear();
  openModal.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workout controller", () => {
  it("prefills suggested values and steps through owned weights", () => {
    const { result } = renderHook(() => useWorkout(session([item(1), item(2)]), {}, { mobile: false, onDone: vi.fn() }));
    expect(result.current.values).toMatchObject({ weight: "40", value: "8" });
    act(() => {
      result.current.adjustWeight(1);
    });
    expect(result.current.values.weight).toBe("42.5");
    act(() => {
      result.current.adjustValue(-1);
    });
    expect(result.current.values.value).toBe("7");
    act(() => {
      result.current.prefill({ weight: 37.5, value: 12 });
    });
    expect(result.current.values).toMatchObject({ weight: "37.5", value: "12" });
  });

  it("logs a set, moves to the next open exercise and starts the rest timer", async () => {
    const after = session([item(1, { sets: [done] }), item(2)]);
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/sets" && init?.method === "POST") return reply({ ...done, session_exercise_id: 1, record: null });
      if (url === "/api/sessions/1") return reply(after);
      return reply({});
    });
    const { result } = renderHook(() => useWorkout(session([item(1), item(2)]), {}, { mobile: false, onDone: vi.fn() }));
    await act(async () => {
      await result.current.logSet();
    });
    const posted = fetchMock.mock.calls.find(([url]) => url === "/api/sets");
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({ session_exercise_id: 1, value: 8, weight: 40, effort: null });
    expect(result.current.index).toBe(1);
    expect(showRest).toHaveBeenCalledWith(60, "Exercise 2", 1);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/sessions/1/state")).toBe(true);
    });
  });

  it("asks to finish when every planned set is logged", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/sets") return reply({ ...done, session_exercise_id: 1, record: null });
      if (url === "/api/sessions/1") return reply(session([item(1, { sets: [done] })]));
      return reply({});
    });
    const { result } = renderHook(() => useWorkout(session([item(1)]), {}, { mobile: true, onDone: vi.fn() }));
    await act(async () => {
      await result.current.logSet();
    });
    expect(showRest).not.toHaveBeenCalled();
    expect(openModal).toHaveBeenCalledOnce();
  });

  it("refuses to log without a value", async () => {
    const { result } = renderHook(() => useWorkout(session([item(1, { rep_min: null, target: "" })]), {}, { mobile: false, onDone: vi.fn() }));
    await act(async () => {
      await result.current.logSet();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps around when navigating", () => {
    fetchMock.mockImplementation(() => reply({}));
    const { result } = renderHook(() => useWorkout(session([item(1), item(2), item(3)]), {}, { mobile: false, onDone: vi.fn() }));
    act(() => {
      result.current.goTo(-1);
    });
    expect(result.current.index).toBe(2);
    expect(result.current.direction).toBe(1);
  });
});
