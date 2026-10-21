import { esc, toast, state } from "../core.js?v=cycle2";

const TOKEN_KEY = "hg-admin-token";
const SOURCE_TEXT = { app: "Set here", environment: "From server file", default: "Default" };

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (error) { return ""; }
}

function writeToken(token) {
  try { token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY); } catch (error) {}
}

async function adminApi(method, path, body) {
  const options = { method, headers: { "X-Admin-Token": readToken() } };
  if (state.userId) options.headers["X-User-Id"] = String(state.userId);
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  let data = null;
  try { data = await response.json(); } catch (error) {}
  if (!response.ok) {
    const error = new Error((data && typeof data.detail === "string" && data.detail) || "Request failed (" + response.status + ")");
    error.status = response.status;
    throw error;
  }
  return data;
}

function fieldHtml(field) {
  const id = "st-" + field.key;
  const badge = '<span class="st-source st-' + field.source + '">' + SOURCE_TEXT[field.source] + "</span>";
  const reset = field.source === "app" ? '<button type="button" class="st-reset" data-reset="' + field.key + '">Reset</button>' : "";
  let input;
  if (field.kind === "bool") {
    input = '<label class="st-switch"><input type="checkbox" id="' + id + '" data-key="' + field.key + '"' + (field.value ? " checked" : "") + "><span>" + (field.value ? "On" : "Off") + "</span></label>";
  } else if (field.kind === "select") {
    input = '<select id="' + id + '" data-key="' + field.key + '">' + field.options.map((option) =>
      '<option value="' + esc(option) + '"' + (option === field.value ? " selected" : "") + ">" + esc(option) + "</option>").join("") + "</select>";
  } else if (field.kind === "secret") {
    input = '<div class="st-secret"><input type="password" id="' + id + '" data-key="' + field.key + '" autocomplete="off" placeholder="' +
      esc(field.is_set ? field.preview + "  (leave empty to keep)" : "Not set") + '"><button type="button" class="st-eye" data-eye="' + id + '">Show</button></div>';
  } else {
    input = '<input type="' + (field.kind === "int" ? "number" : "text") + '" id="' + id + '" data-key="' + field.key + '" value="' + esc(field.value) + '"' +
      (field.kind === "list" ? ' placeholder="comma separated"' : "") + ">";
  }
  return '<div class="st-field"><div class="st-label"><label for="' + id + '">' + esc(field.label) + "</label>" + badge + reset + "</div>" + input + "</div>";
}

function pinForm(view, pinSet, onDone) {
  view.innerHTML = '<section class="st-wrap"><form class="st-card st-pin" id="st-pin">' +
    "<h2>" + (pinSet ? "Admin PIN" : "Choose an admin PIN") + "</h2>" +
    '<p class="muted small">' + (pinSet ? "Settings hold your API keys, so they are locked." : "Pick 4 to 8 digits. Anyone with this PIN can change the server settings.") + "</p>" +
    '<input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" id="st-pin-value" autocomplete="off" required>' +
    (pinSet ? "" : '<input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" id="st-pin-repeat" placeholder="Repeat PIN" autocomplete="off" required>') +
    '<button class="btn primary" type="submit">' + (pinSet ? "Unlock" : "Save PIN") + "</button></form></section>";
  const input = view.querySelector("#st-pin-value");
  input.focus();
  view.querySelector("#st-pin").addEventListener("submit", async (event) => {
    event.preventDefault();
    const repeat = view.querySelector("#st-pin-repeat");
    if (repeat && repeat.value !== input.value) return toast("The two PINs differ", "error");
    try {
      const result = await adminApi("POST", "/api/admin/unlock", { pin: input.value });
      writeToken(result.token);
      onDone();
    } catch (error) {
      input.value = "";
      toast(error.message, "error");
    }
  });
}

