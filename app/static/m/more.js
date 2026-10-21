import { mountNutrition } from "../js/nutrition.js?v=cycle2";
import {
  api, esc, num, toast, confirmModal, openModal, loadExercises, loadEquipment, loadPrograms, invalidate, muscleLabel, mediaTag, mediaUrl,
  thumbUrl, createLoopPlayer, logItemHtml, state, setUser, storageGet, storageSet, formatDay, formatSet, onCleanup,
} from "../js/core.js?v=cycle2";
import { avatar, MUSCLE_NAMES, deleteAccount } from "../js/accounts.js?v=cycle2";
import { createBodyViewer } from "../js/anatomy.js?v=cycle2";
import { leaderboardRows, nextGapText, PARTS, CATEGORY_TEXT } from "../js/views/leaderboard.js?v=cycle2";
import { renderReport } from "../js/views/profile.js?v=cycle2";
import { openExerciseEditor } from "../js/views/exercises.js?v=cycle2";
import { openEquipmentEditor, EQUIPMENT_CATEGORIES } from "../js/views/equipment.js?v=cycle2";
import { redesignDialog } from "../js/views/programs.js?v=cycle2";
import { setTop, updateAiBanner, openDesktop, logout } from "./app.js?v=cycle2";
import { rebuildDialog } from "../js/rebuild.js?v=cycle2";
import { renderTrainerSettings } from "../js/views/trainer.js?v=cycle2";

const GOAL_NAMES = { fat_loss: "Lose fat fast", tone: "Tone and shape", muscle: "Build muscle", strength: "Get stronger", health: "Health and fitness" };

function row(href, title, subtitle, lead = "") {
  return '<a class="m-item" href="' + href + '">' + lead + '<span class="grow"><b>' + esc(title) + "</b>" + (subtitle ? "<span>" + esc(subtitle) + "</span>" : "") + '</span><span class="chev">›</span></a>';
}

export async function renderMore(view) {
  setTop({ title: "More" });
  const user = state.user;
  view.innerHTML =
    '<a class="m-card m-profile-card" href="#/more/profile">' + avatar(user, "big") + '<span class="grow"><b>' + esc(user.name) + "</b><span>" +
    esc((GOAL_NAMES[user.goal] || "") + ", " + user.days_per_week + " days a week") + '</span></span><span class="chev">›</span></a>' +
    '<div class="m-list">' +
    row("#/more/leaderboard", "Leaderboard", "Race against everyone in your gym", '<span class="m-ico">🏆</span>') +
    row("#/more/trainer", "My coach", "Choose Max or Lena", '<span class="m-ico">🏅</span>') +
    row("#/more/coach", "Coach log", "Block, deload, goals, log", '<span class="m-ico">🧭</span>') +
    (user.sex === "female" ? row("#/more/health", "Health", "Cycle, symptoms and training, private", '<span class="m-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#e57399" stroke-width="2" stroke-linecap="round"><path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/></svg></span>') : "") +
    "</div>" +
    '<div class="m-list">' +
    row("#/more/exercises", "Exercises", "Loop animations, muscle images, cues", '<span class="m-ico">🎞️</span>') +
    row("#/more/equipment", "Equipment", "What stands in your gym", '<span class="m-ico">🏋️</span>') +
    "</div>" +
    (user.is_superuser ? '<div class="m-list">' + row("#/more/settings", "Settings", "AI key, models, Alexa, app behaviour", '<span class="m-ico">S</span>') + "</div>" : "") +
    '<div class="m-list"><button class="m-item" id="mo-desktop"><span class="m-ico">🖥️</span><span class="grow"><b>Desktop version</b><span>Full layout and projector mode</span></span><span class="chev">›</span></button>' +
    '<button class="m-item" id="mo-switch"><span class="m-ico">👥</span><span class="grow"><b>Switch account</b><span>Back to the account list</span></span><span class="chev">›</span></button></div>';
  view.querySelector("#mo-desktop").addEventListener("click", openDesktop);
  view.querySelector("#mo-switch").addEventListener("click", () => logout());
}

/* Exercises */

