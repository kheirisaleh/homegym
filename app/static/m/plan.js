import { api, esc, toast, openModal, confirmModal, loadExercises, invalidate, muscleLabel, WEEKDAYS, relativeDay } from "../js/core.js?v=cycle2";
import { setTop } from "./app.js?v=cycle2";
import { redesignDialog } from "../js/views/programs.js?v=cycle2";
import { rebuildDialog, restoreDialog } from "../js/rebuild.js?v=cycle2";
import { cycleState, cycleCardHtml, mountCycleCard, mountAdjustedPlan, configureCycle } from "./cycle.js?v=cycle2";

export async function renderPlan(view) {
  setTop({ title: "Plan", action: { label: "New", run: newProgram } });
  const [programs, rebuild, cycle] = await Promise.all([api("GET", "/api/programs"), api("GET", "/api/me/rebuild").catch(() => null), cycleState()]);
  const byDay = WEEKDAYS.map((day, index) => [day, programs.filter((program) => program.weekday === index)]);
  const unassigned = programs.filter((program) => program.weekday === null);
  view.innerHTML = cycleCardHtml(cycle, true) + '<section class="m-card"><div class="m-card-head"><h2>Not happy with your program?</h2></div>' +
    '<p class="small muted">Tell your coach what did not work. You get a new program built from your history, feedback and equipment.</p>' +
    '<div class="m-row-actions"><button class="btn primary" id="pl-rebuild">New program</button>' +
    (rebuild && rebuild.can_restore ? '<button class="btn" id="pl-restore">Previous program</button>' : "") + "</div></section>" +
    (programs.length ? "" : '<div class="empty">No programs yet.</div>') +
    byDay.filter(([, list]) => list.length).map(([day, list]) => '<div class="m-section-title">' + day + '</div><div class="m-list">' + list.map(programItem).join("") + "</div>").join("") +
    (unassigned.length ? '<div class="m-section-title">No fixed day</div><div class="m-list">' + unassigned.map(programItem).join("") + "</div>" : "");
  configureCycle({ setTop, healthHref: "#/more/health" });
  mountCycleCard(view, cycle, () => renderPlan(view));
  view.querySelector("#pl-rebuild").addEventListener("click", () => rebuildDialog());
  const restore = view.querySelector("#pl-restore");
  if (restore) restore.addEventListener("click", () => restoreDialog(() => renderPlan(view)));
}

function programItem(program) {
  return '<a class="m-item" href="#/plan/' + program.id + '"><span class="grow"><b>' + esc(program.name) + "</b><span>" + program.items.length + " exercises, " + program.total_sets + " sets, " +
    esc(program.last_done ? "last " + relativeDay(program.last_done) : "not done yet") + '</span></span><span class="chev">›</span></a>';
}

async function newProgram() {
  const program = await api("POST", "/api/programs", { name: "New program", weekday: null, description: "", items: [] });
  invalidate("programs");
  location.hash = "#/plan/" + program.id;
}

function bodyOf(program, items) {
  return {
    name: program.name, weekday: program.weekday, description: program.description || "",
    items: items.map((item) => ({ exercise_id: item.exercise_id, sets: item.sets, target: item.target || "", rep_min: item.rep_min, rep_max: item.rep_max, target_weight: item.target_weight, rest_seconds: item.rest_seconds })),
  };
}

export async function renderPlanDetail(view, id) {
  const program = await api("GET", "/api/programs/" + id);
  const items = program.items.map((item) => ({ ...item }));
  setTop({ title: program.name, back: "#/plan", action: { label: "Edit", run: () => editProgramSheet(program, items, view) } });

  const save = async (message) => {
    try {
      await api("PUT", "/api/programs/" + id, bodyOf(program, items));
      invalidate("programs");
      if (message) toast(message);
      renderPlanDetail(view, id);
    } catch (error) {
      toast(error.message, "error");
    }
  };

  view.innerHTML = '<div class="m-card flat"><span class="muted small">' + esc(program.weekday !== null ? WEEKDAYS[program.weekday] : "No fixed day") + ", " + program.total_sets + " working sets</span>" +
    (program.description ? "<p>" + esc(program.description) + "</p>" : "") + "</div>" +
    '<div class="m-list">' + items.map((item, index) =>
      '<button class="m-item" data-item="' + index + '"><span class="grow"><b>' + esc(item.name) + "</b><span>" + item.sets + " × " + esc(item.target || "free") +
      (item.target_weight ? " at " + item.target_weight + " kg" : "") + ", rest " + item.rest_seconds + " s, " + esc(muscleLabel(item.primary_muscle)) + '</span></span><span class="chev">›</span></button>').join("") +
    "</div>" +
    '<button class="btn m-btn-xl" id="pd-add">Add exercise</button>' +
    '<div class="m-row-actions"><button class="btn" id="pd-redesign">Redesign with AI</button><button class="btn" id="pd-start">Start now</button></div>' +
    '<button class="btn ghost danger" id="pd-delete">Delete program</button>';

  view.querySelectorAll("[data-item]").forEach((button) => button.addEventListener("click", () => editItemSheet(items, Number(button.dataset.item), save)));
  view.querySelector("#pd-add").addEventListener("click", async () => {
    const exercise = await pickExercise();
    if (!exercise) return;
    items.push({ exercise_id: exercise.id, name: exercise.name, primary_muscle: exercise.primary_muscle, sets: exercise.measure === "min" ? 1 : 3,
      rep_min: exercise.measure === "reps" ? 8 : exercise.measure === "sec" ? 30 : 20, rep_max: exercise.measure === "reps" ? 12 : exercise.measure === "sec" ? 45 : 20,
      target: "", target_weight: null, rest_seconds: exercise.measure === "min" ? 0 : 90 });
    save(exercise.name + " added");
  });
  view.querySelector("#pd-redesign").addEventListener("click", () => redesignDialog(id, () => renderPlanDetail(view, id)));
  view.querySelector("#pd-start").addEventListener("click", async () => {
    const { startWorkout } = await import("./train.js?v=cycle2");
    const { todayIso } = await import("../js/core.js?v=cycle2");
    startWorkout(todayIso(), id);
  });
  mountAdjustedPlan(view, id, async () => {
    const { startWorkout } = await import("./train.js?v=cycle2");
    const { todayIso } = await import("../js/core.js?v=cycle2");
    startWorkout(todayIso(), id);
  });
  view.querySelector("#pd-delete").addEventListener("click", async () => {
    const ok = await confirmModal("Delete program", "Logged workouts are kept.", "Delete", true);
    if (!ok) return;
    await api("DELETE", "/api/programs/" + id);
    invalidate("programs");
    location.hash = "#/plan";
  });
}

