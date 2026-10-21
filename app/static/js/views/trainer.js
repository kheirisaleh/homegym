import { api, esc, toast, onCleanup, setUser, state } from "../core.js?v=cycle2";
import { coachPicker, COACHES } from "../coach3d.js?v=cycle2";

export async function renderTrainerSettings(view, { mobile } = {}) {
  const persona = await api("GET", "/api/coach/persona");
  view.innerHTML =
    (mobile ? "" : '<div class="page-head"><div><h1>My coach</h1><p>Your coach briefs you before every workout, debriefs you after it and reviews your program twice a week at night.</p></div></div>') +
    '<section class="trainer-settings">' +
    (mobile ? '<p class="muted trainer-lead">Tap a coach to meet them. The choice is saved right away.</p>' : "") +
    '<div id="tr-picker"></div>' +
    '<p class="small muted trainer-note" id="tr-note"></p>' +
    "</section>";
  const note = view.querySelector("#tr-note");
  const describe = (key) => {
    const coach = COACHES[key] || COACHES.max;
    note.innerHTML = "<b>" + esc(coach.name) + "</b> is your coach. " + esc(coach.style);
  };
  describe(persona.coach);
  const picker = coachPicker(view.querySelector("#tr-picker"), persona.coach, async (key) => {
    if (key === persona.coach) return;
    try {
      await api("PUT", "/api/coach/persona", { coach: key });
      persona.coach = key;
      if (state.user) setUser({ ...state.user, coach: key });
      describe(key);
      toast("Your coach is now " + COACHES[key].name);
      document.dispatchEvent(new CustomEvent("coach-changed", { detail: key }));
    } catch (error) {
      toast(error.message, "error");
    }
  });
  onCleanup(() => picker.dispose());
}
