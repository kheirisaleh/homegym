import { api, esc, num, muscleLabel } from "./core.js?v=cycle2";
import { mountCoachStage, COACHES } from "./coach3d.js?v=cycle2";

export function weekBarsHtml(week) {
  if (!week || !week.rows.length) return '<p class="muted small">Your weekly muscle plan appears here once you have a program.</p>';
  const rows = week.rows.map((row) => {
    const share = row.planned ? Math.min(1, row.done / row.planned) : 1;
    const left = Math.max(0, row.planned - row.done);
    const state = row.done >= row.planned ? "done" : share >= 0.5 ? "half" : "open";
    return '<div class="wk-row ' + state + (row.priority ? " prio" : "") + '"><span class="wk-name">' + (row.priority ? '<i title="Priority">★</i>' : "") + esc(muscleLabel(row.muscle)) + "</span>" +
      '<span class="wk-bar"><b style="width:' + Math.round(share * 100) + '%"></b></span>' +
      '<span class="wk-num">' + num(row.done, 0) + "<small>/" + num(row.planned, 0) + "</small></span>" +
      '<span class="wk-left">' + (left <= 0 ? "done" : num(left, 0) + " left") + "</span></div>";
  }).join("");
  return '<div class="wk-bars">' + rows + '</div><p class="wk-foot small muted">Hard sets this week (Monday to Sunday) against your program. ' +
    (week.days_left ? week.days_left + " day" + (week.days_left === 1 ? "" : "s") + " left this week." : "Last day of the week.") + "</p>";
}

export function coachSays(week, persona) {
  if (!week || !week.rows.length) return "";
  const behind = week.rows.filter((row) => row.priority && row.done < row.planned * 0.5 && week.days_left <= 3);
  const doneAll = week.rows.every((row) => row.done >= row.planned);
  if (doneAll) return "Every muscle hit its weekly target. That is a complete week.";
  if (behind.length) return "Your priority " + behind.map((row) => muscleLabel(row.muscle).toLowerCase()).join(" and ") + " still need work this week.";
  const best = week.rows.filter((row) => row.done >= row.planned && row.planned > 0).map((row) => muscleLabel(row.muscle).toLowerCase());
  if (best.length) return "Done for the week: " + best.slice(0, 3).join(", ") + ".";
  return "Fresh week. Every session moves these bars.";
}

export function coachCardHtml(today, options = {}) {
  const persona = today.persona;
  const brief = today.brief;
  const program = today.program;
  const coach = COACHES[persona.coach] || COACHES.max;
  let body;
  if (options.active) {
    body = "<h2>Workout in progress</h2><p>" + esc(options.active.program_name) + " is waiting for you. Let's finish what we started.</p>";
  } else if (brief) {
    body = "<h2>" + esc(brief.title) + "</h2><p>" + esc(brief.message) + "</p>" +
      (brief.points && brief.points.length ? '<ul class="cc-points">' + brief.points.map((point) => "<li>" + esc(point) + "</li>").join("") + "</ul>" : "");
  } else if (program) {
    const when = new Date(today.program_day + "T12:00:00").toLocaleDateString("en", { weekday: "long" });
    body = "<h2>Rest day</h2><p>No session planned today. Next up: <b>" + esc(program.name) + "</b> on " + esc(when) + ". Walk, stretch and sleep well.</p>";
  } else {
    body = "<h2>Let's build your plan</h2><p>Once you have a program I brief you before every workout.</p>";
  }
  return '<section class="coach-card-home" style="--coach-color:' + esc(coach.color) + '">' +
    '<div class="cc-stage" id="cc-stage"></div>' +
    '<div class="cc-bubble"><div class="cc-tag"><b>' + esc(coach.name) + "</b><span>" + esc(coach.title) + "</span></div>" + body +
    '<div class="cc-actions">' + (options.actionsHtml || "") + "</div></div></section>";
}

export function mountCoachCard(root, today) {
  const stage = root.querySelector("#cc-stage");
  if (!stage) return { dispose() {} };
  const mounted = mountCoachStage(stage, today.persona.coach, { framing: "portrait" });
  stage.addEventListener("click", () => mounted.greet());
  return mounted;
}

export function restCoachTip(container, sessionExerciseId) {
  if (!container || !sessionExerciseId) return;
  api("GET", "/api/session-exercises/" + sessionExerciseId + "/tip").then((tip) => {
    if (!tip || !tip.tips.length || !container.isConnected) return;
    const coach = COACHES[tip.persona.coach] || COACHES.max;
    container.innerHTML = '<div class="rest-coach" style="--coach-color:' + esc(coach.color) + '"><span class="avatar">' + esc(coach.name[0]) + "</span><div><b>" + esc(coach.name) + "</b>" +
      tip.tips.map((line) => "<p>" + esc(line) + "</p>").join("") + "</div></div>";
  }).catch(() => {});
}
