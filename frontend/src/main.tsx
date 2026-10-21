import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { legacyHashTarget } from "@/app/legacy";
import { createAppRouter } from "@/app/router";
import { boot } from "@/app/session";
import { installMotion } from "@/ui/motion";
import "@/styles/fonts.css";
import "@/styles/base.css";
import "@/styles/mobile.css";
import "@/styles/cycle.css";
import "@/styles/cycle-desktop.css";
import "@/styles/polish.css";

const legacy = legacyHashTarget(window.location.pathname, window.location.hash);
if (legacy) window.history.replaceState(null, "", legacy);

installMotion();
void boot();

const container = document.getElementById("root");
if (!container) throw new Error("Missing root element");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);
