import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToasts, errorToast, toast, ToastHost } from "../toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    clearToasts();
  });
  vi.useRealTimers();
});

describe("toasts", () => {
  it("shows messages and removes them after their time", () => {
    render(<ToastHost mobile={false} />);
    act(() => {
      toast("Saved");
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(screen.getByText("Saved").parentElement).toHaveClass("leaving");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("styles errors and runs actions", () => {
    const run = vi.fn();
    render(<ToastHost mobile />);
    act(() => {
      errorToast(new Error("Server down"));
      toast("Removed", "", { label: "Undo", run });
    });
    expect(screen.getByText("Server down").parentElement).toHaveClass("error");
    act(() => {
      screen.getByRole("button", { name: "Undo" }).click();
    });
    expect(run).toHaveBeenCalledOnce();
  });
});
