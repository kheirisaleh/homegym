import { api, esc, num, todayIso, fromIso, toIso, formatDay, relativeDay, plateColor, cssVar, logItemHtml, storageGet, storageSet, toast, state, WEEKDAYS, onCleanup } from "../core.js?v=cycle2";
import { lineChart, barChart } from "../charts.js?v=cycle2";
import { startWorkoutFlow } from "./workout.js?v=cycle2";
import { leaderboardRows, nextGapText } from "./leaderboard.js?v=cycle2";
import { coachCardHtml, mountCoachCard, weekBarsHtml, coachSays } from "../coachui.js?v=cycle2";

export async function renderDashboard(view) {
  const today = todayIso();
  const [data, suggestions, board, coachToday] = await Promise.all([
    api("GET", "/api/dashboard?today=" + today),
    api("GET", "/api/suggestions?day=" + today),
    api("GET", "/api/leaderboard?period=week"),
    api("GET", "/api/coach/today?day=" + today).catch(() => null),
  ]);
  const suggested = suggestions.options.find((option) => option.suggested);
  const others = suggestions.options.filter((option) => !option.suggested).slice(0, 4);
  const block = data.block;

  view.innerHTML =
    '<div class="dash">' +
    '<section class="today">' + todayCard(suggested, block) + alternatives(others) + "</section>" +
    (coachToday ? '<section class="hero-coach">' + coachCardHtml(coachToday, { active: state.active }) +
      '<div class="hero-week"><div class="panel-head"><h2>This week</h2><span class="hint">sets done against your program</span></div>' +
      (coachSays(coachToday.week) ? '<p class="wk-say">' + esc(coachSays(coachToday.week)) + "</p>" : "") + weekBarsHtml(coachToday.week) + "</div></section>"
      : '<section class="hero-chart" id="hero"></section>') +
    '<section class="tiles">' + tiles(data) + "</section>" +
    '<section class="panel col-7"><div class="panel-head"><h2>Volume per muscle</h2><span class="hint">Sets per week, counted fractionally</span></div>' + volumeHtml(data.volume) + "</section>" +
    '<section class="panel col-5 board-panel"><div class="panel-head"><h2>This week\'s race</h2><a class="hint" href="#/leaderboard">Leaderboard</a></div>' +
      leaderboardRows(board.rows.slice(0, 6), true) + '<p class="small muted" style="margin-top:12px">' + esc(nextGapText(board.rows)) + "</p></section>" +
    '<section class="panel col-5 proj-hide"><div class="panel-head"><h2>Coach</h2><a class="hint" href="#/coach">See all</a></div><div class="feed">' +
      (data.log.length ? data.log.slice(0, 5).map((entry) => logItemHtml(entry, false)).join("") : '<p class="muted">After your first workout the coach notes and changes appear here.</p>') + "</div></section>" +
    '<section class="panel col-7 proj-hide"><div class="panel-head"><h2>Training days</h2><span class="hint">' + data.stats.total + " workouts in total</span></div>" + heatmapHtml(data.heatmap) + "</section>" +
    '<section class="panel col-12 proj-hide"><div class="panel-head"><h2>New personal bests</h2><span class="hint">last 30 days</span></div>' + prsHtml(data.prs) + "</section>" +
    '<section class="panel col-12 proj-hide" id="body-panel"></section>' +
    "</div>";

  const startButton = view.querySelector("[data-start]");
  if (startButton) startButton.addEventListener("click", () => startWorkoutFlow(today, Number(startButton.dataset.start)));
  view.querySelectorAll("[data-alt]").forEach((button) => button.addEventListener("click", () => startWorkoutFlow(today, Number(button.dataset.alt))));
  const freeButton = view.querySelector("[data-free]");
  if (freeButton) freeButton.addEventListener("click", () => startWorkoutFlow(today, null));

  if (coachToday) {
    const card = mountCoachCard(view, coachToday);
    onCleanup(() => card.dispose());
  } else {
    renderHero(view.querySelector("#hero"), data);
  }
  renderBody(view.querySelector("#body-panel"), data);
}

