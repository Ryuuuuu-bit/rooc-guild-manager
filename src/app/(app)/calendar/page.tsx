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
          Today&apos;s GL/WOE leave, and who&apos;s requested leave for what&apos;s coming up — click a day to see the
          full list. Past rounds aren&apos;t shown here (see /attendance or /checkin for history).
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
                  } ${day.isPast ? "opacity-40" : ""}`}
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
                        {ev.onLeave.length > 0 && (
                          <span className={ev.status === "confirmed" ? "text-amber-300" : "text-zinc-400"}>· {ev.onLeave.length}</span>
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
        {event.onLeave.length > 0 && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              event.status === "confirmed"
                ? "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30"
                : "bg-zinc-700/40 text-zinc-300 ring-1 ring-inset ring-zinc-600/40"
            }`}
          >
            {event.status === "confirmed" ? "On Leave" : "Leave Requested"} ({event.onLeave.length})
          </span>
        )}
      </div>
      {event.status === "unavailable" ? (
        <p className="text-sm text-zinc-500">Past round — see /attendance or /checkin for its leave history.</p>
      ) : event.onLeave.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {event.status === "confirmed" ? "No one on leave for this round." : "No one has requested leave for this round yet."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {event.onLeave.map((m) => (
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
