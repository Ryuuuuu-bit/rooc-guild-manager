// Thin-line icon set for the app chrome (sidebar, bottom bar, command
// palette, buttons). One 24px grid, one 1.6 stroke, round caps — drawn for
// this app, not traced from an external set. Class emojis stay emojis: those
// are admin-configured per class and shared with Discord.
import type { ReactElement } from "react";

const P: Record<string, ReactElement> = {
  home: <path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.8H9.2v5.8H5A1.5 1.5 0 0 1 3.5 19z" />,
  users: (
    <>
      <circle cx="9" cy="8.2" r="3.3" />
      <path d="M2.8 20c.4-3.4 3-5.6 6.2-5.6s5.8 2.2 6.2 5.6" />
      <path d="M15.6 5.2a3 3 0 0 1 0 5.9M17.4 14.7c2.2.6 3.6 2.6 3.8 5.3" />
    </>
  ),
  party: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  random: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.5" cy="8.5" r=".9" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r=".9" fill="currentColor" />
      <circle cx="12" cy="12" r=".9" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r=".9" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r=".9" fill="currentColor" />
    </>
  ),
  loot: (
    <>
      <rect x="3.5" y="8" width="17" height="4.5" rx="1" />
      <path d="M5.5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-6.5M12 8v12.5" />
      <path d="M12 8C10.4 5 7 4.2 7 6.4 7 7.6 8.6 8 12 8zm0 0c1.6-3 5-3.8 5-1.6C17 7.6 15.4 8 12 8z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 9.8h17M8.2 3v4M15.8 3v4" />
    </>
  ),
  activity: <path d="M3 12h3.6l2.6-6.5 5.6 13 2.6-6.5H21" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.2" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.3" />
    </>
  ),
  swords: (
    <>
      <path d="M14.5 17.5 4 7V4h3l10.5 10.5M13 19l6-6M16 16l4 4M19 21l2-2" />
      <path d="M9.5 14.5 6 18M4.5 16.5l3 3M3 20.5l1.5-1.5M14 9l6-6h1v1l-6 6" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" />
      <circle cx="15" cy="6.5" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  logout: <path d="M14.5 4h3.5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 8l-4 4 4 4M6 12h9.5" />,
  calx: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 9.8h17M8.2 3v4M15.8 3v4M10 13l4 4M14 13l-4 4" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.5-3.6 3.3-6 7-6s6.5 2.4 7 6" />
    </>
  ),
};

export type AppIconName = keyof typeof P;

export function AppIcon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {P[name] ?? null}
    </svg>
  );
}
