import { isRouteErrorResponse, Link, useLocation, useRouteError } from "react-router";
import { isMobilePath } from "./legacy";

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? String(error.status) + " " + error.statusText : error instanceof Error ? error.message : "Unknown error";
  return (
    <div className="gate">
      <div className="gate-inner">
        <h1>Something went wrong</h1>
        <p className="gate-lead">{message}</p>
        <button type="button" className="btn primary big" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

export function NotFound() {
  const location = useLocation();
  const home = isMobilePath(location.pathname) ? "/m" : "/";
  return (
    <div className="empty not-found">
      <h2>Page not found</h2>
      <p className="muted">This page does not exist.</p>
      <Link className="btn primary" to={home}>
        Back to start
      </Link>
    </div>
  );
}
