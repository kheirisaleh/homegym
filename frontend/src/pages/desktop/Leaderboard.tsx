import { useState } from "react";
import { api } from "@/lib/api";
import { BOARD_PARTS, CATEGORY_TEXT, nextGapText } from "@/lib/coaching";
import { storageGet, storageSet } from "@/lib/storage";
import type { Leaderboard } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Page } from "@/app/Page";
import { useUser } from "@/app/state";
import { BoardRows } from "@/features/Leaderboard";
import { PageHead, Seg } from "@/ui/common";

export type Period = "week" | "month" | "all";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
];

export function usePeriod(): [Period, (period: Period) => void] {
  const [period, setPeriod] = useState<Period>(() => {
    const saved = storageGet("board-period", "week");
    return saved === "month" || saved === "all" ? saved : "week";
  });
  return [
    period,
    (next) => {
      storageSet("board-period", next);
      setPeriod(next);
    },
  ];
}

export function BoardLegend() {
  return (
    <div className="board-legend">
      {BOARD_PARTS.map(([key, label, color]) => (
        <span key={key}>
          <i style={{ background: "var(" + color + ")" }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function BoardView({ data }: { data: Leaderboard }) {
  const user = useUser();
  return (
    <div className="board-layout">
      <section className="panel">
        <div className="panel-head">
          <h2>{data.label}</h2>
          <span className="hint">{nextGapText(data.rows, user?.id ?? null)}</span>
        </div>
        <BoardRows rows={data.rows} compact={false} />
        <BoardLegend />
      </section>
      <aside className="board-side">
        <section className="panel">
          <div className="panel-head">
            <h3>Category leaders</h3>
          </div>
          <div className="category-list">
            {BOARD_PARTS.map(([key, label]) => {
              const leader = data.categories[key];
              return (
                <div key={key} className="category">
                  <span className="muted small">{label}</span>
                  {leader ? (
                    <>
                      <b>{leader.name}</b>
                      <span className="small">{CATEGORY_TEXT[key](leader.value)}</span>
                    </>
                  ) : (
                    <span className="muted small">open</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel flat">
          <div className="panel-head">
            <h3>How points work</h3>
          </div>
          <div className="small muted points-rules">
            <p>
              <b>Consistency, up to 40.</b> Completed workouts compared with the days you planned.
            </p>
            <p>
              <b>Improvement, up to 30.</b> How much your estimated 1RM grew, in percent of your own level.
            </p>
            <p>
              <b>Personal bests, up to 20.</b> 4 points for every new best.
            </p>
            <p>
              <b>Volume, up to 10.</b> 1 point for every 10 working sets.
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}

export function LeaderboardPage() {
  const [period, setPeriod] = usePeriod();
  const resource = useResource((signal) => api.get<Leaderboard>("/api/leaderboard?period=" + period, { signal }), [period], ["session"]);
  return (
    <Page ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() =>
        resource.data && (
          <>
            <PageHead
              title="Leaderboard"
              lead="Points come from effort and your own progress, not from how heavy you lift. Everyone starts from zero every week and every month."
              actions={<Seg options={PERIODS} value={period} onChange={setPeriod} label="Period" />}
            />
            <BoardView data={resource.data} />
          </>
        )
      }
    </Page>
  );
}
