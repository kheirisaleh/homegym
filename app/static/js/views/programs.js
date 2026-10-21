import {
  api, esc, num, toast, openModal, confirmModal, loadExercises, loadPrograms, invalidate, muscleLabel, cssVar,
  WEEKDAYS, relativeDay, MEASURE_UNITS, state, weekdayIndex, onCleanup,
} from "../core.js?v=cycle2";
import { openExerciseEditor } from "./exercises.js?v=cycle2";
import { rebuildDialog } from "../rebuild.js?v=cycle2";

const MUSCLE_COLORS = {
  chest: "--plate-red", triceps: "--plate-red", front_delts: "--plate-red",
  biceps: "--accent-line", forearms: "--accent-line",
  lats: "--plate-blue", upper_back: "--plate-blue", rear_delts: "--plate-blue", lower_back: "--plate-blue", side_delts: "--plate-blue",
  quads: "--plate-green", glutes: "--plate-green", hamstrings: "--plate-green", calves: "--plate-green",
  abs: "--plate-purple", obliques: "--plate-purple", cardio: "--chalk-3", mobility: "--chalk-3",
};

export function muscleColor(muscle) {
  return cssVar(MUSCLE_COLORS[muscle] || "--chalk-3");
}

export async function renderPrograms(view) {
  const programs = await loadPrograms(true);
  const todayIndex = weekdayIndex(new Date());
  const byDay = Array.from({ length: 7 }, () => []);
  const unassigned = [];
  programs.forEach((program) => {
    if (program.weekday === null || program.weekday === undefined) unassigned.push(program);
    else byDay[program.weekday].push(program);
  });
  view.innerHTML =
    '<div class="page-head"><div><h1>Programs</h1><p>Your weekly plan. Drag a card to another day to move it. The coach adjusts weights after every workout, and sets and exercises at the end of each block.</p></div>' +
    '<div class="page-actions"><button class="btn" id="pg-rebuild">Rebuild with coach</button><a class="btn primary" href="#/programs/new">New program</a></div></div>' +
    '<div class="week-board">' + byDay.map((list, index) =>
      '<div class="day-col' + (index === todayIndex ? " is-today" : "") + '" data-day="' + index + '"><div class="day-name"><span>' + WEEKDAYS[index] + "</span>" + (index === todayIndex ? "<span>today</span>" : "") + "</div>" +
      list.map(card).join("") + "</div>").join("") + "</div>" +
    (unassigned.length ? '<div class="unassigned"><h2 style="margin-bottom:12px">No fixed day</h2><div class="week-board" data-day="none">' + unassigned.map(card).join("") + "</div></div>" : "");

  view.querySelector("#pg-rebuild").addEventListener("click", () => rebuildDialog());
  view.querySelectorAll(".prog-card").forEach((element) => {
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/program", element.dataset.id);
      event.dataTransfer.effectAllowed = "move";
    });
  });
  view.querySelectorAll("[data-day]").forEach((column) => {
    column.addEventListener("dragover", (event) => {
      if (![...event.dataTransfer.types].includes("text/program")) return;
      event.preventDefault();
      column.classList.add("drop");
    });
    column.addEventListener("dragleave", () => column.classList.remove("drop"));
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      column.classList.remove("drop");
      const id = Number(event.dataTransfer.getData("text/program"));
      const program = programs.find((entry) => entry.id === id);
      if (!program) return;
      const weekday = column.dataset.day === "none" ? null : Number(column.dataset.day);
      try {
        await api("PUT", "/api/programs/" + id, programBody(program, { weekday }));
        invalidate("programs");
        toast(program.name + " is now " + (weekday === null ? "without a fixed day" : "on " + WEEKDAYS[weekday]));
        renderPrograms(view);
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

function programBody(program, overrides = {}) {
  return {
    name: program.name,
    weekday: program.weekday,
    description: program.description || "",
    items: program.items.map((item) => ({
      exercise_id: item.exercise_id, sets: item.sets, target: item.target, rep_min: item.rep_min, rep_max: item.rep_max,
      target_weight: item.target_weight, rest_seconds: item.rest_seconds,
    })),
    ...overrides,
  };
}

function card(program) {
  const strength = program.items.filter((item) => item.measure !== "min" && item.measure !== "none");
  const totals = {};
  strength.forEach((item) => { totals[item.primary_muscle] = (totals[item.primary_muscle] || 0) + item.sets; });
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const stripe = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([muscle, sets]) => '<i style="flex:' + sets / sum + ";background:" + muscleColor(muscle) + '" title="' + esc(muscleLabel(muscle)) + '"></i>').join("");
  return '<a class="prog-card" draggable="true" data-id="' + program.id + '" href="#/programs/' + program.id + '">' +
    (stripe ? '<div class="stripe">' + stripe + "</div>" : "") +
    "<h3>" + esc(program.name) + "</h3>" +
    '<div class="ex">' + program.items.slice(0, 6).map((item) => "<span>" + esc(item.sets + " × " + item.name) + "</span>").join("") +
    (program.items.length > 6 ? "<span>and " + (program.items.length - 6) + " more</span>" : "") + "</div>" +
    '<div class="foot"><span>' + program.total_sets + " sets</span><span>" + esc(program.last_done ? relativeDay(program.last_done) : "never") + "</span></div></a>";
}

export async function renderProgramEditor(view, idText) {
  const isNew = idText === "new";
  const [exercises, program] = await Promise.all([
    loadExercises(true),
    isNew ? Promise.resolve({ name: "", weekday: null, description: "", items: [], versions: [] }) : api("GET", "/api/programs/" + idText),
  ]);
  const draft = {
    name: program.name,
    weekday: program.weekday,
    description: program.description || "",
    items: program.items.map((item) => ({ ...item })),
  };
  let dirty = false;
  const byId = Object.fromEntries(exercises.map((exercise) => [exercise.id, exercise]));

  view.innerHTML =
    '<div class="page-head"><div><a class="btn ghost small" href="#/programs">All programs</a><h1 style="margin-top:10px">' + (isNew ? "New program" : esc(program.name)) + "</h1></div>" +
    '<div class="page-actions">' +
    (!isNew ? '<button class="btn" id="p-redesign">Redesign with AI coach</button><button class="btn" id="p-duplicate">Duplicate</button><button class="btn ghost danger" id="p-delete">Delete</button>' : "") +
    '<button class="btn primary" id="p-save">Save</button></div></div>' +
    '<div class="form-grid" style="margin-bottom:8px"><label class="field"><span>Name</span><input type="text" id="p-name" value="' + esc(draft.name) + '" placeholder="e.g. Chest and triceps"></label>' +
    '<label class="field"><span>Weekday</span><select id="p-weekday"><option value="">No fixed day</option>' +
    WEEKDAYS.map((day, index) => '<option value="' + index + '"' + (draft.weekday === index ? " selected" : "") + ">" + day + "</option>").join("") + "</select></label>" +
    '<label class="field" style="grid-column:span 2"><span>Description</span><input type="text" id="p-desc" value="' + esc(draft.description) + '"></label></div>' +
    '<div class="editor-summary" id="p-summary"></div>' +
    '<div class="editor"><div>' +
    '<div class="editor-items" id="p-items"></div>' +
    (!isNew && program.versions && program.versions.length ? '<div class="panel flat" style="margin-top:24px"><div class="panel-head"><h3>Earlier versions</h3><span class="hint">Every change is saved</span></div><div class="feed">' +
      program.versions.map((version) => '<div class="feed-item"><div class="ico k-neutral">↺</div><div><div class="title">' + esc(version.reason) + '</div><div class="msg">' + esc(version.created_at.replace("T", " ").slice(0, 16)) + '</div></div><div class="when"><button class="btn ghost small" data-restore="' + version.id + '">Restore</button></div></div>').join("") +
      "</div></div>" : "") +
    "</div>" +
    '<aside class="library panel"><div class="panel-head"><h3>Exercises</h3><button class="btn ghost small" id="p-new-ex">New exercise</button></div>' +
    '<input type="search" id="lib-search" placeholder="Search">' +
    '<select id="lib-muscle"><option value="">All muscles</option>' + state.meta.muscles.map((muscle) => '<option value="' + muscle + '">' + esc(muscleLabel(muscle)) + "</option>").join("") + "</select>" +
    '<label class="check small"><input type="checkbox" id="lib-available" checked> Only with my equipment</label>' +
    '<div class="library-list" id="lib-list"></div><p class="small faint">Drag or click to add</p></aside></div>';

  const itemsRoot = view.querySelector("#p-items");
  const markDirty = () => { dirty = true; };
  const summary = () => {
    const strength = draft.items.filter((item) => (byId[item.exercise_id] || {}).measure !== "min" && (byId[item.exercise_id] || {}).measure !== "none");
    const sets = strength.reduce((sum, item) => sum + Number(item.sets || 0), 0);
    const seconds = draft.items.reduce((sum, item) => {
      const exercise = byId[item.exercise_id] || {};
      if (exercise.measure === "min") return sum + (Number(item.rep_max) || 20) * 60 * item.sets;
      return sum + item.sets * (45 + Number(item.rest_seconds || 0));
    }, 0);
    const muscles = {};
    strength.forEach((item) => {
      const exercise = byId[item.exercise_id];
      if (!exercise || !exercise.primary_muscle) return;
      muscles[exercise.primary_muscle] = (muscles[exercise.primary_muscle] || 0) + Number(item.sets);
      (exercise.secondary_muscles || []).forEach((muscle) => { muscles[muscle] = (muscles[muscle] || 0) + Number(item.sets) * 0.5; });
    });
    view.querySelector("#p-summary").innerHTML = "<span><b>" + draft.items.length + "</b>exercises</span><span><b>" + sets + "</b>working sets</span><span><b>" + Math.round(seconds / 60) + "</b>minutes approx.</span>" +
      (sets > 24 ? '<span class="delta down">More than 24 sets, that gets long</span>' : "") +
      '<span class="chips">' + Object.entries(muscles).sort((a, b) => b[1] - a[1]).map(([muscle, value]) => '<span class="chip"><span class="dot" style="background:' + muscleColor(muscle) + '"></span>' + esc(muscleLabel(muscle)) + " " + num(value) + "</span>").join("") + "</span>";
  };

  const drawItems = () => {
    if (!draft.items.length) {
      itemsRoot.innerHTML = '<div class="empty">Drag exercises from the list on the right in here.</div>';
      summary();
      return;
    }
    itemsRoot.innerHTML = draft.items.map((item, index) => {
      const exercise = byId[item.exercise_id] || { name: item.name, measure: "reps" };
      const unit = MEASURE_UNITS[exercise.measure] || "";
      const hasRange = exercise.measure !== "none";
      return '<div class="ed-row" draggable="true" data-index="' + index + '">' +
        '<span class="grip" title="Drag to reorder">⠿</span>' +
        '<div class="name"><b>' + esc(exercise.name) + "</b><span>" + esc(muscleLabel(exercise.primary_muscle)) + (exercise.available === false ? " · equipment missing" : "") + "</span></div>" +
        '<label>Sets<input type="number" min="1" max="10" data-field="sets" value="' + item.sets + '"></label>' +
        (hasRange ? '<label>' + esc(unit) + '<span class="range"><input type="number" min="0" step="1" data-field="rep_min" value="' + esc(item.rep_min ?? "") + '"><input type="number" min="0" step="1" data-field="rep_max" value="' + esc(item.rep_max ?? "") + '"></span></label>'
          : '<label>Target<input type="text" data-field="target" value="' + esc(item.target || "") + '"></label>') +
        (exercise.track_weight ? '<label>Weight<input type="number" min="0" step="0.5" data-field="target_weight" value="' + esc(item.target_weight ?? "") + '" placeholder="auto"></label>' : "<span></span>") +
        '<label>Rest<input type="number" min="0" step="15" data-field="rest_seconds" value="' + item.rest_seconds + '"></label>' +
        '<button class="btn ghost small" data-remove title="Remove">✕</button></div>';
    }).join("");
    summary();
    itemsRoot.querySelectorAll(".ed-row").forEach((row) => {
      const index = Number(row.dataset.index);
      row.querySelectorAll("[data-field]").forEach((input) => input.addEventListener("input", () => {
        const field = input.dataset.field;
        draft.items[index][field] = field === "target" ? input.value : input.value === "" ? null : Number(input.value);
        markDirty();
        summary();
      }));
      row.querySelector("[data-remove]").addEventListener("click", () => {
        draft.items.splice(index, 1);
        markDirty();
        drawItems();
      });
      row.addEventListener("dragstart", (event) => {
        if (event.target !== row) return;
        event.dataTransfer.setData("text/row", String(index));
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        row.classList.add("over");
      });
      row.addEventListener("dragleave", () => row.classList.remove("over"));
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove("over");
        const from = event.dataTransfer.getData("text/row");
        const exerciseId = event.dataTransfer.getData("text/exercise");
        if (from !== "") {
          const [moved] = draft.items.splice(Number(from), 1);
          draft.items.splice(index, 0, moved);
        } else if (exerciseId) {
          draft.items.splice(index, 0, newItem(byId[Number(exerciseId)]));
        }
        markDirty();
        drawItems();
      });
    });
  };

  const newItem = (exercise) => ({
    exercise_id: exercise.id, name: exercise.name, sets: exercise.measure === "min" ? 1 : 3,
    rep_min: exercise.measure === "reps" ? 8 : exercise.measure === "sec" ? 30 : exercise.measure === "min" ? 20 : null,
    rep_max: exercise.measure === "reps" ? 12 : exercise.measure === "sec" ? 45 : exercise.measure === "min" ? 20 : null,
    target: "", target_weight: null, rest_seconds: exercise.measure === "min" ? 0 : 90,
  });

  itemsRoot.addEventListener("dragover", (event) => {
    event.preventDefault();
    itemsRoot.classList.add("drop");
  });
  itemsRoot.addEventListener("dragleave", () => itemsRoot.classList.remove("drop"));
  itemsRoot.addEventListener("drop", (event) => {
    event.preventDefault();
    itemsRoot.classList.remove("drop");
    const exerciseId = event.dataTransfer.getData("text/exercise");
    if (exerciseId) {
      draft.items.push(newItem(byId[Number(exerciseId)]));
      markDirty();
      drawItems();
    }
  });

  const drawLibrary = () => {
    const query = view.querySelector("#lib-search").value.toLowerCase();
    const muscle = view.querySelector("#lib-muscle").value;
    const onlyAvailable = view.querySelector("#lib-available").checked;
    const list = exercises.filter((exercise) =>
      (!query || exercise.name.toLowerCase().includes(query)) &&
      (!muscle || exercise.primary_muscle === muscle || (exercise.secondary_muscles || []).includes(muscle)) &&
      (!onlyAvailable || exercise.available));
    view.querySelector("#lib-list").innerHTML = list.map((exercise) =>
      '<button class="lib-item' + (exercise.available ? "" : " unavailable") + '" draggable="true" data-ex="' + exercise.id + '">' +
      '<span class="dot" style="background:' + muscleColor(exercise.primary_muscle) + '"></span>' +
      '<span class="grow">' + esc(exercise.name) + "<span>" + esc(muscleLabel(exercise.primary_muscle)) + "</span></span><span class=\"add\">+</span></button>").join("") ||
      '<p class="muted small">No exercise matches.</p>';
    view.querySelectorAll("[data-ex]").forEach((button) => {
      button.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/exercise", button.dataset.ex));
      button.addEventListener("click", () => {
        draft.items.push(newItem(byId[Number(button.dataset.ex)]));
        markDirty();
        drawItems();
        toast(byId[Number(button.dataset.ex)].name + " added");
      });
    });
  };
  ["#lib-search", "#lib-muscle", "#lib-available"].forEach((selector) => view.querySelector(selector).addEventListener("input", drawLibrary));
  drawLibrary();
  drawItems();

  ["#p-name", "#p-weekday", "#p-desc"].forEach((selector) => view.querySelector(selector).addEventListener("input", markDirty));

  view.querySelector("#p-new-ex").addEventListener("click", () => openExerciseEditor(null, async (created) => {
    const fresh = await loadExercises(true);
    exercises.splice(0, exercises.length, ...fresh);
    fresh.forEach((exercise) => { byId[exercise.id] = exercise; });
    draft.items.push(newItem(byId[created.id]));
    markDirty();
    drawLibrary();
    drawItems();
  }));

  const save = async () => {
    const name = view.querySelector("#p-name").value.trim();
    if (!name) {
      toast("Give the program a name", "error");
      return;
    }
    const weekdayValue = view.querySelector("#p-weekday").value;
    const body = {
      name,
      weekday: weekdayValue === "" ? null : Number(weekdayValue),
      description: view.querySelector("#p-desc").value,
      items: draft.items.map((item) => ({
        exercise_id: item.exercise_id, sets: Math.max(1, Number(item.sets) || 1), target: item.target || "",
        rep_min: item.rep_min, rep_max: item.rep_max, target_weight: item.target_weight, rest_seconds: Number(item.rest_seconds) || 0,
      })),
    };
    try {
      const saved = await api(isNew ? "POST" : "PUT", isNew ? "/api/programs" : "/api/programs/" + idText, body);
      dirty = false;
      invalidate("programs");
      toast("Program saved");
      location.hash = "#/programs/" + saved.id;
      if (!isNew) renderProgramEditor(view, idText);
    } catch (error) {
      toast(error.message, "error");
    }
  };
  view.querySelector("#p-save").addEventListener("click", save);

  if (!isNew) {
    view.querySelector("#p-delete").addEventListener("click", async () => {
      const ok = await confirmModal("Delete program", "Logged workouts are kept. The program is archived if it was already used.", "Delete", true);
      if (!ok) return;
      await api("DELETE", "/api/programs/" + idText);
      invalidate("programs");
      location.hash = "#/programs";
    });
    view.querySelector("#p-duplicate").addEventListener("click", async () => {
      const copy = await api("POST", "/api/programs/" + idText + "/duplicate");
      invalidate("programs");
      location.hash = "#/programs/" + copy.id;
    });
    view.querySelector("#p-redesign").addEventListener("click", () => redesignDialog(Number(idText), () => renderProgramEditor(view, idText)));
    view.querySelectorAll("[data-restore]").forEach((button) => button.addEventListener("click", async () => {
      await api("POST", "/api/programs/" + idText + "/restore/" + button.dataset.restore);
      toast("Version restored");
      renderProgramEditor(view, idText);
    }));
  }

  const guard = (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", guard);
  onCleanup(() => window.removeEventListener("beforeunload", guard));
}

export function redesignDialog(programId, onDone) {
  const modal = openModal(
    '<div class="modal-head"><h2>Redesign program</h2></div>' +
    '<p class="muted">The local AI coach rebuilds the program from your exercises and equipment and keeps exercises that still bring progress. Weights you reached are carried over. The old version stays saved and can be restored.</p>' +
    '<label class="field"><span>Wish (optional)</span><textarea id="r-wish" placeholder="e.g. more focus on the long head of the biceps, at most 45 minutes"></textarea></label>' +
    '<div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go autofocus>Redesign</button></div>',
  );
  modal.element.querySelector("[data-go]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "AI coach is thinking";
    try {
      const result = await api("POST", "/api/coach/redesign/" + programId, { instruction: modal.element.querySelector("#r-wish").value });
      modal.close();
      invalidate("programs");
      toast("Redesigned: " + result.items.join(", "));
      if (onDone) onDone(result);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Redesign";
      toast(error.message, "error");
    }
  });
}
