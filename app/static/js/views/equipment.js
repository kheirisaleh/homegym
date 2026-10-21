import { api, esc, num, toast, openModal, confirmModal, loadEquipment, invalidate, mediaUrl } from "../core.js?v=cycle2";

const CATEGORIES = {
  free_weight: "Free weights",
  machine: "Machines",
  bench: "Benches",
  bodyweight: "Bodyweight stations",
  cardio: "Cardio",
  accessory: "Accessories",
};

export async function renderEquipment(view) {
  const items = await loadEquipment(true);
  const groups = {};
  items.forEach((item) => { (groups[item.category] = groups[item.category] || []).push(item); });
  const available = items.filter((item) => item.available).length;
  view.innerHTML =
    '<div class="page-head"><div><h1>Equipment</h1><p>What stands in your home gym. The coach only suggests exercises you have everything for, and only raises weights in steps you actually own. Switch something off and the AI coach replaces the affected exercises.</p></div>' +
    '<div class="page-actions"><span class="muted">' + available + " of " + items.length + ' available</span><button class="btn primary" id="eq-new">Add equipment</button></div></div>' +
    Object.keys(CATEGORIES).filter((key) => groups[key]).map((key) =>
      '<section class="eq-group"><h2>' + CATEGORIES[key] + '</h2><div class="eq-grid">' + groups[key].map(cardHtml).join("") + "</div></section>").join("");

  view.querySelector("#eq-new").addEventListener("click", () => openEditor(null, () => renderEquipment(view)));
  view.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    openEditor(items.find((item) => item.key === button.dataset.edit), () => renderEquipment(view));
  }));
  view.querySelectorAll("[data-toggle]").forEach((input) => input.addEventListener("change", async () => {
    const item = items.find((entry) => entry.key === input.dataset.toggle);
    try {
      const result = await api("PUT", "/api/equipment/" + item.key, { ...bodyOf(item), available: input.checked });
      invalidate("equipment", "exercises", "programs");
      reportSwaps(result, item.name + (input.checked ? " available" : " not available"));
      renderEquipment(view);
    } catch (error) {
      toast(error.message, "error");
    }
  }));
}

function reportSwaps(result, fallback) {
  if (result.swapped && result.swapped.length) toast("Replaced in your plan: " + result.swapped.join(", "));
  else if (result.pending) toast(result.pending, "error");
  else toast(fallback);
}

function bodyOf(item) {
  return { name: item.name, key: item.key, category: item.category, available: item.available, weights: item.weights, notes: item.notes || "" };
}

function cardHtml(item) {
  return '<div class="eq-card' + (item.available ? "" : " off") + '">' +
    (item.photo ? '<div class="eq-photo"><img src="' + mediaUrl(item.photo) + '" alt="' + esc(item.name) + '" loading="lazy"></div>' : "") +
    '<div class="top"><h3>' + esc(item.name) + "</h3>" +
    '<label class="switch" title="Available"><input type="checkbox" data-toggle="' + item.key + '"' + (item.available ? " checked" : "") + ' aria-label="' + esc(item.name) + ' available"><span></span></label></div>' +
    (item.weights ? '<div class="weights">' + item.weights.slice(0, 18).map((weight) => "<span>" + num(weight) + "</span>").join("") + (item.weights.length > 18 ? "<span>+" + (item.weights.length - 18) + "</span>" : "") + "</div>" : "") +
    (item.notes ? '<p class="small muted">' + esc(item.notes) + "</p>" : "") +
    '<div class="foot"><span>Used by ' + item.exercise_count + " exercise" + (item.exercise_count === 1 ? "" : "s") + '</span><button class="btn ghost small" data-edit="' + item.key + '">Edit</button></div></div>';
}

function parseWeights(text) {
  const values = new Set();
  text.split(/[\s;,]+/).filter(Boolean).forEach((part) => {
    const range = part.match(/^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = Number(range[3] || "2.5");
      for (let value = start; value <= end + 1e-9 && step > 0; value += step) values.add(Math.round(value * 100) / 100);
      return;
    }
    const value = Number(part);
    if (value > 0) values.add(value);
  });
  return [...values].sort((a, b) => a - b);
}

function photoSlot(item) {
  return '<div class="slot" id="q-photo"><b>Photo</b><div class="preview">' +
    (item && item.photo ? '<img src="' + mediaUrl(item.photo) + '" alt="">' : item ? "A photo of this piece of equipment in your gym (PNG, JPG, WEBP)." : "Save the equipment first, then add a photo.") + "</div>" +
    (item ? '<div class="row"><label class="btn small"><input type="file" hidden accept="image/*">Choose file</label>' +
      (item.photo ? '<button class="btn ghost small danger" data-remove-photo>Remove</button>' : "") + '<span class="small faint">or drop it here</span></div>' : "") + "</div>";
}

