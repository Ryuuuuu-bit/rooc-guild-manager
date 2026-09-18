// Small, deliberately plain icon glyphs (simple strokes, not traced from an
// external icon set) for the sidebar's link rows — same "minimal glyph"
// convention already used for the dashboard's stat-card icons (see
// UsersIcon/CheckIcon/etc. in src/app/(app)/page.tsx), just gathered here
// since the sidebar needs one per nav link instead of one-off per page.
// All stroke-based (uniform weight) rather than the dashboard's mix of
// fill/stroke, since a sidebar reads cleaner with one consistent line style.

interface IconProps {
  className?: string;
}

const base = "h-4 w-4";

export function HomeIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 10.5 10 4l7 6.5" />
      <path d="M5 9v7h10V9" />
    </svg>
  );
}

export function UsersIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="6.5" r="3" />
      <path d="M4 17a6 6 0 0 1 12 0" />
    </svg>
  );
}

export function PartyIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="6" height="6" rx="1.3" />
      <rect x="11" y="3" width="6" height="6" rx="1.3" />
      <rect x="3" y="11" width="6" height="6" rx="1.3" />
      <rect x="11" y="11" width="6" height="6" rx="1.3" />
    </svg>
  );
}

export function ShuffleIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 5.5h3.2c1 0 1.9.5 2.4 1.4l3 5.2c.5.9 1.4 1.4 2.4 1.4H17" />
      <path d="M14.3 5.5H17" />
      <path d="M3 14.5h3.2c1 0 1.9-.5 2.4-1.4" />
      <path d="M14.3 14.5H17" />
      <path d="M14.8 3.5 17 5.5l-2.2 2" />
      <path d="M14.8 16.5 17 14.5l-2.2-2" />
    </svg>
  );
}

export function QueueIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 5.5h14" />
      <path d="M3 10h11" />
      <path d="M3 14.5h8" />
    </svg>
  );
}

export function CalendarIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
      <path d="M3 8h14" />
      <path d="M7 3v3M13 3v3" />
    </svg>
  );
}

export function ActivityIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 11h3l1.6 4L11 5l1.8 6H17" />
    </svg>
  );
}

export function ClockIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="10.5" r="6.5" />
      <path d="M10 6.8V10.5l3 2" />
    </svg>
  );
}

export function MicIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="7.3" y="2.8" width="5.4" height="9" rx="2.7" />
      <path d="M5 10.2a5 5 0 0 0 10 0" />
      <path d="M10 15.2v2" />
      <path d="M7.5 17.2h5" />
    </svg>
  );
}

export function SwordsIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3.5 3.5 13 13" />
      <path d="M10 9l3.5 3.5-1 2.7-2.7-1L9 13" />
      <path d="M16.5 3.5 7 13" />
      <path d="M10 9 6.5 12.5l1 2.7 2.7-1L11 13" />
    </svg>
  );
}

export function SlidersIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 5.5h7M13.5 5.5H17" />
      <circle cx="10.7" cy="5.5" r="1.7" />
      <path d="M3 10h4.5M11 10H17" />
      <circle cx="8.7" cy="10" r="1.7" />
      <path d="M3 14.5h9.5M16 14.5H17" />
      <circle cx="14" cy="14.5" r="1.7" />
    </svg>
  );
}
