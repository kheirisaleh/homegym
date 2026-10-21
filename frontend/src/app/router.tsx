import type { ComponentType } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { DesktopShell } from "./DesktopShell";
import { MobileShell } from "./MobileShell";
import { NotFound, RouteError } from "./RouteError";
import { Root } from "./Root";

type Loader = () => Promise<Record<string, unknown>>;

function page(load: Loader, name: string): Pick<RouteObject, "lazy"> {
  return {
    lazy: async () => {
      const module = await load();
      return { Component: module[name] as ComponentType };
    },
  };
}

const desktop = () => import("@/pages/desktop");
const mobile = () => import("@/pages/mobile");

export const routes: RouteObject[] = [
  {
    path: "/",
    Component: Root,
    ErrorBoundary: RouteError,
    HydrateFallback: () => null,
    children: [
      {
        Component: DesktopShell,
        children: [
          { index: true, ...page(desktop, "DashboardPage") },
          { path: "training", ...page(desktop, "TrainingPage") },
          { path: "programs", ...page(desktop, "ProgramsPage") },
          { path: "programs/:programId", ...page(desktop, "ProgramEditorPage") },
          { path: "exercises", ...page(desktop, "ExercisesPage") },
          { path: "exercises/:exerciseId", ...page(desktop, "ExercisesPage") },
          { path: "equipment", ...page(desktop, "EquipmentPage") },
          { path: "history", ...page(desktop, "HistoryPage") },
          { path: "history/training/:sessionId", ...page(desktop, "SessionDetailPage") },
          { path: "coach", ...page(desktop, "CoachPage") },
          { path: "leaderboard", ...page(desktop, "LeaderboardPage") },
          { path: "trainer", ...page(desktop, "TrainerPage") },
          { path: "profile", ...page(desktop, "ProfilePage") },
          { path: "health", ...page(desktop, "HealthPage") },
          { path: "settings", ...page(desktop, "SettingsPage") },
          { path: "*", Component: NotFound },
        ],
      },
      {
        path: "m",
        Component: MobileShell,
        children: [
          { index: true, ...page(mobile, "TodayPage") },
          { path: "train", ...page(mobile, "TrainPage") },
          { path: "train/preview/:programId", ...page(mobile, "PreviewPage") },
          { path: "plan", ...page(mobile, "PlanPage") },
          { path: "plan/:programId", ...page(mobile, "PlanDetailPage") },
          { path: "progress", ...page(mobile, "ProgressPage") },
          { path: "progress/session/:sessionId", ...page(mobile, "SessionPage") },
          { path: "more", ...page(mobile, "MorePage") },
          { path: "more/exercises", ...page(mobile, "ExerciseListPage") },
          { path: "more/exercises/:exerciseId", ...page(mobile, "ExerciseDetailPage") },
          { path: "more/equipment", ...page(mobile, "EquipmentListPage") },
          { path: "more/coach", ...page(mobile, "CoachPage") },
          { path: "more/trainer", ...page(mobile, "TrainerPage") },
          { path: "more/leaderboard", ...page(mobile, "LeaderboardPage") },
          { path: "more/health", ...page(mobile, "HealthPage") },
          { path: "more/settings", ...page(mobile, "SettingsPage") },
          { path: "more/profile", ...page(mobile, "ProfilePage") },
          { path: "*", Component: NotFound },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
