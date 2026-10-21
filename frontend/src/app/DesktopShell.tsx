import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api } from "@/lib/api";
import type { CoachState } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { storageGet } from "@/lib/storage";
import { hasOpenModal } from "@/ui/modal";
import { Avatar } from "@/ui/common";
import { BrandMark, ProjectorIcon } from "@/ui/icons";
import { useRestOpen } from "@/workout/rest";
import { applyProjector, toggleProjector, useProjector } from "./projector";
import { refreshActive, refreshAiStatus, useActive, useAiBannerDismissed, useAiStatus, useUser } from "./state";
import { useProjectorFit } from "./useProjectorFit";

const NAV: { to: string; key: string; label: string; only?: "female" | "admin" }[] = [
  { to: "/", key: "1", label: "Overview" },
  { to: "/training", key: "2", label: "Training" },
  { to: "/programs", key: "3", label: "Programs" },
  { to: "/exercises", key: "4", label: "Exercises" },
  { to: "/equipment", key: "5", label: "Equipment" },
  { to: "/history", key: "6", label: "History" },
  { to: "/coach", key: "7", label: "Coach" },
  { to: "/leaderboard", key: "8", label: "Leaderboard" },
  { to: "/trainer", key: "9", label: "My coach" },
  { to: "/health", key: "H", label: "Health", only: "female" },
  { to: "/settings", key: "0", label: "Settings", only: "admin" },
];

function BlockChip() {
  const coach = useResource((signal) => api.get<CoachState>("/api/coach?log_limit=1", { signal }), [], ["coach", "session"]);
  const block = coach.data?.block;
  if (!block) return <div className="block-chip" />;
  return (
    <div className="block-chip">
      Block {block.number}
      {block.deload ? ", deload" : ""}
      <strong>
        Week {block.week} of {block.weeks}
      </strong>
      <div className="block-weeks">
        {Array.from({ length: block.weeks }, (_, index) => {
          const week = index + 1;
          const classes = [week < block.week ? "done" : "", week === block.week ? "now" : "", week === block.weeks || (block.deload && week === block.week) ? "deload" : ""];
          return <i key={week} className={classes.join(" ").trim()} />;
        })}
      </div>
    </div>
  );
}

function AiBanner() {
  const status = useAiStatus();
  const [dismissed, dismiss] = useAiBannerDismissed();
  if (!status || status.ready || dismissed) return null;
  return (
    <div className="ai-banner" role="status">
      <b>AI coach offline.</b>
      <span>{(status.message || "Not reachable") + ". Program updates wait until it is back. Weights still progress after every workout."}</span>
      <Link to="/coach">Details</Link>
      <button type="button" className="ai-dismiss" aria-label="Hide this notice" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}

function ActiveBanner() {
  const active = useActive();
  const location = useLocation();
  if (!active || location.pathname.startsWith("/training")) return null;
  return (
    <div className="active-banner">
      <span>Workout in progress: {active.program_name}</span>
      <Link to="/training">Back to workout</Link>
    </div>
  );
}

export function DesktopShell() {
  const user = useUser();
  const projector = useProjector();
  const location = useLocation();
  const navigate = useNavigate();
  const viewRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const restOpen = useRestOpen();
  const visibleNav = NAV.filter((item) => !item.only || (item.only === "female" ? user?.sex === "female" : Boolean(user?.is_superuser)));

  useProjectorFit(viewRef, stageRef, projector, location.pathname);

  useEffect(() => {
    applyProjector(projector);
  }, [projector]);

  useEffect(() => {
    if (storageGet("force-desktop", "") !== "1" && window.matchMedia("(max-width: 760px)").matches) {
      void navigate("/m" + (location.pathname === "/" ? "" : location.pathname), { replace: true });
    }
  }, [navigate, location.pathname]);

  useEffect(() => {
    document.body.dataset.route = location.pathname.split("/")[1] || "dashboard";
    viewRef.current?.focus({ preventScroll: true });
    void refreshActive().catch(() => undefined);
  }, [location.pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshAiStatus(), 60000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (hasOpenModal() || restOpen || document.querySelector(".coach-overlay")) return;
      if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        toggleProjector();
        return;
      }
      if (location.pathname.startsWith("/training")) return;
      const item = visibleNav.find((entry) => entry.key.toLowerCase() === event.key.toLowerCase());
      if (item) void navigate(item.to);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [location.pathname, navigate, restOpen, visibleNav]);

  return (
    <div className="shell">
      <aside className="rail">
        <Link className="brand" to="/" aria-label="Home">
          <BrandMark />
          <span>Home Gym</span>
        </Link>
        <nav className="nav" aria-label="Main navigation">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => (isActive ? "active" : "")}
              aria-keyshortcuts={item.key}
            >
              <span className="key">{item.key}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          {user ? (
            <Link className="user-chip" to="/profile">
              <Avatar name={user.name} color={user.color} />
              <span className="user-chip-name">{user.name}</span>
              <span className="user-chip-hint">Profile</span>
            </Link>
          ) : null}
          <BlockChip />
          <button type="button" className="projector-toggle" aria-pressed={projector} title="Projector mode (P)" onClick={toggleProjector}>
            <ProjectorIcon />
            <span>Projector</span>
          </button>
        </div>
      </aside>
      <div className="stage" ref={stageRef}>
        <AiBanner />
        <ActiveBanner />
        <main id="view" className="view" tabIndex={-1} ref={viewRef}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
