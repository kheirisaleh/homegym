import { num, plural } from "@/lib/format";
import { BOARD_PARTS } from "@/lib/coaching";
import type { LeaderboardRow } from "@/lib/types";
import { useUser } from "@/app/state";
import { Avatar } from "@/ui/common";

export function ScoreBar({ row }: { row: LeaderboardRow }) {
  return (
    <div className="score-bar" role="img" aria-label={plural(row.score, "point")}>
      {BOARD_PARTS.map(([key, label, color]) =>
        row.points[key] ? <i key={key} style={{ flex: row.points[key], background: "var(" + color + ")" }} title={label + ": " + String(row.points[key])} /> : null,
      )}
      <i className="rest" style={{ flex: Math.max(0, 100 - row.score) }} />
    </div>
  );
}

export function BoardRows({ rows, compact }: { rows: LeaderboardRow[]; compact: boolean }) {
  const user = useUser();
  if (!rows.length) return <p className="muted">Nobody has trained in this period yet.</p>;
  return (
    <div className={"board" + (compact ? " compact" : "")}>
      {rows.map((row) => (
        <div key={row.id} className={"board-row" + (row.id === user?.id ? " me" : "")}>
          <span className="board-rank">{row.rank}</span>
          <Avatar name={row.name} color={row.color} />
          <div className="board-main">
            <div className="board-name">
              <b>{row.name}</b>
              {compact ? null : (
                <span className="muted small">
                  {row.workouts} of {row.planned} workouts, {row.improvement >= 0 ? "+" : ""}
                  {num(row.improvement * 100, 1)} % strength, {plural(row.records, "best")}
                </span>
              )}
            </div>
            <ScoreBar row={row} />
          </div>
          <span className="board-score">{row.score}</span>
        </div>
      ))}
    </div>
  );
}
