import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createStore, invalidate, useStore } from "../store";
import { useResource } from "../useResource";

describe("store", () => {
  it("notifies subscribers and supports updater functions", () => {
    const store = createStore(1);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.set((value) => value + 1);
    expect(store.get()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.set(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("re-renders hook users", () => {
    const store = createStore("a");
    const { result } = renderHook(() => useStore(store));
    act(() => {
      store.set("b");
    });
    expect(result.current).toBe("b");
  });
});

describe("useResource", () => {
  it("loads data and reloads when its tag is invalidated", async () => {
    let calls = 0;
    const fetcher = vi.fn(() => Promise.resolve(++calls));
    const { result } = renderHook(() => useResource(fetcher, [], ["programs"]));
    await waitFor(() => {
      expect(result.current.data).toBe(1);
    });
    expect(result.current.loading).toBe(false);
    act(() => {
      invalidate("programs");
    });
    await waitFor(() => {
      expect(result.current.data).toBe(2);
    });
  });

  it("keeps old data and reports errors", async () => {
    let fail = false;
    const { result } = renderHook(() => useResource(() => (fail ? Promise.reject(new Error("boom")) : Promise.resolve("ok")), []));
    await waitFor(() => {
      expect(result.current.data).toBe("ok");
    });
    fail = true;
    act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom");
    });
    expect(result.current.data).toBe("ok");
  });

  it("ignores responses from stale requests", async () => {
    const resolvers: ((value: string) => void)[] = [];
    const { result, rerender } = renderHook(({ id }) => useResource(() => new Promise<string>((resolve) => resolvers.push(resolve)), [id]), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    act(() => {
      resolvers[1]?.("second");
      resolvers[0]?.("first");
    });
    await waitFor(() => {
      expect(result.current.data).toBe("second");
    });
  });
});
