import { useState } from "react";
import { api } from "@/lib/api";
import { EQUIPMENT_CATEGORIES, mediaUrl, parseWeights } from "@/lib/catalog";
import { invalidate } from "@/lib/store";
import type { Equipment, EquipmentResult } from "@/lib/types";
import { confirmDialog, openModal } from "@/ui/modal";
import { errorToast, toast } from "@/ui/toast";

export function reportSwaps(result: EquipmentResult, fallback: string): void {
  if (result.swapped?.length) toast("Replaced in your plan: " + result.swapped.join(", "));
  else if (result.pending) toast(result.pending, "error");
  else toast(fallback);
}

export function equipmentBody(item: Equipment) {
  return { name: item.name, key: item.key, category: item.category, available: item.available, weights: item.weights, notes: item.notes || "" };
}

export async function toggleEquipment(item: Equipment, available: boolean): Promise<void> {
  try {
    const result = await api.put<EquipmentResult>("/api/equipment/" + item.key, { ...equipmentBody(item), available });
    invalidate("equipment", "exercises", "programs");
    reportSwaps(result, item.name + (available ? " available" : " not available"));
  } catch (error) {
    errorToast(error);
  }
}

function PhotoSlot({ item, onChange }: { item: Equipment | null; onChange: (item: Equipment) => void }) {
  const [status, setStatus] = useState("");
  const [drag, setDrag] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file || !item) return;
    const data = new FormData();
    data.append("file", file);
    setStatus("Uploading");
    try {
      onChange(await api.post<Equipment>("/api/equipment/" + item.key + "/photo", data));
      setStatus("");
      toast("Photo uploaded");
    } catch (error) {
      errorToast(error);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const remove = async () => {
    if (!item) return;
    try {
      onChange(await api.delete<Equipment>("/api/equipment/" + item.key + "/photo"));
    } catch (error) {
      errorToast(error);
    }
  };
  let preview: React.ReactNode = "Save the equipment first, then add a photo.";
  if (status) preview = status;
  else if (item?.photo) preview = <img src={mediaUrl(item.photo)} alt="" />;
  else if (item) preview = "A photo of this piece of equipment in your gym (PNG, JPG, WEBP).";
  return (
    <div
      className={"slot" + (drag ? " drag" : "")}
      onDragOver={(event) => {
        if (!item) return;
        event.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDrag(false);
        void upload(event.dataTransfer.files[0]);
      }}
    >
      <b>Photo</b>
      <div className="preview">{preview}</div>
      {item ? (
        <div className="row">
          <label className="btn small">
            <input type="file" hidden accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} />
            Choose file
          </label>
          {item.photo ? (
            <button type="button" className="btn ghost small danger" onClick={() => void remove()}>
              Remove
            </button>
          ) : null}
          <span className="small faint">or drop it here</span>
        </div>
      ) : null}
    </div>
  );
}

function EquipmentForm({ item, close }: { item: Equipment | null; close: () => void }) {
  const isNew = !item;
  const [current, setCurrent] = useState<Equipment | null>(item);
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "free_weight");
  const [weights, setWeights] = useState((item?.weights ?? []).join(" "));
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [available, setAvailable] = useState(item?.available ?? true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const parsed = parseWeights(weights);
    const body = { name: name.trim(), category, available, weights: parsed.length ? parsed : null, notes };
    if (!body.name) {
      toast("Give the equipment a name", "error");
      return;
    }
    setBusy(true);
    try {
      const result = isNew ? await api.post<EquipmentResult>("/api/equipment", body) : await api.put<EquipmentResult>("/api/equipment/" + item.key, body);
      invalidate("equipment", "exercises", "programs");
      close();
      reportSwaps(result, "Saved");
    } catch (error) {
      setBusy(false);
      errorToast(error);
    }
  };

  const remove = async () => {
    if (!item) return;
    const ok = await confirmDialog("Remove equipment", "Exercises in your plan that need it are replaced by the AI coach with suitable alternatives.", "Remove", true);
    if (!ok) return;
    try {
      const result = await api.delete<EquipmentResult>("/api/equipment/" + item.key);
      invalidate("equipment", "exercises", "programs");
      close();
      reportSwaps(result, "Removed");
    } catch (error) {
      errorToast(error);
    }
  };

  return (
    <>
      <div className="modal-head">
        <h2>{isNew ? "Add equipment" : item.name}</h2>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} data-autofocus onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {Object.entries(EQUIPMENT_CATEGORIES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <PhotoSlot
        item={current}
        onChange={(updated) => {
          setCurrent(updated);
          invalidate("equipment");
        }}
      />
      <label className="field">
        <span>Available weights in kg</span>
        <input type="text" placeholder="e.g. 2.5 5 7.5 10 or 2.5..30/2.5" value={weights} onChange={(event) => setWeights(event.target.value)} />
      </label>
      <p className="small faint">
        Separate values with spaces. 2.5..30/2.5 creates a series from 2.5 to 30 in steps of 2.5. For dumbbells enter the weight per dumbbell, for a barbell the total weight.
      </p>
      <label className="field">
        <span>Note</span>
        <input type="text" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} /> Available
      </label>
      <div className="modal-foot">
        {isNew ? null : (
          <button type="button" className="btn ghost danger left" onClick={() => void remove()}>
            Remove
          </button>
        )}
        <button type="button" className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}

export function openEquipmentEditor(item: Equipment | null): void {
  openModal((close) => <EquipmentForm item={item} close={close} />, { label: item ? item.name : "Add equipment" });
}