function plates() {
  const sizes = [[150, "--plate-red"], [132, "--plate-blue"], [114, "--plate-yellow"], [96, "--plate-green"]];
  return '<div class="plates" aria-hidden="true">' + sizes.map(([height, color]) => '<i style="height:' + height + "px;margin-top:" + (150 - height) / 2 + "px;background:var(" + color + ')"></i>').join("") + "</div>";
}

function todayCard(option, block) {
  const now = new Date();
  const when = WEEKDAYS[(now.getDay() + 6) % 7] + ", week " + block.week + " of " + block.weeks + " in block " + block.number;
  if (state.active) {
    return '<div class="today-card">' + plates() + '<div class="when">Workout in progress</div><h1>' + esc(state.active.program_name) + "</h1>" +
      '<div class="actions"><a class="btn primary big" href="#/training">Continue workout</a></div></div>';
  }
  if (!option) {
    return '<div class="today-card"><div class="when">' + esc(when) + '</div><h1>No program yet</h1><p class="muted">Create a program and the overview suggests the right one every day.</p>' +
      '<div class="actions"><a class="btn primary big" href="#/programs/new">Create program</a><button class="btn big" data-free>Free workout</button></div></div>';
  }
  const program = option.program;
  const strength = program.items.filter((item) => item.measure !== "min" && item.measure !== "none");
  const minutes = estimateMinutes(program, block.deload);
  return '<div class="today-card">' + plates() +
    '<div class="when">' + esc(when) + (block.deload ? ' · <span class="deload-flag">Deload week, half the sets</span>' : "") + "</div>" +
    "<h1>" + esc(program.name) + "</h1>" +
    '<div class="meta"><div><b>' + program.items.length + "</b>exercises</div><div><b>" + (block.deload ? Math.ceil(program.total_sets / 2) : program.total_sets) + "</b>working sets</div>" +
    "<div><b>" + minutes + "</b>minutes approx.</div><div><b>" + esc(option.last_done_before ? relativeDay(option.last_done_before) : "new") + "</b>last time</div></div>" +
    '<p class="muted">' + esc(strength.slice(0, 4).map((item) => item.name).join(", ")) + (strength.length > 4 ? " and " + (strength.length - 4) + " more" : "") + "</p>" +
    '<div class="actions"><button class="btn primary big" data-start="' + program.id + '">Start workout</button><button class="btn big" data-free>Free workout</button></div></div>';
}

function estimateMinutes(program, deload) {
  let seconds = 0;
  program.items.forEach((item) => {
    if (item.measure === "min") {
      seconds += (Number(item.target.match(/\d+/)) || 20) * 60 * item.sets;
      return;
    }
    const sets = deload ? Math.ceil(item.sets / 2) : item.sets;
    seconds += sets * (45 + item.rest_seconds);
  });
  return Math.max(5, Math.round(seconds / 300) * 5);
}

function alternatives(options) {
  if (!options.length) return "<div></div>";
  return '<div class="panel flat"><div class="panel-head"><h3>Or today</h3></div><div class="alt-programs">' +
    options.map((option) => '<button class="alt-program" data-alt="' + option.program.id + '"><span class="dot" style="background:' + plateColor(option.program.id) + '"></span>' +
      '<span class="grow"><b>' + esc(option.program.name) + "</b><span>" + esc(option.reason) + " · " + option.program.items.length + " exercises</span></span></button>").join("") +
    "</div></div>";
}

function tiles(data) {
  const stats = data.stats;
  const cardio = data.cardio;
  const trend = data.body_trend;
  const cardioShare = cardio.target ? Math.min(100, (cardio.minutes / cardio.target) * 100) : 0;
  let bodyValue = "–";
  let bodySub = "Log your weight below";
  if (trend) {
    bodyValue = num(trend.avg7 || trend.latest) + "<small>kg</small>";
    bodySub = trend.weekly_rate === null ? "7 day average" : (trend.weekly_rate <= 0 ? "" : "+") + num(trend.weekly_rate * 100, 2) + " % per week";
  }
  return '<div class="tile"><div class="label">This week</div><div class="value">' + stats.this_week + '<small>workouts</small></div><div class="sub">' + stats.this_month + " this month</div></div>" +
    '<div class="tile"><div class="label">Streak</div><div class="value">' + stats.streak_weeks + '<small>weeks</small></div><div class="sub">in a row with at least one workout</div></div>' +
    '<div class="tile"><div class="label">Cardio last 7 days</div><div class="value">' + num(cardio.minutes, 0) + "<small>/ " + cardio.target + ' min</small></div><div class="meter"><i style="width:' + cardioShare + '%"></i></div></div>' +
    '<div class="tile"><div class="label">Body weight</div><div class="value">' + bodyValue + '</div><div class="sub">' + esc(bodySub) + "</div></div>";
}

