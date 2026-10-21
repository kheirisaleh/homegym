import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { closeAllModals, confirmDialog, hasOpenModal, ModalHost, openModal } from "../modal";

afterEach(() => {
  act(() => {
    closeAllModals();
  });
});

describe("modals", () => {
  it("resolves confirm dialogs with the chosen answer", async () => {
    render(<ModalHost />);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = confirmDialog("Delete program", "Logged workouts are kept.", "Delete", true);
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Logged workouts are kept.");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await expect(answer).resolves.toBe(true);
  });

  it("treats escape as cancel and calls onClose once the exit animation ends", async () => {
    render(<ModalHost />);
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = confirmDialog("Leave?", "Changes are lost.", "Leave");
    });
    await userEvent.keyboard("{Escape}");
    await expect(answer).resolves.toBe(false);
    expect(hasOpenModal()).toBe(false);
  });

  it("only lets the top most modal react to escape", async () => {
    render(<ModalHost />);
    act(() => {
      openModal(() => <p>first</p>, { label: "First" });
      openModal(() => <p>second</p>, { label: "Second" });
    });
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Second" }).parentElement).toHaveClass("leaving");
  });
});
