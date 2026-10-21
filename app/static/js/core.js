export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MEASURE_LABELS = { reps: "Reps", sec: "Seconds", min: "Minutes", none: "Check off" };
export const MEASURE_UNITS = { reps: "reps", sec: "s", min: "min", none: "" };
export const EFFORT_LABELS = { 1: "Easy", 2: "Hard", 3: "Max effort" };

export const PLATE_COLORS = ["--accent-line", "--plate-blue", "--plate-red", "--plate-green", "--plate-purple", "--plate-cyan", "--plate-orange", "--chalk-2"];

export const state = {
  meta: null,
  exercises: null,
  programs: null,
  equipment: null,
  active: null,
  cleanup: [],
  user: null,
  userId: null,
  onUnauthorized: null,
};

export function setUser(user) {
  state.user = user;
  state.userId = user ? user.id : null;
  state.programs = null;
  state.active = null;
  storageSet("user-id", user ? String(user.id) : "");
}

export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export async function api(method, path, body) {
  const options = { method, headers: {} };
  if (state.userId) options.headers["X-User-Id"] = String(state.userId);
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  if (response.status === 401 && state.onUnauthorized) state.onUnauthorized();
  if (!response.ok) {
    let message = "Request failed (" + response.status + ")";
    try {
      const data = await response.json();
      if (data && data.detail) message = typeof data.detail === "string" ? data.detail : "Check your input";
    } catch (error) {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function cssVar(name) {
  if (!name.startsWith("--")) return name;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function plateColor(index) {
  return cssVar(PLATE_COLORS[index % PLATE_COLORS.length]);
}

export function toast(message, kind = "", action) {
  const root = document.getElementById("toast-root");
  const element = document.createElement("div");
  element.className = "toast " + kind;
  element.innerHTML = "<span>" + esc(message) + "</span>";
  if (action) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.run();
      element.remove();
    });
    element.appendChild(button);
  }
  root.appendChild(element);
  setTimeout(() => element.remove(), kind === "error" ? 6000 : action ? 7000 : 3200);
}

export function openModal(html, options = {}) {
  const root = document.getElementById("modal-root");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = '<div class="modal' + (options.wide ? " wide" : "") + '" role="dialog" aria-modal="true">' + html + "</div>";
  root.appendChild(backdrop);
  const previous = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    if (options.onClose) options.onClose();
    if (previous && previous.focus) previous.focus();
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelectorAll("[data-close]").forEach((element) => element.addEventListener("click", close));
  const focusTarget = backdrop.querySelector("[autofocus]") || backdrop.querySelector("input, select, textarea, button");
  if (focusTarget) setTimeout(() => focusTarget.focus(), 20);
  return { element: backdrop.querySelector(".modal"), close };
}

export function confirmModal(title, message, confirmLabel, danger) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal(
      '<div class="modal-head"><h2>' + esc(title) + "</h2></div><p class=\"muted\">" + esc(message) + "</p>" +
      '<div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn ' + (danger ? "danger" : "primary") + '" data-ok autofocus>' + esc(confirmLabel) + "</button></div>",
      { onClose: () => { if (!answered) resolve(false); } },
    );
    modal.element.querySelector("[data-ok]").addEventListener("click", () => {
      answered = true;
      resolve(true);
      modal.close();
    });
  });
}

export function pad(number) {
  return String(number).padStart(2, "0");
}

export function toIso(dateValue) {
  return dateValue.getFullYear() + "-" + pad(dateValue.getMonth() + 1) + "-" + pad(dateValue.getDate());
}

export function todayIso() {
  return toIso(new Date());
}

export function fromIso(isoValue) {
  const [year, month, day] = isoValue.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function weekdayIndex(dateValue) {
  return (dateValue.getDay() + 6) % 7;
}

export function formatDay(isoValue, withWeekday = true) {
  const value = fromIso(isoValue);
  const text = value.getDate() + " " + MONTHS[value.getMonth()] + " " + value.getFullYear();
  return withWeekday ? WEEKDAYS[weekdayIndex(value)] + ", " + text : text;
}

export function formatShortDay(isoValue) {
  const value = fromIso(isoValue);
  return value.getDate() + " " + MONTHS_SHORT[value.getMonth()];
}

export function relativeDay(isoValue) {
  const days = Math.round((fromIso(todayIso()) - fromIso(isoValue)) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days > 1 && days < 14) return days + " days ago";
  return formatShortDay(isoValue);
}

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? hours + ":" + pad(minutes) + ":" + pad(rest) : minutes + ":" + pad(rest);
}

export function num(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const rounded = Math.round(Number(value) * 10 ** digits) / 10 ** digits;
  return rounded.toLocaleString("en-GB", { maximumFractionDigits: digits });
}

export function formatSet(set, measure, trackWeight) {
  const value = set.value === null || set.value === undefined ? null : num(set.value);
  if (measure === "none") return "done";
  let text = value === null ? "" : value + " " + MEASURE_UNITS[measure];
  if (trackWeight && set.weight !== null && set.weight !== undefined) text = num(set.weight) + " kg × " + (value === null ? "?" : value);
  return text.trim();
}

export function muscleLabel(key) {
  return (state.meta && state.meta.muscle_labels[key]) || key || "";
}