function bindPhoto(root, item, onChange) {
  const slot = root.querySelector("#q-photo");
  if (!item) return;
  const upload = async (file) => {
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    slot.querySelector(".preview").textContent = "Uploading";
    try {
      const updated = await api("POST", "/api/equipment/" + item.key + "/photo", data);
      Object.assign(item, updated);
      slot.outerHTML = photoSlot(item);
      bindPhoto(root, item, onChange);
      onChange();
      toast("Photo uploaded");
    } catch (error) {
      toast(error.message, "error");
      slot.querySelector(".preview").textContent = error.message;
    }
  };
  slot.querySelector('input[type="file"]').addEventListener("change", (event) => upload(event.target.files[0]));
  slot.addEventListener("dragover", (event) => { event.preventDefault(); slot.classList.add("drag"); });
  slot.addEventListener("dragleave", () => slot.classList.remove("drag"));
  slot.addEventListener("drop", (event) => {
    event.preventDefault();
    slot.classList.remove("drag");
    upload(event.dataTransfer.files[0]);
  });
  const remove = slot.querySelector("[data-remove-photo]");
  if (remove) remove.addEventListener("click", async () => {
    const updated = await api("DELETE", "/api/equipment/" + item.key + "/photo");
    Object.assign(item, updated);
    slot.outerHTML = photoSlot(item);
    bindPhoto(root, item, onChange);
    onChange();
  });
}

function openEditor(item, onSaved) {
  const isNew = !item;
  const current = item ? { ...item } : { name: "", category: "free_weight", available: true, weights: null, notes: "" };
  let photoChanged = false;
  const modal = openModal(
    '<div class="modal-head"><h2>' + (isNew ? "Add equipment" : esc(current.name)) + "</h2></div>" +
    '<div class="form-grid"><label class="field"><span>Name</span><input type="text" id="q-name" value="' + esc(current.name) + '" autofocus></label>' +
    '<label class="field"><span>Type</span><select id="q-cat">' + Object.entries(CATEGORIES).map(([key, label]) => '<option value="' + key + '"' + (current.category === key ? " selected" : "") + ">" + label + "</option>").join("") + "</select></label></div>" +
    photoSlot(isNew ? null : current) +
    '<label class="field"><span>Available weights in kg</span><input type="text" id="q-weights" value="' + esc((current.weights || []).join(" ")) + '" placeholder="e.g. 2.5 5 7.5 10 or 2.5..30/2.5"></label>' +
    '<p class="small faint">Separate values with spaces. 2.5..30/2.5 creates a series from 2.5 to 30 in steps of 2.5. For dumbbells enter the weight per dumbbell, for a barbell the total weight.</p>' +
    '<label class="field"><span>Note</span><input type="text" id="q-notes" value="' + esc(current.notes || "") + '"></label>' +
    '<label class="check"><input type="checkbox" id="q-available"' + (current.available ? " checked" : "") + "> Available</label>" +
    '<div class="modal-foot">' + (isNew ? "" : '<button class="btn ghost danger left" id="q-delete">Remove</button>') +
    '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="q-save">Save</button></div>',
    { onClose: () => { if (photoChanged) { invalidate("equipment"); onSaved(); } } },
  );
  const root = modal.element;
  bindPhoto(root, isNew ? null : current, () => { photoChanged = true; });
  root.querySelector("#q-save").addEventListener("click", async () => {
    const weights = parseWeights(root.querySelector("#q-weights").value);
    const body = {
      name: root.querySelector("#q-name").value.trim(),
      category: root.querySelector("#q-cat").value,
      available: root.querySelector("#q-available").checked,
      weights: weights.length ? weights : null,
      notes: root.querySelector("#q-notes").value,
    };
    if (!body.name) {
      toast("Give the equipment a name", "error");
      return;
    }
    try {
      const result = await api(isNew ? "POST" : "PUT", isNew ? "/api/equipment" : "/api/equipment/" + current.key, body);
      invalidate("equipment", "exercises", "programs");
      photoChanged = false;
      modal.close();
      reportSwaps(result, "Saved");
      onSaved();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  const deleteButton = root.querySelector("#q-delete");
  if (deleteButton) deleteButton.addEventListener("click", async () => {
    const ok = await confirmModal("Remove equipment", "Exercises in your plan that need it are replaced by the AI coach with suitable alternatives.", "Remove", true);
    if (!ok) return;
    const result = await api("DELETE", "/api/equipment/" + current.key);
    invalidate("equipment", "exercises", "programs");
    photoChanged = false;
    modal.close();
    reportSwaps(result, "Removed");
    onSaved();
  });
}

export { openEditor as openEquipmentEditor, CATEGORIES as EQUIPMENT_CATEGORIES };
