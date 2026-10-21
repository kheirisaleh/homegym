import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Stroke({ size = 22, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="9" width="5" height="14" rx="1.5" />
      <rect x="25" y="9" width="5" height="14" rx="1.5" />
      <rect className="bar" x="7" y="14" width="18" height="4" />
    </svg>
  );
}

export const HomeIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
  </Stroke>
);

export const TrainIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M2 9v6M5 6v12M19 6v12M22 9v6M5 12h14" />
  </Stroke>
);

export const PlanIcon = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Stroke>
);

export const ProgressIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M4 19l5-6 4 3 7-9" />
    <path d="M15 7h5v5" />
  </Stroke>
);

export const MoreIcon = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </Stroke>
);

export const ProjectorIcon = (props: IconProps) => (
  <Stroke strokeWidth={1.8} {...props}>
    <rect x="2" y="7" width="20" height="10" rx="2" />
    <circle cx="16" cy="12" r="3" />
    <path d="M6 17v2M18 17v2" />
  </Stroke>
);

export const TrophyIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
  </Stroke>
);

export const WhistleIcon = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="9" cy="15" r="5" />
    <path d="M13 12l8-4v4l-6 2M9 15h.01" />
  </Stroke>
);

export const CompassIcon = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </Stroke>
);

export const HeartIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
  </Stroke>
);

export const FilmIcon = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </Stroke>
);

export const DumbbellIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" />
  </Stroke>
);

export const GearIcon = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Stroke>
);

export const MonitorIcon = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Stroke>
);

export const UsersIcon = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
  </Stroke>
);

export const CameraIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Stroke>
);

export const CloseIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Stroke>
);

export const LockIcon = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Stroke>
);

export function SexIcon({ sex }: { sex: "male" | "female" }) {
  return sex === "female" ? (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="18" r="10" />
      <path d="M24 28v14M17 36h14" />
    </svg>
  ) : (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="20" cy="28" r="10" />
      <path d="M27 21l12-12M30 9h9v9" />
    </svg>
  );
}
