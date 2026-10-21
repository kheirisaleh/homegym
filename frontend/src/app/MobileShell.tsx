import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { storageSet } from "@/lib/storage";
import { HomeIcon, MoreIcon, PlanIcon, ProgressIcon, TrainIcon } from "@/ui/icons";
import { refreshActive, refreshAiStatus, useAiBannerDismissed, useAiStatus } from "./state";

export interface TopBar {
  title: string;
  back?: string;
  action?: { label: string; run: () => void };
}

interface MobileContextValue {
  setTop: (top: TopBar) => void;
  setFocus: (on: boolean) => void;
}

const MobileContext = createContext<MobileContextValue | null>(null);

export function useTopBar(top: TopBar): void {
  const context = useContext(MobileContext);
  const actionRef = useRef(top.action);
  const { title, back } = top;
  const label = top.action?.label;
  useLayoutEffect(() => {
    actionRef.current = top.action;
  });
  useLayoutEffect(() => {
    context?.setTop({
      title,
      ...(back ? { back } : {}),
      ...(label ? { action: { label, run: () => actionRef.current?.run() } } : {}),
    });
  }, [context, title, back, label]);
}

export function useFocusMode(on: boolean): void {
  const context = useContext(MobileContext);
  useEffect(() => {
    context?.setFocus(on);
    return () => context?.setFocus(false);
  }, [on, context]);
}

export function useIsMobile(): boolean {
  return useContext(MobileContext) !== null;
}

const TABS: { to: string; tab: string; label: string; icon: ReactNode; match: (path: string) => boolean }[] = [
  { to: "/m", tab: "today", label: "Today", icon: <HomeIcon size={26} />, match: (path) => path === "/m" || path === "/m/" },
  { to: "/m/train", tab: "train", label: "Train", icon: <TrainIcon size={26} />, match: (path) => path.startsWith("/m/train") },
  { to: "/m/plan", tab: "plan", label: "Plan", icon: <PlanIcon size={26} />, match: (path) => path.startsWith("/m/plan") },
  { to: "/m/progress", tab: "progress", label: "Progress", icon: <ProgressIcon size={26} />, match: (path) => path.startsWith("/m/progress") },
  { to: "/m/more", tab: "more", label: "More", icon: <MoreIcon size={26} />, match: (path) => path.startsWith("/m/more") },
];

function AiBanner() {
  const status = useAiStatus();
  const [dismissed, dismiss] = useAiBannerDismissed();
  if (!status || status.ready || dismissed) return null;
  return (
    <div className="ai-banner m-ai" role="status">
      <b>AI coach offline.</b> <span>Program updates wait until it is back.</span> <Link to="/m/more/coach">Details</Link>
      <button type="button" className="ai-dismiss" aria-label="Hide this notice" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}

export function MobileShell() {
  const [top, setTop] = useState<TopBar>({ title: "" });
  const [focus, setFocus] = useState(false);
  const location = useLocation();
  const context = useMemo<MobileContextValue>(() => ({ setTop, setFocus }), []);

  useEffect(() => {
    storageSet("force-desktop", "");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("m-focus", focus);
  }, [focus]);

  useEffect(() => {
    window.scrollTo(0, 0);
    void refreshActive().catch(() => undefined);
  }, [location.pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshAiStatus(), 60000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <MobileContext.Provider value={context}>
      <div className="m-shell">
        <header className="m-top">
          {top.back ? (
            <Link className="m-back" to={top.back} aria-label="Back">
              ‹
            </Link>
          ) : null}
          <h1>{top.title}</h1>
          {top.action ? (
            <button type="button" className="btn small m-action" onClick={top.action.run}>
              {top.action.label}
            </button>
          ) : null}
        </header>
        <AiBanner />
        <main className="m-view" id="view">
          <Outlet />
        </main>
        <nav className="m-tabs" aria-label="Main">
          {TABS.map((item) => (
            <NavLink key={item.tab} to={item.to} className={item.match(location.pathname) ? "active" : ""} aria-current={item.match(location.pathname) ? "page" : undefined}>
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </MobileContext.Provider>
  );
}