export async function loadMeta() {
  if (!state.meta) state.meta = await api("GET", "/api/meta");
  return state.meta;
}

export async function loadExercises(force) {
  if (force || !state.exercises) state.exercises = await api("GET", "/api/exercises");
  return state.exercises;
}

export async function loadPrograms(force) {
  if (force || !state.programs) state.programs = await api("GET", "/api/programs");
  return state.programs;
}

export async function loadEquipment(force) {
  if (force || !state.equipment) state.equipment = await api("GET", "/api/equipment");
  return state.equipment;
}

export function invalidate(...keys) {
  keys.forEach((key) => { state[key] = null; });
}

export function onCleanup(callback) {
  state.cleanup.push(callback);
}

export function runCleanup() {
  const callbacks = state.cleanup.splice(0);
  callbacks.forEach((callback) => {
    try { callback(); } catch (error) {}
  });
}

export function mediaUrl(name) {
  return name ? "/media/" + encodeURIComponent(name) : "";
}

export function isVideo(name) {
  return /\.(mp4|webm|mov)$/i.test(name || "");
}

export function mediaTag(name, attributes = "") {
  if (!name) return "";
  if (isVideo(name)) return '<video src="' + mediaUrl(name) + '" autoplay muted loop playsinline ' + attributes + "></video>";
  return '<img src="' + mediaUrl(name) + '" alt="" ' + attributes + ">";
}

export function thumbUrl(videoId) {
  return "https://i.ytimg.com/vi/" + encodeURIComponent(videoId) + "/hqdefault.jpg";
}

let youtubeReady = null;
function loadYouTubeApi() {
  if (youtubeReady) return youtubeReady;
  youtubeReady = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return youtubeReady;
}

export async function createLoopPlayer(container, videoId, start, end) {
  container.innerHTML = '<div></div><div class="shield"></div>';
  const target = container.firstChild;
  const YTApi = await loadYouTubeApi();
  const startAt = start || 0;
  const playerVars = {
    autoplay: 1, mute: 1, controls: 0, loop: 1, playlist: videoId, rel: 0, playsinline: 1,
    modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0,
  };
  if (startAt) playerVars.start = startAt;
  if (end) playerVars.end = end;
  let pollHandle = null;
  const player = new YTApi.Player(target, {
    videoId,
    host: "https://www.youtube-nocookie.com",
    playerVars,
    events: {
      onReady: (event) => {
        event.target.mute();
        event.target.playVideo();
        pollHandle = setInterval(() => {
          try {
            const current = event.target.getCurrentTime();
            if (end && current >= end) event.target.seekTo(startAt, true);
            if (startAt && current < startAt - 1) event.target.seekTo(startAt, true);
          } catch (error) {
            clearInterval(pollHandle);
          }
        }, 300);
      },
      onStateChange: (event) => {
        if (event.data === YTApi.PlayerState.ENDED) {
          event.target.seekTo(startAt, true);
          event.target.playVideo();
        }
      },
    },
  });
  return {
    destroy() {
      clearInterval(pollHandle);
      try { player.destroy(); } catch (error) {}
    },
  };
}

let audioContext = null;
export function beep(times = 3, frequency = 880) {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    for (let index = 0; index < times; index++) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      const start = audioContext.currentTime + index * 0.28;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      oscillator.start(start);
      oscillator.stop(start + 0.22);
    }
  } catch (error) {}
}

export function storageGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

export function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (error) {}
}

export function logKindClass(kind) {
  if (["weight_up", "reps_up", "time_up", "volume_up", "cardio_up", "weight_set"].includes(kind)) return "k-up";
  if (["weight_down", "volume_down"].includes(kind)) return "k-down";
  if (["swap", "redesign", "restore", "edit"].includes(kind)) return "k-swap";
  if (["block_review", "deload_start", "fatigue"].includes(kind)) return "k-block";
  if (kind === "ai_note") return "k-ai";
  if (kind === "ai_waiting") return "k-down";
  return "k-neutral";
}

export function logKindIcon(kind) {
  return { ai_note: "AI", ai_waiting: "!", weight_up: "↑", reps_up: "↑", time_up: "↑", volume_up: "+", cardio_up: "+", weight_set: "•", weight_down: "↓", volume_down: "−",
    swap: "⇄", redesign: "✎", edit: "✎", restore: "↺", undo: "↺", block_review: "B", deload_start: "D", fatigue: "D" }[kind] || "i";
}

export function logItemHtml(entry, withUndo) {
  const canUndo = withUndo && entry.version_id && !entry.undone && entry.kind !== "undo";
  return '<div class="feed-item' + (entry.undone ? " undone" : "") + '">' +
    '<div class="ico ' + logKindClass(entry.kind) + '">' + logKindIcon(entry.kind) + "</div>" +
    '<div><div class="title">' + esc(entry.title) + (entry.source === "ai" ? ' <span class="chip ai">AI</span>' : "") + "</div>" +
    (entry.message ? '<div class="msg">' + esc(entry.message).replace(/\n\n/g, "<br><br>") + "</div>" : "") + "</div>" +
    '<div class="when">' + esc(relativeDay(entry.created_at.slice(0, 10))) +
    (canUndo ? '<br><button class="btn ghost small" data-undo="' + entry.id + '">Undo</button>' : "") + "</div></div>";
}
