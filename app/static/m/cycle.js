import { api, esc, toast, openModal, confirmModal, todayIso, formatDay, num, cssVar, state, onCleanup } from "../js/core.js?v=cycle2";
let topFn = () => {};
let healthHref = "#/more/health";

export function configureCycle(options) {
  if (options.setTop) topFn = options.setTop;
  if (options.healthHref) healthHref = options.healthHref;
}

const SCALE_SYMPTOM = ["None", "Mild", "Medium", "Strong"];
const SCALE_FLOW = ["None", "Light", "Medium", "Heavy"];
const SCALE_FIVE = ["1", "2", "3", "4", "5"];
const SYMPTOM_FIELDS = [
  ["cramps", "Cramps", SCALE_SYMPTOM],
  ["back_pain", "Back pain", SCALE_SYMPTOM],
  ["headache", "Headache", SCALE_SYMPTOM],
  ["bloating", "Bloating", SCALE_SYMPTOM],
  ["flow", "Flow", SCALE_FLOW],
];
const LEVEL_TEXT = {
  none: "Normal workout today",
  light: "Slightly lighter workout",
  moderate: "Clearly lighter workout",
  rest: "Recovery day",
};
const TOKEN_KEY = "health-token";

export async function cycleState() {
  if (!state.user || state.user.sex !== "female") return { eligible: false };
  try {
    return await api("GET", "/api/cycle/state?day=" + todayIso());
  } catch (error) {
    return { eligible: false };
  }
}

function dayLabel(iso) {
  return formatDay(iso, false);
}

function predictionText(prediction) {
  if (!prediction) return "";
  const days = prediction.days_until;
  const when = days > 1 ? "in about " + days + " days" : days === 1 ? "tomorrow" : days === 0 ? "today" : "about " + Math.abs(days) + " days ago";
  return "Next period expected " + when + " (" + dayLabel(prediction.window_start) + " to " + dayLabel(prediction.window_end) + ")" +
    (prediction.confidence === "low" ? ", rough guess until more cycles are logged" : "");
}

export function cycleCardHtml(cycle, compact) {
  if (!cycle || !cycle.eligible) return "";
  if (cycle.active) {
    const level = cycle.level ? LEVEL_TEXT[cycle.level] : "";
    return '<section class="m-card cycle-card on" id="cycle-card"><div class="m-card-head"><h2>Period mode</h2><span class="cycle-pill">Day ' + cycle.period_day + "</span></div>" +
      '<label class="cycle-switch"><span><b>I am on my period</b><br><span class="small muted">' + esc(level || "Tell us how you feel to tune today's workout") + "</span></span>" +
      '<input type="checkbox" id="cycle-toggle" checked><i></i></label>' +
      '<div class="m-row-actions"><button class="btn" id="cycle-checkin">' + (cycle.checkin ? "Update how I feel" : "How do I feel?") + "</button>" +
      '<a class="btn" href="' + healthHref + '">Health</a></div></section>';
  }
  const prediction = predictionText(cycle.prediction);
  return '<section class="m-card cycle-card' + (cycle.due_soon ? " due" : "") + '" id="cycle-card"><div class="m-card-head"><h2>Period mode</h2>' +
    (compact ? "" : '<a href="' + healthHref + '">Health</a>') + "</div>" +
    '<label class="cycle-switch"><span><b>I am on my period</b><br><span class="small muted">' + esc(prediction || "Turn on to get a workout that fits how you feel") + "</span></span>" +
    '<input type="checkbox" id="cycle-toggle"><i></i></label></section>';
}

export function mountCycleCard(view, cycle, onChange) {
  const toggle = view.querySelector("#cycle-toggle");
  if (!toggle) return;
  toggle.addEventListener("change", async () => {
    if (toggle.checked) {
      toggle.checked = false;
      const saved = await checkinSheet(null, true);
      if (saved) onChange();
      return;
    }
    const ok = await confirmModal("Turn off period mode", "Your normal program comes back right away. The period is saved as ending today.", "Turn off");
    if (!ok) {
      toggle.checked = true;
      return;
    }
    try {
      await api("POST", "/api/cycle/stop", { day: todayIso() });
      toast("Back to your normal program");
      onChange();
    } catch (error) {
      toggle.checked = true;
      toast(error.message, "error");
    }
  });
  const checkin = view.querySelector("#cycle-checkin");
  if (checkin) checkin.addEventListener("click", async () => {
    const saved = await checkinSheet(cycle.checkin, false);
    if (saved) onChange();
  });
}

