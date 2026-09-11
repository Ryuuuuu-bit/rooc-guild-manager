import Link from "next/link";
import { getCalendarMonth, type CalendarDayEvent } from "@/lib/calendar-data";
import { thaiDateString } from "@/lib/checkin-data";
import { requireUser } from "@/lib/authz";
import { MemberAvatar } from "@/components/member-avatar";

interface SearchParams {
  y?: string;
  m?: string;
  d?: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function fmtDayLabel(date: string): string {
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Bangkok",
  });
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const params = await searchParams;

  const todayStr = thaiDateString(new Date());
  const [todayYear, todayMonth] = todayStr.split("-").map(Number);
  const year = Number(params.y) || todayYear;
  const month = Number(params.m) || todayMonth;

  const calendar = await getCalendarMonth(year, month);
  const dayByDate = new Map(calendar.days.map((d) => [d.date, d]));

  const selectedDate = params.d && dayByDate.has(params.d) ? params.d : year === todayYear && month === todayMonth ? todayStr : null;
  const selectedDay = selectedDate ? dayByDate.get(selectedDate) : undefined;

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const isCurrentMonth = year === todayYear && month === todayMonth;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Calendar</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every GL/WOE round for the month, with who actually didn&apos;t attend (real check-in voice data, same as
          /checkin) — click a day to see the full list instead of checking one round at a time.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-2">
        <div className="flex items-center gap-1">
          <Link
            href={`/calendar?y=${prev.year}&m=${prev.month}`}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
            aria-label="Previous month"
          >
            ←
          </Link>
          <span className="min-w-[10ch] px-2 text-center text-sm font-medium text-zinc-100">
            {MONTH_LABELS[month - 1]} {year}
          </span>
          <Link
            href={`/calendar?y=${next.year}&m=${next.month}`}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
            aria-label="Next month"
          >
            →
          </Link>
        </div>
        {!isCurrentMonth && (
          <Link
            href="/calendar"
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500"
          >
            Today
          </Link>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-t-xl border border-zinc-800 bg-zinc-800 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="bg-zinc-900 py-2">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px border-x border-b border-zinc-800 bg-zinc-800">
            {Array.from({ length: calendar.firstWeekday }).map((_, i) => (
              <div key={`blank-${i}`} className="min-h-[92px] bg-zinc-950/60" />
            ))}
            {calendar.days.map((day) => {
              const isSelected = day.date === selectedDate;
              const dayNum = Number(day.date.slice(-2));
              return (
                <Link
                  key={day.date}
                  href={`/calendar?y=${year}&m=${month}&d=${day.date}`}
                  className={`flex min-h-[92px] flex-col gap-1 p-1.5 text-left transition hover:bg-zinc-800/60 ${
                    isSelected ? "bg-amber-950/20 ring-1 ring-inset ring-amber-600" : "bg-zinc-900"
                  }`}
                >
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                      day.isToday ? "bg-amber-600 font-medium text-white" : "text-zinc-400"
                    }`}
                  >
                    {dayNum}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    {/* Only 2 events exist today (gl/woe) — a 3rd added to
                        CHECKIN_EVENTS would fall into the "gl" color below
                        rather than get its own, which is fine cosmetically
                        but worth widening if that ever happens. */}
                    {day.events.map((ev) => (
                      <span
                        key={ev.eventKey}
                        className={`inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          ev.eventKey === "woe"
                            ? "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30"
                            : "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30"
                        }`}
                      >
                        {ev.eventKey.toUpperCase()}
                        {ev.notAttended.length > 0 && (
                          <span className={ev.confirmed ? "text-rose-300" : "text-zinc-400"}>· {ev.notAttended.length}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {selectedDay ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-medium text-zinc-100">{fmtDayLabel(selectedDay.date)}</h2>
          {selectedDay.events.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No GL/WOE round scheduled this day.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {selectedDay.events.map((ev) => (
                <CalendarEventDetail key={ev.eventKey} event={ev} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Click a day above to see who&apos;s on leave for it.</p>
      )}
    </div>
  );
}

function CalendarEventDetail({ event }: { event: CalendarDayEvent }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            event.eventKey === "woe"
              ? "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30"
              : "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30"
          }`}
        >
          {event.label}
        </span>
        {event.confirmed ? (
          <span className="inline-flex items-center rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
            Attended {event.attendedCount}/{event.totalCount}
          </span>
        ) : (
          <span className="text-xs text-zinc-500">Upcoming — not attended yet</span>
        )}
        {event.notAttended.length > 0 && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              event.confirmed
                ? "bg-rose-400/15 text-rose-300 ring-1 ring-inset ring-rose-400/30"
                : "bg-zinc-700/40 text-zinc-300 ring-1 ring-inset ring-zinc-600/40"
            }`}
          >
            {event.confirmed ? "Not Attended" : "Leave Requested"} ({event.notAttended.length})
          </span>
        )}
      </div>
      {event.notAttended.length === 0 ? (
        <p className="text-sm text-zinc-500">{event.confirmed ? "Everyone attended." : "No one has requested leave for this round yet."}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {event.notAttended.map((m) => (
            <Link
              key={m.id}
              href={`/members/${m.id}`}
              className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 py-1 pl-1 pr-3 text-xs text-zinc-300 transition hover:bg-zinc-800"
            >
              <MemberAvatar src={m.discordAvatar} alt={m.name} width={20} height={20} className="h-5 w-5 rounded-full" />
              {m.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
