import {
  api, esc, num, state, toast, openModal, confirmModal, formatSet, formatClock, todayIso, formatDay, relativeDay, muscleLabel,
  mediaTag, createLoopPlayer, beep, onCleanup, loadExercises, invalidate, EFFORT_LABELS, MEASURE_UNITS, plateColor,
} from "../core.js?v=cycle2";
import { openCoach, preloadCoach } from "../coach3d.js?v=cycle2";
import { painNote } from "../rebuild.js?v=cycle2";
import { restCoachTip } from "../coachui.js?v=cycle2";

const workout = { session: null, index: 0, player: null, effort: null, timer: null, clockHandle: null, feedback: {} };

export async function refreshActive() {
  state.active = await api("GET", "/api/sessions/active");
  const banner = document.getElementById("active-banner");
  const onTraining = location.hash.startsWith("#/training");
  if (state.active && !onTraining) {
    banner.hidden = false;
    banner.innerHTML = "<span>Workout in progress: " + esc(state.active.program_name) + "</span><a href=\"#/training\">Back to workout</a>";
  } else {
    banner.hidden = true;
  }
  return state.active;
}

export async function startWorkoutFlow(day, programId) {
  await refreshActive();
  if (state.active) {
    location.hash = "#/training";
    return;
  }
  const begin = async () => {
    try {
      await api("POST", "/api/sessions", { day, program_id: programId });
      await refreshActive();
      location.hash = "#/training";
      if (location.hash === "#/training") window.dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (error) {
      toast(error.message, "error");
    }
  };
  if (programId === null || programId === undefined) return begin();
  let program;
  let persona = null;
  try {
    [program, persona] = await Promise.all([api("GET", "/api/programs/" + programId), api("GET", "/api/coach/persona").catch(() => null)]);
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  if (persona) preloadCoach(persona.coach);
  const brief = api("GET", "/api/coach/brief?day=" + day + "&program_id=" + programId);
  brief.catch(() => {});
  const modal = openModal(
    '<div class="modal-head"><h2>' + esc(program.name) + "</h2></div>" +
    (program.description ? '<p class="muted">' + esc(program.description) + "</p>" : "") +
    '<div class="preview-list" style="padding:0 0 12px">' + program.items.map((item, index) =>
      '<div class="preview-item"><span class="n">' + (index + 1) + "</span><div><b>" + esc(item.name) + '</b><div class="meta">' +
      esc(item.measure === "min" ? item.target : item.measure === "none" ? item.sets + " rounds" : item.sets + " × " + (item.target || "")) +
      (item.track_weight && item.target_weight ? " · " + num(item.target_weight) + " kg" : "") + (item.rest_seconds ? " · rest " + formatClock(item.rest_seconds) : "") + "</div>" +
      (item.cue ? '<div class="cue">' + esc(item.cue) + "</div>" : "") + "</div></div>").join("") + "</div>" +
    '<div class="modal-foot"><button class="btn ghost" data-close>Close</button><button class="btn primary" data-go autofocus>Start workout</button></div>',
    { wide: true },
  );
  modal.element.querySelector("[data-go]").addEventListener("click", () => {
    modal.close();
    openCoach({ persona: persona || undefined, load: () => brief, primary: "Let's go", secondary: "Not yet", onPrimary: begin });
  });
}

export async function renderTraining(view) {
  const active = await refreshActive();
  if (!active) return renderStart(view);
  workout.session = active;
  workout.index = Math.min(active.current_index || 0, Math.max(0, active.exercises.length - 1));
  workout.effort = null;
  workout.feedback = await api("GET", "/api/sessions/" + active.id + "/feedback").catch(() => ({}));
  onCleanup(teardown);
  view.innerHTML = '<div class="workout"><aside class="w-list" id="w-list"></aside><section class="w-main" id="w-main"></section><aside class="w-side" id="w-side"></aside></div>';
  draw();
  const tick = () => {
    const element = document.getElementById("w-elapsed");
    if (element) element.textContent = formatClock((Date.now() - new Date(workout.session.started_at).getTime()) / 1000);
  };
  tick();
  workout.clockHandle = setInterval(tick, 1000);
  const onKey = (event) => handleKey(event);
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));
}

function teardown() {
  if (workout.player) workout.player.destroy();
  workout.player = null;
  clearInterval(workout.clockHandle);
  stopTimer();
  const overlay = document.querySelector(".rest-overlay");
  if (overlay) overlay.remove();
}