function editItemSheet(items, index, save) {
  const item = items[index];
  const modal = openModal('<div class="modal-head"><h2>' + esc(item.name) + "</h2></div>" +
    '<div class="form-grid"><label class="field"><span>Sets</span><input type="number" inputmode="numeric" id="ei-sets" value="' + item.sets + '"></label>' +
    '<label class="field"><span>Rest s</span><input type="number" inputmode="numeric" step="15" id="ei-rest" value="' + item.rest_seconds + '"></label>' +
    '<label class="field"><span>From</span><input type="number" inputmode="numeric" id="ei-min" value="' + (item.rep_min ?? "") + '"></label>' +
    '<label class="field"><span>To</span><input type="number" inputmode="numeric" id="ei-max" value="' + (item.rep_max ?? "") + '"></label>' +
    '<label class="field" style="grid-column:span 2"><span>Weight kg (empty means automatic)</span><input type="number" inputmode="decimal" step="0.5" id="ei-weight" value="' + (item.target_weight ?? "") + '"></label></div>' +
    '<div class="m-switch-row"><span>Position</span><div class="m-move"><button id="ei-up" aria-label="Move up">↑</button><button id="ei-down" aria-label="Move down">↓</button></div></div>' +
    '<div class="modal-foot"><button class="btn danger left" id="ei-remove">Remove</button><button class="btn primary" id="ei-save">Save</button></div>');
  const root = modal.element;
  const read = (selector) => { const value = root.querySelector(selector).value; return value === "" ? null : Number(value); };
  root.querySelector("#ei-save").addEventListener("click", () => {
    item.sets = Math.max(1, read("#ei-sets") || 1);
    item.rest_seconds = read("#ei-rest") || 0;
    item.rep_min = read("#ei-min");
    item.rep_max = read("#ei-max");
    item.target_weight = read("#ei-weight");
    modal.close();
    save("Saved");
  });
  root.querySelector("#ei-remove").addEventListener("click", () => { items.splice(index, 1); modal.close(); save("Removed"); });
  root.querySelector("#ei-up").addEventListener("click", () => { if (index > 0) { items.splice(index - 1, 0, items.splice(index, 1)[0]); modal.close(); save(); } });
  root.querySelector("#ei-down").addEventListener("click", () => { if (index < items.length - 1) { items.splice(index + 1, 0, items.splice(index, 1)[0]); modal.close(); save(); } });
}

function editProgramSheet(program, items, view) {
  const modal = openModal('<div class="modal-head"><h2>Program</h2></div>' +
    '<label class="field"><span>Name</span><input type="text" id="ep-name" value="' + esc(program.name) + '"></label>' +
    '<label class="field"><span>Day</span><select id="ep-day"><option value="">No fixed day</option>' + WEEKDAYS.map((day, index) =>
      '<option value="' + index + '"' + (program.weekday === index ? " selected" : "") + ">" + day + "</option>").join("") + "</select></label>" +
    '<div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ep-save">Save</button></div>');
  modal.element.querySelector("#ep-save").addEventListener("click", async () => {
    program.name = modal.element.querySelector("#ep-name").value.trim() || program.name;
    const day = modal.element.querySelector("#ep-day").value;
    program.weekday = day === "" ? null : Number(day);
    await api("PUT", "/api/programs/" + program.id, bodyOf(program, items));
    invalidate("programs");
    modal.close();
    renderPlanDetail(view, program.id);
  });
}

export async function pickExercise() {
  const exercises = (await loadExercises(true)).filter((exercise) => exercise.available);
  return new Promise((resolve) => {
    let picked = null;
    const modal = openModal('<div class="modal-head"><h2>Add exercise</h2></div><input type="search" id="px-q" placeholder="Search exercises"><div class="m-sheet-list" id="px-list"></div>',
      { onClose: () => resolve(picked) });
    const draw = () => {
      const query = modal.element.querySelector("#px-q").value.toLowerCase();
      modal.element.querySelector("#px-list").innerHTML = exercises.filter((exercise) => exercise.name.toLowerCase().includes(query) || muscleLabel(exercise.primary_muscle).toLowerCase().includes(query)).slice(0, 50).map((exercise) =>
        '<button class="m-option" data-pick="' + exercise.id + '"><span class="grow"><b>' + esc(exercise.name) + '</b><br><span class="small muted">' + esc(muscleLabel(exercise.primary_muscle)) + "</span></span></button>").join("");
      modal.element.querySelectorAll("[data-pick]").forEach((button) => button.addEventListener("click", () => {
        picked = exercises.find((exercise) => exercise.id === Number(button.dataset.pick));
        modal.close();
      }));
    };
    modal.element.querySelector("#px-q").addEventListener("input", draw);
    draw();
  });
}