function volumeHtml(rows) {
  if (!rows.length) return '<p class="muted">Once programs contain exercises with target muscles, your weekly volume shows up here.</p>';
  const scale = Math.max(20, ...rows.map((row) => Math.max(row.planned, row.done, row.max) + 2));
  const pct = (value) => (Math.min(value, scale) / scale) * 100;
  const stateOf = (row) => row.done >= row.max ? "over" : row.done >= row.min ? "good" : row.done >= row.min * 0.5 ? "low" : "far";
  const labels = { over: "Above range", good: "In range", low: "Below range", far: "Far below" };
  const sorted = rows.slice().sort((left, right) => (right.priority ? 1 : 0) - (left.priority ? 1 : 0) || (left.done / Math.max(left.min, 1)) - (right.done / Math.max(right.min, 1)));
  const counts = { good: 0, low: 0, far: 0, over: 0 };
  sorted.forEach((row) => { counts[stateOf(row)] += 1; });
  const summary = '<div class="vol-summary"><span class="vs-good"><b>' + counts.good + '</b> in range</span><span class="vs-low"><b>' + (counts.low + counts.far) + '</b> below</span>' + (counts.over ? '<span class="vs-over"><b>' + counts.over + "</b> above</span>" : "") + "</div>";
  return summary + '<div class="volume-list">' + sorted.map((row) => {
    const state = stateOf(row);
    return '<div class="vol-row" data-state="' + state + '"><div class="name">' + esc(row.label) + (row.priority ? '<span class="star" title="Priority">★</span>' : "") + "</div>" +
    '<div class="vol-track" title="' + labels[state] + ": done " + num(row.done) + ", planned " + num(row.planned) + ", target " + row.min + " to " + row.max + '">' +
    '<div class="vol-band" style="left:' + pct(row.min) + "%;width:" + (pct(row.max) - pct(row.min)) + '%"></div>' +
    '<div class="vol-plan" style="left:calc(' + pct(row.planned) + '% - 1px)"></div><div class="vol-done" style="width:' + pct(row.done) + '%"></div></div>' +
    '<div class="figs"><b>' + num(row.done) + "</b><span> / " + num(row.planned) + '</span><i class="vol-state">' + labels[state] + "</i></div></div>";
  }).join("") + "</div>" +
    '<div class="vol-legend"><span><i class="lg-done"></i>done in the last 7 days</span><span><i class="lg-plan"></i>planned per week</span>' +
    '<span><i class="lg-band"></i>target range</span></div>';
}

function heatmapHtml(entries) {
  const byDay = {};
  entries.forEach((entry) => { byDay[entry.day] = entry; });
  const max = Math.max(1, ...entries.map((entry) => entry.sets));
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7 * 30 - ((end.getDay() + 6) % 7));
  let cells = "";
  for (let cursor = new Date(start); cursor <= new Date(end.getFullYear(), end.getMonth(), end.getDate() + (6 - ((end.getDay() + 6) % 7))); cursor.setDate(cursor.getDate() + 1)) {
    const iso = toIso(cursor);
    const entry = byDay[iso];
    if (cursor > end) {
      cells += '<i class="future"></i>';
      continue;
    }
    const level = entry ? Math.min(3, 1 + Math.floor((entry.sets / max) * 2.99)) : 0;
    cells += "<i" + (level ? ' data-l="' + level + '"' : "") + ' title="' + esc(formatDay(iso) + (entry ? ": " + entry.sets + " sets" : "")) + '"></i>';
  }
  return '<div class="heatmap">' + cells + "</div>";
}

