import { esc } from "../core.js?v=cycle2";
import { configureCycle, cycleState, cycleCardHtml, mountCycleCard, mountAdjustedPlan, renderHealth } from "../../m/cycle.js?v=cycle2";

function headerSetter(head) {
  return ({ title, action }) => {
    head.innerHTML = "<div><h1>" + esc(title) + "</h1><p>Your cycle, symptoms and training in one place. Private to you.</p></div>" +
      (action ? '<div class="page-actions"><button class="btn" id="hp-action">' + esc(action.label) + "</button></div>" : "");
    if (action) head.querySelector("#hp-action").addEventListener("click", action.run);
  };
}

function slot(view) {
  const box = document.createElement("div");
  box.className = "cycle-desktop cycle-slot";
  const head = view.querySelector(".page-head");
  if (head) head.after(box);
  else view.prepend(box);
  return box;
}

export async function renderHealthDesktop(view) {
  view.innerHTML = '<div class="page-head" id="hp-head"></div><div class="cycle-desktop health-desktop" id="hp-body"></div>';
  configureCycle({ setTop: headerSetter(view.querySelector("#hp-head")), healthHref: "#/health" });
  await renderHealth(view.querySelector("#hp-body"));
}

export async function mountCycleDesktop(view, rerender) {
  configureCycle({ setTop: () => {}, healthHref: "#/health" });
  const cycle = await cycleState();
  if (!cycle.eligible) return;
  const box = slot(view);
  box.innerHTML = cycleCardHtml(cycle, false);
  mountCycleCard(box, cycle, rerender);
}

export async function mountAdjustedDesktop(view, programId, start) {
  configureCycle({ setTop: () => {}, healthHref: "#/health" });
  const cycle = await cycleState();
  if (!cycle.eligible || !cycle.active) return;
  await mountAdjustedPlan(slot(view), programId, start);
}
