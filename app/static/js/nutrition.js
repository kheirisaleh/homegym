import { api, esc, formatDay } from "./core.js?v=cycle2";

function value(number, unit) {
  return number === null || number === undefined ? "?" : Math.round(number) + unit;
}

export async function mountNutrition(slot, { mobile } = {}) {
  if (!slot) return;
  let data;
  try {
    data = await api("GET", "/api/nutrition/week");
  } catch (error) {
    slot.remove();
    return;
  }
  if (!data.status.enabled) {
    slot.remove();
    return;
  }
  const days = data.days.filter((day) => day.entries.length);
  const max = Math.max(1, ...data.days.map((day) => day.kcal || 0));
  const bars = data.days.map((day) => {
    const height = Math.round(((day.kcal || 0) / max) * 100);
    const label = new Date(day.day + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" });
    return '<div class="nu-bar' + (day.entries.length ? "" : " empty") + '" title="' + esc(day.day + ": " + value(day.kcal, " kcal") + ", " + value(day.protein, " g protein")) +
      '"><i style="height:' + Math.max(height, day.entries.length ? 6 : 2) + '%"></i><span>' + esc(label) + "</span></div>";
  }).join("");
  const list = days.slice().reverse().map((day) =>
    '<li><b>' + esc(formatDay(day.day, false)) + "</b><span>" + esc(day.entries.map((entry) => entry.name).join(", ")) + '</span><em>' +
    value(day.kcal, " kcal") + " · " + value(day.protein, " g protein") + "</em></li>").join("");
  const average = data.average;
  const body = '<div class="nu-stats"><div><b>' + data.logged_days + '<small>/7</small></b><span>days logged</span></div><div><b>' + value(average.kcal, "") +
    '</b><span>kcal per day</span></div><div><b>' + value(average.protein, " g") + '</b><span>protein per day</span></div></div>' +
    '<div class="nu-bars">' + bars + "</div>" +
    (list ? '<ul class="nu-list">' + list + "</ul>" : '<p class="small muted">Nothing cooked at home was logged this week.</p>') +
    '<p class="small muted">From the pantry: home cooked meals and logged snacks. The AI coach sees this when it writes notes and reviews.</p>';
  slot.outerHTML = mobile
    ? '<div class="m-card nu-card"><div class="m-card-head"><h2>Nutrition, last 7 days</h2></div>' + body + "</div>"
    : '<section class="panel nu-card"><div class="panel-head"><h2>Nutrition, last 7 days</h2><span class="hint">from the pantry</span></div>' + body + "</section>";
}
