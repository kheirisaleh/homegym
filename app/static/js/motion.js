const REVEAL = [
  ".page-head", ".today-card", ".hero-chart", ".panel", ".tile", ".prog-card", ".ex-card", ".eq-card", ".session-row", ".alt-program",
  ".cal-day", ".feed-item", ".board-row", ".user-card", ".m-hero", ".m-card", ".m-item", ".m-stat", ".m-section-title", ".preview-item",
  ".st-card", ".choice", ".coach-mini", ".logger", ".w-item", ".mw-set-row",
].join(",");
const COUNTERS = ".tile .value, .m-hero h1, .m-stat b, .hero-figure .big, .board .score, .editor-summary b, .nu-stats b";
const BARS = ".vol-done, .wk-bar b, .meter i, .nu-bar i";
const MAX_STAGGER = 14;

export function calm() {
  return document.documentElement.dataset.projector === "on" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function enter(root) {
  if (!root || calm()) return;
  const items = [...root.querySelectorAll(REVEAL)].filter((element) => !element.closest(".modal") && !element.parentElement.closest(".rv"));
  items.forEach((element, index) => {
    element.classList.remove("rv");
    element.style.setProperty("--rv-i", String(Math.min(index, MAX_STAGGER)));
    void element.offsetWidth;
    element.classList.add("rv");
    element.addEventListener("animationend", () => element.classList.remove("rv"), { once: true });
  });
  growBars(root);
  root.querySelectorAll(COUNTERS).forEach(countUp);
}

export function growBars(root) {
  if (calm()) return;
  root.querySelectorAll(BARS).forEach((bar, index) => {
    bar.animate(
      [{ transform: "scaleX(0)", transformOrigin: "left center" }, { transform: "scaleX(1)", transformOrigin: "left center" }],
      { duration: 700, delay: 120 + Math.min(index, 20) * 35, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
    );
  });
}

export function countUp(element) {
  if (calm() || element.dataset.counted) return;
  const node = [...element.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && /\d/.test(child.textContent));
  if (!node) return;
  const match = node.textContent.match(/^(\s*[+−-]?)([\d.,]+)(.*)$/s);
  if (!match) return;
  const raw = match[2];
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  const target = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(target) || target === 0) return;
  element.dataset.counted = "1";
  const grouped = raw.includes(",");
  const format = (value) => {
    const fixed = value.toFixed(decimals);
    return grouped ? Number(fixed).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed;
  };
  const duration = 900;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 4);
    node.textContent = match[1] + (progress < 1 ? format(target * eased) : raw) + match[3];
    if (progress < 1) requestAnimationFrame(step);
  };
  node.textContent = match[1] + format(0) + match[3];
  requestAnimationFrame(step);
}

export function slideIn(element, direction = 1) {
  if (!element || calm()) return;
  element.animate(
    [{ opacity: 0, transform: "translateX(" + 28 * direction + "px)" }, { opacity: 1, transform: "none" }],
    { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
}

export function pop(element) {
  if (!element || calm()) return;
  element.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }],
    { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
}

const CONFETTI = ["--plate-yellow", "--plate-blue", "--plate-red", "--plate-green", "--plate-purple", "--plate-cyan"];

export function celebrate(originX, originY) {
  if (calm()) return;
  const layer = document.createElement("div");
  layer.className = "confetti";
  document.body.appendChild(layer);
  const x = originX ?? window.innerWidth / 2;
  const y = originY ?? window.innerHeight * 0.4;
  const styles = getComputedStyle(document.documentElement);
  const pieces = 70;
  for (let index = 0; index < pieces; index++) {
    const piece = document.createElement("i");
    const angle = (Math.PI * 2 * index) / pieces + Math.random() * 0.4;
    const power = 160 + Math.random() * 260;
    const color = styles.getPropertyValue(CONFETTI[index % CONFETTI.length]).trim();
    piece.style.background = color;
    piece.style.left = x + "px";
    piece.style.top = y + "px";
    if (index % 3 === 0) piece.style.borderRadius = "50%";
    layer.appendChild(piece);
    const dx = Math.cos(angle) * power;
    const dy = Math.sin(angle) * power - 180;
    const spin = (Math.random() - 0.5) * 900;
    piece.animate(
      [
        { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
        { transform: "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px)) rotate(" + spin / 2 + "deg)", opacity: 1, offset: 0.45 },
        { transform: "translate(calc(-50% + " + dx * 1.3 + "px), calc(-50% + " + (dy + 420) + "px)) rotate(" + spin + "deg)", opacity: 0 },
      ],
      { duration: 1500 + Math.random() * 700, easing: "cubic-bezier(.15,.7,.3,1)", fill: "forwards" },
    );
  }
  setTimeout(() => layer.remove(), 2400);
}

let progressBar = null;
let progressTimer = null;

export function routeStart() {
  if (!progressBar) {
    progressBar = document.createElement("div");
    progressBar.className = "route-progress";
    document.body.appendChild(progressBar);
  }
  clearTimeout(progressTimer);
  progressBar.classList.remove("done");
  progressTimer = setTimeout(() => progressBar.classList.add("on"), 120);
}

export function routeEnd() {
  if (!progressBar) return;
  clearTimeout(progressTimer);
  if (!progressBar.classList.contains("on")) return;
  progressBar.classList.add("done");
  progressTimer = setTimeout(() => progressBar.classList.remove("on", "done"), 360);
}

function ripple(event) {
  const target = event.target.closest(".btn, .m-item, .alt-program, .user-card, .choice, .m-option, .m-tabs a, .nav a");
  if (!target || target.disabled || calm()) return;
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2.2;
  const wave = document.createElement("span");
  wave.className = "ripple";
  wave.style.width = wave.style.height = size + "px";
  wave.style.left = event.clientX - rect.left - size / 2 + "px";
  wave.style.top = event.clientY - rect.top - size / 2 + "px";
  target.appendChild(wave);
  wave.addEventListener("animationend", () => wave.remove(), { once: true });
}

function watchToasts() {
  const root = document.getElementById("toast-root");
  if (!root) return;
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("pr")) {
        const rect = node.getBoundingClientRect();
        celebrate(rect.left + rect.width / 2, rect.top);
      }
    }));
  }).observe(root, { childList: true });
}

function spotlight(event) {
  const card = event.target.closest && event.target.closest(".panel, .tile, .prog-card, .ex-card, .eq-card, .today-card, .user-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", event.clientX - rect.left + "px");
  card.style.setProperty("--my", event.clientY - rect.top + "px");
}

document.addEventListener("pointerdown", ripple, { passive: true });
if (window.matchMedia("(hover: hover)").matches) document.addEventListener("pointermove", spotlight, { passive: true });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchToasts, { once: true });
else watchToasts();
