import {
  api, esc, num, toast, confirmModal, loadExercises, formatDay, formatSet, toIso, todayIso, WEEKDAYS_SHORT, MONTHS,
  storageGet, storageSet, cssVar, EFFORT_LABELS, MEASURE_UNITS, state,
} from "../core.js?v=cycle2";
import { lineChart, barChart } from "../charts.js?v=cycle2";
import { startWorkoutFlow, refreshActive } from "./workout.js?v=cycle2";

const view_state = { month: null };

export async function renderHistory(view) {
  const tab = storageGet("history-tab", "calendar");
  view.innerHTML = '<div class="page-head"><div><h1>History</h1><p>Every workout, and how each exercise develops.</p></div></div>' +
    '<div class="tabs" role="tablist">' + [["calendar", "Calendar"], ["list", "Workouts"], ["progress", "Exercise progress"]].map(([key, label]) =>
      '<button role="tab" data-tab="' + key + '" aria-selected="' + (tab === key) + '">' + label + "</button>").join("") + "</div><div id=\"h-body\"></div>";
  view.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    storageSet("history-tab", button.dataset.tab);
    renderHistory(view);
  }));
  const body = view.querySelector("#h-body");
  if (tab === "calendar") return renderCalendar(body);
  if (tab === "list") return renderList(body);
  return renderProgress(body);
}

async function renderCalendar(body) {
  if (!view_state.month) {
    const now = new Date();
    view_state.month = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const month = view_state.month;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(start.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 41);
  const sessions = await api("GET", "/api/sessions?start=" + toIso(start) + "&end=" + toIso(end) + "&limit=500");
  const byDay = {};
  sessions.forEach((session) => { (byDay[session.day] = byDay[session.day] || []).push(session); });
  const today = todayIso();
  let cells = WEEKDAYS_SHORT.map((day) => '<div class="dow">' + day + "</div>").join("");
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const iso = toIso(cursor);
    const list = byDay[iso] || [];
    cells += '<button class="cal-day' + (cursor.getMonth() !== month.getMonth() ? " other" : "") + (iso === today ? " is-today" : "") + '" data-day="' + iso + '"><span class="d">' + cursor.getDate() + "</span>" +
      list.map((session) => '<span class="s' + (session.status === "active" ? " active" : "") + '">' + esc(session.program_name) + "</span>").join("") + "</button>";
  }
  body.innerHTML = '<div class="toolbar"><button class="btn icon" data-move="-1" aria-label="Previous month">‹</button><h2 style="min-width:220px;text-align:center">' + MONTHS[month.getMonth()] + " " + month.getFullYear() +
    '</h2><button class="btn icon" data-move="1" aria-label="Next month">›</button><button class="btn ghost small" data-move="0">Today</button></div><div class="calendar">' + cells + "</div>";
  body.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => {
    const move = Number(button.dataset.move);
    view_state.month = move === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(month.getFullYear(), month.getMonth() + move, 1);
    renderCalendar(body);
  }));
  body.querySelectorAll("[data-day]").forEach((cell) => cell.addEventListener("click", async () => {
    const list = byDay[cell.dataset.day] || [];
    if (list.length) {
      location.hash = "#/history/training/" + list[0].id;
      return;
    }
    const ok = await confirmModal("Log a workout", "Start or backfill a workout for " + formatDay(cell.dataset.day) + "?", "Create workout");
    if (ok) startWorkoutFlow(cell.dataset.day, null);
  }));
}

async function renderList(body) {
  const sessions = await api("GET", "/api/sessions?limit=1000");
  if (!sessions.length) {
    body.innerHTML = '<div class="empty">No workouts logged yet.<br><a class="btn primary" href="#/training">Start your first workout</a></div>';
    return;
  }
  const groups = {};
  sessions.forEach((session) => { (groups[session.day.slice(0, 7)] = groups[session.day.slice(0, 7)] || []).push(session); });
  body.innerHTML = Object.keys(groups).map((key) => {
    const [year, monthNumber] = key.split("-").map(Number);
    return '<section style="margin-bottom:26px"><h2 style="margin-bottom:12px">' + MONTHS[monthNumber - 1] + " " + year + ' <span class="muted small">' + groups[key].length + " workouts</span></h2>" +
      '<div class="session-list">' + groups[key].map((session) =>
        '<a class="session-row" href="#/history/training/' + session.id + '"><span>' + esc(formatDay(session.day)) + "</span><span><b>" + esc(session.program_name) + "</b>" +
        (session.deload ? ' <span class="deload-flag small">Deload</span>' : "") + (session.status === "active" ? ' <span class="chip priority">in progress</span>' : "") + "</span>" +
        '<span class="num">' + session.sets_done + "/" + session.sets_planned + ' <span class="small faint">sets</span></span><span class="num">' + num(session.volume / 1000, 2) + ' <span class="small faint">t</span></span></a>').join("") +
      "</div></section>";
  }).join("");
}