export async function renderExercisesList(view) {
  setTop({ title: "Exercises", back: "#/more", action: { label: "New", run: () => openExerciseEditor(null, () => renderExercisesList(view)) } });
  const exercises = await loadExercises(true);
  const filter = { query: storageGet("m-ex-q", ""), scope: storageGet("m-ex-scope", "plan") };
  view.innerHTML = '<input type="search" id="mx-q" placeholder="Search exercises or muscles" value="' + esc(filter.query) + '">' +
    '<div class="m-tabs-inline">' + [["plan", "In my plan"], ["all", "All"], ["nomedia", "Without media"]].map(([key, label]) =>
      '<button data-scope="' + key + '" aria-pressed="' + (filter.scope === key) + '">' + label + "</button>").join("") + "</div>" +
    '<div class="m-list" id="mx-list"></div>';
  const list = view.querySelector("#mx-list");
  const draw = () => {
    const query = filter.query.toLowerCase();
    const shown = exercises.filter((exercise) =>
      (!query || exercise.name.toLowerCase().includes(query) || muscleLabel(exercise.primary_muscle).toLowerCase().includes(query)) &&
      (filter.scope !== "plan" || exercise.program_count > 0) &&
      (filter.scope !== "nomedia" || (!exercise.media_loop && !exercise.media_muscles)));
    shown.sort((a, b) => (b.program_count > 0) - (a.program_count > 0) || a.name.localeCompare(b.name));
    list.innerHTML = shown.slice(0, 150).map((exercise) => {
      let thumb = '<span class="ph">' + esc((muscleLabel(exercise.primary_muscle) || exercise.name).slice(0, 2)) + "</span>";
      if (exercise.media_loop) thumb = mediaTag(exercise.media_loop, 'loading="lazy"');
      else if (exercise.media_muscles) thumb = mediaTag(exercise.media_muscles, 'loading="lazy"');
      else if (exercise.video_id) thumb = '<img src="' + thumbUrl(exercise.video_id) + '" alt="" loading="lazy">';
      const tags = [muscleLabel(exercise.primary_muscle) || "No target muscle"];
      if (exercise.program_count) tags.push("in plan");
      if (!exercise.available) tags.push("equipment missing");
      return '<a class="m-item" href="#/more/exercises/' + exercise.id + '"><span class="thumb">' + thumb + '</span><span class="grow"><b>' + esc(exercise.name) + "</b><span>" +
        esc(tags.join(", ")) + '</span></span><span class="chev">›</span></a>';
    }).join("") || '<div class="empty">Nothing matches.</div>';
  };
  view.querySelector("#mx-q").addEventListener("input", (event) => { filter.query = event.target.value; storageSet("m-ex-q", filter.query); draw(); });
  view.querySelectorAll("[data-scope]").forEach((button) => button.addEventListener("click", () => {
    filter.scope = button.dataset.scope;
    storageSet("m-ex-scope", filter.scope);
    view.querySelectorAll("[data-scope]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    draw();
  }));
  draw();
}

function mediaCard(exercise, kind) {
  const name = kind === "loop" ? exercise.media_loop : exercise.media_muscles;
  const title = kind === "loop" ? "Loop animation" : "Target muscles";
  const hint = kind === "loop" ? "GIF or short video. Record one with your camera." : "Image with the target muscles highlighted.";
  const accept = kind === "loop" ? "image/gif,video/*" : "image/*";
  return '<div class="m-card"><div class="m-card-head"><h2>' + title + "</h2>" + (name ? '<button class="link" data-remove="' + kind + '">Remove</button>' : "") + "</div>" +
    (name ? '<div class="mw-media">' + mediaTag(name) + "</div>" : '<p class="small muted">' + hint + "</p>") +
    '<label class="btn m-btn-xl"><input type="file" hidden accept="' + accept + '" data-upload="' + kind + '">' + (name ? "Replace" : "Upload") + "</label></div>";
}

export async function renderExerciseDetail(view, id) {
  const exercises = await loadExercises(true);
  const exercise = exercises.find((entry) => entry.id === id);
  if (!exercise) {
    view.innerHTML = '<div class="empty">Exercise not found.</div>';
    setTop({ title: "Exercise", back: "#/more/exercises" });
    return;
  }
  setTop({ title: exercise.name, back: "#/more/exercises", action: { label: "Edit", run: () => openExerciseEditor(exercise, () => { invalidate("exercises"); renderExerciseDetail(view, id); }) } });
  const history = await api("GET", "/api/exercises/" + id + "/history").catch(() => ({ entries: [] }));
  const facts = [
    ["Target", muscleLabel(exercise.primary_muscle) || "none"],
    ["Also works", (exercise.secondary_muscles || []).map(muscleLabel).join(", ") || "none"],
    ["Level", ["", "Beginner", "Intermediate", "Advanced"][exercise.difficulty] || ""],
    ["Status", exercise.available ? "Equipment available" : "Equipment missing"],
  ];
  view.innerHTML =
    '<div class="m-card flat">' + facts.map(([label, value]) => '<div class="m-switch-row"><span class="muted">' + label + '</span><b style="text-align:right">' + esc(value) + "</b></div>").join("") + "</div>" +
    (exercise.cues ? '<div class="m-card"><h2>Technique</h2><p>' + esc(exercise.cues).replace(/\n/g, "<br>") + "</p></div>" : "") +
    mediaCard(exercise, "loop") + mediaCard(exercise, "muscles") +
    (!exercise.media_loop && exercise.video_id ? '<div class="m-card"><h2>YouTube fallback</h2><div class="mw-media" id="mx-yt" style="aspect-ratio:16/9"></div></div>' : "") +
    (history.entries.length ? '<div class="m-section-title">Recent workouts</div><div class="m-list">' + history.entries.slice(0, 6).map((entry) =>
      '<a class="m-item" href="#/progress/session/' + entry.session_id + '"><span class="grow"><b>' + esc(formatDay(entry.day, false)) + "</b><span>" +
      esc(entry.sets.map((set) => formatSet(set, entry.measure, entry.track_weight)).join(", ")) + '</span></span><b class="num">' + num(entry.metric) + "</b></a>").join("") + "</div>" : "");

  const yt = view.querySelector("#mx-yt");
  if (yt) createLoopPlayer(yt, exercise.video_id, exercise.video_start || 0, exercise.video_end || 0).then((player) => { if (player) onCleanup(() => player.destroy()); });

  view.querySelectorAll("[data-upload]").forEach((input) => input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    const label = input.closest("label");
    label.classList.add("busy");
    label.lastChild.textContent = "Uploading";
    try {
      await api("POST", "/api/exercises/" + id + "/media/" + input.dataset.upload, data);
      invalidate("exercises");
      toast("Uploaded");
      renderExerciseDetail(view, id);
    } catch (error) {
      toast(error.message, "error");
      label.classList.remove("busy");
      label.lastChild.textContent = "Upload";
    }
  }));
  view.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", async () => {
    const ok = await confirmModal("Remove media", "The file is deleted from the server.", "Remove", true);
    if (!ok) return;
    await api("DELETE", "/api/exercises/" + id + "/media/" + button.dataset.remove);
    invalidate("exercises");
    renderExerciseDetail(view, id);
  }));
}

