import { changedValues } from "@/lib/insights";
import { type SyntheticEvent, useState } from "react";
import { ApiError, request } from "@/lib/api";
import { sessionGet, sessionSet } from "@/lib/storage";
import type { SettingsField, SettingsView } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { errorToast, toast } from "@/ui/toast";

const TOKEN_KEY = "hg-admin-token";
const SOURCE_TEXT: Record<SettingsField["source"], string> = { app: "Set here", environment: "From server file", default: "Default" };

interface AdminState {
  allowed: boolean;
  unlocked: boolean;
  pin_set: boolean;
}

function adminApi<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  return request<T>(method, path, body, { headers: { "X-Admin-Token": sessionGet(TOKEN_KEY) } });
}


function PinForm({ pinSet, onDone }: { pinSet: boolean; onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!pinSet && repeat !== pin) {
      toast("The two PINs differ", "error");
      return;
    }
    try {
      const result = await adminApi<{ token: string }>("POST", "/api/admin/unlock", { pin });
      sessionSet(TOKEN_KEY, result.token);
      onDone();
    } catch (error) {
      setPin("");
      errorToast(error);
    }
  };
  return (
    <section className="st-wrap">
      <form className="st-card st-pin" onSubmit={(event) => void submit(event)}>
        <h2>{pinSet ? "Admin PIN" : "Choose an admin PIN"}</h2>
        <p className="muted small">{pinSet ? "Settings hold your API keys, so they are locked." : "Pick 4 to 8 digits. Anyone with this PIN can change the server settings."}</p>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          autoComplete="off"
          aria-label="PIN"
          required
          autoFocus
          value={pin}
          onChange={(event) => setPin(event.target.value)}
        />
        {pinSet ? null : (
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            placeholder="Repeat PIN"
            aria-label="Repeat PIN"
            autoComplete="off"
            required
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
        )}
        <button className="btn primary" type="submit">
          {pinSet ? "Unlock" : "Save PIN"}
        </button>
      </form>
    </section>
  );
}

