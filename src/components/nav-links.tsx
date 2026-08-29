"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLink {
  href: string;
  label: string;
}

// Kept inline in the top bar — the pages people open every session.
const primaryLinks: NavLink[] = [
  { href: "/", label: "ภาพรวม" },
  { href: "/members", label: "สมาชิก" },
  { href: "/party", label: "จัดปาร์ตี้" },
  { href: "/random", label: "สุ่มสมาชิก" },
];

// Grouped under one "กิจกรรม & บันทึก" dropdown on desktop — record-keeping
// pages people check less often, so they don't crowd the top bar. Mobile
// keeps everything flat in the scrollable strip below, since a dropdown adds
// friction on touch without saving meaningful space there.
const activityLinks: NavLink[] = [
  { href: "/activity", label: "ประวัติกิจกรรม" },
  { href: "/attendance", label: "สถิติการลา" },
  { href: "/checkin", label: "เช็คชื่อ [DC]" },
  { href: "/loot-queue", label: "คิวประมูล" },
];

const linkClass =
  "rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100";
const activeLinkClass = "rounded-lg px-3 py-1.5 text-sm font-medium bg-amber-600 text-white";

/** "/members" matches "/members" and "/members/123", but "/" only matches itself — otherwise every route would match the home link. */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The top-bar nav: primary links inline, record-keeping pages grouped under one dropdown. */
export function DesktopNavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const activityActive = activityLinks.some((l) => isActive(pathname, l.href));

  // Native <details> keeps its own "open" DOM state, which this layout never
  // resets on navigation (it isn't remounted between pages) — without this,
  // picking a link from the dropdown leaves it visually stuck open on the
  // page you just navigated to. Each dropdown link closes it directly
  // on click (below); this effect handles the other way to dismiss it,
  // clicking outside.
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  return (
    <nav className="hidden items-center gap-1 sm:flex">
      {primaryLinks.map((link) => (
        <Link key={link.href} href={link.href} className={isActive(pathname, link.href) ? activeLinkClass : linkClass}>
          {link.label}
        </Link>
      ))}
      <details ref={detailsRef} open={dropdownOpen} className="relative">
        <summary
          onClick={(e) => {
            e.preventDefault();
            setDropdownOpen((v) => !v);
          }}
          className={`${activityActive ? activeLinkClass : linkClass} flex list-none cursor-pointer items-center gap-1 [&::-webkit-details-marker]:hidden`}
        >
          กิจกรรม &amp; บันทึก
          <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 transition ${dropdownOpen ? "rotate-180" : ""}`}>
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </summary>
        <div className="absolute left-0 top-full z-20 mt-1 flex w-48 flex-col gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 shadow-xl">
          {activityLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setDropdownOpen(false)}
              className={`block ${isActive(pathname, link.href) ? activeLinkClass : `${linkClass} hover:bg-zinc-800`}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </details>
      {isAdmin && (
        <Link href="/classes" className={isActive(pathname, "/classes") ? activeLinkClass : linkClass}>
          จัดการอาชีพ
        </Link>
      )}
    </nav>
  );
}

/** Below the top bar on narrow screens: the 4 frequently-used pages stay visible, everything else (record-keeping pages, plus admin's class management) collapses behind a "···" button — flattening all ~9 links into one scrollable row got cluttered and made every page one uncertain scroll away. */
export function MobileNavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const secondaryLinks = isAdmin ? [...activityLinks, { href: "/classes", label: "จัดการอาชีพ" }] : activityLinks;
  const secondaryActive = secondaryLinks.some((l) => isActive(pathname, l.href));

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
        <div className="absolute right-4 top-full z-20 mt-1 flex w-52 flex-col gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 shadow-xl">
          {secondaryLinks.map((link) => {
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
      )}
    </nav>
  );
}