async function renderProgress(body) {
  const exercises = (await loadExercises(true)).filter((exercise) => exercise.times_logged > 0);
  if (!exercises.length) {
    body.innerHTML = '<div class="empty">Once you have logged sets you see the progress of every exercise here.</div>';
    return;
  }
  const selected = Number(storageGet("progress-ex", exercises[0].id));
  body.innerHTML = '<div class="toolbar"><select id="pg-select" style="max-width:360px">' + exercises.map((exercise) =>
    '<option value="' + exercise.id + '"' + (exercise.id === selected ? " selected" : "") + ">" + esc(exercise.name) + "</option>").join("") + '</select></div><div id="pg-body"></div>';
  const select = body.querySelector("#pg-select");
  const draw = async () => {
    storageSet("progress-ex", select.value);
    const data = await api("GET", "/api/exercises/" + select.value + "/history");
    const target = body.querySelector("#pg-body");
    const exercise = data.exercise;
    const entries = data.entries.slice().reverse();
    const weighted = exercise.track_weight && exercise.measure === "reps";
    const unit = weighted ? "kg" : MEASURE_UNITS[exercise.measure];
    const best = Math.max(...entries.map((entry) => entry.metric || 0));
    target.innerHTML = '<div class="panel"><div class="panel-head"><h2>' + esc(exercise.name) + '</h2><span class="hint">' + entries.length + " workouts · best " + num(best) + " " + esc(unit) + (weighted ? " 1RM" : "") + "</span></div>" +
      '<div class="chart-box"><canvas id="pg-chart"></canvas></div>' + (weighted ? '<h3 style="margin:22px 0 10px">Volume per workout</h3><div class="chart-box tiny"><canvas id="pg-volume"></canvas></div>' : "") +
      '<table class="progress-table"><thead><tr><th>Date</th><th>Program</th><th>Sets</th>' + (weighted ? "<th>Estimated 1RM</th>" : "<th>Best</th>") + "</tr></thead><tbody>" +
      data.entries.map((entry) => '<tr><td><a href="#/history/training/' + entry.session_id + '">' + esc(formatDay(entry.day, false)) + "</a></td><td>" + esc(entry.program_name) + (entry.deload ? ' <span class="deload-flag small">Deload</span>' : "") + "</td><td>" +
        esc(entry.sets.map((set) => formatSet(set, entry.measure, entry.track_weight)).join(", ")) + '</td><td class="num">' + num(entry.metric) + "</td></tr>").join("") + "</tbody></table></div>";
    if (entries.length) {
      const datasets = [{ label: weighted ? "Estimated 1RM" : "Best", data: entries.map((entry) => entry.metric), color: cssVar("--plate-yellow") }];
      if (weighted) datasets.push({ label: "Heaviest set", data: entries.map((entry) => entry.top_weight), color: cssVar("--plate-blue"), borderDash: [5, 5] });
      lineChart(target.querySelector("#pg-chart"), { labels: entries.map((entry) => entry.day), datasets, unit });
      if (weighted) barChart(target.querySelector("#pg-volume"), {
        labels: entries.map((entry) => entry.day), datasets: [{ label: "Volume", data: entries.map((entry) => entry.volume), color: cssVar("--rubber-2") }], unit: "kg", dateLabels: true,
      });
    }
  };
  select.addEventListener("change", draw);
  draw();
}

export async function renderSessionDetail(view, id) {
  const session = await api("GET", "/api/sessions/" + id);
  const sets = session.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  const volume = session.exercises.reduce((sum, item) => sum + item.sets.reduce((inner, set) => inner + (set.weight || 0) * (set.value || 0), 0), 0);
  const minutes = session.finished_at ? Math.round((new Date(session.finished_at) - new Date(session.started_at)) / 60000) : null;
  view.innerHTML = '<div class="page-head"><div><a class="btn ghost small" href="#/history">History</a><h1 style="margin-top:10px">' + esc(session.program_name) + "</h1><p>" + esc(formatDay(session.day)) +
    (session.block_week ? ", week " + session.block_week + " of the block" : "") + (session.deload ? ", deload" : "") + "</p></div>" +
    '<div class="page-actions">' + (session.status === "done" ? '<button class="btn" id="reopen">Reopen</button>' : '<a class="btn primary" href="#/training">Weiter trainieren</a>') +
    '<button class="btn ghost danger" id="delete">Delete</button></div></div>' +
    '<div class="editor-summary"><span><b>' + sets + "</b>sets</span><span><b>" + num(volume / 1000, 2) + "</b>tonnes</span>" + (minutes !== null ? "<span><b>" + minutes + "</b>minutes</span>" : "") + "</div>" +
    (session.notes ? '<p class="cues" style="margin-bottom:20px">' + esc(session.notes) + "</p>" : "") +
    '<div class="session-list">' + session.exercises.map((item) =>
      '<div class="panel"><div class="panel-head"><h3>' + esc(item.exercise_name) + '</h3><span class="hint">' + item.sets.length + " of " + item.planned_sets + " sets · target " + esc(item.target || "free") + "</span></div>" +
      (item.sets.length ? '<table class="sets-table"><tbody>' + item.sets.map((set) => '<tr><td class="faint" style="width:60px">' + set.set_number + '</td><td class="num">' + esc(formatSet(set, item.measure, item.track_weight)) + "</td><td>" + esc(set.effort ? EFFORT_LABELS[set.effort] : "") + "</td></tr>").join("") + "</tbody></table>"
        : '<p class="muted small">Not done</p>') + "</div>").join("") + "</div>";
  const reopen = view.querySelector("#reopen");
  if (reopen) reopen.addEventListener("click", async () => {
    try {
      await api("POST", "/api/sessions/" + id + "/reopen");
      await refreshActive();
      location.hash = "#/training";
    } catch (error) {
      toast(error.message, "error");
    }
  });
  view.querySelector("#delete").addEventListener("click", async () => {
    const ok = await confirmModal("Delete workout", "All sets of this workout will be deleted.", "Delete", true);
    if (!ok) return;
    await api("DELETE", "/api/sessions/" + id);
    state.active = null;
    location.hash = "#/history";
  });
}
