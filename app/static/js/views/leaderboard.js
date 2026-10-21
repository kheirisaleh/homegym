import { api, esc, num, state, storageGet, storageSet } from "../core.js?v=cycle2";
import { avatar } from "../accounts.js?v=cycle2";

export const PARTS = [
  ["consistency", "Consistency", "--plate-green"],
  ["improvement", "Improvement", "--plate-blue"],
  ["records", "Personal bests", "--accent-line"],
  ["volume", "Volume", "--plate-purple"],
];

export const CATEGORY_TEXT = {
  consistency: (value) => num(value * 100, 0) + " % of planned workouts",
  improvement: (value) => "+" + num(value * 100, 1) + " % strength",
  records: (value) => value + " new bests",
  volume: (value) => value + " working sets",
};

export function scoreBar(row) {
  return '<div class="score-bar">' + PARTS.map(([key, , color]) =>
    row.points[key] ? '<i style="flex:' + row.points[key] + ";background:var(" + color + ')" title="' + key + ": " + row.points[key] + '"></i>' : "").join("") +
    '<i class="rest" style="flex:' + Math.max(0, 100 - row.score) + '"></i></div>';
}

function pts(value) {
  return value + (value === 1 ? " point" : " points");
}

export function nextGapText(rows) {
  const mine = rows.find((row) => row.id === state.userId);
  if (!mine) return "";
  if (mine.rank === 1) return rows.length > 1 ? "You lead. " + pts(mine.score - rows[1].score) + " ahead of " + rows[1].name + "." : "You are the only one on the board this period.";
  const ahead = rows[mine.rank - 2];
  return pts(ahead.score - mine.score + 1) + " to pass " + ahead.name + ". One more workout is worth up to " + Math.ceil(40 / Math.max(1, mine.planned)) + ".";
}

export function leaderboardRows(rows, compact) {
  if (!rows.length) return '<p class="muted">Nobody has trained in this period yet.</p>';
  return '<div class="board' + (compact ? " compact" : "") + '">' + rows.map((row) =>
    '<div class="board-row' + (row.id === state.userId ? " me" : "") + '"><span class="board-rank">' + row.rank + "</span>" + avatar(row) +
    '<div class="board-main"><div class="board-name"><b>' + esc(row.name) + "</b>" + (compact ? "" : '<span class="muted small">' + row.workouts + " of " + row.planned + " workouts, " +
      (row.improvement >= 0 ? "+" : "") + num(row.improvement * 100, 1) + " % strength, " + row.records + " bests</span>") + "</div>" + scoreBar(row) + "</div>" +
    '<span class="board-score">' + row.score + "</span></div>").join("") + "</div>";
}

export async function renderLeaderboard(view) {
  const period = storageGet("board-period", "week");
  const data = await api("GET", "/api/leaderboard?period=" + period);
  view.innerHTML =
    '<div class="page-head"><div><h1>Leaderboard</h1><p>Points come from effort and your own progress, not from how heavy you lift. Everyone starts from zero every week and every month.</p></div>' +
    '<div class="seg" role="group" aria-label="Period">' + [["week", "This week"], ["month", "This month"], ["all", "All time"]].map(([key, label]) =>
      '<button data-period="' + key + '" aria-pressed="' + (period === key) + '">' + label + "</button>").join("") + "</div></div>" +
    '<div class="board-layout"><section class="panel"><div class="panel-head"><h2>' + esc(data.label) + '</h2><span class="hint">' + esc(nextGapText(data.rows)) + "</span></div>" +
    leaderboardRows(data.rows, false) +
    '<div class="board-legend">' + PARTS.map(([key, label, color]) => '<span><i style="background:var(' + color + ')"></i>' + label + "</span>").join("") + "</div></section>" +
    '<aside class="board-side"><section class="panel"><div class="panel-head"><h3>Category leaders</h3></div><div class="category-list">' +
    PARTS.map(([key, label]) => {
      const leader = data.categories[key];
      return '<div class="category"><span class="muted small">' + label + "</span>" +
        (leader ? "<b>" + esc(leader.name) + '</b><span class="small">' + esc(CATEGORY_TEXT[key](leader.value)) + "</span>" : '<span class="muted small">open</span>') + "</div>";
    }).join("") + "</div></section>" +
    '<section class="panel flat"><div class="panel-head"><h3>How points work</h3></div><div class="small muted points-rules">' +
    "<p><b>Consistency, up to 40.</b> Completed workouts compared with the days you planned.</p>" +
    "<p><b>Improvement, up to 30.</b> How much your estimated 1RM grew, in percent of your own level.</p>" +
    "<p><b>Personal bests, up to 20.</b> 4 points for every new best.</p>" +
    "<p><b>Volume, up to 10.</b> 1 point for every 10 working sets.</p></div></section></aside></div>";
  view.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", () => {
    storageSet("board-period", button.dataset.period);
    renderLeaderboard(view);
  }));
}
