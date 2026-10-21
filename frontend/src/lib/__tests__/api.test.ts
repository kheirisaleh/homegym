import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, onUnauthorized, query, setApiUser } from "../api";

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

afterEach(() => {
  setApiUser(null);
  onUnauthorized(null);
});

describe("api client", () => {
  it("sends the user header and json bodies", async () => {
    const fetchMock = respond(200, { ok: true });
    setApiUser(7);
    await expect(api.post("/api/x", { a: 1 })).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["X-User-Id"]).toBe("7");
    expect(init?.body).toBe('{"a":1}');
  });

  it("raises api errors with the server detail", async () => {
    respond(409, { detail: "Already exists" });
    await expect(api.get("/api/x")).rejects.toEqual(new ApiError("Already exists", 409));
  });

  it("uses a generic message for validation errors", async () => {
    respond(422, { detail: [{ msg: "bad" }] });
    await expect(api.get("/api/x")).rejects.toThrow("Check your input");
  });

  it("calls the unauthorized handler unless quiet", async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    respond(401, { detail: "Unknown user" });
    await expect(api.get("/api/me", { quietUnauthorized: true })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
    respond(401, { detail: "Unknown user" });
    await expect(api.get("/api/me")).rejects.toThrow();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("returns null for empty responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete("/api/x")).resolves.toBeNull();
  });

  it("builds query strings without empty values", () => {
    expect(query({ a: 1, b: null, c: false, d: "x y", e: true })).toBe("?a=1&d=x+y&e=true");
    expect(query({})).toBe("");
  });
});
