import { api, esc, num, toast, openModal, confirmModal, formatSet, todayIso, relativeDay, mediaTag, createLoopPlayer, onCleanup, loadExercises, invalidate, EFFORT_LABELS, MEASURE_UNITS, formatClock, beep } from "../js/core.js?v=cycle2";
import { suggested, stepWeight, showRest } from "../js/views/workout.js?v=cycle2";
import { setTop, focusMode } from "./app.js?v=cycle2";
import { slideIn, celebrate } from "../js/motion.js?v=cycle2";
import { openCoach, preloadCoach } from "../js/coach3d.js?v=cycle2";
import { painNote } from "../js/rebuild.js?v=cycle2";

const run = { session: null, index: 0, effort: null, player: null, media: "loop", timer: null, feedback: {} };
const FEEL = [["good", "Felt it"], ["weak", "Didn't feel it"], ["pain", "Pain"]];
let personaPromise = null;

export function coachPersona() {
  if (!personaPromise) personaPromise = api("GET", "/api/coach/persona").catch(() => null);
  return personaPromise;
}

export function resetCoachPersona() {
  personaPromise = null;
}

document.addEventListener("coach-changed", () => { personaPromise = null; });

async function beginSession(day, programId) {
  const active = await api("GET", "/api/sessions/active");
  if (!active) await api("POST", "/api/sessions", { day, program_id: programId });
  if (location.hash === "#/train") window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = "#/train";
}

export async function startWorkout(day, programId) {
  try {
    const active = await api("GET", "/api/sessions/active");
    if (active) {
      if (location.hash === "#/train") window.dispatchEvent(new HashChangeEvent("hashchange"));
      else location.hash = "#/train";
      return;
    }
    if (programId === null || programId === undefined) {
      await beginSession(day, null);
      return;
    }
    location.hash = "#/train/preview/" + programId;
  } catch (error) {
    toast(error.message, "error");
  }
}

export async function renderPreview(view, programId) {
  const day = todayIso();
  const active = await api("GET", "/api/sessions/active");
  if (active) {
    location.hash = "#/train";
    return;
  }
  const [program, persona] = await Promise.all([api("GET", "/api/programs/" + programId), coachPersona()]);
  if (persona) preloadCoach(persona.coach);
  const brief = api("GET", "/api/coach/brief?day=" + day + "&program_id=" + programId);
  brief.catch(() => {});
  setTop({ title: program.name, back: "#/train" });
  const minutes = estimateMinutes(program.items);
  view.innerHTML =
    '<section class="preview-hero"><div class="when muted">' + esc(program.weekday !== null && program.weekday !== undefined ? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][program.weekday] : "Any day") +
    (program.last_done ? ", last time " + esc(relativeDay(program.last_done)) : "") + "</div><h1>" + esc(program.name) + "</h1>" +
    (program.description ? '<p class="muted">' + esc(program.description) + "</p>" : "") +
    '<div class="m-stat-row"><div class="m-stat"><span>Exercises</span><b>' + program.items.length + '</b></div><div class="m-stat"><span>Sets</span><b>' + program.total_sets +
    '</b></div><div class="m-stat"><span>About</span><b>' + minutes + "<small>min</small></b></div></div></section>" +
    (persona ? '<div class="preview-coach"><div class="avatar" style="background:' + esc(persona.color) + '">' + esc(persona.name.slice(0, 1)) + '</div><div><b>' + esc(persona.name) +
      '</b> <span class="muted small">' + esc(persona.title) + '</span><br><span class="small muted">Briefs you when you press Start.</span></div></div>' : "") +
    '<div class="preview-list">' + program.items.map((item, index) =>
      '<div class="preview-item"><span class="n">' + (index + 1) + "</span><div><b>" + esc(item.name) + '</b><div class="meta">' +
      esc(item.measure === "min" ? item.target : item.measure === "none" ? item.sets + " rounds" : item.sets + " × " + (item.target || "")) +
      (item.track_weight && item.target_weight ? " · " + num(item.target_weight) + " kg" : "") + (item.rest_seconds ? " · rest " + formatClock(item.rest_seconds) : "") + "</div>" +
      (item.cue ? '<div class="cue">' + esc(item.cue) + "</div>" : "") + "</div></div>").join("") + "</div>" +
    '<div class="preview-start"><button class="btn primary" id="pv-start">Start workout</button></div>';
  view.querySelector("#pv-start").addEventListener("click", () => {
    openCoach({
      persona: persona || undefined,
      load: () => brief,
      primary: "Let's go",
      secondary: "Not yet",
      onPrimary: () => beginSession(day, programId).catch((error) => toast(error.message, "error")),
    });
  });
}

