import type { CSSProperties, ReactNode } from "react";
import { canUndo, logIcon, logTone } from "@/lib/coaching";
import { initials, relativeDay } from "@/lib/format";
import { isVideo, mediaUrl } from "@/lib/catalog";
import type { LogEntry } from "@/lib/types";

export function Avatar({ name, color, size = "" }: { name: string; color: string | null | undefined; size?: "" | "big" }) {
  return (
    <span className={"avatar" + (size ? " " + size : "")} style={{ "--avatar": color || "#f2c14e" } as CSSProperties}>
      {initials(name)}
    </span>
  );
}

export function MediaTag({ name, lazy = false }: { name: string | null | undefined; lazy?: boolean }) {
  if (!name) return null;
  if (isVideo(name)) return <video src={mediaUrl(name)} autoPlay muted loop playsInline />;
  return <img src={mediaUrl(name)} alt="" loading={lazy ? "lazy" : undefined} />;
}

interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

interface SegProps<T extends string | number> {
  options: SegOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
  role?: "group" | "tablist";
}

export function Seg<T extends string | number>({ options, value, onChange, label, className = "seg", role = "group" }: SegProps<T>) {
  return (
    <div className={className} role={role} aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ChipToggles({ items, selected, onToggle, label }: { items: { key: string; label: string }[]; selected: string[]; onToggle: (key: string) => void; label?: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {items.map((item) => (
        <button key={item.key} type="button" className="chip" aria-pressed={selected.includes(item.key)} onClick={() => onToggle(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

export function LogItem({ entry, onUndo }: { entry: LogEntry; onUndo?: (entry: LogEntry) => void }) {
  const undo = Boolean(onUndo) && canUndo(entry);
  const paragraphs = entry.message ? entry.message.split("\n\n") : [];
  return (
    <div className={"feed-item" + (entry.undone ? " undone" : "")}>
      <div className={"ico " + logTone(entry.kind)}>{logIcon(entry.kind)}</div>
      <div>
        <div className="title">
          {entry.title}
          {entry.source === "ai" ? (
            <>
              {" "}
              <span className="chip ai">AI</span>
            </>
          ) : null}
        </div>
        {paragraphs.length ? (
          <div className="msg">
            {paragraphs.map((text, index) => (
              <span key={index}>
                {index ? (
                  <>
                    <br />
                    <br />
                  </>
                ) : null}
                {text}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="when">
        {relativeDay(entry.created_at.slice(0, 10))}
        {undo ? (
          <>
            <br />
            <button type="button" className="btn ghost small" onClick={() => onUndo?.(entry)}>
              Undo
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function LoadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      This page could not be loaded: {error.message}
      {onRetry ? (
        <>
          <br />
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : null}
    </div>
  );
}

export function Skeleton({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={"skeleton" + (mobile ? " mobile" : "")} aria-busy="true" aria-label="Loading">
      <i className="sk-title" />
      <div className="sk-row">
        <i />
        <i />
        <i />
      </div>
      <i className="sk-block" />
      <i className="sk-block short" />
    </div>
  );
}

export function PageHead({ title, lead, actions, back }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {back}
        <h1 style={back ? { marginTop: 10 } : undefined}>{title}</h1>
        {lead ? <p>{lead}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
