import { useCallback, useEffect, useRef, useState } from "react";
import { type Tag, useTagVersion } from "./store";

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
  setData: (next: T | ((current: T | undefined) => T)) => void;
}

interface ResourceState<T> {
  key: string;
  data: T | undefined;
  error: Error | null;
}

const NO_TAGS: readonly Tag[] = [];

export function useResource<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[], tags: readonly Tag[] = NO_TAGS): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({ key: "", data: undefined, error: null });
  const [nonce, setNonce] = useState(0);
  const version = useTagVersion(tags);
  const fetcherRef = useRef(fetcher);
  const key = JSON.stringify(deps) + "|" + version + "|" + String(nonce);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    const controller = new AbortController();
    fetcherRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key, data, error: null });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ key, data: current.data, error: error instanceof Error ? error : new Error(String(error)) }));
      },
    );
    return () => {
      controller.abort();
    };
  }, [key]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const setData = useCallback((next: T | ((current: T | undefined) => T)) => {
    setState((current) => ({ ...current, data: typeof next === "function" ? (next as (value: T | undefined) => T)(current.data) : next }));
  }, []);

  return { data: state.data, error: state.error, loading: state.key !== key, reload, setData };
}