function estimateMinutes(items) {
  let seconds = 300;
  for (const item of items) {
    if (item.measure === "min") seconds += (item.rep_min || 20) * 60;
    else if (item.measure === "none") seconds += item.sets * 150;
    else seconds += item.sets * (50 + (item.rest_seconds || 60));
  }
  return Math.round(seconds / 60);
}

export async function renderTrain(view) {
  const active = await api("GET", "/api/sessions/active");
  if (!active) return renderStartList(view);
  run.session = active;
  run.index = Math.min(active.current_index || 0, Math.max(0, active.exercises.length - 1));
  run.effort = null;
  run.feedback = await api("GET", "/api/sessions/" + active.id + "/feedback").catch(() => ({}));
  focusMode(true);
  onCleanup(teardown);
  setTop({ title: active.program_name, back: "#/", action: { label: "Finish", run: () => finish(false) } });
  view.innerHTML = '<div id="mw-content" class="mw-content"></div>';
  const dock = document.createElement("div");
  dock.className = "mw-dock";
  dock.id = "mw-dock";
  document.body.appendChild(dock);
  onCleanup(() => dock.remove());
  bindSwipe(view);
  draw();
}

function teardown() {
  if (run.player) run.player.destroy();
  run.player = null;
  stopTimer();
  const overlay = document.querySelector(".rest-overlay");
  if (overlay) overlay.remove();
}

async function renderStartList(view) {
  setTop({ title: "Train" });
  const today = todayIso();
  const suggestions = await api("GET", "/api/suggestions?day=" + today);
  view.innerHTML = '<div class="m-section-title">Pick a workout</div><div class="m-list">' + suggestions.options.map((option) =>
    '<button class="m-item" data-program="' + option.program.id + '"><span class="grow"><b>' + esc(option.program.name) + "</b><span>" + esc(option.reason) + ", " +
    option.program.items.length + " exercises, " + option.program.total_sets + " sets</span></span>" + (option.suggested ? '<span class="chip priority">Today</span>' : '<span class="chev">›</span>') + "</button>").join("") +
    "</div>" + (suggestions.options.length ? "" : '<p class="muted">No programs yet.</p>') +
    '<button class="btn m-btn-xl" id="mw-free">Free workout</button>';
  view.querySelectorAll("[data-program]").forEach((button) => button.addEventListener("click", () => startWorkout(today, Number(button.dataset.program))));
  view.querySelector("#mw-free").addEventListener("click", () => startWorkout(today, null));
}

function current() {
  return run.session.exercises[run.index];
}

function isComplete(item) {
  return item.sets.length >= item.planned_sets;
}

function firstIncomplete(from) {
  const list = run.session.exercises;
  for (let offset = 0; offset < list.length; offset++) {
    const index = (from + offset) % list.length;
    if (!isComplete(list[index])) return index;
  }
  return -1;
}

