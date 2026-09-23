"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CalendarDayEvent, CalendarLeaveMember, CalendarMonth } from "@/lib/calendar-data";
import { ClassBadge } from "@/components/badges";
import { MemberAvatar } from "@/components/member-avatar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const VIEW_STORAGE_KEY = "calendar-view";
type View = "month" | "rounds";

interface Round {
  key: string; // `${date}:${eventKey}`
  date: string;
  weekday: number;
  isToday: boolean;
  event: CalendarDayEvent;
}

function fmtDay(date: string, style: "short" | "long" = "short"): string {
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString("en-US", {
    weekday: style === "long" ? "long" : "short",
    day: "numeric",
    month: style === "long" ? "long" : "short",
    timeZone: "Asia/Bangkok",
  });
}

/** How heavy a round's leave count is against the roster: ≥10% is a real
 * hole in the lineup, ≥5% worth a look, anything less is routine. */
function loadTone(n: number, roster: number): { text: string; bar: string } {
  if (n === 0) return { text: "text-emerald-400", bar: "bg-emerald-400" };
  const share = roster > 0 ? n / roster : 0;
  if (share >= 0.1) return { text: "text-rose-400", bar: "bg-rose-400" };
  if (share >= 0.05) return { text: "text-amber-300", bar: "bg-amber-400" };
  return { text: "text-zinc-300", bar: "bg-zinc-500" };
}

function eventTone(eventKey: string) {
  return eventKey === "woe"
    ? { chip: "bg-indigo-400/10", label: "text-indigo-300", pill: "bg-indigo-400/15 text-indigo-300 ring-indigo-400/30" }
    : { chip: "bg-sky-400/10", label: "text-sky-300", pill: "bg-sky-400/15 text-sky-300 ring-sky-400/30" };
}

function AvatarStack({ people, max, size = 18 }: { people: CalendarLeaveMember[]; max: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <div className="flex items-center">
      {shown.map((p) => (
        <span key={p.id} title={p.name} className="-mr-1.5 inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-zinc-900" style={{ width: size, height: size }}>
          <MemberAvatar src={p.discordAvatar} alt={p.name} width={size} height={size} className="rounded-full" />
        </span>
      ))}
      {people.length > max && <span className="ml-3 text-[10px] text-zinc-500">+{people.length - max}</span>}
    </div>
  );
}