function scaleHtml(field, label, options, value, offset) {
  return '<div class="cycle-scale"><span>' + esc(label) + '</span><div class="cycle-seg" data-field="' + field + '">' +
    options.map((text, index) => '<button type="button" data-value="' + (index + offset) + '" aria-pressed="' + (value === index + offset) + '">' + esc(text) + "</button>").join("") +
    "</div></div>";
}

export function checkinSheet(existing, starting) {
  const current = existing || { energy: null, cramps: 0, back_pain: 0, headache: 0, bloating: 0, flow: 1, sleep: null, mood: null, note: "" };
  return new Promise((resolve) => {
    let done = false;
    const modal = openModal('<div class="modal-head"><h2>' + (starting ? "Period started" : "How do you feel today?") + "</h2></div>" +
      '<p class="small muted">Your answers only shape today\'s workout and your private health page. Nobody else sees them.</p>' +
      scaleHtml("energy", "Energy (1 is empty, 5 is great)", SCALE_FIVE, current.energy, 1) +
      SYMPTOM_FIELDS.map(([field, label, options]) => scaleHtml(field, label, options, current[field] ?? 0, 0)).join("") +
      '<details class="cycle-more"><summary>Sleep, mood and a note</summary>' +
      scaleHtml("sleep", "Sleep last night", SCALE_FIVE, current.sleep, 1) +
      scaleHtml("mood", "Mood", SCALE_FIVE, current.mood, 1) +
      '<label class="field"><span>Note</span><input type="text" id="cy-note" maxlength="300" value="' + esc(current.note || "") + '"></label></details>' +
      '<div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cy-save">' + (starting ? "Turn on" : "Save") + "</button></div>",
      { onClose: () => { if (!done) resolve(false); } });
    const root = modal.element;
    const values = { ...current };
    root.querySelectorAll(".cycle-seg").forEach((group) => {
      group.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        const field = group.dataset.field;
        const value = Number(button.dataset.value);
        const optional = field === "sleep" || field === "mood";
        values[field] = optional && values[field] === value ? null : value;
        group.querySelectorAll("button").forEach((other) => other.setAttribute("aria-pressed", String(Number(other.dataset.value) === values[field])));
      }));
    });
    root.querySelector("#cy-save").addEventListener("click", async () => {
      if (!values.energy) {
        toast("Pick your energy first", "error");
        return;
      }
      const checkin = {
        day: todayIso(), energy: values.energy, cramps: values.cramps || 0, back_pain: values.back_pain || 0, headache: values.headache || 0,
        bloating: values.bloating || 0, flow: values.flow || 0, sleep: values.sleep ?? null, mood: values.mood ?? null, note: root.querySelector("#cy-note").value.trim(),
      };
      try {
        if (starting) await api("POST", "/api/cycle/start", { day: todayIso(), checkin });
        else await api("PUT", "/api/cycle/checkin", checkin);
        done = true;
        modal.close();
        resolve(true);
        toast(starting ? "Period mode is on" : "Saved");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

function changeTag(item) {
  if (item.change === "swapped") return '<span class="cycle-tag swap">instead of ' + esc(item.replaces || "") + "</span>";
  if (item.change === "added") return '<span class="cycle-tag swap">new today</span>';
  if (item.change === "lighter") return '<span class="cycle-tag">lighter</span>';
  return "";
}

function planItemHtml(item) {
  const amount = item.measure === "min" ? (item.rep_min || "") + (item.rep_max && item.rep_max !== item.rep_min ? " to " + item.rep_max : "") + " min"
    : item.sets + " × " + (item.rep_min ? item.rep_min + (item.rep_max && item.rep_max !== item.rep_min ? " to " + item.rep_max : "") : esc(item.target || "free")) +
      (item.measure === "sec" ? " s" : "");
  return '<div class="m-item"><span class="grow"><b>' + esc(item.name) + " " + changeTag(item) + "</b><span>" + amount +
    (item.target_weight ? " at " + item.target_weight + " kg" : "") + (item.rest_seconds ? ", rest " + item.rest_seconds + " s" : "") + "</span>" +
    (item.cue ? '<span class="cycle-cue">' + esc(item.cue) + "</span>" : "") + "</span></div>";
}

export async function mountAdjustedPlan(view, programId, startWorkout) {
  const cycle = await cycleState();
  if (!cycle.eligible || !cycle.active) return;
  const holder = document.createElement("section");
  holder.className = "m-card cycle-plan";
  holder.innerHTML = '<div class="m-card-head"><h2>Today, adjusted</h2><span class="cycle-pill">Day ' + cycle.period_day + '</span></div><p class="small muted">Your coach is tuning this workout to how you feel...</p>';
  view.prepend(holder);
  if (!cycle.checkin) {
    holder.innerHTML = '<div class="m-card-head"><h2>Today, adjusted</h2><span class="cycle-pill">Day ' + cycle.period_day + "</span></div>" +
      '<p class="small muted">Tell your coach how you feel and this workout gets tuned for today.</p><button class="btn primary" id="cy-feel">How do I feel?</button>';
    holder.querySelector("#cy-feel").addEventListener("click", async () => {
      if (await checkinSheet(null, false)) {
        holder.remove();
        mountAdjustedPlan(view, programId, startWorkout);
      }
    });
    return;
  }
  const draw = (plan) => {
    holder.innerHTML = '<div class="m-card-head"><h2>Today, adjusted</h2><span class="cycle-pill">' + esc(LEVEL_TEXT[plan.level] || "") + "</span></div>" +
      (plan.note ? "<p>" + esc(plan.note) + "</p>" : "") +
      (plan.advice && plan.advice.length ? '<div class="cycle-advice">' + plan.advice.map((line) => "<p>" + esc(line) + "</p>").join("") + "</div>" : "") +
      '<div class="m-list">' + plan.items.map(planItemHtml).join("") + "</div>" +
      '<p class="small muted">' + (plan.source === "ai" ? "Tuned by your AI coach within safe limits." : "Tuned by the built in rules" + (plan.ai_error ? " because the AI coach was not available." : ".")) +
      " Your saved program is not changed.</p>" +
      (plan.level === "none" ? "" : '<button class="btn primary m-btn-xl" id="cy-start">Start adjusted workout</button>') +
      '<div class="m-row-actions"><button class="btn" id="cy-update">Update how I feel</button><button class="btn" id="cy-again">Ask the coach again</button></div>';
    const start = holder.querySelector("#cy-start");
    if (start) start.addEventListener("click", () => startWorkout());
    holder.querySelector("#cy-update").addEventListener("click", async () => {
      if (await checkinSheet(cycle.checkin, false)) {
        holder.remove();
        mountAdjustedPlan(view, programId, startWorkout);
      }
    });
    holder.querySelector("#cy-again").addEventListener("click", () => load(true));
  };
  const load = async (fresh) => {
    holder.querySelector("p") && (holder.querySelector("p").textContent = "Your coach is tuning this workout to how you feel...");
    try {
      const plan = await api("POST", "/api/cycle/plan/" + programId + "?day=" + todayIso() + (fresh ? "&fresh=true" : ""));
      if (plan.active) draw(plan);
      else holder.remove();
    } catch (error) {
      holder.innerHTML = '<p class="small muted">The adjusted plan could not be loaded: ' + esc(error.message) + "</p>";
    }
  };
  load(false);
}

function token() {
  try {
    return sessionStorage.getItem(TOKEN_KEY + "-" + state.userId) || "";
  } catch (error) {
    return "";
  }
}

function setToken(value) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY + "-" + state.userId, value);
    else sessionStorage.removeItem(TOKEN_KEY + "-" + state.userId);
  } catch (error) {}
}

