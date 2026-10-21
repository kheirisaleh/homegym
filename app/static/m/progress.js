import { api, esc, num, cssVar, formatDay, formatSet, relativeDay, storageGet, storageSet, toast, todayIso, fromIso, EFFORT_LABELS, MEASURE_UNITS, confirmModal, plateColor } from "../js/core.js?v=cycle2";
import { lineChart, barChart } from "../js/charts.js?v=cycle2";
import { setTop } from "./app.js?v=cycle2";
import { enter } from "../js/motion.js?v=cycle2";

const TABS = [["strength", "Strength"], ["exercise", "Exercise"], ["history", "Workouts"], ["body", "Body"]];

export async function renderProgress(view) {
  setTop({ title: "Progress" });
  const tab = storageGet("m-progress-tab", "strength");
  view.innerHTML = '<div class="m-tabs-inline">' + TABS.map(([key, label]) => '<button data-tab="' + key + '" aria-pressed="' + (tab === key) + '">' + label + "</button>").join("") + '</div><div id="pg-body" style="display:flex;flex-direction:column;gap:16px"></div>';
  view.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { storageSet("m-progress-tab", button.dataset.tab); renderProgress(view); }));
  const body = view.querySelector("#pg-body");
  const draw = { strength: strengthTab, exercise: exerciseTab, history: historyTab }[tab] || bodyTab;
  await draw(body);
  if (view.contains(body)) enter(body);
}

async function strengthTab(body) {
  const data = await api("GET", "/api/dashboard?today=" + todayIso());
  const series = data.strength_index;
  if (!series.length) {
    body.innerHTML = '<div class="empty">Log sets with weight and your strength curve appears here.</div>';
    return;
  }
  const last = series[series.length - 1];
  body.innerHTML = '<div class="m-hero"><span class="when">Strength compared with your start</span><h1>' + num(last.value, 0) + ' %</h1><div class="m-chart"><canvas id="pg-index"></canvas></div></div>' +
    '<div class="m-section-title">Biggest gains</div><div class="m-list">' + data.strength.slice().sort((a, b) => b.change - a.change).slice(0, 8).map((entry, index) =>
      '<div class="m-item"><span class="dot" style="background:' + plateColor(index) + '"></span><span class="grow"><b>' + esc(entry.name) + "</b><span>" + num(entry.last) + " kg 1RM</span></span><b class=\"" +
      (entry.change >= 0 ? "delta up" : "delta down") + '">' + (entry.change >= 0 ? "+" : "") + num(entry.change * 100, 0) + " %</b></div>").join("") + "</div>" +
    '<div class="m-card"><h2>Weekly volume</h2><div class="m-chart"><canvas id="pg-volume"></canvas></div></div>';
  lineChart(body.querySelector("#pg-index"), { labels: series.map((point) => point.week), datasets: [{ label: "Strength index", data: series.map((point) => point.value), color: cssVar("--accent-line"), pointRadius: 0 }], unit: "%" });
  barChart(body.querySelector("#pg-volume"), { labels: data.weekly.map((week) => week.week), datasets: [{ label: "Volume", data: data.weekly.map((week) => week.volume), color: cssVar("--plate-blue") }], unit: "kg" });
}

async function exerciseTab(body) {
  const exercises = (await api("GET", "/api/exercises")).filter((exercise) => exercise.times_logged > 0);
  if (!exercises.length) {
    body.innerHTML = '<div class="empty">No logged exercises yet.</div>';
    return;
  }
  const selected = Number(storageGet("m-progress-ex", exercises[0].id));
  body.innerHTML = '<select id="pg-ex">' + exercises.map((exercise) => '<option value="' + exercise.id + '"' + (exercise.id === selected ? " selected" : "") + ">" + esc(exercise.name) + "</option>").join("") + '</select><div id="pg-ex-body" style="display:flex;flex-direction:column;gap:16px"></div>';
  const draw = async () => {
    storageSet("m-progress-ex", body.querySelector("#pg-ex").value);
    const data = await api("GET", "/api/exercises/" + body.querySelector("#pg-ex").value + "/history");
    const entries = data.entries.slice().reverse();
    const weighted = data.exercise.track_weight && data.exercise.measure === "reps";
    const target = body.querySelector("#pg-ex-body");
    target.innerHTML = '<div class="m-card"><div class="m-chart"><canvas></canvas></div></div><div class="m-list">' + data.entries.map((entry) =>
      '<a class="m-item" href="#/progress/session/' + entry.session_id + '"><span class="grow"><b>' + esc(formatDay(entry.day, false)) + "</b><span>" + esc(entry.sets.map((set) => formatSet(set, entry.measure, entry.track_weight)).join(", ")) +
      '</span></span><b class="num">' + num(entry.metric) + "</b></a>").join("") + "</div>";
    if (entries.length) lineChart(target.querySelector("canvas"), { labels: entries.map((entry) => entry.day), datasets: [{ label: weighted ? "Estimated 1RM" : "Best", data: entries.map((entry) => entry.metric), color: cssVar("--accent-line") }], unit: weighted ? "kg" : MEASURE_UNITS[data.exercise.measure] });
  };
  body.querySelector("#pg-ex").addEventListener("change", draw);
  draw();
}