function RoundChip({ round, roster, selected, highlighted, onSelect }: { round: Round; roster: number; selected: boolean; highlighted: boolean; onSelect: () => void }) {
  const { event } = round;
  const n = event.onLeave.length;
  const tone = eventTone(event.eventKey);
  const load = loadTone(n, roster);
  const onlyVoided = n === 0 && event.voided.length > 0;
  const ring = selected ? "ring-2 ring-amber-500" : highlighted ? "ring-2 ring-pink-400" : "ring-1 ring-transparent hover:ring-zinc-600";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mt-1 w-full rounded-lg px-1.5 py-1 text-left transition ${ring} ${
        onlyVoided ? "bg-[repeating-linear-gradient(135deg,rgba(63,63,70,.3)_0_6px,transparent_6px_12px)]" : tone.chip
      }`}
    >
      <div className="flex items-center gap-1 text-[11px] font-semibold">
        <span className={onlyVoided ? "text-zinc-500" : tone.label}>{event.shortLabel}</span>
        <span className={`ml-auto tabular-nums ${onlyVoided ? "text-zinc-500" : load.text}`}>{onlyVoided ? "—" : n === 0 ? "✓ all in" : n}</span>
      </div>
      {onlyVoided ? (
        <div className="mt-0.5 text-[10px] text-zinc-500">พักการแข่ง · {event.voided.length} voided</div>
      ) : (
        <>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
            <div className={`h-full rounded-full ${load.bar}`} style={{ width: `${n === 0 ? 100 : Math.min(100, (n / Math.max(1, roster)) * 500)}%` }} />
          </div>
          {n > 0 && (
            <div className="mt-1">
              <AvatarStack people={event.onLeave} max={4} />
            </div>
          )}
          {event.voided.length > 0 && <div className="mt-0.5 text-[10px] text-zinc-500">+{event.voided.length} voided</div>}
          {event.status === "requested" && <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300">upcoming · cancellable</div>}
        </>
      )}
    </button>
  );
}

function DetailPanel({ round, calendar }: { round: Round | null; calendar: CalendarMonth }) {
  if (!round) {
    return <p className="py-6 text-center text-sm text-zinc-500">Pick a GL/WOE round to see who&apos;s out.</p>;
  }
  const { event } = round;
  const n = event.onLeave.length;
  const tone = eventTone(event.eventKey);
  const load = loadTone(n, calendar.roster);
  const upcoming = event.status === "requested";

  // Group who's out by main class, biggest hole first.
  const byClass = new Map<string, CalendarLeaveMember[]>();
  for (const m of event.onLeave) byClass.set(m.className ?? "", [...(byClass.get(m.className ?? "") ?? []), m]);
  const groups = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">{fmtDay(round.date, "long")}</h2>
        <p className="text-xs text-zinc-500">
          {event.label} · {event.timeLabel}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone.pill}`}>{event.shortLabel}</span>
          {upcoming ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">Upcoming — cancellable until {event.timeLabel.split("–")[1]}</span>
          ) : (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400">Round ended — counted</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-xl bg-zinc-950/60 p-2">
          <div className={`text-lg font-bold tabular-nums ${load.text}`}>{n}</div>
          <div className="text-[10px] text-zinc-500">on leave</div>
        </div>
        <div className="rounded-xl bg-zinc-950/60 p-2">
          <div className="text-lg font-bold tabular-nums text-zinc-100">{Math.max(0, calendar.roster - n)}</div>
          <div className="text-[10px] text-zinc-500">available</div>
        </div>
        <div className="rounded-xl bg-zinc-950/60 p-2">
          <div className="text-lg font-bold tabular-nums text-zinc-100">{calendar.roster ? Math.round(((calendar.roster - n) / calendar.roster) * 100) : 0}%</div>
          <div className="text-[10px] text-zinc-500">of roster</div>
        </div>
      </div>

      {n === 0 ? (
        <p className="rounded-xl bg-emerald-500/5 py-3 text-center text-sm text-emerald-300">✓ Nobody on leave for this round</p>
      ) : (
        <>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Class impact</p>
            <div className="flex flex-col gap-1.5">
              {groups.map(([cls, list]) => {
                const size = calendar.classSizes[cls] ?? list.length;
                return (
                  <div key={cls || "none"} className="grid grid-cols-[minmax(0,110px)_1fr_40px] items-center gap-2 text-xs">
                    <span className="truncate">{cls ? <ClassBadge className={cls} /> : <span className="text-zinc-500">No class</span>}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <span className="block h-full rounded-full bg-rose-400" style={{ width: `${Math.min(100, (list.length / Math.max(1, size)) * 100)}%` }} />
                    </span>
                    <span className="text-right tabular-nums text-zinc-400">
                      {list.length}/{size}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">On leave ({n})</p>
            <div className="flex flex-col gap-0.5">
              {groups.flatMap(([, list]) => list).map((m) => {
                const used = calendar.monthlyCounts[m.id]?.[event.eventKey] ?? 0;
                const over = used > calendar.monthlyLimit;
                return (
                  <Link key={m.id} href={`/members/${m.id}`} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-zinc-800/60">
                    <MemberAvatar src={m.discordAvatar} alt={m.name} width={26} height={26} className="h-[26px] w-[26px] shrink-0 rounded-full" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">{m.name}</div>
                      <div className="flex items-center gap-1.5">
                        <ClassBadge className={m.className} />
                        {m.note && <span className="truncate text-[10px] text-zinc-400">“{m.note}”</span>}
                      </div>
                    </div>
                    <div className="ml-auto shrink-0 text-right text-[10px]">
                      <div className="text-zinc-500">{m.source === "ADMIN" ? "by admin" : "self"}</div>
                      <div className={over ? "font-semibold text-rose-400" : "text-zinc-500"} title={`${event.shortLabel} leaves this month (guild rule: ${calendar.monthlyLimit})`}>
                        {used}/{calendar.monthlyLimit} this month{over ? " ⚠" : ""}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      {event.voided.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Voided — not counted ({event.voided.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {event.voided.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/70 py-0.5 pl-0.5 pr-2 text-[11px] text-zinc-400 line-through decoration-zinc-600">
                <MemberAvatar src={m.discordAvatar} alt={m.name} width={16} height={16} className="rounded-full opacity-60" />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {upcoming && event.boardId && (
        <Link href={`/party?board=${event.boardId}`} className="rounded-lg bg-amber-600 px-3 py-2 text-center text-xs font-medium text-white transition hover:bg-amber-500">
          Open party board
        </Link>
      )}
    </div>
  );
}

/**
 * Interactive part of /calendar: month grid (or a flat list of rounds), a
 * member search that rings every round they're out for, and a sticky panel
 * with the selected round's class impact and who's out.
 */
export function CalendarBoard({ calendar, initialSelected }: { calendar: CalendarMonth; initialSelected: string | null }) {
  const rounds = useMemo<Round[]>(
    () => calendar.days.flatMap((d) => d.events.map((event) => ({ key: `${d.date}:${event.eventKey}`, date: d.date, weekday: d.weekday, isToday: d.isToday, event }))),
    [calendar]
  );
  const defaultKey = useMemo(() => {
    const byDate = initialSelected ? rounds.find((r) => r.date === initialSelected) : undefined;
    return (byDate ?? rounds.find((r) => r.event.status === "requested") ?? rounds[rounds.length - 1])?.key ?? null;
  }, [rounds, initialSelected]);
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultKey);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("month");
  const panelRef = useRef<HTMLElement>(null);
  // Below lg the detail panel sits under the calendar — bring it into view on pick.
  function selectRound(key: string) {
    setSelectedKey(key);
    if (window.innerWidth < 1024) window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  // Remembered per browser; deferred a tick so the server-rendered frame hydrates first.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(VIEW_STORAGE_KEY);
        if (saved === "month" || saved === "rounds") setView(saved);
      } catch {
        /* ignore */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }

  const selected = rounds.find((r) => r.key === selectedKey) ?? null;
  const q = query.trim().toLowerCase();
  const matches = (r: Round) => q !== "" && r.event.onLeave.some((m) => m.name.toLowerCase().includes(q));
  const matchCount = q ? rounds.filter(matches).length : 0;

  const roundsList = (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
      {rounds.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">No GL/WOE rounds this month.</p>}
      {rounds.map((r) => {
        const n = r.event.onLeave.length;
        const tone = eventTone(r.event.eventKey);
        const load = loadTone(n, calendar.roster);
        const onlyVoided = n === 0 && r.event.voided.length > 0;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => selectRound(r.key)}
            className={`grid w-full grid-cols-[96px_52px_1fr_44px] items-center gap-3 border-t border-zinc-800 px-3 py-2.5 text-left transition first:border-t-0 hover:bg-zinc-800/40 ${
              r.key === selectedKey ? "bg-amber-500/5" : ""
            } ${matches(r) ? "shadow-[inset_3px_0_0_#f472b6]" : ""}`}
          >
            <span>
              <span className={`block text-sm font-semibold ${r.isToday ? "text-amber-300" : "text-zinc-100"}`}>{fmtDay(r.date)}</span>
              <span className="text-[11px] text-zinc-500">{r.event.timeLabel}</span>
            </span>
            <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone.pill}`}>{r.event.shortLabel}</span>
            <span className="flex min-w-0 items-center gap-3">
              {onlyVoided ? (
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-500">พักการแข่ง · {r.event.voided.length} voided</span>
              ) : n > 0 ? (
                <AvatarStack people={r.event.onLeave} max={8} size={22} />
              ) : (
                <span className="text-xs text-emerald-400">✓ everyone in</span>
              )}
              {r.event.status === "requested" && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">upcoming</span>}
            </span>
            <span className={`text-right text-base font-bold tabular-nums ${onlyVoided ? "text-zinc-600" : load.text}`}>{onlyVoided ? "—" : n}</span>
          </button>
        );
      })}
    </div>
  );

  const grid = (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
      <div className="grid grid-cols-7 bg-zinc-950/60 text-center text-[11px] font-medium uppercase tracking-wide">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`py-2 ${[0, 2, 4].includes(i) ? "text-zinc-300" : "text-zinc-600"}`}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: calendar.firstWeekday }).map((_, i) => (
          <div key={`blank-${i}`} className="min-h-[104px] border-t border-l border-zinc-800 bg-zinc-950/50 [&:nth-child(7n+1)]:border-l-0" />
        ))}
        {calendar.days.map((day) => {
          const dayNum = Number(day.date.slice(-2));
          return (
            <div
              key={day.date}
              className={`min-h-[104px] border-t border-l border-zinc-800 p-1.5 [&:nth-child(7n+1)]:border-l-0 ${day.isPast ? "bg-zinc-950/40" : ""} ${
                day.isToday ? "shadow-[inset_0_0_0_2px_#f59e0b]" : ""
              }`}
            >
              <span
                className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${
                  day.isToday ? "bg-amber-500 font-semibold text-zinc-950" : day.events.length ? (day.isPast ? "text-zinc-500" : "text-zinc-300") : "text-zinc-700"
                }`}
              >
                {dayNum}
              </span>
              {day.events.map((event) => {
                const round: Round = { key: `${day.date}:${event.eventKey}`, date: day.date, weekday: day.weekday, isToday: day.isToday, event };
                return (
                  <RoundChip
                    key={round.key}
                    round={round}
                    roster={calendar.roster}
                    selected={round.key === selectedKey}
                    highlighted={matches(round)}
                    onSelect={() => selectRound(round.key)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="hidden items-center gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-0.5 sm:flex">
          {(["month", "rounds"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${view === v ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {v === "month" ? "Month" : "Rounds"}
            </button>
          ))}
        </div>
        <div className="relative">
          <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.61 9.65l3.62 3.62a.75.75 0 1 0 1.06-1.06l-3.62-3.62A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a member…"
            className="w-52 rounded-xl border border-zinc-800 bg-zinc-900/50 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />
        </div>
        {q && <span className="text-xs text-pink-300">{matchCount ? `on leave in ${matchCount} round${matchCount === 1 ? "" : "s"}` : "no leave this month"}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-sky-400" /> GL
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-indigo-400" /> WOE
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-amber-400" /> upcoming — cancellable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-[repeating-linear-gradient(135deg,#71717a_0_2px,transparent_2px_4px)]" /> voided (พักการแข่ง)
          </span>
        </div>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {/* A 7-column grid is unreadable on a phone — below sm it's always the rounds list. */}
          <div className="sm:hidden">{roundsList}</div>
          <div className="hidden sm:block">{view === "month" ? grid : roundsList}</div>
        </div>
        <aside ref={panelRef} className="scroll-mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
          <DetailPanel round={selected} calendar={calendar} />
        </aside>
      </div>
    </div>
  );
}
