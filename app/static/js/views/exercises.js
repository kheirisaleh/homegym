import {
  api, esc, toast, openModal, confirmModal, loadExercises, loadEquipment, invalidate, muscleLabel, mediaTag, thumbUrl,
  createLoopPlayer, state, MEASURE_LABELS, formatClock, storageGet, storageSet,
} from "../core.js?v=cycle2";

const PATTERNS = {
  horizontal_push: "Horizontal press", incline_push: "Incline press", vertical_push: "Overhead press", dip: "Dips", chest_fly: "Fly",
  lateral_raise: "Lateral raise", rear_delt: "Rear delt", elbow_flexion: "Curl", elbow_flexion_stretch: "Stretched curl", elbow_flexion_neutral: "Neutral grip curl",
  elbow_extension: "Triceps extension", elbow_extension_overhead: "Overhead triceps", vertical_pull: "Vertical pull", horizontal_pull: "Row",
  squat: "Squat", lunge: "Lunge", hinge: "Hip hinge", knee_flexion: "Leg curl", calf: "Calves",
  hip_flexion: "Leg raise", core_flexion: "Crunch", anti_extension: "Plank", anti_lateral: "Side plank", rotation: "Rotation",
  cardio_steady: "Steady cardio", cardio_interval: "Intervals", mobility: "Mobility",
};

export async function renderExercises(view, idText) {
  const [exercises] = await Promise.all([loadExercises(true), loadEquipment()]);
  const filter = { query: storageGet("ex-q", ""), muscle: storageGet("ex-m", ""), media: storageGet("ex-media", "") };
  view.innerHTML =
    '<div class="page-head"><div><h1>Exercises</h1><p>Upload a short loop animation and a target muscle image for every exercise. Both appear large during your workout.</p></div>' +
    '<div class="page-actions"><button class="btn primary" id="ex-new">New exercise</button></div></div>' +
    '<div class="toolbar"><input type="search" id="ex-q" placeholder="Search" value="' + esc(filter.query) + '">' +
    '<select id="ex-m"><option value="">All muscles</option>' + state.meta.muscles.map((muscle) => '<option value="' + muscle + '"' + (filter.muscle === muscle ? " selected" : "") + ">" + esc(muscleLabel(muscle)) + "</option>").join("") + "</select>" +
    '<select id="ex-media"><option value="">All</option><option value="none"' + (filter.media === "none" ? " selected" : "") + '>Without own media</option><option value="used"' + (filter.media === "used" ? " selected" : "") + ">Used in programs</option></select>" +
    '<span class="faint small" id="ex-count"></span></div><div class="ex-grid" id="ex-grid"></div>';

  const grid = view.querySelector("#ex-grid");
  const draw = () => {
    const list = exercises.filter((exercise) =>
      (!filter.query || exercise.name.toLowerCase().includes(filter.query.toLowerCase())) &&
      (!filter.muscle || exercise.primary_muscle === filter.muscle || (exercise.secondary_muscles || []).includes(filter.muscle)) &&
      (filter.media !== "none" || (!exercise.media_loop && !exercise.media_muscles)) &&
      (filter.media !== "used" || exercise.program_count > 0));
    list.sort((a, b) => (b.program_count > 0) - (a.program_count > 0) || a.name.localeCompare(b.name));
    view.querySelector("#ex-count").textContent = list.length + " of " + exercises.length;
    grid.innerHTML = list.map((exercise) => {
      let thumb = '<span class="none">No media</span>';
      let source = "";
      if (exercise.media_loop) {
        thumb = mediaTag(exercise.media_loop, 'loading="lazy"');
        source = "Own";
      } else if (exercise.video_id) {
        thumb = '<img src="' + thumbUrl(exercise.video_id) + '" alt="" loading="lazy">';
        source = "YouTube";
      } else if (exercise.media_muscles) {
        thumb = mediaTag(exercise.media_muscles, 'loading="lazy"');
      }
      return '<button class="ex-card' + (exercise.available ? "" : " unavailable") + '" data-id="' + exercise.id + '"><div class="thumb">' + thumb + (source ? '<span class="src">' + source + "</span>" : "") + "</div>" +
        '<div class="body"><b>' + esc(exercise.name) + '</b><div class="meta"><span>' + esc(muscleLabel(exercise.primary_muscle) || "No target muscle") + "</span>" +
        (exercise.program_count ? '<span class="chip">in ' + exercise.program_count + " program" + (exercise.program_count > 1 ? "s" : "") + "</span>" : "") +
        (exercise.media_muscles ? '<span class="chip">Muscle image</span>' : "") + (exercise.available ? "" : '<span class="chip">Equipment missing</span>') + "</div></div></button>";
    }).join("") || '<div class="empty">No exercise matches the filter.</div>';
    grid.querySelectorAll("[data-id]").forEach((card) => card.addEventListener("click", () => { location.hash = "#/exercises/" + card.dataset.id; }));
  };
  view.querySelector("#ex-q").addEventListener("input", (event) => { filter.query = event.target.value; storageSet("ex-q", filter.query); draw(); });
  view.querySelector("#ex-m").addEventListener("change", (event) => { filter.muscle = event.target.value; storageSet("ex-m", filter.muscle); draw(); });
  view.querySelector("#ex-media").addEventListener("change", (event) => { filter.media = event.target.value; storageSet("ex-media", filter.media); draw(); });
  view.querySelector("#ex-new").addEventListener("click", () => openExerciseEditor(null, () => renderExercises(view)));
  draw();

  if (idText) {
    const exercise = exercises.find((entry) => entry.id === Number(idText));
    if (exercise) openExerciseEditor(exercise, () => renderExercises(view), () => { if (location.hash.startsWith("#/exercises/")) history.replaceState(null, "", "#/exercises"); });
  }
}