function bindSwipe(view) {
  let start = null;
  const onStart = (event) => {
    if (event.target.closest(".body-viewer, input, .mw-media")) return;
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  const onEnd = (event) => {
    if (!start) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) goTo(run.index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  };
  view.addEventListener("touchstart", onStart, { passive: true });
  view.addEventListener("touchend", onEnd, { passive: true });
  onCleanup(() => {
    view.removeEventListener("touchstart", onStart);
    view.removeEventListener("touchend", onEnd);
  });
}

function goTo(index, direction) {
  const list = run.session.exercises;
  if (!list.length) return;
  const from = run.index;
  run.index = (index + list.length) % list.length;
  run.effort = null;
  run.media = "loop";
  draw();
  slideIn(document.getElementById("mw-content"), direction || (run.index >= from ? 1 : -1));
  api("PUT", "/api/sessions/" + run.session.id + "/state", { current_index: run.index }).catch(() => {});
}

function draw() {
  const content = document.getElementById("mw-content");
  const dock = document.getElementById("mw-dock");
  if (!content || !dock) return;
  if (run.player) {
    run.player.destroy();
    run.player = null;
  }
  stopTimer();
  const item = current();
  if (!item) {
    content.innerHTML = '<div class="empty">No exercises in this workout yet.</div><button class="btn primary m-btn-xl" id="mw-add">Add exercise</button>';
    content.querySelector("#mw-add").addEventListener("click", addExercise);
    dock.innerHTML = "";
    return;
  }
  const hasLoop = item.media_loop || item.video_id;
  const showMuscles = run.media === "muscles" && item.media_muscles;
  let media;
  if (!hasLoop && !item.media_muscles) {
    media = '<div class="mw-media empty"><span>No tutorial yet.</span>' + (item.exercise_id ? '<a class="btn small" href="#/more/exercises/' + item.exercise_id + '">Add media</a>' : "") + "</div>";
  } else {
    media = '<div class="mw-media" id="mw-media">' + (showMuscles ? mediaTag(item.media_muscles) : item.media_loop ? mediaTag(item.media_loop) : !hasLoop ? mediaTag(item.media_muscles) : "") +
      (hasLoop && item.media_muscles ? '<div class="mw-media-switch"><button data-media="loop" aria-pressed="' + !showMuscles + '">How to</button><button data-media="muscles" aria-pressed="' + showMuscles + '">Muscles</button></div>' : "") + "</div>";
  }
  const prev = item.previous ? item.previous.sets.map((set) => "<span>" + esc(formatSet(set, item.measure, item.track_weight)) + "</span>").join("") : "";
  content.innerHTML =
    '<div class="mw-dots">' + run.session.exercises.map((entry, index) =>
      '<button class="' + (index === run.index ? "current" : isComplete(entry) ? "done" : "") + '" data-go="' + index + '" aria-label="' + esc(entry.exercise_name) + '"></button>').join("") + "</div>" +
    '<div class="mw-head"><span class="mw-set">' + (isComplete(item) ? "All sets done" : "Set " + (item.sets.length + 1) + " of " + item.planned_sets) + " · exercise " + (run.index + 1) + " of " + run.session.exercises.length + "</span>" +
    "<h1>" + esc(item.exercise_name) + '</h1><span class="mw-target">Target ' + esc(item.target || "free") + (item.track_weight && item.target_weight ? " at " + num(item.target_weight) + " kg" : "") +
    ", rest " + formatClock(item.rest_seconds) + (run.session.deload ? ", deload" : "") + "</span></div>" +
    media +
    (item.plan_cue ? '<p class="cues"><b>Coach:</b> ' + esc(item.plan_cue) + "</p>" : item.cues ? '<p class="cues">' + esc(item.cues) + "</p>" : "") +
    (prev ? '<div class="mw-prev">Last time ' + esc(relativeDay(item.previous.day)) + ": " + prev + "</div>" :
      item.track_weight && !item.target_weight && !item.sets.length ? '<p class="mw-first">First time: pick a weight you can lift for the top of the range with 2 to 3 reps left. The coach takes it from there.</p>' : "") +
    '<div class="mw-sets">' + item.sets.map((set) =>
      '<button class="mw-set-row" data-set="' + set.id + '"><span class="n">' + set.set_number + '</span><span class="grow">' + esc(formatSet(set, item.measure, item.track_weight)) + '</span><span class="tag">' +
      esc(set.effort ? EFFORT_LABELS[set.effort] : "") + "</span></button>").join("") +
    Array.from({ length: Math.max(0, item.planned_sets - item.sets.length) }, (_, index) =>
      '<div class="mw-set-row pending"><span class="n">' + (item.sets.length + index + 1) + '</span><span class="grow">' + esc(item.target || "") + "</span></div>").join("") + "</div>" +
    (item.exercise_id && item.sets.length && item.measure !== "min" && item.measure !== "none" ? '<div class="feel"><span>How did it feel?</span>' + FEEL.map(([key, label]) =>
      '<button data-feel="' + key + '" aria-pressed="' + ((run.feedback[item.id] || {}).rating === key) + '">' + label + "</button>").join("") + "</div>" : "") +
    '<div class="mw-tools"><button class="btn" id="mw-list">Exercises</button><button class="btn" id="mw-plus">+ Set</button><button class="btn" id="mw-minus">− Set</button></div>';

  if (!item.media_loop && item.video_id && !showMuscles) {
    createLoopPlayer(content.querySelector("#mw-media"), item.video_id, item.video_start, item.video_end).then((player) => {
      if (current() === item && run.media === "loop") run.player = player; else player.destroy();
    });
  }
  content.querySelectorAll("[data-media]").forEach((button) => button.addEventListener("click", () => { run.media = button.dataset.media; draw(); }));
  content.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => goTo(Number(button.dataset.go))));
  content.querySelectorAll("[data-set]").forEach((button) => button.addEventListener("click", () => editSet(item, item.sets.find((set) => set.id === Number(button.dataset.set)))));
  content.querySelectorAll("[data-feel]").forEach((button) => button.addEventListener("click", () => saveFeel(item, button.dataset.feel)));
  content.querySelector("#mw-list").addEventListener("click", exerciseSheet);
  content.querySelector("#mw-plus").addEventListener("click", () => changePlanned(item.planned_sets + 1));
  content.querySelector("#mw-minus").addEventListener("click", () => { if (item.planned_sets > Math.max(1, item.sets.length)) changePlanned(item.planned_sets - 1); });
  drawDock(item);
}

