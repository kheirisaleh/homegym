import { api, esc, runCleanup, loadMeta, storageGet, storageSet, toast, state, setUser, invalidate } from "../js/core.js?v=cycle2";
import { renderPicker, renderGenerating } from "../js/accounts.js?v=cycle2";
import { renderToday } from "./today.js?v=cycle2";
import { renderTrain, renderPreview } from "./train.js?v=cycle2";
import { renderPlan, renderPlanDetail } from "./plan.js?v=cycle2";
import { renderSettingsMobile } from "./settings.js?v=cycle2";
import { renderHealth, configureCycle } from "./cycle.js?v=cycle2";
import { renderProgress, renderSessionDetail } from "./progress.js?v=cycle2";
import { renderMore, renderExercisesList, renderExerciseDetail, renderEquipmentList, renderCoachMobile, renderBoardMobile, renderProfileMobile, renderTrainerMobile } from "./more.js?v=cycle2";

const ROUTES = [
  [/^\/?$/, "today", renderToday],
  [/^\/train$/, "train", renderTrain],
  [/^\/train\/preview\/(\d+)$/, "train", (view, match) => renderPreview(view, Number(match[1]))],
  [/^\/plan$/, "plan", renderPlan],
  [/^\/plan\/(\d+)$/, "plan", (view, match) => renderPlanDetail(view, Number(match[1]))],
  [/^\/progress$/, "progress", renderProgress],
  [/^\/progress\/session\/(\d+)$/, "progress", (view, match) => renderSessionDetail(view, Number(match[1]))],
  [/^\/more$/, "more", renderMore],
  [/^\/more\/exercises$/, "more", renderExercisesList],
  [/^\/more\/exercises\/(\d+)$/, "more", (view, match) => renderExerciseDetail(view, Number(match[1]))],
  [/^\/more\/equipment$/, "more", renderEquipmentList],
  [/^\/more\/coach$/, "more", renderCoachMobile],
  [/^\/more\/trainer$/, "more", renderTrainerMobile],
  [/^\/more\/leaderboard$/, "more", renderBoardMobile],
  [/^\/more\/health$/, "more", (view) => { configureCycle({ setTop, healthHref: "#/more/health" }); return renderHealth(view); }],
  [/^\/more\/settings$/, "more", renderSettingsMobile],
  [/^\/more\/profile$/, "more", (view) => renderProfileMobile(view, { onLogout: logout })],
];

let inApp = false;
let token = 0;

export function setTop({ title, back, action }) {
  const top = document.getElementById("m-top");
  top.innerHTML = (back ? '<a class="m-back" href="' + back + '" aria-label="Back">‹</a>' : "") + "<h1>" + esc(title) + "</h1>" +
    (action ? '<button class="btn small m-action" id="m-action">' + esc(action.label) + "</button>" : "");
  if (action) top.querySelector("#m-action").addEventListener("click", action.run);
}

export function focusMode(on) {
  document.body.classList.toggle("m-focus", on);
}

async function router() {
  if (!inApp) return;
  const path = location.hash.replace(/^#/, "") || "/";
  const view = document.getElementById("view");
  runCleanup();
  focusMode(false);
  document.getElementById("modal-root").innerHTML = "";
  const current = ++token;
  for (const [pattern, tab, render] of ROUTES) {
    const match = path.match(pattern);
    if (!match) continue;
    document.querySelectorAll(".m-tabs a").forEach((link) => link.classList.toggle("active", link.dataset.tab === tab));
    view.innerHTML = "";
    window.scrollTo(0, 0);
    try {
      await render(view, match);
    } catch (error) {
      if (current === token && state.userId) view.innerHTML = '<div class="empty">This page could not be loaded: ' + esc(error.message) + "</div>";
    }
    return;
  }
  location.hash = "#/";
}

export async function updateAiBanner(fresh) {
  const banner = document.getElementById("ai-banner");
  try {
    const status = await api("GET", "/api/ai/status" + (fresh ? "?fresh=true" : ""));
    banner.hidden = status.ready;
    if (!status.ready) banner.innerHTML = '<b>AI coach offline.</b> <span>Program updates wait until it is back.</span> <a href="#/more/coach">Details</a>';
    return status;
  } catch (error) {
    return null;
  }
}

function showGate() {
  inApp = false;
  runCleanup();
  document.getElementById("shell").hidden = true;
  const gate = document.getElementById("gate");
  gate.hidden = false;
  return gate;
}

function enterApp(user) {
  setUser(user);
  invalidate("programs", "exercises");
  const gate = document.getElementById("gate");
  gate.hidden = true;
  gate.innerHTML = "";
  document.getElementById("shell").hidden = false;
  inApp = true;
  if (!location.hash || location.hash === "#") location.hash = "#/";
  router();
  updateAiBanner();
}

export function logout() {
  setUser(null);
  location.hash = "";
  renderPicker(showGate(), { onEnter: enterApp, mobile: true });
}

export function openDesktop() {
  storageSet("force-desktop", "1");
  location.href = "/";
}

async function boot() {
  storageSet("force-desktop", "");
  if (!window.Chart) await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  try {
    await loadMeta();
  } catch (error) {
    toast("Server not reachable", "error");
    return;
  }
  state.onUnauthorized = () => { if (inApp) logout(); };
  window.addEventListener("hashchange", router);
  document.addEventListener("regenerating", () => renderGenerating(showGate(), state.user, { onEnter: enterApp, mobile: true }));
  setInterval(() => { if (inApp) updateAiBanner(); }, 60000);
  const saved = Number(storageGet("user-id", "")) || null;
  if (saved) {
    state.userId = saved;
    try {
      const user = await api("GET", "/api/me");
      setUser(user);
      if (user.status === "generating") {
        renderGenerating(showGate(), user, { onEnter: enterApp, mobile: true });
        return;
      }
      enterApp(user);
      return;
    } catch (error) {
      setUser(null);
    }
  }
  renderPicker(showGate(), { onEnter: enterApp, mobile: true });
}

boot();
