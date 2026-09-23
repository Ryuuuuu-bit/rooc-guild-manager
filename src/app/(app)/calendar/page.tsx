import Link from "next/link";
import { getCalendarMonth, getNextRound, type CalendarLeaveMember } from "@/lib/calendar-data";
import { thaiDateString } from "@/lib/checkin-data";
import { requireUser } from "@/lib/authz";
import { CalendarBoard } from "@/components/calendar-board";
import { MemberAvatar } from "@/components/member-avatar";

interface SearchParams {
  y?: string;
  m?: string;
  d?: string;
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
}

/** "in 16h 45m" / "in 3d 4h" / "live now" — rendered on the server per request. */
function countdown(startIso: string, endIso: string, now: Date): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const t = now.getTime();
  if (t >= start && t < end) return "live now";
  const mins = Math.max(0, Math.round((start - t) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d > 0 ? `in ${d}d ${h}h` : `in ${h}h ${m}m`;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const params = await searchParams;
  const now = new Date();

  const todayStr = thaiDateString(now);
  const [todayYear, todayMonth] = todayStr.split("-").map(Number);
  const yParam = Number(params.y);
  const mParam = Number(params.m);
  const year = Number.isInteger(yParam) && yParam >= 2020 && yParam <= 2100 ? yParam : todayYear;
  const month = Number.isInteger(mParam) && mParam >= 1 && mParam <= 12 ? mParam : todayMonth;

  const [calendar, nextRound] = await Promise.all([getCalendarMonth(year, month), getNextRound(now)]);

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const isCurrentMonth = year === todayYear && month === todayMonth;
  const initialSelected = params.d && /^\d{4}-\d{2}-\d{2}$/.test(params.d) ? params.d : isCurrentMonth ? todayStr : null;

  // Month roll-up: counted (round ended), voided, still-cancellable.
  const events = calendar.days.flatMap((d) => d.events);
  const counted = events.filter((e) => e.status === "confirmed").reduce((sum, e) => sum + e.onLeave.length, 0);
  const upcoming = events.filter((e) => e.status === "requested").reduce((sum, e) => sum + e.onLeave.length, 0);
  const voided = events.reduce((sum, e) => sum + e.voided.length, 0);

  // Who's used the most leave this month, per event (the quota is per board).
  const people = new Map<string, CalendarLeaveMember>();
  for (const e of events) for (const m of e.onLeave) people.set(m.id, m);
  const topAbsent = Object.entries(calendar.monthlyCounts)
    .flatMap(([id, perEvent]) => Object.entries(perEvent).map(([eventKey, n]) => ({ member: people.get(id), eventKey, n })))
    .filter((x): x is { member: CalendarLeaveMember; eventKey: string; n: number } => Boolean(x.member))
    .sort((a, b) => b.n - a.n || a.member.name.localeCompare(b.member.name, "th"))
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Calendar</h1>
        <p className="mt-1 text-sm text-zinc-400">Who&apos;s on leave for each GL/WOE round — same data as the party board and /checkin.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr]">
        <div className="rounded-2xl border border-zinc-800 bg-[linear-gradient(135deg,rgba(56,189,248,.12),transparent_60%)] p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Next round</p>
          {nextRound ? (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-xl font-bold text-zinc-50">{nextRound.label}</span>
                <span className="text-sm font-medium tabular-nums text-sky-300">{countdown(nextRound.start, nextRound.end, now)}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {fmtDay(nextRound.date)} · {nextRound.timeLabel} ·{" "}
                <span className={nextRound.onLeave > 0 ? "font-semibold text-amber-300" : "text-emerald-400"}>{nextRound.onLeave} on leave</span> · ~
                {Math.max(0, calendar.roster - nextRound.onLeave)} available
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">No round scheduled this week.</p>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Leaves in {MONTH_LABELS[month - 1]}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-50">{counted}</p>
          <p className="text-[11px] text-zinc-500">
            counted{voided > 0 ? ` · ${voided} voided` : ""}
            {upcoming > 0 ? ` · ${upcoming} upcoming` : ""}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Most leave this month</p>
          {topAbsent.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nobody yet.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              {topAbsent.map(({ member, eventKey, n }) => {
                const over = n > calendar.monthlyLimit;
                return (
                  <Link key={`${member.id}:${eventKey}`} href={`/members/${member.id}`} className="flex items-center gap-2 text-xs hover:text-zinc-100">
                    <MemberAvatar src={member.discordAvatar} alt={member.name} width={20} height={20} className="h-5 w-5 shrink-0 rounded-full" />
                    <span className="truncate text-zinc-300">{member.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 text-[10px] font-medium ${eventKey === "woe" ? "bg-indigo-400/15 text-indigo-300" : "bg-sky-400/15 text-sky-300"}`}
                    >
                      {eventKey.toUpperCase()}
                    </span>
                    <span className={`ml-auto shrink-0 tabular-nums ${over ? "font-semibold text-rose-400" : "text-zinc-400"}`}>
                      {n}/{calendar.monthlyLimit}
                      {over ? " ⚠" : ""}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          <Link href={`/calendar?y=${prev.year}&m=${prev.month}`} className="rounded-lg px-2.5 py-1 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100" aria-label="Previous month">
            ←
          </Link>
          <span className="min-w-[10ch] px-2 text-center text-sm font-semibold text-zinc-100">
            {MONTH_LABELS[month - 1]} {year}
          </span>
          <Link href={`/calendar?y=${next.year}&m=${next.month}`} className="rounded-lg px-2.5 py-1 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100" aria-label="Next month">
            →
          </Link>
        </div>
        {!isCurrentMonth && (
          <Link href="/calendar" className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500">
            Today
          </Link>
        )}
      </div>

      {/* key: a new month remounts the board so its selection resets to that month. */}
      <CalendarBoard key={`${year}-${month}`} calendar={calendar} initialSelected={initialSelected} />
    </div>
  );
}