function drawDock(item) {
  const dock = document.getElementById("mw-dock");
  const values = suggested(item);
  const complete = isComplete(item);
  if (item.measure === "none") {
    dock.innerHTML = '<button class="btn primary mw-save" id="mw-save">' + (complete ? "Done again" : "Done") + "</button>";
  } else {
    const valueLabel = item.measure === "reps" ? "reps" : item.measure === "sec" ? "seconds" : "minutes";
    dock.innerHTML =
      '<div class="mw-steppers' + (item.track_weight ? "" : " one") + '">' +
      (item.track_weight ? stepper("weight", "kg", values.weight) : "") + stepper("value", valueLabel, values.value) + "</div>" +
      (item.measure === "reps"
        ? '<div class="mw-effort">' + [1, 2, 3].map((level) => '<button data-effort="' + level + '" aria-pressed="' + (run.effort === level) + '">' + EFFORT_LABELS[level] + "</button>").join("") + "</div>"
        : '<button class="btn" id="mw-timer">' + (item.measure === "sec" ? "Start countdown" : "Start stopwatch") + "</button>") +
      '<button class="btn primary mw-save" id="mw-save">' + (complete ? "Save extra set" : "Save set") + "</button>";
  }
  dock.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => {
    const field = button.dataset.step;
    const direction = Number(button.dataset.dir);
    const input = dock.querySelector("#mw-" + field);
    if (field === "weight") input.value = stepWeight(item, input.value, direction);
    else input.value = Math.max(0, (Number(input.value) || 0) + direction * (item.measure === "sec" ? 5 : 1));
    if (navigator.vibrate) navigator.vibrate(8);
  }));
  dock.querySelectorAll("[data-effort]").forEach((button) => button.addEventListener("click", () => {
    const level = Number(button.dataset.effort);
    run.effort = run.effort === level ? null : level;
    dock.querySelectorAll("[data-effort]").forEach((other) => other.setAttribute("aria-pressed", String(Number(other.dataset.effort) === run.effort)));
  }));
  const timer = dock.querySelector("#mw-timer");
  if (timer) timer.addEventListener("click", () => toggleTimer(item, timer));
  dock.querySelector("#mw-save").addEventListener("click", () => logSet(item));
}

function stepper(field, label, value) {
  return '<div class="mw-stepper"><button data-step="' + field + '" data-dir="-1" aria-label="Less">−</button><label><input type="number" inputmode="decimal" id="mw-' + field + '" value="' + esc(value ?? "") + '" placeholder="' + (field === "weight" ? "?" : "") + '"><span>' + label + "</span></label>" +
    '<button data-step="' + field + '" data-dir="1" aria-label="More">+</button></div>';
}

function stopTimer() {
  if (run.timer) clearInterval(run.timer.handle);
  run.timer = null;
}

