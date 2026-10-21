function safe<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

export function storageGet(key: string, fallback: string): string {
  return safe(() => localStorage.getItem(key) ?? fallback, fallback);
}

export function storageSet(key: string, value: string): void {
  safe(() => {
    localStorage.setItem(key, value);
  }, undefined);
}

export function sessionGet(key: string): string {
  return safe(() => sessionStorage.getItem(key) ?? "", "");
}

export function sessionSet(key: string, value: string): void {
  safe(() => {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  }, undefined);
}