function prsHtml(prs) {
  if (!prs.length) return '<p class="muted">No new personal bests in the last 30 days. Double progression brings them step by step.</p>';
  return '<div class="pr-list">' + prs.map((entry) =>
    '<div class="pr"><div><b>' + esc(entry.name) + '</b><div class="small faint">' + esc(relativeDay(entry.day)) + " · " + num(entry.weight) + " kg</div></div>" +
    '<div class="w">' + num(entry.e1rm) + ' <span class="small muted">kg 1RM</span> <span class="delta up small">+' + num(entry.gain) + "</span></div></div>").join("") + "</div>";
}

function renderHero(container, data) {
  const mode = storageGet("hero-mode", "index");
  const hasStrength = data.strength.length > 0;
  const head = (figure) =>
    '<div class="hero-chart-top"><div><h2>Strength curve</h2><p class="muted small" style="margin-top:6px">Estimated one rep max (Epley), calculated from your logged sets</p>' + figure + "</div>" +
    '<div class="seg" role="group" aria-label="View">' +
    [["index", "Strength index"], ["lifts", "Exercises"], ["volume", "Weekly volume"]].map(([key, label]) => '<button data-mode="' + key + '" aria-pressed="' + (mode === key) + '">' + label + "</button>").join("") +
    "</div></div>";

  if (!hasStrength) {
    container.innerHTML = head("") + '<div class="empty">Log sets with weight and this curve shows how much stronger you get.</div>';
    bindModes(container, data);
    return;
  }

  if (mode === "lifts") {
    const hidden = new Set(JSON.parse(storageGet("hero-hidden", "null") || "null") || data.strength.slice(6).map((entry) => entry.id));
    const days = [...new Set(data.strength.flatMap((entry) => entry.series.map((point) => point.day)))].sort();
    const visible = data.strength.filter((entry) => !hidden.has(entry.id));
    const best = visible.slice().sort((a, b) => b.change - a.change)[0];
    const figure = best ? '<div class="hero-figure" style="margin-top:16px"><span class="big">' + (best.change >= 0 ? "+" : "") + num(best.change * 100, 0) + '</span><span class="unit">%</span><span class="muted">' + esc(best.name) + " since the start</span></div>" : "";
    container.innerHTML = head(figure) + '<div class="chart-box"><canvas></canvas></div><div class="lift-legend">' +
      data.strength.map((entry, index) => '<button data-lift="' + entry.id + '" aria-pressed="' + !hidden.has(entry.id) + '"><span class="dot" style="background:' + plateColor(index) + '"></span>' + esc(entry.name) + " <b>" + num(entry.last) + "</b></button>").join("") + "</div>";
    const datasets = data.strength.map((entry, index) => {
      const lookup = {};
      entry.series.forEach((point) => { lookup[point.day] = point.e1rm; });
      return { label: entry.name, data: days.map((day) => lookup[day] ?? null), color: plateColor(index), hidden: hidden.has(entry.id) };
    });
    const chart = lineChart(container.querySelector("canvas"), { labels: days, datasets, unit: "kg" });
    container.querySelectorAll("[data-lift]").forEach((button) => button.addEventListener("click", () => {
      const id = Number(button.dataset.lift);
      if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
      storageSet("hero-hidden", JSON.stringify([...hidden]));
      button.setAttribute("aria-pressed", String(!hidden.has(id)));
      const index = data.strength.findIndex((entry) => entry.id === id);
      chart.data.datasets[index].hidden = hidden.has(id);
      chart.update();
    }));
  } else if (mode === "volume") {
    const weeks = data.weekly;
    const last = weeks[weeks.length - 1];
    const figure = last ? '<div class="hero-figure" style="margin-top:16px"><span class="big">' + num(last.volume / 1000, 1) + '</span><span class="unit">tonnes</span><span class="muted">moved in the week of ' + esc(formatDay(last.week, false)) + "</span></div>" : "";
    container.innerHTML = head(figure) + '<div class="chart-box"><canvas></canvas></div>';
    barChart(container.querySelector("canvas"), {
      labels: weeks.map((week) => week.week),
      datasets: [{ label: "Volume", data: weeks.map((week) => week.volume), color: cssVar("--plate-blue") }],
      unit: "kg",
    });
  } else {
    const series = data.strength_index;
    const last = series[series.length - 1];
    const compare = series.length > 4 ? series[series.length - 5] : series[0];
    const delta = last && compare ? last.value - compare.value : 0;
    const figure = last ? '<div class="hero-figure" style="margin-top:16px"><span class="big">' + num(last.value, 0) + '</span><span class="unit">%</span>' +
      '<span class="delta ' + (delta >= 0 ? "up" : "down") + '">' + (delta >= 0 ? "+" : "") + num(delta, 0) + '</span><span class="muted">of your starting strength, change over 4 weeks</span></div>' : "";
    container.innerHTML = head(figure) + '<div class="chart-box"><canvas></canvas></div>';
    lineChart(container.querySelector("canvas"), {
      labels: series.map((point) => point.week),
      datasets: [
        { label: "Strength index", data: series.map((point) => point.value), color: cssVar("--accent-line"), borderWidth: Number(cssVar("--chart-line")) + 1 },
        { label: "Start", data: series.map(() => 100), color: cssVar("--chalk-3"), borderDash: [6, 6], pointRadius: 0, borderWidth: 1 },
      ],
      unit: "%",
    });
  }
  bindModes(container, data);
}