async function renderStart(view) {
  const today = todayIso();
  const suggestions = await api("GET", "/api/suggestions?day=" + today);
  view.innerHTML = '<div class="page-head"><div><h1>Start a workout</h1><p>' + esc(formatDay(today)) + ". Week " + suggestions.block.week + " of " + suggestions.block.weeks +
    (suggestions.block.deload ? ", deload with half the sets." : ".") + "</p></div>" +
    '<div class="page-actions"><button class="btn" id="free">Free workout</button></div></div>' +
    '<div class="alt-programs">' + suggestions.options.map((option) =>
      '<button class="alt-program" data-program="' + option.program.id + '" style="padding:18px 20px">' +
      '<span class="dot" style="background:' + plateColor(option.program.id) + '"></span>' +
      '<span class="grow"><b style="font-size:var(--step-2);font-family:var(--display)">' + esc(option.program.name) + "</b><span>" + esc(option.reason) + " · " +
      option.program.items.length + " exercises · " + option.program.total_sets + " sets</span></span>" +
      (option.suggested ? '<span class="chip priority">Suggested</span>' : "") + "</button>").join("") + "</div>";
  view.querySelectorAll("[data-program]").forEach((button) => button.addEventListener("click", () => startWorkoutFlow(today, Number(button.dataset.program))));
  view.querySelector("#free").addEventListener("click", () => startWorkoutFlow(today, null));
}

function isComplete(item) {
  return item.sets.length >= item.planned_sets;
}

function firstIncomplete(fromIndex) {
  const list = workout.session.exercises;
  for (let offset = 0; offset < list.length; offset++) {
    const index = (fromIndex + offset) % list.length;
    if (!isComplete(list[index])) return index;
  }
  return -1;
}

function current() {
  return workout.session.exercises[workout.index];
}

function draw() {
  drawList();
  drawMain();
  drawSide();
}

function drawList() {
  const session = workout.session;
  const done = session.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  const planned = session.exercises.reduce((sum, item) => sum + item.planned_sets, 0);
  const list = document.getElementById("w-list");
  list.innerHTML = '<div class="head"><h3>' + esc(session.program_name) + "</h3>" + (session.deload ? '<span class="deload-flag small">Deload</span>' : "") + "</div>" +
    session.exercises.map((item, index) =>
      '<button class="w-item' + (index === workout.index ? " current" : "") + (isComplete(item) ? " complete" : "") + '" data-index="' + index + '">' +
      '<span class="n">' + esc(item.exercise_name) + '</span><span class="c">' + item.sets.length + "/" + item.planned_sets + "</span>" +
      '<span class="pips">' + Array.from({ length: item.planned_sets }, (_, set) => "<i" + (set < item.sets.length ? ' class="on"' : "") + "></i>").join("") + "</span></button>").join("") +
    '<div class="w-clock"><div><b id="w-elapsed">0:00</b>Duration</div><div><b>' + done + "/" + planned + "</b>Sets</div></div>" +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' +
    '<button class="btn" id="w-add">Add exercise</button>' +
    '<button class="btn primary" id="w-finish">Finish workout</button>' +
    '<button class="btn ghost danger" id="w-discard">Discard workout</button></div>';
  list.querySelectorAll("[data-index]").forEach((button) => button.addEventListener("click", () => goTo(Number(button.dataset.index))));
  list.querySelector("#w-add").addEventListener("click", addExercise);
  list.querySelector("#w-finish").addEventListener("click", () => finish(false));
  list.querySelector("#w-discard").addEventListener("click", discard);
  const elapsed = document.getElementById("w-elapsed");
  if (elapsed) elapsed.textContent = formatClock((Date.now() - new Date(session.started_at).getTime()) / 1000);
}

function targetText(item) {
  const parts = [];
  parts.push(item.planned_sets + " × " + (item.target || "free"));
  if (item.track_weight && item.target_weight) parts.push("at " + num(item.target_weight) + " kg");
  return parts.join(" ");
}

