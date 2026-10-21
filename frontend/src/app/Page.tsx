import { type ReactNode, useEffect, useRef } from "react";
import { LoadError, Skeleton } from "@/ui/common";
import { enter, routeEnd, routeStart } from "@/ui/motion";

interface Props {
  ready: boolean;
  error?: Error | null;
  onRetry?: () => void;
  mobile?: boolean;
  className?: string;
  children: () => ReactNode;
}

export function Page({ ready, error = null, onRetry, mobile = false, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);

  useEffect(() => {
    if (ready || error) {
      routeEnd();
      return;
    }
    routeStart();
    return routeEnd;
  }, [ready, error]);

  useEffect(() => {
    if (!ready || revealed.current) return;
    revealed.current = true;
    enter(ref.current);
  }, [ready]);

  if (error && !ready) return <LoadError error={error} {...(onRetry ? { onRetry } : {})} />;
  if (!ready) return <Skeleton mobile={mobile} />;
  return (
    <div ref={ref} className={className ?? "page"}>
      {children()}
    </div>
  );
}