async function historyTab(body) {
  const sessions = await api("GET", "/api/sessions?limit=300");
  body.innerHTML = sessions.length ? '<div class="m-list">' + sessions.map((session) =>
    '<a class="m-item" href="#/progress/session/' + session.id + '"><span class="grow"><b>' + esc(session.program_name) + "</b><span>" + esc(formatDay(session.day)) + ", " + session.sets_done + " sets" +
    (session.status === "active" ? ", in progress" : "") + '</span></span><span class="chev">›</span></a>').join("") + "</div>" : '<div class="empty">No workouts yet.</div>';
}

async function bodyTab(body) {
  const data = await api("GET", "/api/body");
  const entries = data.entries.filter((entry) => entry.weight_kg);
  const today = todayIso();
  const existing = data.entries.find((entry) => entry.day === today) || {};
  body.innerHTML = '<div class="m-card"><h2>Log today</h2><div class="form-grid"><label class="field"><span>Weight kg</span><input type="number" inputmode="decimal" step="0.1" id="bd-weight" value="' + (existing.weight_kg ?? "") + '"></label>' +
    '<label class="field"><span>Waist cm</span><input type="number" inputmode="decimal" step="0.5" id="bd-waist" value="' + (existing.waist_cm ?? "") + '"></label></div><button class="btn primary" id="bd-save">Save</button></div>' +
    (entries.length > 1 ? '<div class="m-card"><h2>Trend</h2><div class="m-chart"><canvas></canvas></div>' + (data.trend && data.trend.weekly_rate !== null ? '<p class="small muted">' + (data.trend.weekly_rate > 0 ? "+" : "") + num(data.trend.weekly_rate * 100, 2) + " % per week</p>" : "") + "</div>" : "");
  if (entries.length > 1) {
    const average = entries.map((entry) => {
      const day = fromIso(entry.day);
      const window = entries.filter((other) => { const diff = (day - fromIso(other.day)) / 86400000; return diff >= 0 && diff < 7; });
      return window.reduce((sum, other) => sum + other.weight_kg, 0) / window.length;
    });
    lineChart(body.querySelector("canvas"), { labels: entries.map((entry) => entry.day), datasets: [
      { label: "Weight", data: entries.map((entry) => entry.weight_kg), color: cssVar("--chalk-3"), borderWidth: 1, pointRadius: 2 },
      { label: "7 day average", data: average, color: cssVar("--plate-green"), pointRadius: 0 }], unit: "kg" });
  }
  body.querySelector("#bd-save").addEventListener("click", async () => {
    const weight = body.querySelector("#bd-weight").value;
    const waist = body.querySelector("#bd-waist").value;
    await api("PUT", "/api/body", { day: today, weight_kg: weight ? Number(weight) : null, waist_cm: waist ? Number(waist) : null });
    toast("Saved");
    bodyTab(body);
  });
}

export async function renderSessionDetail(view, id) {
  const session = await api("GET", "/api/sessions/" + id);
  setTop({ title: session.program_name, back: "#/progress" });
  const sets = session.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  view.innerHTML = '<div class="m-card flat"><b>' + esc(formatDay(session.day)) + '</b><span class="muted small">' + sets + " sets" + (session.deload ? ", deload" : "") + "</span>" +
    (session.notes ? "<p>" + esc(session.notes) + "</p>" : "") + "</div>" +
    session.exercises.map((item) => '<div class="m-card"><div class="m-card-head"><h2>' + esc(item.exercise_name) + '</h2><span class="muted small">' + item.sets.length + "/" + item.planned_sets + "</span></div>" +
      (item.sets.length ? item.sets.map((set) => '<div class="m-switch-row"><span class="num">' + esc(formatSet(set, item.measure, item.track_weight)) + '</span><span class="muted small">' + esc(set.effort ? EFFORT_LABELS[set.effort] : "") + "</span></div>").join("") : '<span class="muted small">Not done</span>') +
      "</div>").join("") +
    '<div class="m-row-actions">' + (session.status === "done" ? '<button class="btn" id="sd-reopen">Reopen</button>' : '<a class="btn primary" href="#/train">Continue</a>') + '<button class="btn danger" id="sd-delete">Delete</button></div>';
  const reopen = view.querySelector("#sd-reopen");
  if (reopen) reopen.addEventListener("click", async () => {
    try {
      await api("POST", "/api/sessions/" + id + "/reopen");
      location.hash = "#/train";
    } catch (error) {
      toast(error.message, "error");
    }
  });
  view.querySelector("#sd-delete").addEventListener("click", async () => {
    const ok = await confirmModal("Delete workout", "All sets of this workout will be deleted.", "Delete", true);
    if (!ok) return;
    await api("DELETE", "/api/sessions/" + id);
    location.hash = "#/progress";
  });
  void relativeDay;
}