function drawMain() {
  const main = document.getElementById("w-main");
  if (workout.player) {
    workout.player.destroy();
    workout.player = null;
  }
  stopTimer();
  const item = current();
  if (!item) {
    main.innerHTML = '<div class="empty">This workout has no exercises yet.<br><button class="btn primary" id="empty-add">Add exercise</button></div>';
    main.querySelector("#empty-add").addEventListener("click", addExercise);
    return;
  }
  const muscles = [item.primary_muscle, ...(item.secondary_muscles || [])].filter(Boolean).map(muscleLabel);
  const hasLoop = item.media_loop || item.video_id;
  main.innerHTML =
    '<div class="w-title"><div><h1>' + esc(item.exercise_name) + "</h1>" +
    '<div class="sub"><span>' + esc(targetText(item)) + "</span><span>Rest " + formatClock(item.rest_seconds) + "</span>" +
    (muscles.length ? "<span>" + esc(muscles.join(", ")) + "</span>" : "") + "</div></div>" +
    '<div class="page-actions"><button class="btn icon" id="w-prev" title="Previous exercise (←)">‹</button><button class="btn icon" id="w-next" title="Next exercise (→)">›</button></div></div>' +
    '<div class="media-stage' + (item.media_muscles && hasLoop ? "" : " single") + '">' +
    (hasLoop ? '<div class="media-frame" id="w-loop">' + (item.media_loop ? mediaTag(item.media_loop) : "") + "</div>" : "") +
    (item.media_muscles ? '<div class="media-frame muscles">' + mediaTag(item.media_muscles) + '<span class="tag">Target muscles</span></div>' : "") +
    (!hasLoop && !item.media_muscles ? '<div class="media-frame is-empty"><div class="media-empty"><span>No tutorial video and no muscle image yet.</span>' +
      (item.exercise_id ? '<a class="btn small" href="#/exercises/' + item.exercise_id + '">Upload media</a>' : "") + "</div></div>" : "") +
    "</div>" +
    (item.plan_cue ? '<p class="cues"><b>Coach:</b> ' + esc(item.plan_cue) + "</p>" : "") +
    (item.cues || item.exercise_notes ? '<p class="cues">' + esc([item.cues, item.exercise_notes].filter(Boolean).join(" ")) + "</p>" : "") +
    (item.exercise_id && item.sets.length && item.measure !== "min" && item.measure !== "none" ? '<div class="feel"><span>How did it feel?</span>' +
      [["good", "Felt it"], ["weak", "Didn't feel it"], ["pain", "Pain"]].map(([key, label]) =>
        '<button data-feel="' + key + '" aria-pressed="' + ((workout.feedback[item.id] || {}).rating === key) + '">' + label + "</button>").join("") + "</div>" : "") +
    '<div class="logger" id="logger"></div>';
  if (!item.media_loop && item.video_id) {
    createLoopPlayer(main.querySelector("#w-loop"), item.video_id, item.video_start, item.video_end).then((player) => {
      if (current() === item) workout.player = player; else player.destroy();
    });
  }
  main.querySelectorAll("[data-feel]").forEach((button) => button.addEventListener("click", async () => {
    const rating = button.dataset.feel;
    try {
      if ((workout.feedback[item.id] || {}).rating === rating) {
        await api("DELETE", "/api/session-exercises/" + item.id + "/feedback");
        delete workout.feedback[item.id];
      } else {
        const note = rating === "pain" ? await painNote() : "";
        workout.feedback[item.id] = await api("POST", "/api/session-exercises/" + item.id + "/feedback", { rating, note });
        toast(rating === "good" ? "Noted" : "Noted, your coach will look at it");
      }
      drawMain();
    } catch (error) {
      toast(error.message, "error");
    }
  }));
  main.querySelector("#w-prev").addEventListener("click", () => goTo(workout.index - 1));
  main.querySelector("#w-next").addEventListener("click", () => goTo(workout.index + 1));
  drawLogger();
}

export function suggested(item) {
  const last = item.sets[item.sets.length - 1];
  const setNumber = item.sets.length + 1;
  const previousSets = item.previous ? item.previous.sets : [];
  const previousSame = previousSets.find((set) => set.set_number === setNumber) || previousSets[previousSets.length - 1];
  let weight = null;
  if (item.track_weight) {
    if (last && last.weight !== null) weight = last.weight;
    else if (item.target_weight) weight = item.target_weight;
    else if (previousSame && previousSame.weight !== null) weight = previousSame.weight;
  }
  let value = null;
  if (last && last.value !== null) value = last.value;
  else if (previousSame && previousSame.value !== null && (!item.track_weight || previousSame.weight === weight)) value = previousSame.value;
  else if (item.rep_min) value = item.rep_min;
  else {
    const match = (item.target || "").match(/\d+(\.\d+)?/);
    if (match) value = Number(match[0]);
  }
  return { weight, value };
}

