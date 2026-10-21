import { api, esc, toast, confirmModal, logItemHtml, muscleLabel, state, loadPrograms, invalidate, formatDay, storageGet, storageSet } from "../core.js?v=cycle2";
import { redesignDialog } from "./programs.js?v=cycle2";
import { updateAiBanner } from "../app.js?v=cycle2";
import { mountNutrition } from "../nutrition.js?v=cycle2";

export async function renderCoach(view) {
  const [coach, programs] = await Promise.all([api("GET", "/api/coach?log_limit=200"), loadPrograms(true)]);
  const block = coach.block;
  const settings = coach.settings;
  const filter = storageGet("coach-filter", "all");
  const levels = { all: "Everything", session: "After workouts", block: "Block reviews", deload: "Deload", equipment: "Equipment", manual: "Manual" };

  const timeline = Array.from({ length: block.weeks }, (_, index) => {
    const week = index + 1;
    const isDeload = week === block.weeks || (block.early_deload && week >= block.week && block.deload);
    const classes = [week < block.week ? "done" : "", week === block.week ? "now" : "", isDeload ? "deload" : ""].join(" ");
    return '<div class="' + classes + '"><i></i><span>' + (isDeload ? "Deload" : "Week " + week) + "</span></div>";
  }).join("");

  view.innerHTML =
    '<div class="page-head"><div><h1>Coach</h1><p>Weights go up after every workout. Sets and exercises only change at the end of a block, decided by the local AI coach within fixed rules. The plan stays stable enough to measure progress and still changes before you get stuck.</p></div></div>' +
    '<div class="coach-grid"><div style="display:flex;flex-direction:column;gap:20px">' +
    '<section class="panel"><div class="block-hero"><div><div class="muted">Block ' + block.number + '</div><div class="big">Week ' + block.week + '<span class="muted" style="font-size:var(--step-2)"> / ' + block.weeks + "</span></div>" +
    '<div class="muted small">' + (block.deload ? "Deload running: half the sets at the same weight" : "Deload from " + esc(formatDay(block.deload_from, false))) + ". Review on " + esc(formatDay(block.end_day, false)) + ".</div></div>" +
    '<div class="block-timeline">' + timeline + "</div></div></section>" +

    '<section class="panel"><div class="panel-head"><h2>Adjust now</h2><span class="hint">Otherwise this runs automatically</span></div><div class="action-list">' +
    actionRow("progress", "Check progression", coach.pending_sessions ? coach.pending_sessions + " workout(s) not evaluated yet." : "All workouts are evaluated. Checks again whether weights should go up.", "Check") +
    actionRow("review", "Finish block now", "The AI coach reviews strength and volume right away, swaps stalled exercises and starts a new block.", "Finish") +
    actionRow("deload", "Deload now", "One week with half the sets. Useful when you are sick, travelling or tired for days.", "Start", block.deload) +
    actionRow("fatigue", "I am wiped out", "From week 2 on the coach starts a deload. Before that it is only noted.", "Report", block.deload) +
    programs.map((program) => '<div class="action-row proj-hide"><div><b>'  + esc(program.name) + '</b><p>Let the AI coach rebuild this program from your exercises and equipment.</p></div><button class="btn small" data-redesign="' + program.id + '">Redesign</button></div>').join("") +
    "</div></section>" +

    '<section class="panel"><div class="panel-head"><h2>Log</h2><select id="c-filter" style="max-width:200px">' +
    Object.entries(levels).map(([key, label]) => '<option value="' + key + '"' + (filter === key ? " selected" : "") + ">" + label + "</option>").join("") + "</select></div>" +
    '<div class="feed" id="c-log"></div></section></div>' +

    '<div style="display:flex;flex-direction:column;gap:20px">' +
    '<section class="panel proj-hide"><div class="panel-head"><h2>AI coach</h2><span class="ai-state" id="c-ai-state"><span class="dot" style="background:var(--chalk-3)"></span>checking</span></div>' +
    '<p class="small muted">' + (settings.ai_provider === "gemini" ? "Runs with Google Gemini, so your training data is sent to Google." : "Runs locally with Ollama, nothing leaves your network.") + ' It picks replacement exercises, redesigns programs and writes a note after every workout and every block. Weights and volume limits are always calculated by fixed rules, the AI only decides inside them.</p>' +
    '<div class="form-grid" style="margin-top:14px"><div class="field"><span>AI service</span><div class="num" style="font-size:var(--step-1)">' + esc(settings.ai_provider === "gemini" ? "Google Gemini" : settings.ollama_url) + '</div></div>' +
    '<div class="field"><span>Model</span><div class="num" style="font-size:var(--step-1)">' + esc(settings.ai_model) + "</div></div></div>" +
    '<div id="c-ai-help" class="small muted" style="margin-top:12px"></div>' +
    '<div class="modal-foot" style="margin-top:14px"><button class="btn" id="c-ai-test">Check connection</button> <a class="btn" href="/quality" target="_blank">Program quality tests</a></div></section>' +

    '<div id="nu-slot"></div>' +
    '<section class="panel"><div class="panel-head"><h2>Your goals</h2></div>' +
    '<div class="field"><span>Priority muscles get more volume (14 to 22 sets per week instead of 10 to 20)</span><div class="chips" id="c-priority">' +
    state.meta.muscles.filter((muscle) => !["cardio", "mobility"].includes(muscle)).map((muscle) =>
      '<button type="button" class="chip" data-muscle="' + muscle + '" aria-pressed="' + settings.priority_muscles.includes(muscle) + '">' + esc(muscleLabel(muscle)) + "</button>").join("") + "</div></div>" +
    '<label class="check" style="margin-top:16px"><input type="checkbox" id="c-fat"' + (settings.goal_fat_loss ? " checked" : "") + "> Fat loss, leaner face</label>" +
    '<p class="small faint" style="margin-top:6px">Fat cannot be burned from the face alone. It drops together with total body fat. So the coach raises cardio when your weight stalls and reminds you of the calorie deficit.</p>' +
    '<div class="form-grid" style="margin-top:14px"><label class="field"><span>Cardio target per week, min</span><input type="number" id="c-cardio" min="0" step="10" value="' + settings.cardio_target_min + '"></label>' +
    '<label class="field"><span>Block length</span><select id="c-weeks">' + [4, 5, 6].map((weeks) => '<option value="' + weeks + '"' + (settings.block_weeks === weeks ? " selected" : "") + ">" + weeks + " weeks incl. deload</option>").join("") + "</select></label></div>" +
    '<div class="modal-foot" style="margin-top:16px"><button class="btn primary" id="c-save-goals">Save goals</button></div></section>' +

    '<section class="panel flat proj-hide"><div class="panel-head"><h3>The rules</h3></div><div class="small muted" style="display:flex;flex-direction:column;gap:8px">' +
    "<p>After every workout: hit the top of the rep range in all sets and the weight goes up to the next step you actually own. Fall below the bottom on the first set twice in a row and it goes one step back.</p>" +
    "<p>At the end of a block: sets per muscle move towards 10 to 20 per week, priority muscles up to 22. At most 2 exercise swaps per block, only for stalled exercises and only after a full block.</p>" +
    "<p>Deload: the last week of each block, or earlier when two workouts in a row were clearly weaker.</p>" +
    "<p>Every change can be undone from the log.</p></div></section>" +
    "</div></div>";

  let logLimit = 25;
  const drawLog = () => {
    const level = view.querySelector("#c-filter").value;
    const list = coach.log.filter((entry) => level === "all" || entry.level === level);
    const shown = list.slice(0, logLimit);
    view.querySelector("#c-log").innerHTML = (shown.length ? shown.map((entry) => logItemHtml(entry, true)).join("") : '<p class="muted">No entries yet.</p>') +
      (list.length > logLimit ? '<button class="btn ghost small" id="c-more" style="margin-top:10px">Show older</button>' : "");
    const more = view.querySelector("#c-more");
    if (more) more.addEventListener("click", () => { logLimit += 30; drawLog(); });
    view.querySelectorAll("[data-undo]").forEach((button) => button.addEventListener("click", async () => {
      const ok = await confirmModal("Undo change", "The program goes back to the state before this change. Other changes from the same review are reset as well.", "Undo");
      if (!ok) return;
      try {
        await api("POST", "/api/coach/log/" + button.dataset.undo + "/undo");
        invalidate("programs");
        toast("Undone");
        renderCoach(view);
      } catch (error) {
        toast(error.message, "error");
      }
    }));
  };
  mountNutrition(view.querySelector("#nu-slot"));
  view.querySelector("#c-filter").addEventListener("change", (event) => {
    storageSet("coach-filter", event.target.value);
    drawLog();
  });
  drawLog();

  const actions = {
    progress: async () => {
      const result = await api("POST", "/api/coach/progress");
      toast(result.changes.length ? result.changes.length + " change(s)" : "No new changes");
    },
    review: async () => {
      const ok = await confirmModal("Finish block", "The current block is reviewed now and a new one starts today. This can take a minute while the AI coach thinks.", "Finish block");
      if (!ok) return false;
      toast("AI coach is reviewing the block");
      const result = await api("POST", "/api/coach/review");
      toast(result.summary.join(" · "));
    },
    deload: async () => {
      const result = await api("POST", "/api/coach/deload");
      toast(result.started ? "Deload started" : "Deload already running");
    },
    fatigue: async () => {
      const result = await api("POST", "/api/coach/fatigue");
      toast(result.message);
    },
  };
  view.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await actions[button.dataset.action]();
      invalidate("programs");
      if (result !== false) renderCoach(view);
      else button.disabled = false;
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  }));
  view.querySelectorAll("[data-redesign]").forEach((button) => button.addEventListener("click", () => redesignDialog(Number(button.dataset.redesign), () => renderCoach(view))));

  view.querySelectorAll("#c-priority [data-muscle]").forEach((chip) => chip.addEventListener("click", () => {
    chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
  }));
  view.querySelector("#c-save-goals").addEventListener("click", async () => {
    try {
      await api("PUT", "/api/coach/settings", {
        priority_muscles: [...view.querySelectorAll('#c-priority [aria-pressed="true"]')].map((chip) => chip.dataset.muscle),
        goal_fat_loss: view.querySelector("#c-fat").checked,
        cardio_target_min: Number(view.querySelector("#c-cardio").value) || 0,
        block_weeks: Number(view.querySelector("#c-weeks").value),
      });
      toast("Goals saved. They apply from the next block review.");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  const checkAi = async (fresh) => {
    const target = view.querySelector("#c-ai-state");
    const help = view.querySelector("#c-ai-help");
    target.innerHTML = '<span class="dot" style="background:var(--chalk-3)"></span>checking';
    const status = await updateAiBanner(fresh);
    if (!status) {
      target.textContent = "unknown";
      return;
    }
    let color = "var(--plate-red)";
    let text = "offline";
    if (status.ready) {
      color = "var(--plate-green)";
      text = "ready";
      help.textContent = "Installed models: " + status.models.join(", ");
    } else if (status.reachable) {
      color = "var(--plate-yellow)";
      text = "not ready";
      help.textContent = status.message || "The AI model is not ready yet.";
    } else {
      help.textContent = status.message || "The AI service is not reachable.";
    }
    target.innerHTML = '<span class="dot" style="background:' + color + '"></span>' + text;
  };
  view.querySelector("#c-ai-test").addEventListener("click", () => checkAi(true));
  checkAi(false);
}

function actionRow(key, title, text, label, disabled) {
  return '<div class="action-row"><div><b>' + esc(title) + "</b><p>" + esc(text) + '</p></div><button class="btn small" data-action="' + key + '"' + (disabled ? " disabled" : "") + ">" + esc(label) + "</button></div>";
}