async function healthApi(method, path, body) {
  const options = { method, headers: { "X-User-Id": String(state.userId), "X-Health-Token": token() } };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  if (response.status === 423) {
    setToken("");
    const error = new Error("locked");
    error.locked = true;
    throw error;
  }
  if (!response.ok) {
    let message = "Request failed (" + response.status + ")";
    try {
      const data = await response.json();
      if (data && typeof data.detail === "string") message = data.detail;
    } catch (error) {}
    throw new Error(message);
  }
  return response.json();
}

export async function renderHealth(view) {
  topFn({ title: "Health", back: "#/more" });
  const cycle = await cycleState();
  if (!cycle.eligible) {
    view.innerHTML = '<div class="empty">This page is only available for female profiles.</div>';
    return;
  }
  if (!token()) {
    renderGate(view, cycle.pin_set);
    return;
  }
  let data;
  try {
    data = await healthApi("GET", "/api/cycle/health");
  } catch (error) {
    if (error.locked) {
      renderGate(view, true);
      return;
    }
    throw error;
  }
  topFn({ title: "Health", back: "#/more", action: { label: "Lock", run: () => { setToken(""); renderHealth(view); } } });
  drawHealth(view, data);
}

function renderGate(view, pinSet) {
  view.innerHTML = '<section class="m-card"><h2>' + (pinSet ? "Enter your health PIN" : "Protect your health page") + "</h2>" +
    '<p class="small muted">' + (pinSet ? "This page is private to you." : "Pick a PIN with 4 to 8 digits. Nobody else, not even the server admin in the app, can open this page without it.") + "</p>" +
    '<input type="password" inputmode="numeric" autocomplete="off" id="hp-pin" maxlength="8" placeholder="PIN">' +
    (pinSet ? "" : '<input type="password" inputmode="numeric" autocomplete="off" id="hp-pin2" maxlength="8" placeholder="Repeat PIN">') +
    '<button class="btn primary m-btn-xl" id="hp-go">' + (pinSet ? "Unlock" : "Set PIN") + "</button></section>";
  const go = async () => {
    const pin = view.querySelector("#hp-pin").value.trim();
    try {
      if (pinSet) {
        const result = await api("POST", "/api/cycle/unlock", { pin });
        setToken(result.token);
      } else {
        if (!/^\d{4,8}$/.test(pin)) return toast("Use 4 to 8 digits", "error");
        if (pin !== view.querySelector("#hp-pin2").value.trim()) return toast("The PINs do not match", "error");
        const result = await api("POST", "/api/cycle/pin", { pin });
        setToken(result.token);
      }
      renderHealth(view);
    } catch (error) {
      toast(error.message, "error");
    }
  };
  view.querySelector("#hp-go").addEventListener("click", go);
  view.querySelector("#hp-pin").addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
}