export function stepWeight(item, weight, direction) {
  const steps = item.weight_steps;
  const currentWeight = Number(weight) || 0;
  if (steps && steps.length) {
    if (direction > 0) return steps.find((value) => value > currentWeight + 1e-6) ?? currentWeight;
    const lower = steps.filter((value) => value < currentWeight - 1e-6);
    return lower.length ? lower[lower.length - 1] : currentWeight;
  }
  return Math.max(0, Math.round((currentWeight + direction * 2.5) * 100) / 100);
}

function drawLogger() {
  const item = current();
  const logger = document.getElementById("logger");
  const values = suggested(item);
  const setNumber = item.sets.length + 1;
  const complete = isComplete(item);
  let controls = "";
  if (item.measure === "none") {
    controls = "";
  } else {
    if (item.track_weight) {
      controls += '<div class="stepper"><span>Weight kg</span><div class="stepper-row"><button type="button" data-step="weight" data-dir="-1" title="Lighter (Shift ↓)">−</button>' +
        '<input type="number" inputmode="decimal" step="0.5" min="0" id="in-weight" value="' + esc(values.weight ?? "") + '" aria-label="Weight">' +
        '<button type="button" data-step="weight" data-dir="1" title="Heavier (Shift ↑)">+</button></div></div>';
    }
    const valueStep = item.measure === "min" ? 1 : item.measure === "sec" ? 5 : 1;
    controls += '<div class="stepper"><span>' + (item.measure === "reps" ? "Reps" : item.measure === "sec" ? "Seconds" : "Minutes") + '</span><div class="stepper-row">' +
      '<button type="button" data-step="value" data-dir="-' + valueStep + '" title="Less (↓)">−</button>' +
      '<input type="number" inputmode="decimal" step="' + (item.measure === "min" ? "0.5" : "1") + '" min="0" id="in-value" value="' + esc(values.value ?? "") + '" aria-label="Value">' +
      '<button type="button" data-step="value" data-dir="' + valueStep + '" title="More (↑)">+</button></div></div>';
    if (item.measure === "reps") {
      controls += '<div class="effort"><span>How hard was the set</span><div class="seg" role="group">' +
        [1, 2, 3].map((level) => '<button type="button" data-effort="' + level + '" aria-pressed="' + (workout.effort === level) + '">' + EFFORT_LABELS[level] + "</button>").join("") + "</div></div>";
    } else {
      controls += '<div class="effort"><span>Timer</span><button class="btn big" type="button" id="w-timer">' + (item.measure === "sec" ? "Start countdown" : "Start stopwatch") + "</button></div>";
    }
  }
  const prevText = item.previous ? item.previous.sets.map((set) => formatSet(set, item.measure, item.track_weight)).join(", ") : "";
  logger.innerHTML =
    '<div class="logger-top"><h2>' + (complete ? "All sets done" : "Set " + setNumber + " of " + item.planned_sets) + "</h2>" +
    '<div class="target-line">Target <b>' + esc(item.target || "free") + "</b>" + (item.track_weight && item.target_weight ? " at <b>" + num(item.target_weight) + " kg</b>" : "") +
    (prevText ? ' <span class="faint">· last time ' + esc(prevText) + "</span>" : "") + "</div></div>" +
    (controls ? '<div class="steppers">' + controls + "</div>" : "") +
    '<div class="log-actions"><button class="btn primary big" id="w-log">' + (item.measure === "none" ? "Done" : complete ? "Save extra set" : "Save set") + ' <span class="kbd">Enter</span></button>' +
    '<button class="btn small" id="w-more" title="Plan one more set">+ Set</button><button class="btn small" id="w-less" title="Plan one set less">− Set</button>' +
    '<span class="hint">↑ ↓ reps · Shift ↑ ↓ weight · ← → exercise</span></div>' +
    setsTable(item);

  logger.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.step === "weight") adjustWeight(Number(button.dataset.dir));
    else adjustValue(Number(button.dataset.dir));
  }));
  logger.querySelectorAll("[data-effort]").forEach((button) => button.addEventListener("click", () => {
    const level = Number(button.dataset.effort);
    workout.effort = workout.effort === level ? null : level;
    logger.querySelectorAll("[data-effort]").forEach((other) => other.setAttribute("aria-pressed", String(Number(other.dataset.effort) === workout.effort)));
  }));
  logger.querySelector("#w-log").addEventListener("click", logSet);
  logger.querySelector("#w-more").addEventListener("click", () => changePlanned(item.planned_sets + 1));
  logger.querySelector("#w-less").addEventListener("click", () => {
    if (item.planned_sets > Math.max(1, item.sets.length)) changePlanned(item.planned_sets - 1);
  });
  const timerButton = logger.querySelector("#w-timer");
  if (timerButton) timerButton.addEventListener("click", () => toggleTimer(item, timerButton));
  bindSetRows(logger, item);
}

