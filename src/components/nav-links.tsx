"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLink {
  href: string;
  label: string;
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

// Always visible in the top bar / start of the mobile strip — the two pages
// almost everyone opens first (an overview, and the roster itself).
const primaryLinks: NavLink[] = [
  { href: "/", label: "ภาพรวม" },
  { href: "/members", label: "สมาชิก" },
];

// Grouped by what the pages are FOR, not how often they're used — mixing an
// active "run this week's event" tool with a passive "look at past records"
// one in the same menu made the categories read as arbitrary. Split into
// two: tools you use to run something now, vs. pages you check to look
// something up.
const groups: NavGroup[] = [
  {
    label: "จัดกิจกรรม",
    links: [
      { href: "/party", label: "จัดปาร์ตี้" },
      { href: "/random", label: "สุ่มสมาชิก" },
      { href: "/checkin", label: "เช็คชื่อ [DC]" },
      { href: "/loot-queue", label: "คิวประมูล" },
    ],
  },
  {
    label: "บันทึก & สถิติ",
    links: [
      { href: "/activity", label: "ประวัติกิจกรรม" },
      { href: "/attendance", label: "สถิติการลา" },
    ],
  },
];

const linkClass =
  "rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100";
const activeLinkClass = "rounded-lg px-3 py-1.5 text-sm font-medium bg-amber-600 text-white";

/** "/members" matches "/members" and "/members/123", but "/" only matches itself — otherwise every route would match the home link. */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** One top-bar dropdown for a category of pages — desktop only. Its own open/close state so the two category menus don't interfere with each other. */
function NavDropdown({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const active = group.links.some((l) => isActive(pathname, l.href));

  // Native <details> keeps its own "open" DOM state, which this layout never
  // resets on navigation (it isn't remounted between pages) — without this,
  // picking a link from the dropdown leaves it visually stuck open on the
  // page you just navigated to. Each link closes it directly on click
  // (below); this effect handles the other way to dismiss it, clicking
  // outside.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <details ref={detailsRef} open={open} className="relative">
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className={`${active ? activeLinkClass : linkClass} flex list-none cursor-pointer items-center gap-1 [&::-webkit-details-marker]:hidden`}
      >
        {group.label}
        <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`}>
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 flex w-48 flex-col gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 shadow-xl">
        {group.links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className={`block ${isActive(pathname, link.href) ? activeLinkClass : `${linkClass} hover:bg-zinc-800`}`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

/** The top-bar nav: the 2 core pages inline, everything else grouped by type into two dropdowns. */
export function DesktopNavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 sm:flex">
      {primaryLinks.map((link) => (
        <Link key={link.href} href={link.href} className={isActive(pathname, link.href) ? activeLinkClass : linkClass}>
          {link.label}
        </Link>
      ))}
      {groups.map((group) => (
        <NavDropdown key={group.label} group={group} pathname={pathname} />
      ))}
      {isAdmin && (
        <Link href="/classes" className={isActive(pathname, "/classes") ? activeLinkClass : linkClass}>
          จัดการอาชีพ
        </Link>
      )}
    </nav>
  );
}

/** Below the top bar on narrow screens: the 2 core pages stay visible, the rest (still split into the same two type-based categories, plus admin's class management) collapses behind a "···" button — flattening every link into one scrollable row got cluttered and made every page one uncertain scroll away. */
export function MobileNavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const secondaryGroups: NavGroup[] = isAdmin
    ? [...groups, { label: "ระบบ", links: [{ href: "/classes", label: "จัดการอาชีพ" }] }]
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
    <nav ref={containerRef} className="relative flex items-center gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
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
        เพิ่มเติม
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
