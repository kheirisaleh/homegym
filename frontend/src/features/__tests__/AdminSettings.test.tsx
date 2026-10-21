import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSettings } from "../AdminSettings";

function server(routes: Record<string, unknown>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = (init?.method ?? "GET") + " " + url;
      return Promise.resolve(new Response(JSON.stringify(routes[key] ?? {}), { status: 200 }));
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin settings", () => {
  it("explains that only the main account may open settings", async () => {
    server({ "GET /api/admin/state": { allowed: false, unlocked: false, pin_set: false } });
    render(<AdminSettings />);
    expect(await screen.findByRole("heading", { name: "Main account only" })).toBeInTheDocument();
  });

  it("unlocks with a PIN and keeps the token for the tab", async () => {
    const calls = server({ "GET /api/admin/state": { allowed: true, unlocked: false, pin_set: true }, "POST /api/admin/unlock": { token: "abc" } });
    render(<AdminSettings />);
    await userEvent.type(await screen.findByLabelText("PIN"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => {
      expect(window.sessionStorage.getItem("hg-admin-token")).toBe("abc");
    });
    const unlock = calls.find((call) => call.url === "/api/admin/unlock");
    expect(JSON.parse(unlock?.init?.body as string)).toEqual({ pin: "1234" });
  });

  it("saves only changed fields", async () => {
    const calls = server({
      "GET /api/admin/state": { allowed: true, unlocked: true, pin_set: true },
      "GET /api/admin/settings": {
        groups: { ai: "AI" },
        fields: [
          { key: "gemini_model", group: "ai", label: "Model", kind: "text", options: null, source: "default", value: "flash" },
          { key: "gemini_key", group: "ai", label: "Key", kind: "secret", options: null, source: "app", value: "", is_set: true, preview: "ab…" },
        ],
      },
    });
    render(<AdminSettings />);
    const model = await screen.findByLabelText("Model");
    await userEvent.clear(model);
    await userEvent.type(model, "pro");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls.some((call) => call.init?.method === "PUT")).toBe(true);
    });
    const put = calls.find((call) => call.init?.method === "PUT");
    expect(JSON.parse(put?.init?.body as string)).toEqual({ values: { gemini_model: "pro" }, reset: [] });
  });
});