function setsTable(item) {
  const rows = item.sets.map((set) =>
    '<tr data-set-row="' + set.id + '"><td class="faint">' + set.set_number + '</td><td class="num">' + esc(formatSet(set, item.measure, item.track_weight)) + (set.record ? '<span class="badge-pr">Best</span>' : "") + "</td>" +
    "<td>" + esc(set.effort ? EFFORT_LABELS[set.effort] : "") + '</td><td class="row-actions"><button class="btn ghost small" data-edit-set="' + set.id + '">Edit</button><button class="btn ghost small danger" data-delete-set="' + set.id + '">Delete</button></td></tr>').join("");
  const pending = Array.from({ length: Math.max(0, item.planned_sets - item.sets.length) }, (_, index) =>
    '<tr class="pending"><td>' + (item.sets.length + index + 1) + '</td><td class="num">' + esc(item.target || "") + (item.track_weight && item.target_weight ? " · " + num(item.target_weight) + " kg" : "") + "</td><td></td><td></td></tr>").join("");
  if (!rows && !pending) return "";
  return '<table class="sets-table"><thead><tr><th>Set</th><th>Result</th><th>Feel</th><th></th></tr></thead><tbody>' + rows + pending + "</tbody></table>";
}

function bindSetRows(logger, item) {
  logger.querySelectorAll("[data-edit-set]").forEach((button) => button.addEventListener("click", () => {
    const set = item.sets.find((entry) => entry.id === Number(button.dataset.editSet));
    const row = button.closest("tr");
    row.innerHTML = '<td class="faint">' + set.set_number + '</td><td colspan="2" style="display:flex;gap:8px;align-items:center">' +
      (item.track_weight ? '<input type="number" step="0.5" data-e-weight value="' + esc(set.weight ?? "") + '"> kg ' : "") +
      (item.measure !== "none" ? '<input type="number" step="0.5" data-e-value value="' + esc(set.value ?? "") + '"> ' + esc(MEASURE_UNITS[item.measure]) : "") + "</td>" +
      '<td class="row-actions"><button class="btn small primary" data-save>Save</button><button class="btn ghost small" data-cancel>Cancel</button></td>';
    row.querySelector("[data-cancel]").addEventListener("click", drawLogger);
    row.querySelector("[data-save]").addEventListener("click", async () => {
      const weightInput = row.querySelector("[data-e-weight]");
      const valueInput = row.querySelector("[data-e-value]");
      try {
        await api("PUT", "/api/sets/" + set.id, {
          weight: weightInput && weightInput.value !== "" ? Number(weightInput.value) : null,
          value: valueInput && valueInput.value !== "" ? Number(valueInput.value) : null,
          effort: set.effort,
        });
        await reload();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }));
  logger.querySelectorAll("[data-delete-set]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api("DELETE", "/api/sets/" + button.dataset.deleteSet);
      await reload();
    } catch (error) {
      toast(error.message, "error");
    }
  }));
}

