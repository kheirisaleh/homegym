import { api } from "@/lib/api";
import { mediaUrl } from "@/lib/catalog";
import { num, plural } from "@/lib/format";
import { groupEquipment } from "@/lib/insights";
import type { Equipment } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Page } from "@/app/Page";
import { openEquipmentEditor, toggleEquipment } from "@/features/EquipmentEditor";
import { PageHead, Switch } from "@/ui/common";


function EquipmentCard({ item }: { item: Equipment }) {
  return (
    <div className={"eq-card" + (item.available ? "" : " off")}>
      {item.photo ? (
        <div className="eq-photo">
          <img src={mediaUrl(item.photo)} alt={item.name} loading="lazy" />
        </div>
      ) : null}
      <div className="top">
        <h3>{item.name}</h3>
        <Switch checked={item.available} label={item.name + " available"} onChange={(value) => void toggleEquipment(item, value)} />
      </div>
      {item.weights ? (
        <div className="weights">
          {item.weights.slice(0, 18).map((weight) => (
            <span key={weight}>{num(weight)}</span>
          ))}
          {item.weights.length > 18 ? <span>+{item.weights.length - 18}</span> : null}
        </div>
      ) : null}
      {item.notes ? <p className="small muted">{item.notes}</p> : null}
      <div className="foot">
        <span>Used by {plural(item.exercise_count, "exercise")}</span>
        <button type="button" className="btn ghost small" onClick={() => openEquipmentEditor(item)}>
          Edit
        </button>
      </div>
    </div>
  );
}

function EquipmentView({ items }: { items: Equipment[] }) {
  const available = items.filter((item) => item.available).length;
  return (
    <>
      <PageHead
        title="Equipment"
        lead="What stands in your home gym. The coach only suggests exercises you have everything for, and only raises weights in steps you actually own. Switch something off and the AI coach replaces the affected exercises."
        actions={
          <>
            <span className="muted">
              {available} of {items.length} available
            </span>
            <button type="button" className="btn primary" onClick={() => openEquipmentEditor(null)}>
              Add equipment
            </button>
          </>
        }
      />
      {groupEquipment(items).map(([key, label, list]) => (
        <section key={key} className="eq-group">
          <h2>{label}</h2>
          <div className="eq-grid">
            {list.map((item) => (
              <EquipmentCard key={item.key} item={item} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function EquipmentPage() {
  const resource = useResource((signal) => api.get<Equipment[]>("/api/equipment", { signal }), [], ["equipment"]);
  return (
    <Page ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <EquipmentView items={resource.data} />}
    </Page>
  );
}