/* Equipment */

export async function renderEquipmentList(view) {
  setTop({ title: "Equipment", back: "#/more", action: { label: "Add", run: () => openEquipmentEditor(null, () => renderEquipmentList(view)) } });
  const items = await loadEquipment(true);
  const groups = {};
  items.forEach((item) => { (groups[item.category] = groups[item.category] || []).push(item); });
  const available = items.filter((item) => item.available).length;
  view.innerHTML = '<p class="small muted">' + available + " of " + items.length + " available. Switch something off and the AI coach replaces the exercises that need it.</p>" +
    Object.keys(EQUIPMENT_CATEGORIES).filter((key) => groups[key]).map((key) =>
      '<div class="m-section-title">' + EQUIPMENT_CATEGORIES[key] + '</div><div class="m-list">' + groups[key].map((item) =>
        '<div class="m-item' + (item.available ? "" : " off") + '"><button class="m-eq-photo" data-photo="' + item.key + '" aria-label="Photo of ' + esc(item.name) + '">' +
        (item.photo ? '<img src="' + mediaUrl(item.photo) + '" alt="" loading="lazy">' : '<span class="m-ico">📷</span>') + "</button>" +
        '<button class="grow m-plain" data-edit="' + item.key + '"><b>' + esc(item.name) + "</b><span>" +
        esc(item.weights ? item.weights.length + " weights, " + num(item.weights[0]) + " to " + num(item.weights[item.weights.length - 1]) + " kg" : "Used by " + item.exercise_count + " exercises") +
        '</span></button><label class="switch"><input type="checkbox" data-toggle="' + item.key + '"' + (item.available ? " checked" : "") + ' aria-label="' + esc(item.name) + ' available"><span></span></label></div>').join("") + "</div>").join("") +
    '<input type="file" hidden accept="image/*" id="eq-file">';

  const find = (key) => items.find((item) => item.key === key);
  view.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEquipmentEditor(find(button.dataset.edit), () => renderEquipmentList(view))));
  view.querySelectorAll("[data-toggle]").forEach((input) => input.addEventListener("change", async () => {
    const item = find(input.dataset.toggle);
    try {
      const result = await api("PUT", "/api/equipment/" + item.key, {
        name: item.name, key: item.key, category: item.category, available: input.checked, weights: item.weights, notes: item.notes || "",
      });
      invalidate("equipment", "exercises", "programs");
      if (result.swapped && result.swapped.length) toast("Replaced in your plan: " + result.swapped.join(", "));
      else if (result.pending) toast(result.pending, "error");
      else toast(item.name + (input.checked ? " available" : " not available"));
      renderEquipmentList(view);
    } catch (error) {
      toast(error.message, "error");
      input.checked = !input.checked;
    }
  }));
  const fileInput = view.querySelector("#eq-file");
  let target = null;
  view.querySelectorAll("[data-photo]").forEach((button) => button.addEventListener("click", () => {
    const item = find(button.dataset.photo);
    if (!item.photo) {
      target = item;
      fileInput.click();
      return;
    }
    const modal = openModal('<div class="modal-head"><h2>' + esc(item.name) + '</h2></div><div class="mw-media"><img src="' + mediaUrl(item.photo) + '" alt=""></div>' +
      '<div class="modal-foot"><button class="btn danger left" id="ph-remove">Remove</button><button class="btn primary" id="ph-replace">Replace photo</button></div>');
    modal.element.querySelector("#ph-replace").addEventListener("click", () => { target = item; modal.close(); fileInput.click(); });
    modal.element.querySelector("#ph-remove").addEventListener("click", async () => {
      await api("DELETE", "/api/equipment/" + item.key + "/photo");
      invalidate("equipment");
      modal.close();
      renderEquipmentList(view);
    });
  }));
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file || !target) return;
    const data = new FormData();
    data.append("file", file);
    toast("Uploading photo");
    try {
      await api("POST", "/api/equipment/" + target.key + "/photo", data);
      invalidate("equipment");
      toast("Photo saved");
      renderEquipmentList(view);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

/* Coach */

export async function renderCoachMobile(view) {
  setTop({ title: "Coach", back: "#/more" });
  const [coach, programs] = await Promise.all([api("GET", "/api/coach?log_limit=120"), loadPrograms(true)]);
  const block = coach.block;
  const settings = coach.settings;
  const weeks = Array.from({ length: block.weeks }, (_, index) => {
    const week = index + 1;
    const deload = week === block.weeks || (block.early_deload && week >= block.week && block.deload);
    return '<i class="' + [week < block.week ? "done" : "", week === block.week ? "now" : "", deload ? "deload" : ""].join(" ") + '"></i>';
  }).join("");
  view.innerHTML =
    '<section class="m-hero"><div class="when">Block ' + block.number + (block.deload ? ", deload running" : "") + "</div><h1>Week " + block.week + ' <span class="muted" style="font-size:24px">of ' + block.weeks + "</span></h1>" +
    '<div class="m-weeks">' + weeks + '</div><p class="small muted">' + esc(block.deload ? "Half the sets at the same weight this week." : "Deload from " + formatDay(block.deload_from, false) + ".") +
    " Review on " + esc(formatDay(block.end_day, false)) + ".</p></section>" +
    '<div class="m-card"><div class="m-card-head"><h2>AI coach</h2><span class="ai-state" id="mc-ai"><span class="dot" style="background:var(--chalk-3)"></span>checking</span></div>' +
    '<p class="small muted" id="mc-ai-help">' + (settings.ai_provider === "gemini" ? "Runs with Google Gemini." : "Runs locally with Ollama.") + ' Weights follow fixed rules, the AI decides swaps, redesigns and notes inside them.</p>' +
    '<button class="btn" id="mc-ai-test">Check connection</button> <a class="btn" href="/quality">Program quality tests</a></div>' +
    '<div class="m-section-title">Adjust now</div><div class="m-list">' +
    actionItem("progress", "Check progression", coach.pending_sessions ? coach.pending_sessions + " workout(s) not evaluated yet" : "Checks again whether weights should go up") +
    actionItem("review", "Finish block now", "AI review, swaps stalled exercises, new block") +
    actionItem("deload", "Deload now", "One week with half the sets", block.deload) +
    actionItem("fatigue", "I am wiped out", "From week 2 on this starts a deload", block.deload) +
    programs.map((program) => '<button class="m-item" data-redesign="' + program.id + '"><span class="grow"><b>Redesign ' + esc(program.name) + "</b><span>Rebuilt by the AI coach</span></span><span class=\"chev\">›</span></button>").join("") +
    "</div>" +
    '<div id="nu-slot"></div>' +
    '<div class="m-card"><h2>Your goals</h2><span class="small muted">Priority muscles get more weekly sets</span><div class="chips" id="mc-priority">' +
    state.meta.muscles.filter((muscle) => !["cardio", "mobility"].includes(muscle)).map((muscle) =>
      '<button type="button" class="chip" data-muscle="' + muscle + '" aria-pressed="' + settings.priority_muscles.includes(muscle) + '">' + esc(muscleLabel(muscle)) + "</button>").join("") + "</div>" +
    '<div class="m-switch-row"><span>Fat loss focus</span><label class="switch"><input type="checkbox" id="mc-fat"' + (settings.goal_fat_loss ? " checked" : "") + '><span></span></label></div>' +
    '<div class="form-grid"><label class="field"><span>Cardio min per week</span><input type="number" inputmode="numeric" id="mc-cardio" step="10" value="' + settings.cardio_target_min + '"></label>' +
    '<label class="field"><span>Block length</span><select id="mc-weeks">' + [4, 5, 6].map((count) => '<option value="' + count + '"' + (settings.block_weeks === count ? " selected" : "") + ">" + count + " weeks</option>").join("") + "</select></label></div>" +
    '<button class="btn primary m-btn-xl" id="mc-save">Save goals</button></div>' +
    '<div class="m-section-title">Log</div><div class="m-card"><div class="feed" id="mc-log"></div></div>';

  let limit = 15;
  const drawLog = () => {
    const shown = coach.log.slice(0, limit);
    view.querySelector("#mc-log").innerHTML = (shown.length ? shown.map((entry) => logItemHtml(entry, true)).join("") : '<p class="muted">No entries yet.</p>') +
      (coach.log.length > limit ? '<button class="btn ghost" id="mc-more">Show older</button>' : "");
    const more = view.querySelector("#mc-more");
    if (more) more.addEventListener("click", () => { limit += 30; drawLog(); });
    view.querySelectorAll("[data-undo]").forEach((button) => button.addEventListener("click", async () => {
      const ok = await confirmModal("Undo change", "The program goes back to the state before this change.", "Undo");
      if (!ok) return;
      try {
        await api("POST", "/api/coach/log/" + button.dataset.undo + "/undo");
        invalidate("programs");
        toast("Undone");
        renderCoachMobile(view);
      } catch (error) {
        toast(error.message, "error");
      }
    }));
  };
  drawLog();

  const actions = {
    progress: async () => {
      const result = await api("POST", "/api/coach/progress");
      toast(result.changes.length ? result.changes.length + " change(s)" : "No new changes");
    },
    review: async () => {
      const ok = await confirmModal("Finish block", "The block is reviewed now and a new one starts today. The AI coach may need a minute.", "Finish block");
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
      if (result !== false) renderCoachMobile(view);
      else button.disabled = false;
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  }));
  view.querySelectorAll("[data-redesign]").forEach((button) => button.addEventListener("click", () => redesignDialog(Number(button.dataset.redesign), () => renderCoachMobile(view))));
  view.querySelectorAll("#mc-priority [data-muscle]").forEach((chip) => chip.addEventListener("click", () => {
    chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
  }));
  view.querySelector("#mc-save").addEventListener("click", async () => {
    try {
      await api("PUT", "/api/coach/settings", {
        priority_muscles: [...view.querySelectorAll('#mc-priority [aria-pressed="true"]')].map((chip) => chip.dataset.muscle),
        goal_fat_loss: view.querySelector("#mc-fat").checked,
        cardio_target_min: Number(view.querySelector("#mc-cardio").value) || 0,
        block_weeks: Number(view.querySelector("#mc-weeks").value),
      });
      toast("Goals saved. They apply from the next block review.");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  const checkAi = async (fresh) => {
    const target = view.querySelector("#mc-ai");
    const help = view.querySelector("#mc-ai-help");
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
      help.textContent = "Model " + status.model + " is ready.";
    } else if (status.reachable) {
      color = "var(--plate-yellow)";
      text = "not ready";
      help.textContent = status.message || "The AI model is not ready yet.";
    } else {
      help.textContent = status.message || "The AI service is not reachable.";
    }
    target.innerHTML = '<span class="dot" style="background:' + color + '"></span>' + text;
  };
  view.querySelector("#mc-ai-test").addEventListener("click", () => checkAi(true));
  mountNutrition(view.querySelector("#nu-slot"), { mobile: true });
  checkAi(false);
}

function actionItem(key, title, text, disabled) {
  return '<button class="m-item" data-action="' + key + '"' + (disabled ? " disabled" : "") + '><span class="grow"><b>' + esc(title) + "</b><span>" + esc(text) + '</span></span><span class="chev">›</span></button>';
}

/* Leaderboard */

export async function renderBoardMobile(view) {
  setTop({ title: "Leaderboard", back: "#/more" });
  const period = storageGet("board-period", "week");
  const data = await api("GET", "/api/leaderboard?period=" + period);
  const me = data.rows.find((entry) => entry.id === state.userId);
  view.innerHTML =
    '<div class="m-tabs-inline">' + [["week", "This week"], ["month", "This month"], ["all", "All time"]].map(([key, label]) =>
      '<button data-period="' + key + '" aria-pressed="' + (period === key) + '">' + label + "</button>").join("") + "</div>" +
    (me ? '<section class="m-hero"><div class="when">' + esc(data.label) + '</div><h1>#' + me.rank + ' <span class="muted" style="font-size:24px">with ' + me.score + " points</span></h1>" +
      '<p class="small muted">' + esc(nextGapText(data.rows)) + "</p></section>" : "") +
    '<div class="m-card">' + leaderboardRows(data.rows, false) +
    '<div class="board-legend">' + PARTS.map(([, label, color]) => '<span><i style="background:var(' + color + ')"></i>' + label + "</span>").join("") + "</div></div>" +
    '<div class="m-section-title">Category leaders</div><div class="m-list">' + PARTS.map(([key, label]) => {
      const leader = data.categories[key];
      return '<div class="m-item"><span class="grow"><b>' + label + "</b><span>" + (leader ? esc(leader.name + ", " + CATEGORY_TEXT[key](leader.value)) : "open") + "</span></span></div>";
    }).join("") + "</div>" +
    '<div class="m-card flat small muted"><p><b>Consistency, up to 40.</b> Completed workouts compared with the days you planned.</p>' +
    "<p><b>Improvement, up to 30.</b> Growth of your estimated 1RM, relative to your own level.</p>" +
    "<p><b>Personal bests, up to 20.</b> 4 points per new best.</p><p><b>Volume, up to 10.</b> 1 point per 10 working sets.</p></div>";
  view.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", () => {
    storageSet("board-period", button.dataset.period);
    renderBoardMobile(view);
  }));
}