function drawSide() {
  const item = current();
  const side = document.getElementById("w-side");
  if (!item) {
    side.innerHTML = "";
    return;
  }
  const prev = item.previous;
  const bestText = item.best ? (item.track_weight && item.measure === "reps" ? num(item.best) + " kg" : num(item.best) + " " + MEASURE_UNITS[item.measure]) : "none yet";
  side.innerHTML =
    '<div class="panel"><div class="panel-head"><h3>Last time</h3><span class="hint">' + (prev ? esc(relativeDay(prev.day)) : "") + "</span></div>" +
    (prev ? '<div class="prev-sets">' + prev.sets.map((set) => "<div><span>Set " + set.set_number + "</span><span>" + esc(formatSet(set, item.measure, item.track_weight)) + "</span></div>").join("") + "</div>"
      : '<p class="muted small">First time with this exercise. The heaviest clean weight today becomes your starting weight.</p>') + "</div>" +
    '<div class="panel"><div class="panel-head"><h3>Personal best</h3></div><div class="num" style="font-size:var(--step-3)">' + esc(bestText) + "</div>" +
    (item.track_weight && item.measure === "reps" ? '<p class="small faint">estimated 1RM</p>' : "") + "</div>" +
    (item.rep_max ? '<div class="panel"><div class="panel-head"><h3>How the weight goes up</h3></div><p class="small muted">Hit ' + num(item.rep_max) + " reps in all " + item.planned_sets + " sets" +
      (item.target_weight ? " with " + num(item.target_weight) + " kg" : "") + " and the coach raises the weight automatically next time.</p></div>" : "") +
    (item.exercise_id ? '<a class="btn ghost small" href="#/exercises/' + item.exercise_id + '">Edit media and cues</a>' : "");
}

function adjustWeight(direction) {
  const input = document.getElementById("in-weight");
  if (!input) return;
  input.value = stepWeight(current(), input.value, direction);
}

function adjustValue(delta) {
  const input = document.getElementById("in-value");
  if (!input) return;
  input.value = Math.max(0, (Number(input.value) || 0) + delta);
}

function handleKey(event) {
  if (document.querySelector(".modal-backdrop")) return;
  if (document.querySelector(".rest-overlay")) return;
  const tag = (event.target.tagName || "").toLowerCase();
  const inNumber = tag === "input" && event.target.type === "number";
  if ((tag === "input" && !inNumber) || tag === "textarea" || tag === "select") return;
  if (event.key === "Enter" && !event.target.closest(".sets-table")) {
    event.preventDefault();
    logSet();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    if (event.shiftKey) adjustWeight(direction);
    else adjustValue(direction * (current() && current().measure === "sec" ? 5 : 1));
  } else if (event.key === "ArrowLeft" && !inNumber) {
    goTo(workout.index - 1);
  } else if (event.key === "ArrowRight" && !inNumber) {
    goTo(workout.index + 1);
  }
}

async function goTo(index) {
  const list = workout.session.exercises;
  if (!list.length) return;
  workout.index = (index + list.length) % list.length;
  workout.effort = null;
  draw();
  api("PUT", "/api/sessions/" + workout.session.id + "/state", { current_index: workout.index }).catch(() => {});
}

async function reload(keepIndex = true) {
  const index = workout.index;
  workout.session = await api("GET", "/api/sessions/" + workout.session.id);
  state.active = workout.session;
  workout.index = keepIndex ? Math.min(index, Math.max(0, workout.session.exercises.length - 1)) : 0;
  draw();
}

async function changePlanned(sets) {
  try {
    await api("PUT", "/api/session-exercises/" + current().id + "/planned", { sets });
    await reload();
  } catch (error) {
    toast(error.message, "error");
  }
}

let logging = false;
async function logSet() {
  if (logging) return;
  const item = current();
  if (!item) return;
  const weightInput = document.getElementById("in-weight");
  const valueInput = document.getElementById("in-value");
  const weight = weightInput && weightInput.value !== "" ? Number(weightInput.value) : null;
  const value = valueInput && valueInput.value !== "" ? Number(valueInput.value) : null;
  if (item.measure !== "none" && value === null) {
    toast("Enter the " + (item.measure === "reps" ? "reps" : "time") + " first", "error");
    return;
  }
  logging = true;
  stopTimer();
  try {
    const saved = await api("POST", "/api/sets", { session_exercise_id: item.id, value, weight, effort: workout.effort });
    workout.effort = null;
    const recordSetId = saved.record ? saved.id : null;
    const before = workout.index;
    workout.session = await api("GET", "/api/sessions/" + workout.session.id);
    state.active = workout.session;
    const updated = workout.session.exercises[before];
    if (recordSetId) {
      const set = updated.sets.find((entry) => entry.id === recordSetId);
      if (set) set.record = true;
      toast("New personal best: " + num(saved.record.current) + (updated.track_weight ? " kg 1RM" : ""), "pr");
    }
    let nextLabel = updated.exercise_name + ", set " + (updated.sets.length + 1);
    if (isComplete(updated)) {
      const candidate = firstIncomplete(before + 1);
      if (candidate !== -1) {
        workout.index = candidate;
        nextLabel = workout.session.exercises[candidate].exercise_name;
      }
    }
    draw();
    api("PUT", "/api/sessions/" + workout.session.id + "/state", { current_index: workout.index }).catch(() => {});
    if (firstIncomplete(0) === -1) finish(true);
    else if (updated.rest_seconds > 0) showRest(updated.rest_seconds, nextLabel, updated.id);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    logging = false;
  }
}

