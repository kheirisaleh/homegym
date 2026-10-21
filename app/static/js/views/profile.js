import { api, esc, num, toast, setUser, confirmModal, onCleanup } from "../core.js?v=cycle2";
import { avatar, MUSCLE_NAMES, deleteAccount } from "../accounts.js?v=cycle2";
import { createBodyViewer } from "../anatomy.js?v=cycle2";
import { rebuildDialog } from "../rebuild.js?v=cycle2";

const GOAL_NAMES = { fat_loss: "Lose fat fast", tone: "Tone and shape", muscle: "Build muscle", strength: "Get stronger", health: "Health and fitness" };
const EXPERIENCE_NAMES = { none: "Never trained", under_6_months: "Less than 6 months", "6_to_24_months": "6 to 24 months", over_2_years: "More than 2 years" };

export function renderReport(markdown) {
  return markdown.split("\n").map((line) => {
    if (line.startsWith("### ")) return "<h4>" + esc(line.slice(4)) + "</h4>";
    if (line.startsWith("## ")) return "<h3>" + esc(line.slice(3)) + "</h3>";
    if (line.startsWith("# ")) return "<h2>" + esc(line.slice(2)) + "</h2>";
    if (line.startsWith("    * ")) return '<div class="rep-sub">' + esc(line.slice(6)) + "</div>";
    if (line.startsWith("* ")) return '<div class="rep-item">' + esc(line.slice(2)).replace(/`([^`]+)`/g, "<code>$1</code>") + "</div>";
    return line.trim() ? "<p>" + esc(line) + "</p>" : "";
  }).join("");
}

export async function renderProfile(view, { onLogout }) {
  const user = await api("GET", "/api/me");
  setUser(user);
  view.innerHTML =
    '<div class="page-head"><div class="profile-head">' + avatar(user, "big") + "<div><h1>" + esc(user.name) + '</h1><p class="muted">' +
    esc(GOAL_NAMES[user.goal] || user.goal) + ", " + user.days_per_week + " days a week, level " + esc(user.level) + "</p></div></div>" +
    '<div class="page-actions"><a class="btn" href="#/trainer">My coach</a><button class="btn" id="pr-regen">New program with your coach</button><button class="btn primary" id="pr-logout">Log out</button></div></div>' +
    '<div class="profile-grid"><section class="panel"><div class="panel-head"><h2>Profile</h2></div><div class="form-grid">' +
    '<label class="field"><span>Name</span><input type="text" id="pf-name" value="' + esc(user.name) + '"></label>' +
    '<label class="field"><span>Age</span><input type="number" id="pf-age" value="' + esc(user.age ?? "") + '"></label>' +
    '<label class="field"><span>Height cm</span><input type="number" id="pf-height" value="' + esc(user.height_cm ?? "") + '"></label>' +
    '<label class="field"><span>Weight kg</span><input type="number" step="0.1" id="pf-weight" value="' + esc(user.weight_kg ?? "") + '"></label>' +
    '<label class="field"><span>Colour</span><input type="color" id="pf-color" value="' + esc(user.color) + '"></label></div>' +
    '<div class="profile-facts"><div><span>Sex</span><b>' + esc(user.sex) + "</b></div><div><span>Experience</span><b>" + esc(EXPERIENCE_NAMES[user.experience] || "") + "</b></div>" +
    "<div><span>BMI</span><b>" + (user.bmi ? num(user.bmi) + " (" + esc(user.bmi_label) + ")" : "–") + "</b></div>" +
    "<div><span>Target muscles</span><b>" + esc(user.priority_muscles.map((muscle) => (MUSCLE_NAMES[muscle] || muscle).replace(/ \(.*\)/, "")).join(", ") || "balanced") + "</b></div></div>" +
    '<div class="modal-foot"><button class="btn ghost danger left" id="pf-delete">Delete account</button><button class="btn primary" id="pf-save">Save profile</button></div></section>' +
    '<section class="panel"><div class="panel-head"><h2>Your muscles</h2><span class="hint">Change priorities under Coach</span></div><div class="model-box profile-model" id="pf-model"></div></section></div>' +
    (user.plan_summary ? '<section class="panel" style="margin-top:20px"><div class="panel-head"><h2>Coach summary of your first program</h2></div><p>' + esc(user.plan_summary) + "</p></section>" : "") +
    '<section class="panel flat" style="margin-top:20px"><div class="panel-head"><h2>Training brief</h2><span class="hint">What the AI coach received</span></div><div class="report" id="pf-report"><p class="muted">Loading</p></div></section>';

  const viewer = await createBodyViewer(view.querySelector("#pf-model"), { sex: user.sex, selected: user.priority_muscles, interactive: false, autoRotate: true, labels: MUSCLE_NAMES });
  if (viewer) onCleanup(() => viewer.destroy());
  const report = await api("GET", "/api/me/report");
  view.querySelector("#pf-report").innerHTML = report.report ? renderReport(report.report) : '<p class="muted">No brief stored for this account.</p>';

  view.querySelector("#pf-save").addEventListener("click", async () => {
    const value = (id) => view.querySelector(id).value;
    try {
      const updated = await api("PUT", "/api/me", {
        name: value("#pf-name").trim(),
        age: value("#pf-age") ? Number(value("#pf-age")) : null,
        height_cm: value("#pf-height") ? Number(value("#pf-height")) : null,
        weight_kg: value("#pf-weight") ? Number(value("#pf-weight")) : null,
        color: value("#pf-color"),
      });
      setUser(updated);
      toast("Profile saved");
      document.dispatchEvent(new CustomEvent("user-changed"));
    } catch (error) {
      toast(error.message, "error");
    }
  });
  view.querySelector("#pr-logout").addEventListener("click", onLogout);
  view.querySelector("#pf-delete").addEventListener("click", () => deleteAccount(user, onLogout));
  view.querySelector("#pr-regen").addEventListener("click", () => rebuildDialog());
}
