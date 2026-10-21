import { api, esc, num, todayIso, toIso, relativeDay, state, cssVar, toast, WEEKDAYS, WEEKDAYS_SHORT, logItemHtml, onCleanup } from "../js/core.js?v=cycle2";
import { coachCardHtml, mountCoachCard, weekBarsHtml, coachSays } from "../js/coachui.js?v=cycle2";
import { leaderboardRows, nextGapText } from "../js/views/leaderboard.js?v=cycle2";
import { setTop } from "./app.js?v=cycle2";
import { startWorkout } from "./train.js?v=cycle2";
import { cycleState, cycleCardHtml, mountCycleCard, configureCycle } from "./cycle.js?v=cycle2";

export async function renderToday(view) {
  const today = todayIso();
  setTop({ title: "Hi " + (state.user ? state.user.name : "") });
  const [data, suggestions, board, active, programs, coachToday, cycle] = await Promise.all([
    api("GET", "/api/dashboard?today=" + today),
    api("GET", "/api/suggestions?day=" + today),
    api("GET", "/api/leaderboard?period=week"),
    api("GET", "/api/sessions/active"),
    api("GET", "/api/programs"),
    api("GET", "/api/coach/today?day=" + today).catch(() => null),
    cycleState(),
  ]);
  const suggested = suggestions.options.find((option) => option.suggested);
  const block = data.block;
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const doneDays = new Set(data.heatmap.map((entry) => entry.day));
  const plannedDays = new Set(programs.filter((program) => program.weekday !== null).map((program) => program.weekday));

  let hero;
  if (coachToday) {
    let actions;
    if (active) actions = '<a class="btn primary m-btn-xl" href="#/train">Continue</a>';
    else if (suggested) actions = '<button class="btn primary m-btn-xl" data-start="' + suggested.program.id + '">Start ' + esc(suggested.program.name) + "</button>" +
      (suggestions.options.length > 1 ? '<button class="btn" id="t-other">Pick another workout</button>' : "");
    else actions = suggestions.options.length ? '<button class="btn" id="t-other">Pick a workout</button>' : "";
    hero = coachCardHtml(coachToday, { active, actionsHtml: actions });
  } else if (active) {
    hero = '<section class="m-hero"><div class="when">Workout in progress</div><h1>' + esc(active.program_name) + '</h1><a class="btn primary m-btn-xl" href="#/train">Continue</a></section>';
  } else if (suggested) {
    const program = suggested.program;
    hero = '<section class="m-hero"><div class="when">' + WEEKDAYS[(new Date().getDay() + 6) % 7] + ", week " + block.week + " of " + block.weeks +
      (block.deload ? ", deload" : "") + "</div><h1>" + esc(program.name) + '</h1><div class="meta"><div><b>' + program.items.length + "</b>exercises</div><div><b>" +
      (block.deload ? Math.ceil(program.total_sets / 2) : program.total_sets) + "</b>sets</div><div><b>" + esc(suggested.last_done_before ? relativeDay(suggested.last_done_before) : "new") + "</b>last time</div></div>" +
      '<button class="btn primary m-btn-xl" data-start="' + program.id + '">Start workout</button>' +
      (suggestions.options.length > 1 ? '<button class="btn" id="t-other">Pick another workout</button>' : "") + "</section>";
  } else {
    hero = '<section class="m-hero"><div class="when">' + esc(state.user.status === "ready" ? "No program yet" : "Your program is being written") + "</div><h1>Welcome</h1>" +
      '<p class="muted">' + esc(state.user.status_message || "The AI coach writes your program as soon as it is ready.") + "</p></section>";
  }

  const index = data.strength_index;
  const lastIndex = index[index.length - 1];
  view.innerHTML = hero + cycleCardHtml(cycle, false) +
    '<section class="week-strip">' + WEEKDAYS_SHORT.map((label, offset) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + offset);
      const iso = toIso(day);
      const done = doneDays.has(iso);
      return '<div class="' + (iso === today ? "is-today" : "") + '"><span>' + label + '</span><i class="' + (done ? "done" : plannedDays.has(offset) ? "planned" : "") + '"></i></div>';
    }).join("") + "</section>" +
    '<section class="m-stat-row"><div class="m-stat"><span>Strength</span><b>' + (lastIndex ? num(lastIndex.value, 0) + "<small>%</small>" : "–") + '</b></div>' +
    '<div class="m-stat"><span>This week</span><b>' + data.stats.this_week + '<small>workouts</small></b></div>' +
    '<div class="m-stat"><span>Cardio 7 days</span><b>' + num(data.cardio.minutes, 0) + "<small>/ " + data.cardio.target + ' min</small></b></div>' +
    '<div class="m-stat"><span>Streak</span><b>' + data.stats.streak_weeks + "<small>weeks</small></b></div></section>" +
    (coachToday ? '<section class="m-card"><div class="m-card-head"><h2>This week</h2><a href="#/progress">Progress</a></div>' +
      (coachSays(coachToday.week) ? '<p class="wk-say">' + esc(coachSays(coachToday.week)) + "</p>" : "") + weekBarsHtml(coachToday.week) + "</section>" : "") +
    '<section class="m-card"><div class="m-card-head"><h2>This week\'s race</h2><a href="#/more/leaderboard">All</a></div>' + leaderboardRows(board.rows.slice(0, 5), true) +
    '<p class="small muted">' + esc(nextGapText(board.rows)) + "</p></section>" +
    '<section class="m-card"><div class="m-card-head"><h2>Body weight</h2></div><div class="m-edit-row"><input type="number" inputmode="decimal" step="0.1" id="t-weight" placeholder="kg today" value="' +
    esc((data.body.find((entry) => entry.day === today) || {}).weight_kg ?? "") + '"><button class="btn primary" id="t-save-weight">Save</button></div>' +
    (data.body_trend && data.body_trend.avg7 ? '<p class="small muted">7 day average ' + num(data.body_trend.avg7) + " kg" + (data.body_trend.weekly_rate !== null ? ", " + (data.body_trend.weekly_rate > 0 ? "+" : "") + num(data.body_trend.weekly_rate * 100, 2) + " % per week" : "") + "</p>" : "") + "</section>" +
    (data.log.length ? '<section class="m-card"><div class="m-card-head"><h2>Coach</h2><a href="#/more/coach">All</a></div><div class="feed">' + data.log.slice(0, 3).map((entry) => logItemHtml(entry, false)).join("") + "</div></section>" : "");

  if (coachToday) {
    const card = mountCoachCard(view, coachToday);
    onCleanup(() => card.dispose());
  }
  configureCycle({ setTop, healthHref: "#/more/health" });
  mountCycleCard(view, cycle, () => renderToday(view));
  const start = view.querySelector("[data-start]");
  if (start) start.addEventListener("click", () => startWorkout(today, Number(start.dataset.start)));
  const other = view.querySelector("#t-other");
  if (other) other.addEventListener("click", () => pickWorkout(suggestions.options, today));
  view.querySelector("#t-save-weight").addEventListener("click", async () => {
    const value = view.querySelector("#t-weight").value;
    if (!value) return;
    await api("PUT", "/api/body", { day: today, weight_kg: Number(value), waist_cm: null });
    toast("Weight saved");
  });
}

export function pickWorkout(options, day) {
  import("../js/core.js?v=cycle2").then(({ openModal }) => {
    const modal = openModal('<div class="modal-head"><h2>Choose a workout</h2></div><div class="m-sheet-list">' +
      options.map((option) => '<button class="m-option" data-pick="' + option.program.id + '"><span class="grow"><b>' + esc(option.program.name) + '</b><br><span class="small muted">' +
        esc(option.reason) + ", " + option.program.items.length + " exercises</span></span></button>").join("") +
      '<button class="m-option" data-pick="free"><b>Free workout</b></button></div>');
    modal.element.querySelectorAll("[data-pick]").forEach((button) => button.addEventListener("click", () => {
      modal.close();
      startWorkout(day, button.dataset.pick === "free" ? null : Number(button.dataset.pick));
    }));
  });
}
