import { useState } from "react";
import { api } from "@/lib/api";
import { formatDay } from "@/lib/format";
import { blockWeeks } from "@/lib/insights";
import { storageGet, storageSet } from "@/lib/storage";
import type { CoachState, Program } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Page } from "@/app/Page";
import { AiState, type CoachAction, CoachLogFeed, aiView, GoalsForm, useAiCheck, useCoachAction } from "@/features/coachTools";
import { NutritionCard } from "@/features/NutritionCard";
import { redesignDialog } from "@/features/programDialogs";
import { PageHead } from "@/ui/common";

const LEVELS: Record<string, string> = { all: "Everything", session: "After workouts", block: "Block reviews", deload: "Deload", equipment: "Equipment", manual: "Manual" };

function ActionRow({ title, text, label, disabled, busy, onRun }: { title: string; text: string; label: string; disabled?: boolean; busy: boolean; onRun: () => void }) {
  return (
    <div className="action-row">
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
      <button type="button" className="btn small" disabled={disabled || busy} aria-busy={busy} onClick={onRun}>
        {label}
      </button>
    </div>
  );
}

function CoachView({ coach, programs }: { coach: CoachState; programs: Program[] }) {
  const { block, settings } = coach;
  const actions = useCoachAction(false);
  const ai = useAiCheck();
  const [level, setLevel] = useState(() => storageGet("coach-filter", "all"));
  const log = coach.log.filter((entry) => level === "all" || entry.level === level);
  const row = (action: CoachAction, title: string, text: string, label: string, disabled = false) => (
    <ActionRow title={title} text={text} label={label} disabled={disabled} busy={actions.busy === action} onRun={() => void actions.run(action)} />
  );
  return (
    <>
      <PageHead
        title="Coach"
        lead="Weights go up after every workout. Sets and exercises only change at the end of a block, decided by the local AI coach within fixed rules. The plan stays stable enough to measure progress and still changes before you get stuck."
      />
      <div className="coach-grid">
        <div className="coach-column">
          <section className="panel">
            <div className="block-hero">
              <div>
                <div className="muted">Block {block.number}</div>
                <div className="big">
                  Week {block.week}
                  <span className="muted block-of"> / {block.weeks}</span>
                </div>
                <div className="muted small">
                  {block.deload ? "Deload running: half the sets at the same weight" : "Deload from " + formatDay(block.deload_from, false)}. Review on {formatDay(block.end_day, false)}.
                </div>
              </div>
              <div className="block-timeline">
                {blockWeeks(block).map((week) => (
                  <div key={week.week} className={week.classes}>
                    <i />
                    <span>{week.deload ? "Deload" : "Week " + String(week.week)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Adjust now</h2>
              <span className="hint">Otherwise this runs automatically</span>
            </div>
            <div className="action-list">
              {row(
                "progress",
                "Check progression",
                coach.pending_sessions ? String(coach.pending_sessions) + " workout(s) not evaluated yet." : "All workouts are evaluated. Checks again whether weights should go up.",
                "Check",
              )}
              {row("review", "Finish block now", "The AI coach reviews strength and volume right away, swaps stalled exercises and starts a new block.", "Finish")}
              {row("deload", "Deload now", "One week with half the sets. Useful when you are sick, travelling or tired for days.", "Start", block.deload)}
              {row("fatigue", "I am wiped out", "From week 2 on the coach starts a deload. Before that it is only noted.", "Report", block.deload)}
              {programs.map((program) => (
                <div key={program.id} className="action-row proj-hide">
                  <div>
                    <b>{program.name}</b>
                    <p>Let the AI coach rebuild this program from your exercises and equipment.</p>
                  </div>
                  <button type="button" className="btn small" onClick={() => redesignDialog(program.id)}>
                    Redesign
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Log</h2>
              <select
                className="log-filter"
                aria-label="Filter log"
                value={level}
                onChange={(event) => {
                  setLevel(event.target.value);
                  storageSet("coach-filter", event.target.value);
                }}
              >
                {Object.entries(LEVELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <CoachLogFeed key={level} log={log} initial={25} step={30} mobile={false} />
          </section>
        </div>
        <div className="coach-column">
          <section className="panel proj-hide">
            <div className="panel-head">
              <h2>AI coach</h2>
              <AiState status={ai.status} mobile={false} />
            </div>
            <p className="small muted">
              {settings.ai_provider === "gemini" ? "Runs with Google Gemini, so your training data is sent to Google." : "Runs locally with Ollama, nothing leaves your network."} It picks replacement exercises,
              redesigns programs and writes a note after every workout and every block. Weights and volume limits are always calculated by fixed rules, the AI only decides inside them.
            </p>
            <div className="form-grid ai-facts">
              <div className="field">
                <span>AI service</span>
                <div className="num">{settings.ai_provider === "gemini" ? "Google Gemini" : settings.ollama_url}</div>
              </div>
              <div className="field">
                <span>Model</span>
                <div className="num">{settings.ai_model}</div>
              </div>
            </div>
            <div className="small muted ai-help" aria-live="polite">
              {ai.status === undefined ? "" : aiView(ai.status, false).help}
            </div>
            <div className="modal-foot ai-actions">
              <button type="button" className="btn" onClick={() => void ai.check(true)}>
                Check connection
              </button>
              <a className="btn" href="/quality" target="_blank" rel="noreferrer">
                Program quality tests
              </a>
            </div>
          </section>
          <NutritionCard mobile={false} />
          <GoalsForm key={JSON.stringify(settings)} settings={settings} mobile={false} />
          <section className="panel flat proj-hide">
            <div className="panel-head">
              <h3>The rules</h3>
            </div>
            <div className="small muted rules-text">
              <p>After every workout: hit the top of the rep range in all sets and the weight goes up to the next step you actually own. Fall below the bottom on the first set twice in a row and it goes one step back.</p>
              <p>At the end of a block: sets per muscle move towards 10 to 20 per week, priority muscles up to 22. At most 2 exercise swaps per block, only for stalled exercises and only after a full block.</p>
              <p>Deload: the last week of each block, or earlier when two workouts in a row were clearly weaker.</p>
              <p>Every change can be undone from the log.</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export function CoachPage() {
  const resource = useResource(
    async (signal) => {
      const [coach, programs] = await Promise.all([api.get<CoachState>("/api/coach?log_limit=200", { signal }), api.get<Program[]>("/api/programs", { signal })]);
      return { coach, programs };
    },
    [],
    ["coach", "programs"],
  );
  return (
    <Page ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <CoachView coach={resource.data.coach} programs={resource.data.programs} />}
    </Page>
  );
}