function tile(label, value, unit) {
  return '<div class="m-stat"><span>' + esc(label) + "</span><b>" + (value === null || value === undefined ? "–" : esc(String(value)) + (unit ? "<small>" + esc(unit) + "</small>" : "")) + "</b></div>";
}

function heatColor(value, max, good) {
  if (value === null || value === undefined) return "transparent";
  const share = Math.max(0, Math.min(1, value / max));
  const strength = good ? 1 - share : share;
  return "color-mix(in srgb, var(--plate-red, #e5484d) " + Math.round(strength * 85) + "%, var(--iron-3))";
}

function drawHealth(view, data) {
  const summary = data.summary;
  const prediction = data.prediction;
  const symptomRows = [["energy", "Energy", 5, true], ["cramps", "Cramps", 3], ["back_pain", "Back", 3], ["headache", "Head", 3], ["bloating", "Bloating", 3], ["flow", "Flow", 3], ["mood", "Mood", 5, true], ["sleep", "Sleep", 5, true]];
  const mapDays = data.symptom_map.filter((entry) => entry.cycle_day <= 35);
  const phaseHasData = data.phases.some((phase) => phase.strength !== null || phase.energy !== null || phase.effort !== null);
  view.innerHTML =
    (data.flags.length ? '<section class="m-card cycle-flags"><h2>Worth a look</h2>' + data.flags.map((flag) => "<p>" + esc(flag) + "</p>").join("") +
      '<p class="small muted">These notes come from simple rules on your own logs. They are not a diagnosis.</p></section>' : "") +
    '<section class="m-card"><div class="m-card-head"><h2>Next period</h2></div>' +
    (prediction ? "<p><b>" + esc(dayLabel(prediction.next_start)) + "</b>, likely between " + esc(dayLabel(prediction.window_start)) + " and " + esc(dayLabel(prediction.window_end)) + ".</p>" +
      '<p class="small muted">' + (prediction.based_on ? "Based on " + prediction.based_on + " cycle" + (prediction.based_on === 1 ? "" : "s") + "." : "Based on a typical 28 day cycle until you log more.") + "</p>"
      : '<p class="small muted">Log your first period to see a forecast. You can also add past periods below.</p>') + "</section>" +
    '<section class="m-stat-row">' + tile("Cycle", summary.average_cycle, "days") + tile("Period", summary.average_period, "days") +
    tile("Range", summary.shortest !== null ? summary.shortest + " to " + summary.longest : null, "days") + tile("Pattern", summary.regularity) + "</section>" +
    (data.lengths.length >= 2 ? '<section class="m-card"><h2>Cycle length</h2><div class="cycle-chart"><canvas id="cy-lengths"></canvas></div></section>' : "") +
    '<section class="m-card"><h2>Your symptoms by cycle day</h2>' +
    (mapDays.length ? '<div class="cycle-heat" style="--days:' + mapDays.length + '"><span></span>' + mapDays.map((entry) => "<em>" + entry.cycle_day + "</em>").join("") +
      symptomRows.map(([key, label, max, good]) => "<span>" + label + "</span>" + mapDays.map((entry) => '<i title="' + label + " day " + entry.cycle_day + ": " + (entry[key] ?? "no data") +
        '" style="background:' + heatColor(entry[key], max, good) + '"></i>').join("")).join("") + "</div>" +
      '<p class="small muted">Darker means stronger symptoms, or lower energy, mood and sleep.</p>'
      : '<p class="small muted">Fill in "How do I feel?" on period days to see your own pattern here.</p>') + "</section>" +
    '<section class="m-card"><h2>Training across your cycle</h2>' +
    (phaseHasData ? '<div class="cycle-table"><div class="head"><span>Cycle days</span><span>Strength</span><span>Effort</span><span>Energy</span></div>' +
      data.phases.map((phase) => "<div><span>" + esc(phase.label) + '<small>' + phase.sessions + " workouts</small></span><span>" + (phase.strength !== null ? num(phase.strength, 0) + " %" : "–") + "</span><span>" +
        (phase.effort !== null ? num(phase.effort, 1) : "–") + "</span><span>" + (phase.energy !== null ? num(phase.energy, 1) : "–") + "</span></div>").join("") + "</div>" +
      '<p class="small muted">Strength is your normal workouts compared with your own typical level (100 %). Adjusted period workouts are left out so they do not pull the numbers down.</p>'
      : '<p class="small muted">After a few cycles with workouts you will see here whether your training changes across your cycle. For most women it does not change much.</p>') + "</section>" +
    '<section class="m-card"><div class="m-card-head"><h2>Coach review</h2></div><div id="cy-insight">' + insightHtml(data.insight) + "</div>" +
    '<button class="btn" id="cy-insight-go">' + (data.insight ? "New review" : "Write my review") + "</button></section>" +
    '<section class="m-card"><div class="m-card-head"><h2>Periods</h2><button class="link" id="cy-add">Add past period</button></div>' +
    (data.cycles.length ? '<div class="m-list">' + data.cycles.map((cycle) => '<button class="m-item" data-period="' + cycle.id + '"><span class="grow"><b>' + esc(dayLabel(cycle.start)) +
      (cycle.end ? " to " + esc(dayLabel(cycle.end)) : ", ongoing") + "</b><span>" + (cycle.period_length ? cycle.period_length + " days" : "") +
      (cycle.cycle_length ? (cycle.period_length ? ", " : "") + "cycle " + cycle.cycle_length + " days" : "") + '</span></span><span class="chev">›</span></button>').join("") + "</div>"
      : '<p class="small muted">No periods logged yet.</p>') + "</section>" +
    '<section class="m-card"><h2>Your data</h2><div class="m-row-actions"><button class="btn" id="cy-report">Report for a doctor</button><button class="btn" id="cy-export">Download data</button></div>' +
    '<div class="m-row-actions"><button class="btn" id="cy-pin">Change PIN</button><button class="btn danger" id="cy-erase">Delete all</button></div>' +
    '<p class="small muted">Stored only on your home server. Your cycle never shows up in the team board, summaries or Alexa. The AI coach only gets anonymous numbers, never your name or dates.</p></section>';

  if (data.lengths.length >= 2 && window.Chart) {
    const chart = new window.Chart(view.querySelector("#cy-lengths"), {
      type: "bar",
      data: { labels: data.lengths.map((entry) => dayLabel(entry.start)), datasets: [{ data: data.lengths.map((entry) => entry.length), backgroundColor: cssVar("--action") || "#f2c14e", borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { suggestedMin: 18, suggestedMax: 38, ticks: { color: cssVar("--chalk-3") } }, x: { ticks: { color: cssVar("--chalk-3") } } } },
    });
    onCleanup(() => chart.destroy());
  }
  view.querySelector("#cy-insight-go").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Your coach is reading your numbers...";
    try {
      const insight = await healthApi("POST", "/api/cycle/insight");
      view.querySelector("#cy-insight").innerHTML = insightHtml(insight);
      button.textContent = "New review";
    } catch (error) {
      if (error.locked) return renderHealth(view);
      toast(error.message, "error");
      button.textContent = "Try again";
    }
    button.disabled = false;
  });
  view.querySelector("#cy-add").addEventListener("click", () => periodSheet(null, view));
  view.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", () =>
    periodSheet(data.cycles.find((cycle) => cycle.id === Number(button.dataset.period)), view)));
  view.querySelector("#cy-report").addEventListener("click", () => window.open("/api/cycle/report?token=" + encodeURIComponent(token()) + "&uid=" + state.userId, "_blank"));
  view.querySelector("#cy-export").addEventListener("click", () => { location.href = "/api/cycle/export?token=" + encodeURIComponent(token()) + "&uid=" + state.userId; });
  view.querySelector("#cy-pin").addEventListener("click", () => pinSheet(view));
  view.querySelector("#cy-erase").addEventListener("click", () => eraseSheet(view));
}