function toggleTimer(item, button) {
  const input = document.getElementById("mw-value");
  if (run.timer) {
    const elapsed = (Date.now() - run.timer.start) / 1000;
    if (input) input.value = item.measure === "min" ? Math.round((elapsed / 60) * 2) / 2 : Math.round(elapsed);
    stopTimer();
    button.textContent = item.measure === "sec" ? "Start countdown" : "Start stopwatch";
    return;
  }
  const goal = Number(input && input.value) || 0;
  const start = Date.now();
  let beeped = false;
  const update = () => {
    const elapsed = (Date.now() - start) / 1000;
    if (item.measure === "sec" && goal) {
      const remaining = goal - elapsed;
      button.textContent = (remaining > 0 ? formatClock(Math.ceil(remaining)) : "+" + formatClock(-remaining)) + ", tap to stop";
      if (remaining <= 0 && !beeped) {
        beeped = true;
        beep(2, 990);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
    } else {
      button.textContent = formatClock(elapsed) + ", tap to stop";
    }
  };
  run.timer = { start, handle: setInterval(update, 200) };
  update();
}

let saving = false;
async function logSet(item) {
  if (saving) return;
  const weightInput = document.getElementById("mw-weight");
  const valueInput = document.getElementById("mw-value");
  const weight = weightInput && weightInput.value !== "" ? Number(weightInput.value) : null;
  const value = valueInput && valueInput.value !== "" ? Number(valueInput.value) : null;
  if (item.measure !== "none" && value === null) {
    toast("Enter the " + (item.measure === "reps" ? "reps" : "time") + " first", "error");
    return;
  }
  saving = true;
  stopTimer();
  try {
    const saved = await api("POST", "/api/sets", { session_exercise_id: item.id, value, weight, effort: run.effort });
    run.effort = null;
    const before = run.index;
    run.session = await api("GET", "/api/sessions/" + run.session.id);
    const updated = run.session.exercises[before];
    if (saved.record) {
      toast("New personal best: " + num(saved.record.current) + (updated.track_weight ? " kg 1RM" : ""), "pr");
      if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    }
    let nextLabel = updated.exercise_name + ", set " + (updated.sets.length + 1);
    if (isComplete(updated)) {
      const candidate = firstIncomplete(before + 1);
      if (candidate !== -1) {
        run.index = candidate;
        run.media = "loop";
        nextLabel = run.session.exercises[candidate].exercise_name;
      }
    }
    draw();
    api("PUT", "/api/sessions/" + run.session.id + "/state", { current_index: run.index }).catch(() => {});
    if (firstIncomplete(0) === -1) finish(true);
    else if (updated.rest_seconds > 0) showRest(updated.rest_seconds, nextLabel, updated.id);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    saving = false;
  }
}

async function reload() {
  run.session = await api("GET", "/api/sessions/" + run.session.id);
  run.index = Math.min(run.index, Math.max(0, run.session.exercises.length - 1));
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

function editSet(item, set) {
  const modal = openModal('<div class="modal-head"><h2>Set ' + set.set_number + "</h2></div>" +
    '<div class="form-grid">' + (item.track_weight ? '<label class="field"><span>Weight kg</span><input type="number" inputmode="decimal" id="es-weight" value="' + esc(set.weight ?? "") + '"></label>' : "") +
    (item.measure !== "none" ? '<label class="field"><span>' + esc(MEASURE_UNITS[item.measure] || "value") + '</span><input type="number" inputmode="decimal" id="es-value" value="' + esc(set.value ?? "") + '"></label>' : "") + "</div>" +
    '<div class="modal-foot"><button class="btn danger left" id="es-delete">Delete</button><button class="btn primary" id="es-save">Save</button></div>');
  modal.element.querySelector("#es-save").addEventListener("click", async () => {
    const weight = modal.element.querySelector("#es-weight");
    const value = modal.element.querySelector("#es-value");
    try {
      await api("PUT", "/api/sets/" + set.id, { weight: weight && weight.value !== "" ? Number(weight.value) : null, value: value && value.value !== "" ? Number(value.value) : null, effort: set.effort });
      modal.close();
      await reload();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  modal.element.querySelector("#es-delete").addEventListener("click", async () => {
    try {
      await api("DELETE", "/api/sets/" + set.id);
      modal.close();
      await reload();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function exerciseSheet() {
  const modal = openModal('<div class="modal-head"><h2>Exercises</h2></div><div class="m-sheet-list">' + run.session.exercises.map((entry, index) =>
    '<button class="m-option" data-jump="' + index + '" aria-pressed="' + (index === run.index) + '"><span class="grow"><b>' + esc(entry.exercise_name) + '</b><br><span class="small muted">' +
    entry.sets.length + " of " + entry.planned_sets + " sets</span></span>" + (isComplete(entry) ? '<span class="chip">done</span>' : "") + "</button>").join("") + "</div>" +
    '<div class="modal-foot"><button class="btn danger left" id="ex-discard">Discard</button><button class="btn" id="ex-add">Add exercise</button></div>');
  modal.element.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => { modal.close(); goTo(Number(button.dataset.jump)); }));
  modal.element.querySelector("#ex-add").addEventListener("click", () => { modal.close(); addExercise(); });
  modal.element.querySelector("#ex-discard").addEventListener("click", async () => {
    modal.close();
    const ok = await confirmModal("Discard workout", "All sets of this workout will be deleted.", "Discard", true);
    if (!ok) return;
    try {
      await api("DELETE", "/api/sessions/" + run.session.id);
    } catch (error) {
      toast(error.message, "error");
      return;
    }
    teardown();
    location.hash = "#/";
  });
}

async function addExercise() {
  const exercises = (await loadExercises()).filter((exercise) => exercise.available);
  const modal = openModal('<div class="modal-head"><h2>Add exercise</h2></div><input type="search" id="ae-q" placeholder="Search">' +
    '<div class="m-sheet-list" id="ae-list"></div>');
  const draw = () => {
    const query = modal.element.querySelector("#ae-q").value.toLowerCase();
    modal.element.querySelector("#ae-list").innerHTML = exercises.filter((exercise) => exercise.name.toLowerCase().includes(query)).slice(0, 40).map((exercise) =>
      '<button class="m-option" data-add="' + exercise.id + '">' + esc(exercise.name) + "</button>").join("");
    modal.element.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", async () => {
      try {
        run.session = await api("POST", "/api/sessions/" + run.session.id + "/exercises", { exercise_id: Number(button.dataset.add), sets: 3, target: "", rest_seconds: 90 });
      } catch (error) {
        toast(error.message, "error");
        return;
      }
      modal.close();
      goTo(run.session.exercises.length - 1);
    }));
  };
  modal.element.querySelector("#ae-q").addEventListener("input", draw);
  draw();
}

async function saveFeel(item, rating) {
  const previous = run.feedback[item.id];
  try {
    if (previous && previous.rating === rating) {
      await api("DELETE", "/api/session-exercises/" + item.id + "/feedback");
      delete run.feedback[item.id];
    } else {
      let note = "";
      if (rating === "pain") note = (await painNote()).slice(0, 300);
      run.feedback[item.id] = await api("POST", "/api/session-exercises/" + item.id + "/feedback", { rating, note });
      toast(rating === "good" ? "Noted" : "Noted, your coach will look at it");
    }
    draw();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function finish(allDone) {
  const modal = openModal('<div class="modal-head"><h2>' + (allDone ? "All done" : "Finish workout") + "</h2></div>" +
    '<p class="muted">The coach adjusts weights and reps for next time and writes a short note.</p>' +
    '<label class="field"><span>Note (optional)</span><textarea id="fw-notes" placeholder="Sleep, energy, pain"></textarea></label>' +
    '<div class="modal-foot"><button class="btn" data-close>Keep training</button><button class="btn primary" id="fw-save">Save workout</button></div>');
  const saveButton = modal.element.querySelector("#fw-save");
  saveButton.addEventListener("click", async () => {
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    try {
      const result = await api("POST", "/api/sessions/" + run.session.id + "/finish", { notes: modal.element.querySelector("#fw-notes").value });
      modal.close();
      teardown();
      invalidate("programs");
      celebrate();
      const label = { weight_up: "heavier", weight_down: "lighter", reps_up: "more reps", time_up: "longer", weight_set: "start weight" };
      const sets = result.exercises.reduce((sum, entry) => sum + entry.sets.length, 0);
      const extra = '<div class="m-stat-row"><div class="m-stat"><span>Sets</span><b>' + sets + "</b></div>" +
        '<div class="m-stat"><span>Minutes</span><b>' + Math.round((new Date(result.finished_at) - new Date(result.started_at)) / 60000) + "</b></div></div>" +
        (result.changes.length ? '<div class="m-section-title">Next time</div><div class="m-sheet-list">' + result.changes.map((change) =>
          '<div class="m-option"><span class="chip priority">' + esc(label[change.kind] || change.kind) + "</span>" + esc(change.exercise) + (change.weight ? ", " + num(change.weight) + " kg" : "") + "</div>").join("") + "</div>" : "");
      const persona = await coachPersona();
      const sessionId = run.session.id;
      openCoach({
        persona: persona || undefined,
        load: () => api("GET", "/api/sessions/" + sessionId + "/outro"),
        extraHtml: extra,
        primary: "Done",
        fallback: { title: "Saved", message: "Workout saved. Great job showing up today.", points: [], mood: "celebrate" },
        onPrimary: () => { location.hash = "#/"; },
      });
    } catch (error) {
      saveButton.disabled = false;
      toast(error.message, "error");
    }
  });
}
