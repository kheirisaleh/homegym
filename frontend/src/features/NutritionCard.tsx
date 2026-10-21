import { api } from "@/lib/api";
import { formatDay } from "@/lib/format";
import type { NutritionWeek } from "@/lib/types";
import { useResource } from "@/lib/useResource";

function amount(value: number | null | undefined, unit: string): string {
  return value === null || value === undefined ? "?" : String(Math.round(value)) + unit;
}

export function NutritionCard({ mobile }: { mobile: boolean }) {
  const week = useResource((signal) => api.get<NutritionWeek>("/api/nutrition/week", { signal }).catch(() => null), [], ["session"]);
  const data = week.data;
  if (!data?.status.enabled) return null;
  const max = Math.max(1, ...data.days.map((day) => day.kcal ?? 0));
  const logged = data.days.filter((day) => day.entries.length).reverse();
  const body = (
    <>
      <div className="nu-stats">
        <div>
          <b>
            {data.logged_days}
            <small>/7</small>
          </b>
          <span>days logged</span>
        </div>
        <div>
          <b>{amount(data.average.kcal, "")}</b>
          <span>kcal per day</span>
        </div>
        <div>
          <b>{amount(data.average.protein, " g")}</b>
          <span>protein per day</span>
        </div>
      </div>
      <div className="nu-bars">
        {data.days.map((day) => {
          const height = Math.round(((day.kcal ?? 0) / max) * 100);
          const label = new Date(day.day + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" });
          return (
            <div key={day.day} className={"nu-bar" + (day.entries.length ? "" : " empty")} title={day.day + ": " + amount(day.kcal, " kcal") + ", " + amount(day.protein, " g protein")}>
              <i style={{ height: String(Math.max(height, day.entries.length ? 6 : 2)) + "%" }} />
              <span>{label}</span>
            </div>
          );
        })}
      </div>
      {logged.length ? (
        <ul className="nu-list">
          {logged.map((day) => (
            <li key={day.day}>
              <b>{formatDay(day.day, false)}</b>
              <span>{day.entries.map((entry) => entry.name ?? "").filter(Boolean).join(", ")}</span>
              <em>
                {amount(day.kcal, " kcal")} · {amount(day.protein, " g protein")}
              </em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Nothing cooked at home was logged this week.</p>
      )}
      <p className="small muted">From the pantry: home cooked meals and logged snacks. The AI coach sees this when it writes notes and reviews.</p>
    </>
  );
  if (mobile) {
    return (
      <div className="m-card nu-card">
        <div className="m-card-head">
          <h2>Nutrition, last 7 days</h2>
        </div>
        {body}
      </div>
    );
  }
  return (
    <section className="panel nu-card">
      <div className="panel-head">
        <h2>Nutrition, last 7 days</h2>
        <span className="hint">from the pantry</span>
      </div>
      {body}
    </section>
  );
}