export async function openExerciseEditor(exercise, onSaved, onClose) {
  const equipment = await loadEquipment();
  const isNew = !exercise;
  let current = exercise ? { ...exercise } : {
    name: "", measure: "reps", track_weight: true, primary_muscle: "", secondary_muscles: [], equipment: [], load_equipment: null,
    pattern: "", difficulty: 1, cues: "", notes: "", video_id: null, video_start: null, video_end: null,
  };
  let player = null;
  let changed = false;
  const muscles = state.meta.muscles;
  const modal = openModal(
    '<div class="modal-head"><h2>' + (isNew ? "New exercise" : esc(current.name)) + '</h2><button class="btn ghost small" data-close>Close</button></div>' +
    '<div class="form-grid"><label class="field" style="grid-column:span 2"><span>Name</span><input type="text" id="e-name" value="' + esc(current.name) + '" autofocus></label>' +
    '<label class="field"><span>Measure</span><select id="e-measure">' + Object.entries(MEASURE_LABELS).map(([key, label]) => '<option value="' + key + '"' + (current.measure === key ? " selected" : "") + ">" + label + "</option>").join("") + "</select></label>" +
    '<label class="field"><span>Difficulty</span><select id="e-difficulty">' + [[1, "Beginner"], [2, "Intermediate"], [3, "Advanced"]].map(([value, label]) => '<option value="' + value + '"' + (current.difficulty === value ? " selected" : "") + ">" + label + "</option>").join("") + "</select></label></div>" +
    '<label class="check"><input type="checkbox" id="e-weight"' + (current.track_weight ? " checked" : "") + "> Log weight</label>" +

    (isNew ? "" : '<h3>Media for training</h3><div class="media-slots">' + slotHtml("loop", "Loop animation", "GIF or short video (MP4, WEBM). Plays muted in a loop.", current.media_loop) +
      slotHtml("muscles", "Target muscles", "Image (PNG, JPG, WEBP, SVG) with the muscles highlighted.", current.media_muscles) + "</div>") +

    '<h3>Muscles and movement</h3><div class="form-grid"><label class="field"><span>Target muscle</span><select id="e-primary"><option value="">None</option>' +
    muscles.map((muscle) => '<option value="' + muscle + '"' + (current.primary_muscle === muscle ? " selected" : "") + ">" + esc(muscleLabel(muscle)) + "</option>").join("") + "</select></label>" +
    '<label class="field"><span>Movement pattern</span><select id="e-pattern"><option value="">None</option>' +
    Object.entries(PATTERNS).map(([key, label]) => '<option value="' + key + '"' + (current.pattern === key ? " selected" : "") + ">" + label + "</option>").join("") + "</select></label></div>" +
    '<div class="field"><span>Secondary muscles (count half)</span><div class="chips" id="e-secondary">' +
    muscles.map((muscle) => '<button type="button" class="chip" data-muscle="' + muscle + '" aria-pressed="' + (current.secondary_muscles || []).includes(muscle) + '">' + esc(muscleLabel(muscle)) + "</button>").join("") + "</div></div>" +
    '<div class="field"><span>Required equipment</span><div class="chips" id="e-equipment">' +
    equipment.map((item) => '<button type="button" class="chip" data-eq="' + item.key + '" aria-pressed="' + (current.equipment || []).includes(item.key) + '">' + esc(item.name) + "</button>").join("") + "</div></div>" +
    '<label class="field"><span>Weight steps from</span><select id="e-load"><option value="">No equipment, steps of 2.5 kg</option>' +
    equipment.filter((item) => item.weights).map((item) => '<option value="' + item.key + '"' + (current.load_equipment === item.key ? " selected" : "") + ">" + esc(item.name) + "</option>").join("") + "</select></label>" +
    '<label class="field"><span>Technique cues (shown during training)</span><textarea id="e-cues">' + esc(current.cues || "") + "</textarea></label>" +

    '<h3>YouTube as fallback</h3><p class="muted small">Only shown when no own loop animation is uploaded. Use start and end to loop just the important part.</p>' +
    '<div class="form-grid"><label class="field" style="grid-column:span 2"><span>Link or video ID</span><input type="text" id="e-link" value="' + esc(current.video_id ? "https://youtu.be/" + current.video_id : "") + '"></label>' +
    '<label class="field"><span>Start s</span><input type="number" min="0" id="e-start" value="' + esc(current.video_start ?? "") + '"></label>' +
    '<label class="field"><span>End s</span><input type="number" min="0" id="e-end" value="' + esc(current.video_end ?? "") + '"></label></div>' +
    '<div class="media-frame" id="e-preview" style="aspect-ratio:16/9"></div>' +
    '<div class="toolbar" style="margin:0"><input type="search" id="e-query" value="' + esc((current.name || "") + " form") + '"><label class="check small"><input type="checkbox" id="e-short" checked> Short only</label><button class="btn" id="e-search">Search</button></div>' +
    '<div class="yt-results" id="e-results"></div>' +

    '<div class="modal-foot">' + (isNew ? "" : '<button class="btn ghost danger left" id="e-delete">Delete exercise</button>') +
    '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="e-save">Save</button></div>',
    {
      wide: true,
      onClose: () => {
        if (player) player.destroy();
        if (changed && onSaved) onSaved(current);
        if (onClose) onClose();
      },
    },
  );
  const root = modal.element;

  root.querySelectorAll("#e-secondary [data-muscle], #e-equipment [data-eq]").forEach((chip) => chip.addEventListener("click", () => {
    chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
  }));

  const refreshPreview = () => {
    if (player) {
      player.destroy();
      player = null;
    }
    const preview = root.querySelector("#e-preview");
    const id = extractId(root.querySelector("#e-link").value);
    if (!id) {
      preview.innerHTML = '<div class="media-empty">No YouTube video selected</div>';
      return;
    }
    const start = Number(root.querySelector("#e-start").value) || 0;
    const end = Number(root.querySelector("#e-end").value) || 0;
    createLoopPlayer(preview, id, start, end).then((created) => { player = created; });
  };
  ["#e-link", "#e-start", "#e-end"].forEach((selector) => root.querySelector(selector).addEventListener("change", refreshPreview));
  refreshPreview();

  const search = async () => {
    const results = root.querySelector("#e-results");
    results.innerHTML = '<p class="muted small">Searching</p>';
    try {
      const short = root.querySelector("#e-short").checked;
      let items = await api("GET", "/api/youtube/search?q=" + encodeURIComponent(root.querySelector("#e-query").value) + (short ? "&short=true" : ""));
      if (short) items = items.filter((item) => !item.length || item.length <= 120);
      results.innerHTML = items.map((item) =>
        '<button class="yt-result' + (item.embeddable ? "" : " blocked") + '" data-use="' + item.video_id + '" data-title="' + esc(item.title) + '"' + (item.embeddable ? "" : " disabled") + ">" +
        '<img src="' + thumbUrl(item.video_id) + '" alt=""><div>' + esc(item.title) + '<div class="len">' + (item.length ? formatClock(item.length) : "") + " · " + esc(item.channel) + (item.embeddable ? "" : " · cannot be embedded") + "</div></div></button>").join("") ||
        '<p class="muted small">No results.</p>';
      results.querySelectorAll("[data-use]").forEach((button) => button.addEventListener("click", () => {
        root.querySelector("#e-link").value = "https://youtu.be/" + button.dataset.use;
        root.querySelector("#e-start").value = "";
        root.querySelector("#e-end").value = "";
        current.video_title = button.dataset.title;
        refreshPreview();
      }));
    } catch (error) {
      results.innerHTML = '<p class="muted small">' + esc(error.message) + "</p>";
    }
  };
  root.querySelector("#e-search").addEventListener("click", search);
  root.querySelector("#e-query").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      search();
    }
  });

  if (!isNew) bindSlots(root, current, (updated) => {
    current = { ...current, ...updated };
    changed = true;
    invalidate("exercises");
  });

  root.querySelector("#e-save").addEventListener("click", async () => {
    const body = {
      name: root.querySelector("#e-name").value.trim(),
      measure: root.querySelector("#e-measure").value,
      track_weight: root.querySelector("#e-weight").checked,
      difficulty: Number(root.querySelector("#e-difficulty").value),
      primary_muscle: root.querySelector("#e-primary").value || null,
      pattern: root.querySelector("#e-pattern").value || null,
      secondary_muscles: [...root.querySelectorAll('#e-secondary [aria-pressed="true"]')].map((chip) => chip.dataset.muscle),
      equipment: [...root.querySelectorAll('#e-equipment [aria-pressed="true"]')].map((chip) => chip.dataset.eq),
      load_equipment: root.querySelector("#e-load").value || null,
      cues: root.querySelector("#e-cues").value,
      notes: current.notes || "",
      video: root.querySelector("#e-link").value.trim() || null,
      video_start: Number(root.querySelector("#e-start").value) || null,
      video_end: Number(root.querySelector("#e-end").value) || null,
      video_title: current.video_title || null,
    };
    if (!body.name) {
      toast("Give the exercise a name", "error");
      return;
    }
    try {
      const saved = await api(isNew ? "POST" : "PUT", isNew ? "/api/exercises" : "/api/exercises/" + current.id, body);
      current = saved;
      changed = true;
      invalidate("exercises", "programs");
      toast(isNew ? "Exercise created. Now you can upload media." : "Exercise saved");
      modal.close();
      if (isNew) setTimeout(() => { location.hash = "#/exercises/" + saved.id; }, 50);
    } catch (error) {
      toast(error.message, "error");
    }
  });

  const deleteButton = root.querySelector("#e-delete");
  if (deleteButton) deleteButton.addEventListener("click", async () => {
    const ok = await confirmModal("Delete exercise", "The exercise disappears from all programs. Logged sets stay in your history.", "Delete", true);
    if (!ok) return;
    await api("DELETE", "/api/exercises/" + current.id);
    changed = true;
    invalidate("exercises", "programs");
    modal.close();
  });
}