function stopTimer() {
  if (workout.timer) clearInterval(workout.timer.handle);
  workout.timer = null;
}

function toggleTimer(item, button) {
  if (workout.timer) {
    const elapsed = (Date.now() - workout.timer.start) / 1000;
    const input = document.getElementById("in-value");
    if (input) input.value = item.measure === "min" ? Math.round((elapsed / 60) * 2) / 2 : Math.round(elapsed);
    stopTimer();
    button.textContent = item.measure === "sec" ? "Countdown starten" : "Stoppuhr starten";
    return;
  }
  const input = document.getElementById("in-value");
  const goal = Number(input && input.value) || 0;
  const start = Date.now();
  let beeped = false;
  const update = () => {
    const elapsed = (Date.now() - start) / 1000;
    if (item.measure === "sec" && goal) {
      const remaining = goal - elapsed;
      button.textContent = remaining > 0 ? formatClock(Math.ceil(remaining)) + " · stop" : "+" + formatClock(-remaining) + " · stop";
      if (remaining <= 0 && !beeped) {
        beeped = true;
        beep(2, 990);
      }
    } else {
      button.textContent = formatClock(elapsed) + " · stop";
    }
  };
  workout.timer = { start, handle: setInterval(update, 200) };
  update();
}

export function showRest(seconds, nextLabel, sessionExerciseId) {
  const overlay = document.createElement("div");
  overlay.className = "rest-overlay";
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  let total = seconds;
  let endAt = Date.now() + seconds * 1000;
  let beeped = false;
  overlay.innerHTML = '<div class="label">Rest</div>' +
    '<div class="rest-ring"><svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="' + radius + '"></circle><circle class="prog" cx="100" cy="100" r="' + radius + '" stroke-dasharray="' + circumference + '"></circle></svg><div class="count"></div></div>' +
    '<div class="next">Up next: <strong>' + esc(nextLabel) + "</strong></div>" + '<div class="rest-coach-slot"></div>' +
    '<div class="controls"><button class="btn big" data-add="-15">− 15 s</button><button class="btn big" data-add="30">+ 30 s</button><button class="btn primary big" data-skip>Continue <span class="kbd">Enter</span></button></div>';
  document.body.appendChild(overlay);
  restCoachTip(overlay.querySelector(".rest-coach-slot"), sessionExerciseId);
  const ring = overlay.querySelector(".rest-ring");
  const progress = overlay.querySelector(".prog");
  const count = overlay.querySelector(".count");
  const update = () => {
    const remaining = (endAt - Date.now()) / 1000;
    if (remaining <= 0) {
      count.textContent = "+" + formatClock(-remaining);
      ring.classList.add("over");
      progress.style.strokeDashoffset = 0;
      if (!beeped) {
        beeped = true;
        beep(3);
      }
    } else {
      count.textContent = formatClock(Math.ceil(remaining));
      ring.classList.remove("over");
      progress.style.strokeDashoffset = circumference * (1 - remaining / total);
    }
  };
  update();
  const handle = setInterval(update, 200);
  const close = () => {
    clearInterval(handle);
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (event) => {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  overlay.querySelector("[data-skip]").addEventListener("click", close);
  overlay.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => {
    const delta = Number(button.dataset.add);
    endAt += delta * 1000;
    total = Math.max(total + delta, 1);
    if (endAt > Date.now()) beeped = false;
    update();
  }));
  onCleanup(close);
}

