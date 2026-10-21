import { api, esc, toast, relativeDay, setUser, state, confirmModal } from "./core.js?v=cycle2";
import { coachPicker } from "./coach3d.js?v=cycle2";
import { createBodyViewer, SELECTABLE_MUSCLES } from "./anatomy.js?v=cycle2";

export const MUSCLE_NAMES = {
  chest: "Chest", front_delts: "Front shoulders", side_delts: "Side shoulders", rear_delts: "Rear shoulders",
  biceps: "Biceps (front of the arm)", triceps: "Triceps (back of the arm)", forearms: "Forearms",
  lats: "Lats (wide back)", upper_back: "Upper back", lower_back: "Lower back",
  abs: "Abs (belly)", obliques: "Obliques (waist)", glutes: "Glutes (butt)", quads: "Front thighs", hamstrings: "Back thighs", calves: "Calves",
};

const REGIONS = [
  ["Arms", ["biceps", "triceps"]],
  ["Shoulders", ["front_delts", "side_delts", "rear_delts"]],
  ["Chest", ["chest"]],
  ["Back", ["lats", "upper_back"]],
  ["Belly", ["abs", "obliques"]],
  ["Butt", ["glutes"]],
  ["Legs", ["quads", "hamstrings", "calves"]],
];

const GOALS = [
  ["fat_loss", "Lose fat fast", "Burn fat while keeping your muscle. More cardio, full body training."],
  ["tone", "Tone and shape", "Firm, defined look. Moderate weights, more reps, some cardio."],
  ["muscle", "Build muscle", "Grow size where you want it. More sets on your target muscles."],
  ["strength", "Get stronger", "Lift heavier. Lower reps on the big exercises, longer rests."],
  ["health", "Health and fitness", "Feel better, move better, stay healthy for years."],
];

const EXPERIENCE = [
  ["none", "Never", "I have never trained with weights"],
  ["under_6_months", "A little", "Less than 6 months"],
  ["6_to_24_months", "Some", "Between 6 months and 2 years"],
  ["over_2_years", "A lot", "More than 2 years"],
];

const GENERATING_LINES = [
  "Reading your answers",
  "Choosing a split for your week",
  "Setting sets for every muscle",
  "Matching exercises to the equipment in your gym",
  "The AI coach is picking your exercises",
  "Writing your first program",
];

function initials(name) {
  return name.split(/\s+/).map((part) => part[0] || "").join("").slice(0, 2).toUpperCase();
}

export function avatar(user, size = "") {
  return '<span class="avatar ' + size + '" style="--avatar:' + esc(user.color || "#f2c14e") + '">' + esc(initials(user.name)) + "</span>";
}

export async function renderPicker(root, { onEnter, mobile }) {
  const users = await api("GET", "/api/users");
  root.innerHTML =
    '<div class="gate-inner picker">' +
    '<div class="gate-brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="9" width="5" height="14" rx="1.5"/><rect x="25" y="9" width="5" height="14" rx="1.5"/><rect class="bar" x="7" y="14" width="18" height="4"/></svg><span>Home Gym</span></div>' +
    "<h1>" + (users.length ? "Who is training?" : "Welcome to the gym") + "</h1>" +
    (users.length ? '<div class="user-grid">' + users.map((user) =>
      '<button class="user-card" data-user="' + user.id + '">' + avatar(user, "big") +
      '<span class="user-name">' + esc(user.name) + '</span><span class="user-meta">' +
      (user.status === "ready" ? (user.workouts ? user.workouts + " workouts, last " + esc(relativeDay(user.last_day)) : "No workouts yet") : "Program is being written") +
      "</span></button>").join("") + "</div>" : '<p class="gate-lead">Answer a few questions and the AI coach writes your first program.</p>') +
    '<button class="btn primary big gate-new" id="g-new">' + (users.length ? "I am new here" : "Start") + "</button>" +
    (users.length ? '<button class="btn ghost gate-manage" id="g-manage">Delete a profile</button>' : "") +
    (mobile ? "" : '<p class="gate-foot">No passwords. Just pick your name.</p>') +
    "</div>";
  let manage = false;
  const manageButton = root.querySelector("#g-manage");
  if (manageButton) manageButton.addEventListener("click", () => {
    manage = !manage;
    root.querySelector(".picker").classList.toggle("managing", manage);
    manageButton.textContent = manage ? "Done" : "Delete a profile";
    root.querySelector("h1").textContent = manage ? "Tap a profile to delete it" : "Who is training?";
  });
  root.querySelectorAll("[data-user]").forEach((button) => button.addEventListener("click", async () => {
    const user = users.find((entry) => entry.id === Number(button.dataset.user));
    if (manage) {
      const ok = await confirmModal("Delete " + user.name, "All workouts, programs and body data of " + user.name + " are deleted for good.", "Delete profile", true);
      if (!ok) return;
      await api("DELETE", "/api/users/" + user.id);
      if (state.user && state.user.id === user.id) setUser(null);
      renderPicker(root, { onEnter, mobile });
      return;
    }
    setUser(user);
    const full = await api("GET", "/api/me");
    setUser(full);
    if (full.status === "ready") onEnter(full);
    else renderGenerating(root, full, { onEnter, mobile });
  }));
  root.querySelector("#g-new").addEventListener("click", () => renderOnboarding(root, { onEnter, mobile, hasUsers: users.length > 0 }));
}

