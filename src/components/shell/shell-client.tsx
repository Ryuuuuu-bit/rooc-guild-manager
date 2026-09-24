"use client";

// The app chrome's interactive parts: shared live status (badges, next
// event), the sidebar's links, the sticky top bar, the phone bottom bar +
// "More" sheet, and the Ctrl+K command palette. The page list itself lives
// in src/lib/nav-config.ts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { AppIcon } from "./app-icon";
import { MemberAvatar } from "@/components/member-avatar";
import { getNavStatus, getPaletteMembers, type NavStatus, type PaletteMember } from "@/app/actions/nav";
import { NAV_GROUP_LABELS, isNavActive, navItemsFor, type NavItem } from "@/lib/nav-config";

// --- shared status ---------------------------------------------------------------

interface ShellCtx {
  isAdmin: boolean;
  status: NavStatus | null;
  openPalette: () => void;
}
const Ctx = createContext<ShellCtx>({ isAdmin: false, status: null, openPalette: () => {} });
const useShell = () => useContext(Ctx);

/** Ticks every 30s (client only — null during SSR / first paint, so no hydration mismatch). */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const iv = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
    };
  }, []);
  return now;
}

function fmtIn(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ShellProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<NavStatus | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Refresh on navigation and once a minute. Failures just keep the last value.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getNavStatus()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    const first = setTimeout(load, 300);
    const iv = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const value = useMemo(() => ({ isAdmin, status, openPalette }), [isAdmin, status, openPalette]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </Ctx.Provider>
  );
}

// --- badges ----------------------------------------------------------------------

function useBadge(item: NavItem): { text: string; tone: "red" | "amber" | "live"; hint: string } | null {
  const { status } = useShell();
  if (!item.badge || !status) return null;
  if (item.badge === "checkin") return status.live ? { text: "LIVE", tone: "live", hint: `${status.live.label} is on now` } : null;
  const b = status.badges[item.badge];
  return b ? { text: b.count > 99 ? "99+" : String(b.count), tone: b.tone, hint: b.hint } : null;
}

const BADGE_TONE = {
  red: "bg-rose-600 text-white",
  amber: "bg-amber-500/20 text-amber-200",
  live: "bg-emerald-500/15 text-emerald-300",
} as const;

function Badge({ badge, compact = false }: { badge: NonNullable<ReturnType<typeof useBadge>>; compact?: boolean }) {
  if (badge.tone === "live") {
    return compact ? (
      <span className="absolute right-2 top-1.5 h-2 w-2 animate-pulse rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
    ) : (
      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-bold leading-[17px] ${BADGE_TONE.live}`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        LIVE
      </span>
    );
  }
  return (
    <span
      className={`${compact ? "absolute right-1 top-0.5 min-w-[15px] px-1 text-[9px] leading-[15px]" : "min-w-[18px] px-1.5 text-[10px] leading-[17px]"} rounded-full text-center font-bold ${BADGE_TONE[badge.tone]}`}
    >
      {badge.text}
    </span>
  );
}

// --- sidebar -------------------------------------------------------------------------

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavActive(pathname, item.href);
  const badge = useBadge(item);
  return (
    <Link
      href={item.href}
      title={badge ? `${item.label} · ${badge.hint}` : item.label}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition md:justify-center md:px-0 lg:justify-start lg:px-3 ${
        active
          ? "bg-gradient-to-r from-[rgba(245,208,138,0.10)] to-[rgba(245,208,138,0.02)] text-zinc-50 shadow-[inset_2px_0_0_#e9b95f]"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
      }`}
    >
      <AppIcon name={item.icon} className={active ? "text-[#f0c877]" : "text-zinc-500 transition group-hover:text-zinc-200"} />
      <span className="min-w-0 flex-1 truncate md:hidden lg:inline">{item.label}</span>
      {badge && (
        <>
          <span className="md:hidden lg:inline-flex">
            <Badge badge={badge} />
          </span>
          <span className="hidden md:inline lg:hidden">
            <Badge badge={badge} compact />
          </span>
        </>
      )}
    </Link>
  );
}