async function finish(allDone) {
  const modal = openModal(
    '<div class="modal-head"><h2>' + (allDone ? "All done" : "Finish workout") + "</h2></div>" +
    '<p class="muted">The coach evaluates the workout right away and adjusts weights and rep targets. The AI coach then writes a short note about it.</p>' +
    '<label class="field"><span>Note (optional)</span><textarea id="f-notes" placeholder="Sleep, energy, pain, anything you noticed"></textarea></label>' +
    '<div class="modal-foot"><button class="btn ghost" data-close>Keep training</button><button class="btn primary" data-finish autofocus>Save workout</button></div>',
  );
  modal.element.querySelector("[data-finish]").addEventListener("click", async () => {
    try {
      const result = await api("POST", "/api/sessions/" + workout.session.id + "/finish", { notes: modal.element.querySelector("#f-notes").value });
      modal.close();
      teardown();
      state.active = null;
      invalidate("programs");
      const persona = await api("GET", "/api/coach/persona").catch(() => null);
      openCoach({
        persona: persona || undefined,
        load: () => api("GET", "/api/sessions/" + result.id + "/outro"),
        primary: "See summary",
        fallback: { title: "Saved", message: "Workout saved. Great job showing up today.", points: [], mood: "celebrate" },
        onPrimary: () => showSummary(result),
      });
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function showSummary(session) {
  const sets = session.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  const volume = session.exercises.reduce((sum, item) => sum + item.sets.reduce((inner, set) => inner + (set.weight || 0) * (set.value || 0), 0), 0);
  const changes = session.changes || [];
  const label = { weight_up: "heavier", weight_down: "lighter", reps_up: "more reps", time_up: "longer", weight_set: "starting weight" };
  const minutes = Math.round((new Date(session.finished_at) - new Date(session.started_at)) / 60000);
  openModal(
    '<div class="modal-head"><h2>Saved</h2></div>' +
    '<div class="editor-summary"><span><b>' + sets + "</b>sets</span><span><b>" + num(volume / 1000, 2) + "</b>tonnes</span><span><b>" + minutes + "</b>minutes</span></div>" +
    (changes.length ? '<h3>Next time</h3><div class="finish-summary">' + changes.map((change) =>
      '<div class="change"><span class="chip ' + (change.kind === "weight_down" ? "" : "priority") + '">' + esc(label[change.kind] || change.kind) + "</span>" + esc(change.exercise) +
      (change.weight ? " · " + num(change.weight) + " kg" : "") + "</div>").join("") + "</div>"
      : '<p class="muted">Weights stay the same. Add reps until you reach the top of the range in every set.</p>') +
    '<div class="modal-foot"><a class="btn" href="#/history/training/' + session.id + '" data-close>Details</a><button class="btn primary" data-close autofocus>Back to overview</button></div>',
    { onClose: () => { location.hash = "#/"; } },
  );
}

async function discard() {
  const ok = await confirmModal("Discard workout", "All sets of this workout will be deleted.", "Discard", true);
  if (!ok) return;
  await api("DELETE", "/api/sessions/" + workout.session.id);
  teardown();
  state.active = null;
  location.hash = "#/";
}

async function addExercise() {
  const exercises = await loadExercises();
  const modal = openModal(
    '<div class="modal-head"><h2>Add exercise</h2></div>' +
    '<label class="field"><span>Exercise</span><input type="search" id="a-search" placeholder="Search" autofocus></label>' +
    '<select id="a-select" size="8">' + exercises.filter((exercise) => exercise.available).map((exercise) => '<option value="' + exercise.id + '">' + esc(exercise.name) + "</option>").join("") + "</select>" +
    '<div class="form-grid"><label class="field"><span>Sets</span><input type="number" id="a-sets" value="3" min="1"></label>' +
    '<label class="field"><span>Target</span><input type="text" id="a-target" placeholder="e.g. 10–12"></label>' +
    '<label class="field"><span>Rest s</span><input type="number" id="a-rest" value="90" min="0" step="15"></label></div>' +
    '<div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-add>Add</button></div>',
  );
  const select = modal.element.querySelector("#a-select");
  select.selectedIndex = 0;
  modal.element.querySelector("#a-search").addEventListener("input", (event) => {
    const query = event.target.value.toLowerCase();
    [...select.options].forEach((option) => { option.hidden = !option.textContent.toLowerCase().includes(query); });
    const first = [...select.options].find((option) => !option.hidden);
    if (first) select.value = first.value;
  });
  modal.element.querySelector("[data-add]").addEventListener("click", async () => {
    try {
      workout.session = await api("POST", "/api/sessions/" + workout.session.id + "/exercises", {
        exercise_id: Number(select.value),
        sets: Number(modal.element.querySelector("#a-sets").value) || 3,
        target: modal.element.querySelector("#a-target").value,
        rest_seconds: Number(modal.element.querySelector("#a-rest").value) || 0,
      });
      modal.close();
      workout.index = workout.session.exercises.length - 1;
      draw();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}
