export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface ClientState {
  userId: number | null;
  onUnauthorized: (() => void) | null;
}

const client: ClientState = { userId: null, onUnauthorized: null };

export function setApiUser(userId: number | null): void {
  client.userId = userId;
}

export function getApiUser(): number | null {
  return client.userId;
}

export function onUnauthorized(callback: (() => void) | null): void {
  client.onUnauthorized = callback;
}

function detailMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "detail" in data) {
    return typeof data.detail === "string" ? data.detail : "Check your input";
  }
  return "Request failed (" + String(status) + ")";
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  quietUnauthorized?: boolean;
}

export async function request<T>(method: Method, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  if (client.userId !== null) headers["X-User-Id"] = String(client.userId);
  const init: RequestInit = { method, headers, signal: options.signal ?? null };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 401 && !options.quietUnauthorized && client.onUnauthorized) client.onUnauthorized();
  if (!response.ok) {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    throw new ApiError(detailMessage(data, response.status), response.status);
  }
  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
};

export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? "?" + text : "";
}