function bindModes(container, data) {
  container.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    storageSet("hero-mode", button.dataset.mode);
    renderHero(container, data);
  }));
}

function renderBody(container, data) {
  const entries = data.body.filter((entry) => entry.weight_kg);
  const today = todayIso();
  const existing = data.body.find((entry) => entry.day === today) || {};
  container.innerHTML = '<div class="panel-head"><h2>Body</h2><span class="hint">' + (data.goals.fat_loss ? "Fat loss goal active. Your face gets leaner as the 7 day average drops." : "") + "</span></div>" +
    '<div class="body-form"><label class="field"><span>Date</span><input type="date" id="b-day" value="' + today + '"></label>' +
    '<label class="field"><span>Weight kg</span><input type="number" step="0.1" inputmode="decimal" id="b-weight" value="' + (existing.weight_kg ?? "") + '"></label>' +
    '<label class="field"><span>Waist cm</span><input type="number" step="0.5" inputmode="decimal" id="b-waist" value="' + (existing.waist_cm ?? "") + '"></label>' +
    '<button class="btn primary" id="b-save">Save</button></div>' +
    (entries.length > 1 ? '<div class="chart-box short" style="margin-top:18px"><canvas></canvas></div>' : '<p class="muted small" style="margin-top:12px">From two entries on, the curve with its 7 day average appears here.</p>');
  if (entries.length > 1) {
    const labels = entries.map((entry) => entry.day);
    const average = entries.map((entry) => {
      const day = fromIso(entry.day);
      const window = entries.filter((other) => { const diff = (day - fromIso(other.day)) / 86400000; return diff >= 0 && diff < 7; });
      return window.reduce((sum, other) => sum + other.weight_kg, 0) / window.length;
    });
    lineChart(container.querySelector("canvas"), {
      labels,
      datasets: [
        { label: "Weight", data: entries.map((entry) => entry.weight_kg), color: cssVar("--chalk-3"), borderWidth: 1, pointRadius: 2 },
        { label: "7 day average", data: average, color: cssVar("--plate-green"), pointRadius: 0 },
      ],
      unit: "kg",
    });
  }
  container.querySelector("#b-save").addEventListener("click", async () => {
    const weight = container.querySelector("#b-weight").value;
    const waist = container.querySelector("#b-waist").value;
    try {
      await api("PUT", "/api/body", { day: container.querySelector("#b-day").value, weight_kg: weight ? Number(weight) : null, waist_cm: waist ? Number(waist) : null });
      toast("Body values saved");
      const fresh = await api("GET", "/api/dashboard?today=" + todayIso());
      renderBody(container, fresh);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}