function slotHtml(kind, title, help, name) {
  return '<div class="slot" data-slot="' + kind + '"><b>' + title + '</b><div class="preview">' + (name ? mediaTag(name) : esc(help)) + "</div>" +
    '<div class="row"><label class="btn small"><input type="file" hidden accept="' + (kind === "loop" ? "image/gif,video/mp4,video/webm,video/quicktime,image/webp" : "image/*") + '">Choose file</label>' +
    (name ? '<button class="btn ghost small danger" data-remove-media>Remove</button>' : "") + '<span class="small faint">or drop it here</span></div></div>';
}

function bindSlots(root, exercise, onUpdate) {
  root.querySelectorAll("[data-slot]").forEach((slot) => {
    const kind = slot.dataset.slot;
    const upload = async (file) => {
      if (!file) return;
      const data = new FormData();
      data.append("file", file);
      slot.querySelector(".preview").textContent = "Uploading";
      try {
        const updated = await api("POST", "/api/exercises/" + exercise.id + "/media/" + kind, data);
        onUpdate(updated);
        slot.outerHTML = slotHtml(kind, kind === "loop" ? "Loop animation" : "Target muscles", "", kind === "loop" ? updated.media_loop : updated.media_muscles);
        bindSlots(root, updated, onUpdate);
        toast("Uploaded");
      } catch (error) {
        toast(error.message, "error");
        slot.querySelector(".preview").textContent = error.message;
      }
    };
    slot.querySelector('input[type="file"]').addEventListener("change", (event) => upload(event.target.files[0]));
    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      slot.classList.add("drag");
    });
    slot.addEventListener("dragleave", () => slot.classList.remove("drag"));
    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      slot.classList.remove("drag");
      upload(event.dataTransfer.files[0]);
    });
    const remove = slot.querySelector("[data-remove-media]");
    if (remove) remove.addEventListener("click", async () => {
      const updated = await api("DELETE", "/api/exercises/" + exercise.id + "/media/" + kind);
      onUpdate(updated);
      slot.outerHTML = slotHtml(kind, kind === "loop" ? "Loop animation" : "Target muscles", kind === "loop" ? "GIF or short video (MP4, WEBM). Plays muted in a loop." : "Image (PNG, JPG, WEBP, SVG) with the muscles highlighted.", null);
      bindSlots(root, updated, onUpdate);
    });
  });
}

function extractId(value) {
  const text = (value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const match = text.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}
