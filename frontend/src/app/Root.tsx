import { useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { CoachOverlayHost } from "@/coach/overlay";
import { ModalHost } from "@/ui/modal";
import { ToastHost } from "@/ui/toast";
import { RestHost } from "@/workout/rest";
import { Gate } from "@/gate/Gate";
import { isMobilePath } from "./legacy";
import { useGate } from "./session";

export function Root() {
  const gate = useGate();
  const location = useLocation();
  const mobile = isMobilePath(location.pathname);
  const inApp = gate.kind === "app";

  useLayoutEffect(() => {
    document.body.classList.toggle("mobile", mobile);
  }, [mobile]);

  useLayoutEffect(() => {
    if (!inApp) document.body.dataset.route = "gate";
  }, [inApp]);

  return (
    <>
      {inApp ? <Outlet /> : <Gate view={gate} mobile={mobile} />}
      <ModalHost />
      {inApp ? <CoachOverlayHost /> : null}
      {inApp ? <RestHost /> : null}
      <ToastHost mobile={mobile} />
    </>
  );
}
