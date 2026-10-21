import { type DragEvent, useState } from "react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { muscleColorVar } from "@/lib/catalog";
import { plural, relativeDay, weekdayIndex, WEEKDAYS } from "@/lib/format";
import { muscleStripe } from "@/lib/insights";
import { invalidate } from "@/lib/store";
import type { Program } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { programBody } from "@/lib/workout";
import { Page } from "@/app/Page";
import { muscleLabel } from "@/app/state";
import { CycleCard, useCycleState } from "@/features/cycle";
import { rebuildDialog } from "@/features/programDialogs";
import { PageHead } from "@/ui/common";
import { errorToast, toast } from "@/ui/toast";

const DRAG_TYPE = "text/program";


function ProgramCard({ program }: { program: Program }) {
  const stripe = muscleStripe(program);
  return (
    <Link
      className="prog-card"
      draggable
      to={"/programs/" + String(program.id)}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(program.id));
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      {stripe.length ? (
        <div className="stripe" aria-hidden="true">
          {stripe.map((entry) => (
            <i key={entry.muscle} style={{ flex: entry.share, background: muscleColorVar(entry.muscle) }} title={muscleLabel(entry.muscle)} />
          ))}
        </div>
      ) : null}
      <h3>{program.name}</h3>
      <div className="ex">
        {program.items.slice(0, 6).map((item, index) => (
          <span key={String(item.id ?? index)}>
            {item.sets} × {item.name}
          </span>
        ))}
        {program.items.length > 6 ? <span>and {program.items.length - 6} more</span> : null}
      </div>
      <div className="foot">
        <span>{plural(program.total_sets, "set")}</span>
        <span>{program.last_done ? relativeDay(program.last_done) : "never"}</span>
      </div>
    </Link>
  );
}

function DropColumn({ day, className, onDrop, children }: { day: number | null; className: string; onDrop: (programId: number, day: number | null) => void; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <div
      className={className + (over ? " drop" : "")}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const id = Number(event.dataTransfer.getData(DRAG_TYPE));
        if (id) onDrop(id, day);
      }}
    >
      {children}
    </div>
  );
}

function ProgramsView({ programs }: { programs: Program[] }) {
  const cycle = useCycleState();
  const todayIndex = weekdayIndex(new Date());
  const byDay: Program[][] = Array.from({ length: 7 }, () => []);
  const unassigned: Program[] = [];
  for (const program of programs) {
    if (program.weekday === null) unassigned.push(program);
    else byDay[program.weekday]?.push(program);
  }
  const move = async (programId: number, weekday: number | null) => {
    const program = programs.find((entry) => entry.id === programId);
    if (!program || program.weekday === weekday) return;
    try {
      await api.put("/api/programs/" + String(programId), programBody(program, program.items, { weekday }));
      invalidate("programs");
      toast(program.name + " is now " + (weekday === null ? "without a fixed day" : "on " + (WEEKDAYS[weekday] ?? "")));
    } catch (error) {
      errorToast(error);
    }
  };
  return (
    <>
      <PageHead
        title="Programs"
        lead="Your weekly plan. Drag a card to another day to move it. The coach adjusts weights after every workout, and sets and exercises at the end of each block."
        actions={
          <>
            <button type="button" className="btn" onClick={() => void rebuildDialog()}>
              Rebuild with coach
            </button>
            <Link className="btn primary" to="/programs/new">
              New program
            </Link>
          </>
        }
      />
      {cycle?.eligible ? (
        <div className="cycle-desktop cycle-slot">
          <CycleCard cycle={cycle} compact={false} healthHref="/health" />
        </div>
      ) : null}
      <div className="week-board">
        {byDay.map((list, index) => (
          <DropColumn key={WEEKDAYS[index]} day={index} className={"day-col" + (index === todayIndex ? " is-today" : "")} onDrop={(id, day) => void move(id, day)}>
            <div className="day-name">
              <span>{WEEKDAYS[index]}</span>
              {index === todayIndex ? <span>today</span> : null}
            </div>
            {list.map((program) => (
              <ProgramCard key={program.id} program={program} />
            ))}
          </DropColumn>
        ))}
      </div>
      {unassigned.length ? (
        <div className="unassigned">
          <h2>No fixed day</h2>
          <DropColumn day={null} className="week-board" onDrop={(id, day) => void move(id, day)}>
            {unassigned.map((program) => (
              <ProgramCard key={program.id} program={program} />
            ))}
          </DropColumn>
        </div>
      ) : null}
    </>
  );
}

export function ProgramsPage() {
  const resource = useResource((signal) => api.get<Program[]>("/api/programs", { signal }), [], ["programs"]);
  return (
    <Page ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <ProgramsView programs={resource.data} />}
    </Page>
  );
}
