import { type ReactNode, useRef } from "react";
import type { GateView } from "@/app/session";
import { useEnter } from "@/ui/motion";
import { Generating, Ready } from "./Generating";
import { Onboarding } from "./Onboarding";
import { Picker } from "./Picker";

export function Gate({ view, mobile }: { view: GateView; mobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEnter(ref, true, view.kind);
  let content: ReactNode;
  if (view.kind === "picker") content = <Picker mobile={mobile} />;
  else if (view.kind === "onboarding") content = <Onboarding mobile={mobile} hasUsers={view.hasUsers} />;
  else if (view.kind === "generating") content = <Generating user={view.user} mobile={mobile} />;
  else if (view.kind === "ready") content = <Ready user={view.user} mobile={mobile} />;
  else if (view.kind === "offline") {
    content = (
      <div className="gate-inner">
        <h1>Server not reachable</h1>
        <p className="gate-lead">The home server did not answer. Check that it is running, then try again.</p>
        <button type="button" className="btn primary big" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  } else {
    content = (
      <div className="gate-inner">
        <div className="gen-visual" aria-label="Loading">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  }
  return (
    <div className="gate" ref={ref}>
      {content}
    </div>
  );
}
