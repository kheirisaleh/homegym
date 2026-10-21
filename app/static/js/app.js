import { api, esc, runCleanup, loadMeta, storageGet, storageSet, toast, state, setUser, invalidate } from "./core.js?v=cycle2";
import { renderDashboard } from "./views/dashboard.js?v=cycle2";
import { renderTraining, refreshActive } from "./views/workout.js?v=cycle2";
import { renderPrograms, renderProgramEditor } from "./views/programs.js?v=cycle2";
import { renderExercises } from "./views/exercises.js?v=cycle2";
import { renderEquipment } from "./views/equipment.js?v=cycle2";
import { renderHistory, renderSessionDetail } from "./views/history.js?v=cycle2";
import { renderCoach } from "./views/coach.js?v=cycle2";
import { renderLeaderboard } from "./views/leaderboard.js?v=cycle2";
import { renderProfile } from "./views/profile.js?v=cycle2";
import { renderTrainerSettings } from "./views/trainer.js?v=cycle2";
import { renderPicker, renderGenerating, avatar } from "./accounts.js?v=cycle2";
import { renderSettings } from "./views/settings.js?v=cycle2";
import { enter, routeStart, routeEnd } from "./motion.js?v=cycle2";
import { renderHealthDesktop, mountCycleDesktop, mountAdjustedDesktop } from "./views/health.js?v=cycle2";

const ROUTES = [
  [/^\/?$/, "dashboard", async (view) => { await renderDashboard(view); await mountCycleDesktop(view, () => router()); }],
  [/^\/training$/, "training", (view) => renderTraining(view)],
  [/^\/programs$/, "programs", async (view) => { await renderPrograms(view); await mountCycleDesktop(view, () => router()); }],
  [/^\/programs\/(new|\d+)$/, "programs", async (view, match) => {
    await renderProgramEditor(view, match[1]);
    if (match[1] === "new") return;
    const programId = Number(match[1]);
    await mountAdjustedDesktop(view, programId, async () => {
      const { todayIso } = await import("./core.js?v=cycle2");
      const { startWorkoutFlow } = await import("./views/workout.js?v=cycle2");
      startWorkoutFlow(todayIso(), programId);
    });
  }],
  [/^\/settings$/, "settings", (view) => renderSettings(view)],
  [/^\/health$/, "health", (view) => renderHealthDesktop(view)],
  [/^\/exercises$/, "exercises", (view) => renderExercises(view)],
  [/^\/exercises\/(\d+)$/, "exercises", (view, match) => renderExercises(view, match[1])],
  [/^\/equipment$/, "equipment", (view) => renderEquipment(view)],
  [/^\/history$/, "history", (view) => renderHistory(view)],
  [/^\/history\/training\/(\d+)$/, "history", (view, match) => renderSessionDetail(view, match[1])],
  [/^\/coach$/, "coach", (view) => renderCoach(view)],
  [/^\/leaderboard$/, "leaderboard", (view) => renderLeaderboard(view)],
  [/^\/profile$/, "profile", (view) => renderProfile(view, { onLogout: logout })],
  [/^\/trainer$/, "trainer", (view) => renderTrainerSettings(view)],
];

const NAV_KEYS = { 1: "#/", 2: "#/training", 3: "#/programs", 4: "#/exercises", 5: "#/equipment", 6: "#/history", 7: "#/coach", 8: "#/leaderboard", 9: "#/trainer", 0: "#/settings", h: "#/health", H: "#/health" };

let renderToken = 0;
let lastPath = null;
let inApp = false;