function NextEventCard() {
  const { status } = useShell();
  const now = useNow();
  if (!status || now == null || (!status.live && !status.next)) return null;
  return (
    <Link
      href="/checkin"
      className="mx-3 mb-2 hidden rounded-xl border border-zinc-800 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(56,189,248,0.12),transparent_60%)] p-2.5 transition hover:border-zinc-700 lg:block"
    >
      {status.live ? (
        <>
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{status.live.label} · on now</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE
            <span className="text-xs font-normal text-zinc-500">· ends in {fmtIn(new Date(status.live.endsAt).getTime() - now)}</span>
          </div>
        </>
      ) : (
        status.next && (
          <>
            <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Next · {status.next.label}</div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-100">starts in {fmtIn(new Date(status.next.startsAt).getTime() - now)}</div>
          </>
        )
      )}
      <div className="mt-1 flex gap-3 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <AppIcon name="mic" size={12} /> {status.inVoice} in voice
        </span>
        {status.onLeave != null && (
          <span className="inline-flex items-center gap-1">
            <AppIcon name="calx" size={12} /> {status.onLeave} on leave
          </span>
        )}
      </div>
    </Link>
  );
}

export function SidebarNav({ username, avatarUrl, signOut }: { username: string; avatarUrl: string; signOut: ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, openPalette } = useShell();
  const items = navItemsFor(isAdmin);
  const groups = (["main", "events", "logs", "system"] as const).map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);

  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-zinc-900 bg-[#0b0b0d] md:flex md:w-[4.25rem] lg:w-60">
      <Link href="/" className="flex items-center gap-2.5 px-4 pb-2 pt-4 md:justify-center md:px-0 lg:justify-start lg:px-4">
        <Image src="/brand/divine-icon.png" alt="Divine" width={32} height={32} unoptimized className="h-8 w-8 rounded-[10px] object-cover shadow-[0_0_0_1px_rgba(245,208,138,0.45),0_6px_18px_rgba(217,119,6,0.18)]" />
        <span className="flex flex-col leading-tight md:hidden lg:flex">
          <span className="text-[15px] font-semibold text-zinc-50">Divine</span>
          <span className="text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">Guild Manager</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={openPalette}
        title="Search (Ctrl K)"
        className="mx-3 mb-2 mt-1 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[12.5px] text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300 md:justify-center md:px-0 lg:justify-start lg:px-2.5"
      >
        <AppIcon name="search" size={15} />
        <span className="md:hidden lg:inline">Search…</span>
        <kbd className="ml-auto rounded border border-zinc-700 border-b-2 bg-zinc-800 px-1 font-mono text-[10px] text-zinc-400 md:hidden lg:inline">Ctrl K</kbd>
      </button>
      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-2 md:px-2 lg:px-3">
        {groups.map(({ g, items: gi }) => (
          <div key={g} className="flex flex-col gap-0.5">
            {NAV_GROUP_LABELS[g] && (
              <p className="px-3 pb-1 text-[9.5px] font-medium uppercase tracking-[0.14em] text-zinc-600 md:hidden lg:block">{NAV_GROUP_LABELS[g]}</p>
            )}
            {g !== "main" && <span className="mx-auto mb-1 hidden h-px w-6 bg-zinc-800 md:block lg:hidden" />}
            {gi.map((item) => (
              <SidebarLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        ))}
      </nav>
      <NextEventCard />
      <div className="flex items-center gap-2.5 border-t border-zinc-900 px-4 py-3 md:justify-center md:px-0 lg:justify-start lg:px-4">
        <Image src={avatarUrl} alt={username} width={30} height={30} unoptimized className="h-[30px] w-[30px] shrink-0 rounded-full ring-1 ring-zinc-700" title={username} />
        <div className="min-w-0 flex-1 md:hidden lg:block">
          <p className="truncate text-[13px] text-zinc-200">{username}</p>
          {isAdmin && <p className="text-[10px] font-medium text-rose-300">Admin</p>}
        </div>
        <span className="md:hidden lg:block">{signOut}</span>
      </div>
    </aside>
  );
}

// --- top bar ----------------------------------------------------------------------------

export function TopBar({ signOut }: { signOut: ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, status, openPalette } = useShell();
  const current = navItemsFor(isAdmin).find((i) => isNavActive(pathname, i.href));
  const group = current ? NAV_GROUP_LABELS[current.group] : null;
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-zinc-900 bg-zinc-950/80 px-3 py-2.5 backdrop-blur-md sm:px-5 lg:px-7">
      <Link href="/" className="md:hidden">
        <Image src="/brand/divine-icon.png" alt="Divine" width={28} height={28} unoptimized className="h-7 w-7 rounded-[9px] object-cover shadow-[0_0_0_1px_rgba(245,208,138,0.45)]" />
      </Link>
      <div className="min-w-0 truncate text-[12.5px] text-zinc-500">
        {group && <span className="hidden sm:inline">{group} / </span>}
        <span className="font-semibold text-zinc-100">{current?.label ?? "Divine"}</span>
      </div>
      <span className="flex-1" />
      <button
        type="button"
        onClick={openPalette}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
        aria-label="Search"
      >
        <AppIcon name="search" size={15} />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-zinc-700 border-b-2 bg-zinc-800 px-1 font-mono text-[10px] text-zinc-400 lg:inline">Ctrl K</kbd>
      </button>
      {status?.live && (
        <Link href="/checkin" className="flex items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-2.5 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span className="max-w-[9rem] truncate">{status.live.label}</span>
          <span className="hidden sm:inline">LIVE</span>
        </Link>
      )}
      <span className="md:hidden">{signOut}</span>
    </header>
  );
}

// --- phone bottom bar + "More" sheet --------------------------------------------------------

function TabBadge({ item }: { item: NavItem }) {
  const badge = useBadge(item);
  if (!badge) return null;
  if (badge.tone === "live") return <span className="absolute left-[calc(50%+6px)] top-0 h-2 w-2 animate-pulse rounded-full bg-emerald-400 ring-2 ring-zinc-950" />;
  return (
    <span className={`absolute left-[calc(50%+4px)] top-[-2px] min-w-[16px] rounded-full px-1 text-center text-[9.5px] font-bold leading-4 ${BADGE_TONE[badge.tone]}`}>{badge.text}</span>
  );
}

function SheetItem({ item, active, onPick }: { item: NavItem; active: boolean; onPick: () => void }) {
  const badge = useBadge(item);
  return (
    <Link
      href={item.href}
      onClick={onPick}
      className={`relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center text-xs ${
        active ? "border-amber-600/60 bg-amber-600/10 text-amber-100" : "border-zinc-800 bg-zinc-900 text-zinc-300"
      }`}
    >
      <AppIcon name={item.icon} size={22} className={active ? "text-[#f0c877]" : "text-zinc-400"} />
      {item.label}
      {badge && (
        <span className="absolute right-1.5 top-1.5">
          <Badge badge={badge} />
        </span>
      )}
    </Link>
  );
}

export function BottomBar() {
  const pathname = usePathname();
  const { isAdmin, status } = useShell();
  const [open, setOpen] = useState(false);
  const items = navItemsFor(isAdmin);
  const tabs = items.filter((i) => i.tab);
  const rest = items.filter((i) => !i.tab);
  const restActive = rest.some((i) => isNavActive(pathname, i.href));
  const restAlert = status ? rest.some((i) => i.badge && i.badge !== "checkin" && status.badges[i.badge as keyof NavStatus["badges"]]?.tone === "red") : false;

  // Close the sheet on navigation (DOM-driven close happens via onPick too).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      const t = setTimeout(() => setOpen(false), 0);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-zinc-700 bg-zinc-950 px-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-2.5 transition-transform duration-200 md:hidden ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        aria-hidden={!open}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-700" />
        <div className="grid grid-cols-3 gap-2">
          {rest.map((item) => (
            <SheetItem key={item.href} item={item} active={isNavActive(pathname, item.href)} onPick={() => setOpen(false)} />
          ))}
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-zinc-800 bg-zinc-950/95 px-1 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden">
        {tabs.map((item) => {
          const active = isNavActive(pathname, item.href) && !open;
          return (
            <Link key={item.href} href={item.href} className={`relative flex flex-col items-center gap-0.5 py-0.5 text-[10.5px] ${active ? "text-[#f0c877]" : "text-zinc-500"}`}>
              <AppIcon name={item.icon} size={21} />
              {item.tab}
              <TabBadge item={item} />
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`relative flex flex-col items-center gap-0.5 py-0.5 text-[10.5px] ${open || restActive ? "text-[#f0c877]" : "text-zinc-500"}`}
        >
          <AppIcon name="menu" size={21} />
          More
          {restAlert && <span className="absolute left-[calc(50%+6px)] top-0 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-zinc-950" />}
        </button>
      </nav>
    </>
  );
}

// --- command palette ---------------------------------------------------------------------------

interface PaletteItem {
  key: string;
  section: string;
  label: string;
  hint?: string;
  href: string;
  icon: ReactNode;
}

const ADMIN_ACTIONS: { label: string; href: string; icon: string }[] = [
  { label: "Run a loot round", href: "/loot-queue", icon: "loot" },
  { label: "Find subs on the party board", href: "/party", icon: "party" },
  { label: "Members needing attention", href: "/members?attn=pvp", icon: "users" },
];
const COMMON_ACTIONS: { label: string; href: string; icon: string }[] = [
  { label: "Today's voice check-in", href: "/checkin", icon: "mic" },
  { label: "This month's leave stats", href: "/attendance", icon: "clock" },
];

let paletteMembersCache: PaletteMember[] | null = null;

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { isAdmin, status } = useShell();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [membersList, setMembersList] = useState<PaletteMember[]>(paletteMembersCache ?? []);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    if (!paletteMembersCache) {
      getPaletteMembers()
        .then((m) => {
          paletteMembersCache = m;
          setMembersList(m);
        })
        .catch(() => {});
    }
    return () => clearTimeout(t);
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const query = q.trim().toLowerCase();
    const match = (s: string) => !query || s.toLowerCase().includes(query);
    const out: PaletteItem[] = [];
    if (query) {
      for (const m of membersList.filter((m) => match(m.name)).slice(0, 6)) {
        out.push({
          key: `m-${m.id}`,
          section: "Members",
          label: m.name,
          hint: m.className ?? undefined,
          href: `/members/${m.id}`,
          icon: (
            <span className="relative inline-block h-5 w-5 overflow-hidden rounded-full ring-1 ring-zinc-700">
              <MemberAvatar src={m.avatar} alt="" fill sizes="20px" className="object-cover" />
            </span>
          ),
        });
      }
    }
    for (const it of navItemsFor(isAdmin).filter((i) => match(i.label))) {
      const b = it.badge && it.badge !== "checkin" ? status?.badges[it.badge] : undefined;
      out.push({ key: `p-${it.href}`, section: "Pages", label: it.label, hint: b?.hint ?? (it.badge === "checkin" && status?.live ? "Live now" : undefined), href: it.href, icon: <AppIcon name={it.icon} size={17} /> });
    }
    for (const a of [...(isAdmin ? ADMIN_ACTIONS : []), ...COMMON_ACTIONS].filter((a) => match(a.label))) {
      out.push({ key: `a-${a.label}`, section: "Quick actions", label: a.label, href: a.href, icon: <AppIcon name={a.icon} size={17} /> });
    }
    return out;
  }, [q, membersList, isAdmin, status]);

  const selected = Math.min(sel, Math.max(0, items.length - 1));

  function pick(it: PaletteItem | undefined) {
    if (!it) return;
    onClose();
    router.push(it.href);
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  let lastSection = "";
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-3 pt-[10vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[620px] overflow-hidden rounded-2xl border border-zinc-700 bg-[#0f0f11] shadow-2xl shadow-black/70">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4">
          <AppIcon name="search" size={17} className="text-zinc-500" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel(Math.min(items.length - 1, selected + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel(Math.max(0, selected - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(items[selected]);
              }
            }}
            placeholder="Search pages, members or actions…"
            className="w-full bg-transparent py-3.5 text-[15px] text-zinc-50 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-1.5">
          {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-zinc-500">No results</p>}
          {items.map((it, i) => {
            const header = it.section !== lastSection ? it.section : null;
            lastSection = it.section;
            return (
              <div key={it.key}>
                {header && <p className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-[0.12em] text-zinc-600">{header}</p>}
                <button
                  type="button"
                  data-idx={i}
                  onMouseMove={() => i !== selected && setSel(i)}
                  onClick={() => pick(it)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] ${i === selected ? "bg-zinc-800/80 text-zinc-50" : "text-zinc-300"}`}
                >
                  <span className={`flex w-5 justify-center ${i === selected ? "text-[#f0c877]" : "text-zinc-500"}`}>{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="max-w-[45%] truncate text-[11px] text-zinc-500">{it.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden gap-4 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500 sm:flex">
          <span>↑↓ select</span>
          <span>Enter open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
