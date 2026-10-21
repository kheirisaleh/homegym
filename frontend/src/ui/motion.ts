import { type RefObject, useEffect } from "react";

const REVEAL = [
  ".page-head", ".today-card", ".hero-chart", ".panel", ".tile", ".prog-card", ".ex-card", ".eq-card", ".session-row", ".alt-program",
  ".cal-day", ".feed-item", ".board-row", ".user-card", ".m-hero", ".m-card", ".m-item", ".m-stat", ".m-section-title", ".preview-item",
  ".st-card", ".choice", ".coach-card-home", ".logger", ".w-item", ".week-strip > div", ".coach-pick",
].join(",");
const COUNTERS = ".tile .value, .m-hero h1, .m-stat b, .hero-figure .big, .board-score, .editor-summary b, .nu-stats b, .today-card .meta b";
const BARS = ".vol-done, .wk-bar b, .meter i, .nu-bar i, .score-bar i:not(.rest)";
const MAX_STAGGER = 14;

export function calm(): boolean {
  return document.documentElement.dataset.projector === "on" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function countUp(element: HTMLElement): void {
  if (calm() || element.dataset.counted) return;
  const node = [...element.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && /\d/.test(child.textContent ?? ""));
  if (!node) return;
  const match = /^(\s*[+−-]?)([\d.,]+)(.*)$/s.exec(node.textContent ?? "");
  if (!match) return;
  const [, lead = "", raw = "", tail = ""] = match;
  const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;
  const target = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(target) || target === 0) return;
  element.dataset.counted = "1";
  const grouped = raw.includes(",");
  const format = (value: number) => {
    const fixed = value.toFixed(decimals);
    return grouped ? Number(fixed).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed;
  };
  const duration = 900;
  const start = performance.now();
  let written = lead + format(0) + tail;
  const step = (now: number) => {
    if (node.textContent !== written) return;
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 4);
    written = lead + (progress < 1 ? format(target * eased) : raw) + tail;
    node.textContent = written;
    if (progress < 1) requestAnimationFrame(step);
  };
  node.textContent = written;
  requestAnimationFrame(step);
}

export function growBars(root: ParentNode): void {
  if (calm()) return;
  root.querySelectorAll<HTMLElement>(BARS).forEach((bar, index) => {
    bar.animate(
      [{ transform: "scaleX(0)", transformOrigin: "left center" }, { transform: "scaleX(1)", transformOrigin: "left center" }],
      { duration: 650, delay: 100 + Math.min(index, 20) * 30, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
    );
  });
}

export function enter(root: HTMLElement | null): void {
  if (!root || calm()) return;
  const items = [...root.querySelectorAll<HTMLElement>(REVEAL)].filter((element) => !element.closest(".modal") && !element.parentElement?.closest(".rv"));
  items.forEach((element, index) => {
    element.classList.remove("rv");
    element.style.setProperty("--rv-i", String(Math.min(index, MAX_STAGGER)));
    element.getBoundingClientRect();
    element.classList.add("rv");
    element.addEventListener(
      "animationend",
      () => {
        element.classList.remove("rv");
      },
      { once: true },
    );
  });
  growBars(root);
  root.querySelectorAll<HTMLElement>(COUNTERS).forEach(countUp);
}

export function useEnter(ref: RefObject<HTMLElement | null>, ready: boolean, key: unknown = null): void {
  useEffect(() => {
    if (ready) enter(ref.current);
  }, [ready, key, ref]);
}

export function slideIn(element: Element | null, direction = 1): void {
  if (!element || calm()) return;
  element.animate([{ opacity: 0, transform: "translateX(" + String(28 * direction) + "px)" }, { opacity: 1, transform: "none" }], {
    duration: 280,
    easing: "cubic-bezier(.2,.8,.2,1)",
  });
}

export function pop(element: Element | null): void {
  if (!element || calm()) return;
  element.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
}

const CONFETTI = ["--plate-yellow", "--plate-blue", "--plate-red", "--plate-green", "--plate-purple", "--plate-cyan"];

export function celebrate(originX?: number, originY?: number): void {
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
    piece.style.background = styles.getPropertyValue(CONFETTI[index % CONFETTI.length]!).trim();
    piece.style.left = String(x) + "px";
    piece.style.top = String(y) + "px";
    if (index % 3 === 0) piece.style.borderRadius = "50%";
    layer.appendChild(piece);
    const dx = Math.cos(angle) * power;
    const dy = Math.sin(angle) * power - 180;
    const spin = (Math.random() - 0.5) * 900;
    piece.animate(
      [
        { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
        { transform: "translate(calc(-50% + " + String(dx) + "px), calc(-50% + " + String(dy) + "px)) rotate(" + String(spin / 2) + "deg)", opacity: 1, offset: 0.45 },
        { transform: "translate(calc(-50% + " + String(dx * 1.3) + "px), calc(-50% + " + String(dy + 420) + "px)) rotate(" + String(spin) + "deg)", opacity: 0 },
      ],
      { duration: 1500 + Math.random() * 700, easing: "cubic-bezier(.15,.7,.3,1)", fill: "forwards" },
    );
  }
  window.setTimeout(() => {
    layer.remove();
  }, 2400);
}

let progressBar: HTMLDivElement | null = null;
let progressTimer = 0;

export function routeStart(): void {
  if (!progressBar) {
    progressBar = document.createElement("div");
    progressBar.className = "route-progress";
    document.body.appendChild(progressBar);
  }
  const bar = progressBar;
  window.clearTimeout(progressTimer);
  bar.classList.remove("done");
  progressTimer = window.setTimeout(() => bar.classList.add("on"), 120);
}

export function routeEnd(): void {
  const bar = progressBar;
  if (!bar) return;
  window.clearTimeout(progressTimer);
  if (!bar.classList.contains("on")) return;
  bar.classList.add("done");
  progressTimer = window.setTimeout(() => bar.classList.remove("on", "done"), 360);
}

const RIPPLE_TARGETS = ".btn, .m-item, .alt-program, .user-card, .choice, .m-option, .m-tabs a, .nav a";

function ripple(event: PointerEvent): void {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest<HTMLElement>(RIPPLE_TARGETS);
  if (!target || (target as HTMLButtonElement).disabled || calm()) return;
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2.2;
  const wave = document.createElement("span");
  wave.className = "ripple";
  wave.style.width = wave.style.height = String(size) + "px";
  wave.style.left = String(event.clientX - rect.left - size / 2) + "px";
  wave.style.top = String(event.clientY - rect.top - size / 2) + "px";
  target.appendChild(wave);
  wave.addEventListener("animationend", () => wave.remove(), { once: true });
}

const SPOTLIGHT = ".panel, .tile, .prog-card, .ex-card, .eq-card, .today-card, .user-card";

function spotlight(event: PointerEvent): void {
  if (!(event.target instanceof Element)) return;
  const card = event.target.closest<HTMLElement>(SPOTLIGHT);
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", String(event.clientX - rect.left) + "px");
  card.style.setProperty("--my", String(event.clientY - rect.top) + "px");
}

let installed = false;

export function installMotion(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const hover = window.matchMedia("(hover: hover)").matches;
  document.addEventListener("pointerdown", ripple, { passive: true });
  if (hover) document.addEventListener("pointermove", spotlight, { passive: true });
  return () => {
    installed = false;
    document.removeEventListener("pointerdown", ripple);
    document.removeEventListener("pointermove", spotlight);
  };
}