function insightHtml(insight) {
  if (!insight) return '<p class="small muted">Your AI coach can look at your logs and point out your personal patterns.</p>';
  return "<p>" + esc(insight.summary) + "</p>" + (insight.points.length ? "<ul class=\"cycle-points\">" + insight.points.map((point) => "<li>" + esc(point) + "</li>").join("") + "</ul>" : "") +
    '<p class="small muted">Written ' + esc(dayLabel(insight.created)) + ". Not medical advice.</p>";
}

function periodSheet(cycle, view) {
  const modal = openModal('<div class="modal-head"><h2>' + (cycle ? "Edit period" : "Add past period") + "</h2></div>" +
    '<div class="form-grid"><label class="field"><span>First day</span><input type="date" id="pp-start" max="' + todayIso() + '" value="' + esc(cycle ? cycle.start : "") + '"></label>' +
    '<label class="field"><span>Last day</span><input type="date" id="pp-end" max="' + todayIso() + '" value="' + esc(cycle && cycle.end ? cycle.end : "") + '"></label></div>' +
    '<div class="modal-foot">' + (cycle ? '<button class="btn danger left" id="pp-delete">Delete</button>' : "") + '<button class="btn primary" id="pp-save">Save</button></div>');
  const root = modal.element;
  root.querySelector("#pp-save").addEventListener("click", async () => {
    const body = { start_day: root.querySelector("#pp-start").value, end_day: root.querySelector("#pp-end").value || null };
    if (!body.start_day) return toast("Pick the first day", "error");
    try {
      await healthApi(cycle ? "PUT" : "POST", "/api/cycle/periods" + (cycle ? "/" + cycle.id : ""), body);
      modal.close();
      renderHealth(view);
    } catch (error) {
      if (error.locked) { modal.close(); return renderHealth(view); }
      toast(error.message, "error");
    }
  });
  const remove = root.querySelector("#pp-delete");
  if (remove) remove.addEventListener("click", async () => {
    try {
      await healthApi("DELETE", "/api/cycle/periods/" + cycle.id);
      modal.close();
      renderHealth(view);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function pinSheet(view) {
  const modal = openModal('<div class="modal-head"><h2>Change PIN</h2></div>' +
    '<input type="password" inputmode="numeric" id="pc-old" maxlength="8" placeholder="Current PIN">' +
    '<input type="password" inputmode="numeric" id="pc-new" maxlength="8" placeholder="New PIN">' +
    '<div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pc-save">Save</button></div>');
  modal.element.querySelector("#pc-save").addEventListener("click", async () => {
    const pin = modal.element.querySelector("#pc-new").value.trim();
    if (!/^\d{4,8}$/.test(pin)) return toast("Use 4 to 8 digits", "error");
    try {
      const result = await api("POST", "/api/cycle/pin", { pin, current_pin: modal.element.querySelector("#pc-old").value.trim() });
      setToken(result.token);
      modal.close();
      toast("PIN changed");
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function eraseSheet(view) {
  const modal = openModal('<div class="modal-head"><h2>Delete all cycle data</h2></div>' +
    '<p class="muted">All periods, check ins, the coach review and your PIN are deleted for good. Your workouts stay.</p>' +
    '<input type="password" inputmode="numeric" id="pe-pin" maxlength="8" placeholder="Your PIN">' +
    '<div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn danger" id="pe-go">Delete</button></div>');
  modal.element.querySelector("#pe-go").addEventListener("click", async () => {
    try {
      await api("POST", "/api/cycle/erase", { pin: modal.element.querySelector("#pe-pin").value.trim() });
      setToken("");
      modal.close();
      toast("Deleted");
      location.hash = "#/";
    } catch (error) {
      toast(error.message, "error");
    }
  });
}