function FieldInput({ field, value, onChange }: { field: SettingsField; value: string | boolean; onChange: (value: string | boolean) => void }) {
  const [visible, setVisible] = useState(false);
  const id = "st-" + field.key;
  if (field.kind === "bool") {
    return (
      <label className="st-switch">
        <input type="checkbox" id={id} checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{value ? "On" : "Off"}</span>
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)}>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "secret") {
    return (
      <div className="st-secret">
        <input
          type={visible ? "text" : "password"}
          id={id}
          autoComplete="off"
          placeholder={field.is_set ? (field.preview ?? "") + "  (leave empty to keep)" : "Not set"}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="st-eye" aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    );
  }
  return (
    <input
      type={field.kind === "int" ? "number" : "text"}
      id={id}
      placeholder={field.kind === "list" ? "comma separated" : undefined}
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function initialValues(fields: SettingsField[]): Record<string, string | boolean> {
  return Object.fromEntries(fields.map((field) => [field.key, field.kind === "secret" ? "" : field.value]));
}

function SettingsForm({ data, onChanged, onLocked }: { data: SettingsView; onChanged: () => void; onLocked: () => void }) {
  const [values, setValues] = useState(() => initialValues(data.fields));
  const [testOut, setTestOut] = useState("");
  const [pantryOut, setPantryOut] = useState("Webhook address for the pantry: " + window.location.origin + "/api/integrations/pantry");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    const changed = changedValues(data.fields, values);
    if (!Object.keys(changed).length) {
      toast("Nothing changed");
      return;
    }
    setBusy(true);
    try {
      await adminApi("PUT", "/api/admin/settings", { values: changed, reset: [] });
      toast("Settings saved");
      onChanged();
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (key: string) => {
    try {
      await adminApi("PUT", "/api/admin/settings", { values: {}, reset: [key] });
      toast("Back to the server value");
      onChanged();
    } catch (error) {
      errorToast(error);
    }
  };

  const test = async () => {
    setTestOut("Checking");
    try {
      const result = await adminApi<{ message?: string; ready?: boolean }>("POST", "/api/admin/settings/test");
      setTestOut(result.message || (result.ready ? "Connected" : "Not reachable"));
    } catch (error) {
      setTestOut(error instanceof Error ? error.message : String(error));
    }
  };

  const syncPantry = async () => {
    setPantryOut("Syncing");
    try {
      const result = await adminApi<{ message: string }>("POST", "/api/admin/pantry/sync");
      setPantryOut(result.message);
    } catch (error) {
      setPantryOut(error instanceof Error ? error.message : String(error));
    }
  };

  const changePin = async () => {
    try {
      const result = await adminApi<{ token: string }>("POST", "/api/admin/pin", { pin: oldPin, new_pin: newPin });
      sessionSet(TOKEN_KEY, result.token);
      setOldPin("");
      setNewPin("");
      toast("PIN changed");
    } catch (error) {
      errorToast(error);
    }
  };

  const lock = async () => {
    try {
      await adminApi("POST", "/api/admin/lock");
    } catch {
      sessionSet(TOKEN_KEY, "");
    }
    sessionSet(TOKEN_KEY, "");
    onLocked();
  };

  return (
    <form className="st-wrap" onSubmit={(event) => void submit(event)}>
      {Object.entries(data.groups).map(([group, title]) => (
        <section key={group} className="st-card">
          <h2>{title}</h2>
          {data.fields
            .filter((field) => field.group === group)
            .map((field) => (
              <div key={field.key} className="st-field">
                <div className="st-label">
                  <label htmlFor={"st-" + field.key}>{field.label}</label>
                  <span className={"st-source st-" + field.source}>{SOURCE_TEXT[field.source]}</span>
                  {field.source === "app" ? (
                    <button type="button" className="st-reset" onClick={() => void reset(field.key)}>
                      Reset
                    </button>
                  ) : null}
                </div>
                <FieldInput field={field} value={values[field.key] ?? ""} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />
              </div>
            ))}
          {group === "ai" ? (
            <div className="st-test">
              <button type="button" className="btn" onClick={() => void test()}>
                Test connection
              </button>
              <span className="small muted" aria-live="polite">
                {testOut}
              </span>
            </div>
          ) : null}
          {group === "pantry" ? (
            <div className="st-test">
              <button type="button" className="btn" onClick={() => void syncPantry()}>
                Sync now
              </button>
              <span className="small muted" aria-live="polite">
                {pantryOut}
              </span>
            </div>
          ) : null}
        </section>
      ))}
      <section className="st-card">
        <h2>Admin PIN</h2>
        <div className="st-field">
          <label htmlFor="st-old-pin">Current PIN</label>
          <input type="password" inputMode="numeric" id="st-old-pin" autoComplete="off" value={oldPin} onChange={(event) => setOldPin(event.target.value)} />
        </div>
        <div className="st-field">
          <label htmlFor="st-new-pin">New PIN</label>
          <input type="password" inputMode="numeric" id="st-new-pin" autoComplete="off" value={newPin} onChange={(event) => setNewPin(event.target.value)} />
        </div>
        <button type="button" className="btn" onClick={() => void changePin()}>
          Change PIN
        </button>
      </section>
      <div className="st-actions">
        <button type="button" className="btn" onClick={() => void lock()}>
          Lock
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          Save
        </button>
      </div>
    </form>
  );
}

export function AdminSettings() {
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce((value) => value + 1);
  const resource = useResource(
    async (signal) => {
      const state = await request<AdminState>("GET", "/api/admin/state", undefined, { headers: { "X-Admin-Token": sessionGet(TOKEN_KEY) }, signal });
      if (!state.allowed || !state.unlocked) return { state, data: null };
      try {
        const data = await request<SettingsView>("GET", "/api/admin/settings", undefined, { headers: { "X-Admin-Token": sessionGet(TOKEN_KEY) }, signal });
        return { state, data };
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          sessionSet(TOKEN_KEY, "");
          return { state: { ...state, unlocked: false }, data: null };
        }
        throw error;
      }
    },
    [nonce],
  );
  if (resource.error) return <div className="empty">{resource.error.message}</div>;
  if (!resource.data) return <div className="skeleton" aria-busy="true" />;
  const { state, data } = resource.data;
  if (!state.allowed) {
    return (
      <section className="st-wrap">
        <div className="st-card">
          <h2>Main account only</h2>
          <p className="muted small">The server settings can only be opened from the main account of this gym.</p>
        </div>
      </section>
    );
  }
  if (!data) return <PinForm pinSet={state.pin_set} onDone={refresh} />;
  return <SettingsForm key={nonce} data={data} onChanged={refresh} onLocked={refresh} />;
}