/* Profile */

export async function renderProfileMobile(view, { onLogout }) {
  setTop({ title: "Profile", back: "#/more" });
  const user = await api("GET", "/api/me");
  setUser(user);
  view.innerHTML =
    '<div class="m-profile-head">' + avatar(user, "big") + "<div><h1>" + esc(user.name) + '</h1><span class="muted">' + esc(GOAL_NAMES[user.goal] || user.goal) + ", " +
    user.days_per_week + " days, level " + esc(user.level) + "</span></div></div>" +
    '<div class="m-model" id="mp-model"></div>' +
    '<div class="m-row-actions"><button class="btn" id="mp-front">Front</button><button class="btn" id="mp-back">Back</button></div>' +
    '<p class="small muted">Target muscles: ' + esc(user.priority_muscles.map((muscle) => (MUSCLE_NAMES[muscle] || muscle).replace(/ \(.*\)/, "")).join(", ") || "balanced") + ". Change them under Coach.</p>" +
    (user.plan_summary ? '<div class="m-card"><h2>Coach summary</h2><p>' + esc(user.plan_summary) + "</p></div>" : "") +
    '<div class="m-card"><h2>Details</h2><div class="form-grid">' +
    '<label class="field" style="grid-column:span 2"><span>Name</span><input type="text" id="mp-name" value="' + esc(user.name) + '"></label>' +
    '<label class="field"><span>Age</span><input type="number" inputmode="numeric" id="mp-age" value="' + esc(user.age ?? "") + '"></label>' +
    '<label class="field"><span>Height cm</span><input type="number" inputmode="numeric" id="mp-height" value="' + esc(user.height_cm ?? "") + '"></label>' +
    '<label class="field"><span>Weight kg</span><input type="number" inputmode="decimal" step="0.1" id="mp-weight" value="' + esc(user.weight_kg ?? "") + '"></label>' +
    '<label class="field"><span>Colour</span><input type="color" id="mp-color" value="' + esc(user.color) + '"></label></div>' +
    '<div class="m-switch-row"><span class="muted">BMI</span><b>' + (user.bmi ? num(user.bmi) + " (" + esc(user.bmi_label) + ")" : "–") + "</b></div>" +
    '<button class="btn primary m-btn-xl" id="mp-save">Save</button></div>' +
    '<details class="m-card"><summary><b>Training brief</b> <span class="muted small">what the AI coach received</span></summary><div class="report" id="mp-report"><p class="muted">Loading</p></div></details>' +
    '<button class="btn m-btn-xl" id="mp-regen">New program with your coach</button>' +
    '<button class="btn primary m-btn-xl" id="mp-logout">Log out</button>' +
    '<button class="btn ghost danger" id="mp-delete">Delete account</button>';

  const viewer = await createBodyViewer(view.querySelector("#mp-model"), { sex: user.sex, selected: user.priority_muscles, interactive: false, autoRotate: true, labels: MUSCLE_NAMES });
  if (viewer) {
    onCleanup(() => viewer.destroy());
    view.querySelector("#mp-front").addEventListener("click", () => viewer.front());
    view.querySelector("#mp-back").addEventListener("click", () => viewer.back());
  }
  api("GET", "/api/me/report").then((report) => {
    const target = view.querySelector("#mp-report");
    if (target) target.innerHTML = report.report ? renderReport(report.report) : '<p class="muted">No brief stored for this account.</p>';
  }).catch(() => {});

  view.querySelector("#mp-save").addEventListener("click", async () => {
    const value = (selector) => view.querySelector(selector).value;
    try {
      const updated = await api("PUT", "/api/me", {
        name: value("#mp-name").trim(),
        age: value("#mp-age") ? Number(value("#mp-age")) : null,
        height_cm: value("#mp-height") ? Number(value("#mp-height")) : null,
        weight_kg: value("#mp-weight") ? Number(value("#mp-weight")) : null,
        color: value("#mp-color"),
      });
      setUser(updated);
      toast("Profile saved");
    } catch (error) {
      toast(error.message, "error");
    }
  });
  view.querySelector("#mp-logout").addEventListener("click", onLogout);
  view.querySelector("#mp-delete").addEventListener("click", () => deleteAccount(user, onLogout));
  view.querySelector("#mp-regen").addEventListener("click", () => rebuildDialog());
}


export async function renderTrainerMobile(view) {
  setTop({ title: "My coach", back: "#/more" });
  await renderTrainerSettings(view, { mobile: true });
}