async function router() {
  if (!inApp) return;
  const path = location.hash.replace(/^#/, "") || "/";
  const view = document.getElementById("view");
  const sameList = lastPath && path.startsWith("/exercises") && lastPath.startsWith("/exercises") && document.querySelector(".modal-backdrop") === null && path === "/exercises";
  lastPath = path;
  if (sameList && view.querySelector("#ex-grid")) return;
  runCleanup();
  document.getElementById("modal-root").innerHTML = "";
  const token = ++renderToken;
  for (const [pattern, name, render] of ROUTES) {
    const match = path.match(pattern);
    if (!match) continue;
    document.querySelectorAll(".nav a").forEach((link) => link.classList.toggle("active", link.dataset.route === name));
    document.body.dataset.route = name;
    routeStart();
    try {
      await render(view, match);
      if (token === renderToken) {
        enter(view);
        view.focus({ preventScroll: true });
        await refreshActive();
      }
    } catch (error) {
      if (token === renderToken) routeEnd();
      if (!state.userId || token !== renderToken) return;
      view.innerHTML = '<div class="empty">This page could not be loaded: ' + esc(error.message) + '<br><button class="btn" onclick="location.reload()">Reload</button></div>';
    }
    if (token === renderToken) routeEnd();
    updateBlockChip();
    scheduleFit();
    return;
  }
  location.hash = "#/";
}

export async function updateAiBanner(fresh) {
  const banner = document.getElementById("ai-banner");
  try {
    const status = await api("GET", "/api/ai/status" + (fresh ? "?fresh=true" : ""));
    if (status.ready) {
      banner.hidden = true;
      return status;
    }
    banner.hidden = false;
    banner.innerHTML = "<b>AI coach offline.</b><span>" + esc((status.message || "Not reachable") + ".") +
      " Program updates wait until it is back. Weights still progress after every workout.</span><a href=\"#/coach\">Details</a>";
    return status;
  } catch (error) {
    return null;
  }
}

async function updateBlockChip() {
  try {
    const coach = await api("GET", "/api/coach?log_limit=1");
    const block = coach.block;
    const weeks = Array.from({ length: block.weeks }, (_, index) => {
      const week = index + 1;
      const classes = [week < block.week ? "done" : "", week === block.week ? "now" : "", week === block.weeks || (block.deload && week === block.week) ? "deload" : ""].join(" ");
      return '<i class="' + classes + '"></i>';
    }).join("");
    document.getElementById("block-chip").innerHTML = "Block " + block.number + (block.deload ? ", deload" : "") + "<strong>Week " + block.week + " of " + block.weeks + '</strong><div class="block-weeks">' + weeks + "</div>";
  } catch (error) {}
}

function updateUserChip() {
  const chip = document.getElementById("user-chip");
  if (!state.user) {
    chip.innerHTML = "";
    return;
  }
  chip.innerHTML = avatar(state.user) + '<span class="user-chip-name">' + esc(state.user.name) + '</span><span class="user-chip-hint">Profile</span>';
}

let fitHandle = null;

function scheduleFit() {
  cancelAnimationFrame(fitHandle);
  fitHandle = requestAnimationFrame(fitToScreen);
  setTimeout(fitToScreen, 400);
  setTimeout(fitToScreen, 1200);
}

export { scheduleFit };

const MIN_ZOOM = 0.62;
const TRIM_LISTS = [".volume-list", ".alt-programs", ".board", ".feed", "#ex-grid", ".eq-grid", ".session-list", ".prog-list", ".report", ".lift-legend"];
let fitObserver = null;
let fitDebounce = null;

function trimItems(list) {
  return [...list.children].filter((child) => !child.matches(".vol-legend, .proj-more, .board-legend"));
}

function resetTrim(view) {
  view.querySelectorAll(".proj-trimmed").forEach((element) => element.classList.remove("proj-trimmed"));
  view.querySelectorAll(".proj-more").forEach((element) => element.remove());
}

function setVisible(list, count) {
  const items = trimItems(list);
  items.forEach((item, index) => item.classList.toggle("proj-trimmed", index >= count));
  let note = list.querySelector(":scope > .proj-more");
  const hidden = items.length - count;
  if (hidden > 0) {
    if (!note) {
      note = document.createElement("div");
      note.className = "proj-more";
      list.appendChild(note);
    }
    note.textContent = "+ " + hidden + " more on your laptop or phone";
  } else if (note) {
    note.remove();
  }
}

function fitToScreen() {
  const view = document.getElementById("view");
  const stage = document.querySelector(".stage");
  const projector = document.documentElement.dataset.projector === "on";
  if (!projector || !inApp) {
    view.style.zoom = "";
    resetTrim(view);
    if (fitObserver) fitObserver.takeRecords();
    return;
  }
  resetTrim(view);
  view.style.zoom = "1";
  const available = stage.clientHeight - [...stage.children].filter((child) => child !== view && !child.hidden).reduce((sum, child) => sum + child.offsetHeight, 0);
  const availableWidth = stage.clientWidth;
  const fits = (zoom) => view.scrollHeight * zoom <= available + 1 && view.scrollWidth * zoom <= availableWidth + 1;
  let zoom = 1;
  for (let attempt = 0; attempt < 6 && zoom > MIN_ZOOM; attempt++) {
    view.style.zoom = String(zoom);
    if (fits(zoom)) break;
    const height = view.scrollHeight * zoom;
    const width = view.scrollWidth * zoom;
    zoom = Math.max(MIN_ZOOM, zoom * Math.min(available / height, availableWidth / width) * 0.99);
  }
  view.style.zoom = String(zoom);
  if (!fits(zoom)) {
    // Too much content even at the smallest readable size: show fewer list items instead of scrolling.
    const lists = [...view.querySelectorAll(TRIM_LISTS.join(","))].filter((list) => trimItems(list).length > 1).reverse();
    const fitList = (list) => {
      const total = trimItems(list).length;
      setVisible(list, total);
      const before = view.scrollHeight;
      setVisible(list, 1);
      if (view.scrollHeight >= before - 1 && !fits(zoom)) {
        setVisible(list, total);
        return;
      }
      let low = 1;
      let high = total;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        setVisible(list, middle);
        if (fits(zoom)) low = middle;
        else high = middle - 1;
      }
      setVisible(list, low);
    };
    for (const list of lists) {
      fitList(list);
      if (fits(zoom)) break;
    }
    // Second pass: lists that did not matter before may matter now, and earlier lists may regrow.
    if (!fits(zoom)) lists.forEach(fitList);
    for (let attempt = 0; attempt < 6 && !fits(zoom) && zoom > 0.3; attempt++) {
      zoom = Math.max(0.3, zoom * Math.min(available / (view.scrollHeight * zoom), availableWidth / (view.scrollWidth * zoom)) * 0.99);
      view.style.zoom = String(zoom);
    }
  }
  if (fitObserver) fitObserver.takeRecords();
}

