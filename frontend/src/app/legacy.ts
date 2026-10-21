export function legacyHashTarget(pathname: string, hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const route = hash.slice(1).replace(/\/+$/, "");
  const mobile = pathname === "/m" || pathname.startsWith("/m/");
  if (mobile) return "/m" + route;
  return route || "/";
}

export function isMobilePath(pathname: string): boolean {
  return pathname === "/m" || pathname.startsWith("/m/");
}
