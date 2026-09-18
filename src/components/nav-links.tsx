"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ActivityIcon,
  CalendarIcon,
  ClockIcon,
  HomeIcon,
  MicIcon,
  PartyIcon,
  QueueIcon,
  ShuffleIcon,
  SlidersIcon,
  SwordsIcon,
  UsersIcon,
} from "@/components/nav-icons";

interface NavLink {
  href: string;
  label: string;
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

// Always visible in the top bar / start of the mobile strip — the two pages
// almost everyone opens first (an overview, and the roster itself). Exported
// so the sidebar (see sidebar.tsx) renders the exact same two links instead
// of keeping a second, driftable copy of this list.
export const primaryLinks: NavLink[] = [
  { href: "/", label: "Overview" },
  { href: "/members", label: "Members" },
];

// Grouped by what the pages are FOR, not how often they're used: tools you
// use to organize/run something now (party board, random picker, loot
// queue), vs. pages you check to look something up (activity log, leave
// stats, and the check-in report — that one's a record of who showed up,
// not a tool for running the event itself). Exported for the same reason as
// primaryLinks above.
export const groups: NavGroup[] = [
  {
    label: "Events",
    links: [
      { href: "/party", label: "Party" },
      { href: "/random", label: "Random Picker" },
      { href: "/loot-queue", label: "Loot Queue" },
    ],
  },
  {
    label: "Logs & Stats",
    links: [
      { href: "/calendar", label: "Calendar" },
      { href: "/activity", label: "Activity Log" },
      { href: "/attendance", label: "Leave Stats" },
      { href: "/checkin", label: "Check-in [Voice]" },
      { href: "/pvp-stats", label: "PVP Stats" },
    ],
  },
];

// One icon per href, used by the sidebar's rows only — MobileNavLinks below
// stays icon-free (exactly as it always has been) so its compact horizontal
// strip doesn't get cramped.
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "/": HomeIcon,
  "/members": UsersIcon,
  "/party": PartyIcon,
  "/random": ShuffleIcon,
  "/loot-queue": QueueIcon,
  "/calendar": CalendarIcon,
  "/activity": ActivityIcon,
  "/attendance": ClockIcon,
  "/checkin": MicIcon,
  "/pvp-stats": SwordsIcon,
  "/classes": SlidersIcon,
};

/** "/members" matches "/members" and "/members/123", but "/" only matches itself — otherwise every route would match the home link. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** One full-width row in the sidebar's link list — icon + label, highlighted when active. */
function SidebarRow({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const Icon = ICONS[href];
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
        active ? "bg-amber-600 font-medium text-white" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
      }`}
    >
      {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * The desktop sidebar's full link list (see sidebar.tsx): primary links flat
 * at the top, then every group under its own small heading, then "Manage
 * Classes" under a "System" heading for admins — replaces the old
 * dropdown-based DesktopNavLinks now that there's a full-height rail to lay
 * links out top-to-bottom in, instead of a cramped top bar that needed
 * dropdowns to fit everything.
 */
export function SidebarNavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      <div className="flex flex-col gap-0.5">
        {primaryLinks.map((link) => (
          <SidebarRow key={link.href} href={link.href} label={link.label} pathname={pathname} />
        ))}
      </div>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">{group.label}</p>
          {group.links.map((link) => (
            <SidebarRow key={link.href} href={link.href} label={link.label} pathname={pathname} />
          ))}
        </div>
      ))}
      {isAdmin && (
        <div className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">System</p>
          <SidebarRow href="/classes" label="Manage Classes" pathname={pathname} />
        </div>
      )}
    </nav>
  );
}

/** Below the top bar on narrow screens: the 2 core pages stay visible, the rest (still split into the same two type-based categories, plus admin's class management) collapses behind a "···" button — flattening every link into one scrollable row got cluttered and made every page one uncertain scroll away. Unchanged from before — mobile keeps this exact bar; only the desktop nav (see sidebar.tsx) changed shape. */
export function MobileNavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const secondaryGroups: NavGroup[] = isAdmin
    ? [...groups, { label: "System", links: [{ href: "/classes", label: "Manage Classes" }] }]
    : groups;
  const secondaryActive = secondaryGroups.some((g) => g.links.some((l) => isActive(pathname, l.href)));

  useEffect(() => {
    if (!moreOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreOpen]);

  return (
    // Only the primary-links row scrolls horizontally — the "more" button and its
    // dropdown live outside that scroll box. `overflow-x-auto` alone forces the
    // computed overflow-y to "auto" too (CSS overflow spec: an axis can't stay
    // "visible" once the other axis isn't), which was silently clipping the
    // dropdown (positioned `top-full`, i.e. below this row) — the button worked,
    // but the menu it opened was invisible, reading as "can't press it" on mobile.
    <nav ref={containerRef} className="relative flex items-center gap-1 px-4 pb-2 sm:hidden">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {primaryLinks.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${
                active ? "bg-amber-600 font-medium text-white" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        className={`ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${
          secondaryActive ? "bg-amber-600 font-medium text-white" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
        More
      </button>
      {moreOpen && (
        <div className="absolute right-4 top-full z-20 mt-1 flex w-56 flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-2 shadow-xl">
          {secondaryGroups.map((group, i) => (
            <div key={group.label} className={i > 0 ? "border-t border-zinc-800 pt-2" : ""}>
              <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">{group.label}</p>
              <div className="flex flex-col gap-0.5">
                {group.links.map((link) => {
                  const active = isActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMoreOpen(false)}
                      className={`block rounded-lg px-3 py-1.5 text-sm ${
                        active ? "bg-amber-600 font-medium text-white" : "text-zinc-400 hover:bg-zinc-800"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