export function renderOnboarding(root, { onEnter, mobile, hasUsers }) {
  const answers = {
    name: "", sex: null, age: null, height_cm: null, weight_kg: null, experience: null, trained_recently: null,
    goal: null, priority_muscles: [], days_per_week: 3, session_minutes: 60, limitations: "", coach: null,
  };
  let step = 0;
  let viewer = null;
  let picker = null;

  const steps = [
    {
      title: "What is your name?",
      lead: "Everyone in this gym picks their name to log in. No password.",
      body: () => '<input class="big-input" type="text" id="o-name" maxlength="40" autocomplete="off" placeholder="Your name" value="' + esc(answers.name) + '">',
      bind: (body) => {
        const input = body.querySelector("#o-name");
        input.addEventListener("input", () => { answers.name = input.value; refreshNext(); });
        setTimeout(() => input.focus(), 30);
      },
      valid: () => answers.name.trim().length > 0,
    },
    {
      title: "Your body",
      lead: "This picks the 3D model you choose your target muscles on.",
      body: () => '<div class="choice-grid two">' + [["male", "Male"], ["female", "Female"]].map(([key, label]) =>
        '<button class="choice sex-' + key + '" data-sex="' + key + '" aria-pressed="' + (answers.sex === key) + '"><span class="choice-icon">' + sexIcon(key) + '</span><b>' + label + "</b></button>").join("") + "</div>",
      bind: (body) => body.querySelectorAll("[data-sex]").forEach((button) => button.addEventListener("click", () => {
        answers.sex = button.dataset.sex;
        body.querySelectorAll("[data-sex]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
        refreshNext();
        setTimeout(next, 180);
      })),
      valid: () => Boolean(answers.sex),
    },
    {
      title: "Age, height and weight",
      lead: "Used for your BMI, joint friendly cardio when needed, and to track your weight trend.",
      body: () => '<div class="num-fields">' +
        numField("o-age", "Age", "years", answers.age, 12, 100, 1) +
        numField("o-height", "Height", "cm", answers.height_cm, 120, 230, 1) +
        numField("o-weight", "Weight", "kg", answers.weight_kg, 30, 300, 0.1) + "</div>",
      bind: (body) => {
        [["o-age", "age"], ["o-height", "height_cm"], ["o-weight", "weight_kg"]].forEach(([id, key]) => {
          const input = body.querySelector("#" + id);
          input.addEventListener("input", () => { answers[key] = input.value === "" ? null : Number(input.value); refreshNext(); });
        });
        setTimeout(() => body.querySelector("#o-age").focus(), 30);
      },
      valid: () => answers.age >= 12 && answers.age <= 100 && answers.height_cm >= 120 && answers.height_cm <= 230 && answers.weight_kg >= 30 && answers.weight_kg <= 300,
    },
    {
      title: "Have you trained before?",
      lead: "Your experience sets how much volume your first program has.",
      body: () => '<div class="choice-grid">' + EXPERIENCE.map(([key, label, text]) =>
        '<button class="choice" data-exp="' + key + '" aria-pressed="' + (answers.experience === key) + '"><b>' + label + "</b><span>" + text + "</span></button>").join("") + "</div>" +
        '<div class="toggle-row" id="o-recent-row"' + (answers.experience && answers.experience !== "none" ? "" : " hidden") + '><span>Did you train regularly in the last 3 months?</span><div class="seg big-seg">' +
        [[true, "Yes"], [false, "No"]].map(([value, label]) => '<button data-recent="' + value + '" aria-pressed="' + (answers.trained_recently === value) + '">' + label + "</button>").join("") + "</div></div>",
      bind: (body) => {
        body.querySelectorAll("[data-exp]").forEach((button) => button.addEventListener("click", () => {
          answers.experience = button.dataset.exp;
          if (answers.experience === "none") answers.trained_recently = false;
          body.querySelectorAll("[data-exp]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
          body.querySelector("#o-recent-row").hidden = answers.experience === "none";
          refreshNext();
          if (answers.experience === "none") setTimeout(next, 180);
        }));
        body.querySelectorAll("[data-recent]").forEach((button) => button.addEventListener("click", () => {
          answers.trained_recently = button.dataset.recent === "true";
          body.querySelectorAll("[data-recent]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
          refreshNext();
          setTimeout(next, 180);
        }));
      },
      valid: () => Boolean(answers.experience) && (answers.experience === "none" || answers.trained_recently !== null),
    },
    {
      title: "Why do you want to train?",
      lead: "Your main goal shapes reps, rest and how much cardio you get.",
      body: () => '<div class="choice-grid">' + GOALS.map(([key, label, text]) =>
        '<button class="choice" data-goal="' + key + '" aria-pressed="' + (answers.goal === key) + '"><b>' + label + "</b><span>" + text + "</span></button>").join("") + "</div>",
      bind: (body) => body.querySelectorAll("[data-goal]").forEach((button) => button.addEventListener("click", () => {
        answers.goal = button.dataset.goal;
        body.querySelectorAll("[data-goal]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
        refreshNext();
        setTimeout(next, 180);
      })),
      valid: () => Boolean(answers.goal),
    },
    {
      title: "Which muscles matter most to you?",
      lead: "Tap muscles on the model or pick them from the list. Drag to turn the body around. These get extra training.",
      wide: true,
      body: () => '<div class="muscle-step"><div class="model-wrap"><div id="o-model" class="model-box"></div>' +
        '<div class="model-tools"><button class="btn small" id="o-front">Front</button><button class="btn small" id="o-back">Back</button><button class="btn small" id="o-spin" aria-pressed="false">Spin</button></div></div>' +
        '<div class="muscle-pick-list"><div class="region-row">' + REGIONS.map(([label, list]) => '<button class="chip region" data-region="' + list.join(",") + '">' + label + "</button>").join("") + "</div>" +
        '<div class="muscle-chips">' + SELECTABLE_MUSCLES.map((muscle) =>
          '<button class="chip muscle-chip" data-muscle="' + muscle + '" aria-pressed="' + answers.priority_muscles.includes(muscle) + '">' + esc(MUSCLE_NAMES[muscle]) + "</button>").join("") + "</div>" +
        '<p class="small muted" id="o-muscle-hint"></p></div></div>',
      bind: async (body) => {
        const sync = () => {
          body.querySelectorAll("[data-muscle]").forEach((chip) => chip.setAttribute("aria-pressed", String(answers.priority_muscles.includes(chip.dataset.muscle))));
          const count = answers.priority_muscles.length;
          body.querySelector("#o-muscle-hint").textContent = count === 0 ? "Pick at least one, or skip if you want a balanced program." :
            count > 4 ? "Tip: more than 4 priorities means nothing is really a priority. The coach will still balance it." : count + " selected.";
          if (viewer) viewer.setSelected(answers.priority_muscles);
          refreshNext();
        };
        const toggle = (muscle, on) => {
          const has = answers.priority_muscles.includes(muscle);
          if (on === undefined) on = !has;
          if (on && !has) answers.priority_muscles.push(muscle);
          if (!on && has) answers.priority_muscles = answers.priority_muscles.filter((entry) => entry !== muscle);
        };
        body.querySelectorAll("[data-muscle]").forEach((chip) => chip.addEventListener("click", () => { toggle(chip.dataset.muscle); sync(); }));
        body.querySelectorAll("[data-region]").forEach((chip) => chip.addEventListener("click", () => {
          const list = chip.dataset.region.split(",");
          const all = list.every((muscle) => answers.priority_muscles.includes(muscle));
          list.forEach((muscle) => toggle(muscle, !all));
          sync();
        }));
        sync();
        viewer = await createBodyViewer(body.querySelector("#o-model"), {
          sex: answers.sex,
          selected: answers.priority_muscles,
          labels: MUSCLE_NAMES,
          autoRotate: false,
          onToggle: (muscle, on) => { toggle(muscle, on); sync(); },
        });
        if (viewer) {
          body.querySelector("#o-front").addEventListener("click", () => viewer.front());
          body.querySelector("#o-back").addEventListener("click", () => viewer.back());
          const spin = body.querySelector("#o-spin");
          spin.addEventListener("click", () => {
            const on = spin.getAttribute("aria-pressed") !== "true";
            spin.setAttribute("aria-pressed", String(on));
            viewer.setAutoRotate(on);
          });
        }
      },
      valid: () => true,
    },
    {
      title: "How often can you train?",
      lead: "Be realistic. A plan you can keep beats a perfect plan you skip.",
      body: () => '<div class="field-block"><span class="field-label">Days per week</span><div class="day-picker">' +
        [1, 2, 3, 4, 5, 6, 7].map((days) => '<button data-days="' + days + '" aria-pressed="' + (answers.days_per_week === days) + '">' + days + "</button>").join("") + "</div></div>" +
        '<div class="field-block"><span class="field-label">Minutes per session</span><div class="day-picker minutes">' +
        [30, 45, 60, 75, 90].map((minutes) => '<button data-minutes="' + minutes + '" aria-pressed="' + (answers.session_minutes === minutes) + '">' + minutes + "</button>").join("") + "</div></div>" +
        '<p class="muted small" id="o-split"></p>',
      bind: (body) => {
        const describe = () => {
          const days = answers.days_per_week;
          const beginner = answers.experience === "none" || answers.experience === "under_6_months" || (answers.experience === "6_to_24_months" && !answers.trained_recently);
          let text = days <= 3 ? "Full body workouts, every muscle twice a week." :
            beginner ? "3 full body workouts plus " + (days - 3) + " cardio day" + (days - 3 > 1 ? "s" : "") + ", the best start for beginners." :
            days === 4 ? "Upper and lower body split." : days === 5 ? "Upper, lower, push, pull and legs." : "Push, pull and legs, twice a week.";
          body.querySelector("#o-split").textContent = text;
        };
        body.querySelectorAll("[data-days]").forEach((button) => button.addEventListener("click", () => {
          answers.days_per_week = Number(button.dataset.days);
          body.querySelectorAll("[data-days]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
          describe();
        }));
        body.querySelectorAll("[data-minutes]").forEach((button) => button.addEventListener("click", () => {
          answers.session_minutes = Number(button.dataset.minutes);
          body.querySelectorAll("[data-minutes]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
        }));
        describe();
      },
      valid: () => true,
    },
    {
      title: "Choose your coach",
      lead: "Tap a coach to meet them. Your coach briefs you before every workout, debriefs you after it and keeps improving your program.",
      wide: true,
      body: () => '<div id="o-coach"></div>',
      bind: (body) => {
        picker = coachPicker(body.querySelector("#o-coach"), answers.coach, (key) => {
          answers.coach = key;
          refreshNext();
        });
      },
      valid: () => Boolean(answers.coach),
    },
    {
      title: "Anything the coach should know?",
      lead: "Injuries, pain, things you hate or love. Optional.",
      body: () => '<textarea class="big-input" id="o-limits" maxlength="600" placeholder="e.g. my left knee hurts when I run, I love dumbbell work">' + esc(answers.limitations) + "</textarea>" +
        '<div class="review" id="o-review"></div>',
      bind: (body) => {
        const input = body.querySelector("#o-limits");
        input.addEventListener("input", () => { answers.limitations = input.value; });
        const goal = GOALS.find((entry) => entry[0] === answers.goal);
        body.querySelector("#o-review").innerHTML =
          "<div><span>Name</span><b>" + esc(answers.name) + "</b></div>" +
          "<div><span>Body</span><b>" + esc(answers.sex) + ", " + answers.age + " years, " + answers.height_cm + " cm, " + answers.weight_kg + " kg</b></div>" +
          "<div><span>Goal</span><b>" + esc(goal ? goal[1] : "") + "</b></div>" +
          "<div><span>Target muscles</span><b>" + esc(answers.priority_muscles.map((muscle) => MUSCLE_NAMES[muscle].replace(/ \(.*\)/, "")).join(", ") || "balanced") + "</b></div>" +
          "<div><span>Schedule</span><b>" + answers.days_per_week + " days, " + answers.session_minutes + " minutes</b></div>" +
          "<div><span>Coach</span><b>" + (answers.coach === "lena" ? "Lena" : "Max") + "</b></div>";
      },
      valid: () => true,
      last: true,
    },
  ];

  root.innerHTML =
    '<div class="gate-inner wizard' + (mobile ? " mobile" : "") + '">' +
    '<div class="wizard-top"><button class="btn ghost small" id="o-cancel">' + (hasUsers ? "Back to users" : "Cancel") + '</button><div class="wizard-progress" id="o-progress"></div></div>' +
    '<div class="wizard-body" id="o-body"></div>' +
    '<div class="wizard-nav"><button class="btn big" id="o-back-step">Back</button><button class="btn primary big" id="o-next">Next</button></div></div>';
  const bodyRoot = root.querySelector("#o-body");
  const nextButton = root.querySelector("#o-next");
  const backButton = root.querySelector("#o-back-step");

  function refreshNext() {
    nextButton.disabled = !steps[step].valid();
    if (step === 5) nextButton.textContent = answers.priority_muscles.length ? "Next" : "Skip";
  }

  function draw() {
    if (viewer) {
      viewer.destroy();
      viewer = null;
    }
    if (picker) {
      picker.dispose();
      picker = null;
    }
    const current = steps[step];
    root.querySelector("#o-progress").innerHTML = steps.map((_, index) => '<i class="' + (index < step ? "done" : index === step ? "now" : "") + '"></i>').join("");
    bodyRoot.className = "wizard-body" + (current.wide ? " wide" : "");
    bodyRoot.innerHTML = '<div class="step-count">Step ' + (step + 1) + " of " + steps.length + "</div><h1>" + esc(current.title) + '</h1><p class="gate-lead">' + esc(current.lead) + "</p>" +
      '<div class="step-content">' + current.body() + "</div>";
    current.bind(bodyRoot.querySelector(".step-content"));
    backButton.style.visibility = step === 0 ? "hidden" : "visible";
    nextButton.textContent = current.last ? "Write my program" : step === 5 && !answers.priority_muscles.length ? "Skip" : "Next";
    refreshNext();
  }

  function next() {
    if (!steps[step].valid()) return;
    if (steps[step].last) {
      submit();
      return;
    }
    step += 1;
    draw();
  }

  async function submit() {
    nextButton.disabled = true;
    nextButton.textContent = "Saving";
    try {
      const user = await api("POST", "/api/users", { ...answers, name: answers.name.trim(), trained_recently: Boolean(answers.trained_recently) });
      setUser(user);
      if (viewer) viewer.destroy();
      if (picker) picker.dispose();
      renderGenerating(root, user, { onEnter, mobile });
    } catch (error) {
      toast(error.message, "error");
      nextButton.disabled = false;
      nextButton.textContent = "Write my program";
      if (/name/i.test(error.message)) {
        step = 0;
        draw();
      }
    }
  }

  nextButton.addEventListener("click", next);
  backButton.addEventListener("click", () => {
    if (step > 0) {
      step -= 1;
      draw();
    }
  });
  root.querySelector("#o-cancel").addEventListener("click", () => {
    if (viewer) viewer.destroy();
    if (picker) picker.dispose();
    renderPicker(root, { onEnter, mobile });
  });
  root.onkeydown = (event) => {
    if (event.key === "Enter" && event.target.tagName !== "TEXTAREA" && !nextButton.disabled) {
      event.preventDefault();
      next();
    }
  };
  draw();
}

function numField(id, label, unit, value, min, max, step) {
  return '<label class="num-field"><span>' + label + '</span><div><input type="number" inputmode="decimal" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + (value ?? "") + '"><em>' + unit + "</em></div></label>";
}

function sexIcon(sex) {
  return sex === "female"
    ? '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="18" r="10"/><path d="M24 28v14M17 36h14"/></svg>'
    : '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="20" cy="28" r="10"/><path d="M27 21l12-12M30 9h9v9"/></svg>';
}

export function renderGenerating(root, user, { onEnter, mobile }) {
  let line = 0;
  let stopped = false;
  root.innerHTML =
    '<div class="gate-inner generating' + (mobile ? " mobile" : "") + '"><div class="gen-visual" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
    "<h1>Hi " + esc(user.name) + "</h1>" +
    '<p class="gate-lead" id="g-line">' + GENERATING_LINES[0] + "</p>" +
    '<p class="small muted" id="g-status"></p>' +
    '<div id="g-actions"></div></div>';
  const lineEl = root.querySelector("#g-line");
  const statusEl = root.querySelector("#g-status");
  const actions = root.querySelector("#g-actions");
  const spinner = setInterval(() => {
    line = Math.min(GENERATING_LINES.length - 1, line + 1);
    lineEl.textContent = GENERATING_LINES[line];
  }, 2600);

  const poll = async () => {
    if (stopped) return;
    try {
      const fresh = await api("GET", "/api/users/" + user.id);
      if (fresh.status === "ready") {
        stopped = true;
        clearInterval(spinner);
        setUser(fresh);
        showReady(root, fresh, { onEnter, mobile });
        return;
      }
      if (fresh.status === "waiting_ai" || fresh.status === "failed") {
        statusEl.textContent = fresh.status_message;
        actions.innerHTML = '<p class="muted small">' + (fresh.status === "waiting_ai"
          ? "Your answers are saved. The program is written automatically as soon as the AI coach is ready. You can already look around."
          : "Something went wrong. Try again.") + '</p><div class="gate-actions"><button class="btn" id="g-retry">Try again</button><button class="btn primary" id="g-enter">Look around</button></div>';
        actions.querySelector("#g-retry").onclick = async () => { await api("POST", "/api/me/regenerate"); actions.innerHTML = ""; };
        actions.querySelector("#g-enter").onclick = () => { stopped = true; clearInterval(spinner); onEnter(fresh); };
      } else {
        statusEl.textContent = fresh.status_message;
        if (!actions.innerHTML) {
          actions.innerHTML = '<p class="muted small">A careful program takes your coach a few minutes: it is designed, checked by a second coach and improved. ' +
            'You can close the app or keep using it, the new program appears by itself.</p><div class="gate-actions"><button class="btn" id="g-enter">Use the app while you wait</button></div>';
          actions.querySelector("#g-enter").onclick = () => { stopped = true; clearInterval(spinner); onEnter(fresh); };
        }
      }
    } catch (error) {
      statusEl.textContent = error.message;
    }
    setTimeout(poll, 2000);
  };
  poll();
}

async function showReady(root, user, { onEnter, mobile }) {
  const programs = await api("GET", "/api/programs");
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  root.innerHTML =
    '<div class="gate-inner ready' + (mobile ? " mobile" : "") + '"><div class="step-count">Your first program</div><h1>Ready, ' + esc(user.name) + "</h1>" +
    (user.plan_summary ? '<p class="gate-lead">' + esc(user.plan_summary) + "</p>" : "") +
    '<div class="ready-week">' + programs.map((program) =>
      '<div class="ready-day"><span class="ready-dow">' + (program.weekday !== null ? days[program.weekday] : "") + "</span><b>" + esc(program.name) + "</b><span>" +
      program.items.length + " exercises, " + program.total_sets + " sets</span></div>").join("") + "</div>" +
    '<button class="btn primary big" id="r-go">Start training</button></div>';
  root.querySelector("#r-go").addEventListener("click", () => onEnter(user));
}

export async function deleteAccount(user, onDone) {
  const ok = await confirmModal("Delete " + user.name, "All workouts, programs and body data of " + user.name + " are deleted for good.", "Delete account", true);
  if (!ok) return;
  await api("DELETE", "/api/users/" + user.id);
  setUser(null);
  onDone();
}

export { state };
