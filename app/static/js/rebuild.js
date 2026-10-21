import { api, esc, toast, openModal, confirmModal } from "./core.js?v=cycle2";

export async function rebuildDialog() {
  let info;
  try {
    info = await api("GET", "/api/me/rebuild");
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  if (info.running) {
    toast("Your coach is already working on a new program");
    return;
  }
  const ok = await confirmModal(
    "Build a new program?",
    "Your coach designs a new program from your workout history, your feedback and your exact equipment. Your current program is saved and you can switch back at any time.",
    "Yes, continue",
  );
  if (!ok) return;
  const modal = openModal(
    '<div class="modal-head"><h2>What should change?</h2></div>' +
    '<p class="muted">Pick everything that applies. The more your coach knows, the better the new program.</p>' +
    '<div class="rebuild-reasons">' + info.reasons.map((reason) =>
      '<label><input type="checkbox" value="' + esc(reason.key) + '"> ' + esc(reason.label) + "</label>").join("") + "</div>" +
    '<label class="field"><span>In your own words (optional)</span><textarea id="rb-details" maxlength="1000" placeholder="e.g. I never feel the incline press in my chest, I want more arm work, my knee hurts on lunges"></textarea></label>' +
    '<label class="field inline"><input type="checkbox" id="rb-keep" checked> <span>Keep my training days and the focus of each day</span></label>' +
    '<div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rb-go">Build my new program</button></div>',
  );
  modal.element.querySelector("#rb-go").addEventListener("click", async (event) => {
    event.target.disabled = true;
    const reasons = Array.from(modal.element.querySelectorAll(".rebuild-reasons input:checked")).map((input) => input.value);
    try {
      await api("POST", "/api/me/rebuild", {
        reasons,
        details: modal.element.querySelector("#rb-details").value.trim(),
        keep_schedule: modal.element.querySelector("#rb-keep").checked,
      });
      modal.close();
      document.dispatchEvent(new CustomEvent("regenerating"));
    } catch (error) {
      event.target.disabled = false;
      toast(error.message, "error");
    }
  });
}

export async function restoreDialog(onDone) {
  const ok = await confirmModal("Switch back?", "Your previous program becomes active again. The current one is kept and you can switch back.", "Restore previous program");
  if (!ok) return;
  try {
    await api("POST", "/api/me/rebuild/restore");
    toast("Previous program restored");
    if (onDone) onDone();
  } catch (error) {
    toast(error.message, "error");
  }
}

export function painNote() {
  return new Promise((resolve) => {
    let done = false;
    const modal = openModal(
      '<div class="modal-head"><h2>Where did it hurt?</h2></div><p class="muted">Your coach replaces or changes this exercise. Optional.</p>' +
      '<label class="field"><textarea id="pn-text" maxlength="300" placeholder="e.g. front of the right shoulder at the bottom"></textarea></label>' +
      '<div class="modal-foot"><button class="btn ghost" data-close>Skip</button><button class="btn primary" id="pn-save">Save</button></div>',
      { onClose: () => { if (!done) resolve(""); } },
    );
    modal.element.querySelector("#pn-save").addEventListener("click", () => {
      done = true;
      resolve(modal.element.querySelector("#pn-text").value.trim());
      modal.close();
    });
  });
}

export function coachChoiceHtml(current) {
  return '<div class="coach-choice">' + [["max", "Max", "Strength coach", "#d93a3f"], ["lena", "Lena", "Performance coach", "#3f7bf2"]].map(([key, name, title, color]) =>
    '<button type="button" data-coach="' + key + '" aria-pressed="' + (current === key) + '"><div class="avatar" style="background:' + color + '">' + name[0] + "</div><b>" + name + "</b><span>" + title + "</span></button>").join("") + "</div>";
}

export function bindCoachChoice(root, onChange) {
  root.querySelectorAll("[data-coach]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api("PUT", "/api/coach/persona", { coach: button.dataset.coach });
      root.querySelectorAll("[data-coach]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      toast("Your coach is now " + (button.dataset.coach === "lena" ? "Lena" : "Max"));
      if (onChange) onChange(button.dataset.coach);
    } catch (error) {
      toast(error.message, "error");
    }
  }));
}