export async function renderSettings(view, { mobile } = {}) {
  const head = mobile ? "" : '<div class="page-head"><div><h1>Settings</h1><p>Server settings for the whole gym. Values set here win over the server file.</p></div></div>';
  const stateInfo = await adminApi("GET", "/api/admin/state");
  if (!stateInfo.allowed) {
    view.innerHTML = head + '<section class="st-wrap"><div class="st-card"><h2>Main account only</h2><p class="muted small">The server settings can only be opened from the main account of this gym.</p></div></section>';
    return;
  }
  if (!stateInfo.unlocked) {
    const holder = document.createElement("div");
    view.innerHTML = head;
    view.appendChild(holder);
    return pinForm(holder, stateInfo.pin_set, () => renderSettings(view, { mobile }));
  }
  let data;
  try {
    data = await adminApi("GET", "/api/admin/settings");
  } catch (error) {
    if (error.status === 401) { writeToken(""); return renderSettings(view, { mobile }); }
    throw error;
  }
  const sections = Object.entries(data.groups).map(([group, title]) => {
    const fields = data.fields.filter((field) => field.group === group);
    const extra = group === "pantry" ? '<div class="st-test"><button type="button" class="btn" id="st-pantry">Sync now</button><span class="small muted" id="st-pantry-out">Webhook address for the pantry: ' + esc(location.origin) + '/api/integrations/pantry</span></div>' : group === "ai" ? '<div class="st-test"><button type="button" class="btn" id="st-test">Test connection</button><span class="small muted" id="st-test-out"></span></div>' : "";
    return '<section class="st-card"><h2>' + esc(title) + "</h2>" + fields.map(fieldHtml).join("") + extra + "</section>";
  }).join("");
  view.innerHTML = head + '<form class="st-wrap" id="st-form">' + sections +
    '<section class="st-card"><h2>Admin PIN</h2><div class="st-field"><label for="st-old-pin">Current PIN</label><input type="password" inputmode="numeric" id="st-old-pin" autocomplete="off"></div>' +
    '<div class="st-field"><label for="st-new-pin">New PIN</label><input type="password" inputmode="numeric" id="st-new-pin" autocomplete="off"></div>' +
    '<button type="button" class="btn" id="st-change-pin">Change PIN</button></section>' +
    '<div class="st-actions"><button type="button" class="btn" id="st-lock">Lock</button><button type="submit" class="btn primary">Save</button></div></form>';

  const form = view.querySelector("#st-form");
  form.querySelectorAll("[data-eye]").forEach((button) => button.addEventListener("click", () => {
    const input = view.querySelector("#" + button.dataset.eye);
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Show" : "Hide";
  }));
  form.querySelectorAll(".st-switch input").forEach((box) => box.addEventListener("change", () => { box.nextElementSibling.textContent = box.checked ? "On" : "Off"; }));
  form.querySelectorAll("[data-reset]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await adminApi("PUT", "/api/admin/settings", { values: {}, reset: [button.dataset.reset] });
      toast("Back to the server value");
      renderSettings(view, { mobile });
    } catch (error) { toast(error.message, "error"); }
  }));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = {};
    data.fields.forEach((field) => {
      const input = form.querySelector('[data-key="' + field.key + '"]');
      if (!input) return;
      const value = field.kind === "bool" ? input.checked : input.value.trim();
      if (field.kind === "secret" && !value) return;
      if (field.kind !== "secret" && String(value) === String(field.value)) return;
      values[field.key] = value;
    });
    if (!Object.keys(values).length) return toast("Nothing changed");
    try {
      await adminApi("PUT", "/api/admin/settings", { values, reset: [] });
      toast("Settings saved");
      renderSettings(view, { mobile });
    } catch (error) { toast(error.message, "error"); }
  });
  view.querySelector("#st-test").addEventListener("click", async () => {
    const out = view.querySelector("#st-test-out");
    out.textContent = "Checking...";
    try {
      const result = await adminApi("POST", "/api/admin/settings/test");
      out.textContent = result.message || (result.ready ? "Connected" : "Not reachable");
    } catch (error) { out.textContent = error.message; }
  });
  view.querySelector("#st-pantry").addEventListener("click", async () => {
    const out = view.querySelector("#st-pantry-out");
    out.textContent = "Syncing...";
    try {
      const result = await adminApi("POST", "/api/admin/pantry/sync");
      out.textContent = result.message;
    } catch (error) { out.textContent = error.message; }
  });
  view.querySelector("#st-change-pin").addEventListener("click", async () => {
    try {
      const result = await adminApi("POST", "/api/admin/pin", { pin: view.querySelector("#st-old-pin").value, new_pin: view.querySelector("#st-new-pin").value });
      writeToken(result.token);
      toast("PIN changed");
      renderSettings(view, { mobile });
    } catch (error) { toast(error.message, "error"); }
  });
  view.querySelector("#st-lock").addEventListener("click", async () => {
    try { await adminApi("POST", "/api/admin/lock"); } catch (error) {}
    writeToken("");
    renderSettings(view, { mobile });
  });
}