function watchFit() {
  if (fitObserver) return;
  fitObserver = new MutationObserver(() => {
    if (document.documentElement.dataset.projector !== "on") return;
    clearTimeout(fitDebounce);
    fitDebounce = setTimeout(fitToScreen, 180);
  });
  fitObserver.observe(document.getElementById("view"), { childList: true, subtree: true });
}

function applyProjector(on) {
  document.documentElement.dataset.projector = on ? "on" : "off";
  document.getElementById("projector-toggle").setAttribute("aria-pressed", String(on));
  document.querySelector('meta[name="theme-color"]').content = on ? "#fbf8f1" : "#1b1e22";
}

function toggleProjector() {
  const on = document.documentElement.dataset.projector !== "on";
  applyProjector(on);
  storageSet("projector", on ? "on" : "off");
  if (on && document.fullscreenElement === null && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (!on && document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  if (!document.querySelector(".rest-overlay")) router();
  scheduleFit();
}

document.addEventListener("keydown", (event) => {
  if (!inApp) return;
  const tag = (event.target.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tag) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector(".modal-backdrop") || document.querySelector(".rest-overlay")) return;
  if (event.key === "p" || event.key === "P") {
    event.preventDefault();
    toggleProjector();
  } else if (NAV_KEYS[event.key] && !location.hash.startsWith("#/training")) {
    const link = document.querySelector('.nav a[href="' + NAV_KEYS[event.key] + '"]');
    if (link && link.style.display === "none") return;
    location.hash = NAV_KEYS[event.key];
  }
});

function showGate() {
  inApp = false;
  runCleanup();
  document.getElementById("shell").hidden = true;
  const gate = document.getElementById("gate");
  gate.hidden = false;
  document.body.dataset.route = "gate";
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
  updateUserChip();
  document.getElementById("nav-health").style.display = state.user && state.user.sex === "female" ? "" : "none";
  document.getElementById("nav-settings").style.display = state.user && state.user.is_superuser ? "" : "none";
  if (location.hash === "" || location.hash === "#/profile") location.hash = "#/";
  router();
  updateAiBanner();
}

export function logout() {
  setUser(null);
  location.hash = "";
  renderPicker(showGate(), { onEnter: enterApp });
}

async function boot() {
  if (storageGet("force-desktop", "") !== "1" && window.matchMedia("(max-width: 760px)").matches) {
    location.replace("/m/");
    return;
  }
  applyProjector(storageGet("projector", "off") === "on");
  document.getElementById("projector-toggle").addEventListener("click", toggleProjector);
  if (!window.Chart) await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  try {
    await loadMeta();
  } catch (error) {
    toast("Server not reachable", "error");
    return;
  }
  state.onUnauthorized = () => { if (inApp) logout(); };
  window.addEventListener("hashchange", router);
  window.addEventListener("resize", scheduleFit);
  watchFit();
  document.addEventListener("user-changed", updateUserChip);
  document.addEventListener("regenerating", () => renderGenerating(showGate(), state.user, { onEnter: enterApp }));
  setInterval(() => { if (inApp) updateAiBanner(); }, 60000);

  const saved = Number(storageGet("user-id", "")) || null;
  if (saved) {
    state.userId = saved;
    try {
      const user = await api("GET", "/api/me");
      setUser(user);
      if (user.status === "generating") {
        renderGenerating(showGate(), user, { onEnter: enterApp });
        return;
      }
      enterApp(user);
      return;
    } catch (error) {
      setUser(null);
    }
  }
  renderPicker(showGate(), { onEnter: enterApp });
}

boot();
