import Link from "next/link";
import { CHECKIN_EVENTS, getCheckinEvent, getCheckinReport, listCheckinWindows } from "@/lib/checkin-data";
import { requireUser } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";
import { MemberAvatar } from "@/components/member-avatar";
import { CheckinNoteCell } from "@/components/checkin-note-cell";

interface SearchParams {
  event?: string;
  date?: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDatePill(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

function fmtHHMM(time: string): string {
  return time.slice(0, 5).replace(":", ".");
}

export default async function CheckinPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireUser();
  const params = await searchParams;

  const event = getCheckinEvent(params.event ?? "") ?? CHECKIN_EVENTS[0];
  const scheduleLabel = `${event.weekdays.map((w) => WEEKDAY_LABELS[w]).join("/")} ${fmtHHMM(event.startTime)}-${fmtHHMM(event.endTime)}`;

  const windows = await listCheckinWindows(event.key);
  const selected = windows.find((w) => w.date === params.date) ?? windows[0] ?? null;
  const report = selected ? await getCheckinReport(event.key, selected.date) : null;
  const windowMinutes = selected ? Math.round((selected.end.getTime() - selected.start.getTime()) / 60_000) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Event Check-in — {event.label}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Who was in the event&apos;s voice channel ({scheduleLabel}) — counted as &quot;Attended&quot; if they
            joined the channel for even one moment during this window, no minimum time required, with total time
            present shown alongside.
          </p>
          {session.user.isAdmin && (
            <p className="mt-1 text-xs text-zinc-500">
              The system started collecting data automatically from the day this feature (or each event) was
              deployed onward — Discord has no voice history to pull from before that, so earlier rounds still rely
              on manual screenshots. If the bot was offline during an event (e.g. during a deploy), some data for
              that window will be missing.
            </p>
          )}
        </div>
        {CHECKIN_EVENTS.length > 1 && (
          <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
            {CHECKIN_EVENTS.map((e) => (
              <Link
                key={e.key}
                href={`/checkin?event=${e.key}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  event.key === e.key ? "bg-amber-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {e.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {windows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-500">
          No data yet — the system will start collecting automatically from the next {scheduleLabel.split(" ")[0]}{" "}
          round where someone joins the channel
        </div>
      ) : (
        <>
          {/* Single scrollable row rather than flex-wrap — this list only
              ever grows (every past round stays in it forever, see
              listCheckinWindows), so wrapping would make the box taller
              and taller as history piles up. A fixed-height horizontal
              strip keeps the page layout stable no matter how many rounds
              have been recorded; the fade hints there's more to scroll to,
              and the most recent round (windows[0]) sits at the left edge
              so it's visible without scrolling at all. */}
          <div className="relative">
            <div className="flex flex-nowrap gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
              {windows.map((w) => (
                <Link
                  key={w.date}
                  href={`/checkin?event=${event.key}&date=${w.date}`}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    selected?.date === w.date
                      ? "bg-amber-600 text-white"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  }`}
                >
                  {fmtDatePill(w.start)}
                </Link>
              ))}
            </div>
            {windows.length > 8 && (
              <div className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-l from-zinc-950 to-transparent" />
            )}
          </div>

          {report && (
            <>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-zinc-400">
                  Round {fmtDatePill(report.window.start)} ({fmtTime(report.window.start)}-{fmtTime(report.window.end)})
                  — Attended <span className="font-medium text-emerald-400">{report.attendedCount}</span>/
                  {report.totalCount}
                </p>
                {report.onLeaveCount > 0 && (
                  <p className="text-sm text-zinc-400">
                    On Leave (<span className="font-medium text-amber-400">{report.onLeaveCount}</span>):{" "}
                    {report.results
                      .filter((r) => r.onLeave)
                      .map((r) => memberDisplayName(r.member))
                      .join(", ")}
                  </p>
                )}
              </div>

              <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                      <th className="w-10 px-5 py-3 font-medium">#</th>
                      <th className="px-5 py-3 font-medium">Member</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Time Present</th>
                      <th className="px-5 py-3 font-medium">First Joined</th>
                      <th className="px-5 py-3 font-medium">Last Left</th>
                      <th className="px-5 py-3 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {report.results.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-10 text-center text-zinc-500">
                          No member data
                        </td>
                      </tr>
                    )}
                    {report.results.map((row, i) => (
                      <tr
                        key={row.member.id}
                        className={`hover:bg-zinc-800/40 ${
                          row.attended ? "" : row.onLeave ? "bg-amber-950/10" : "bg-rose-950/10"
                        }`}
                      >
                        <td className="px-5 py-3 text-zinc-500">{i + 1}</td>
                        <td className="px-5 py-3">
                          <Link href={`/members/${row.member.id}`} className="flex items-center gap-3">
                            <MemberAvatar
                              src={row.member.discordAvatar}
                              alt={row.member.discordUsername}
                              width={28}
                              height={28}
                              className="h-7 w-7 rounded-full ring-1 ring-zinc-700"
                            />
                            <span className="truncate font-medium text-zinc-100">{memberDisplayName(row.member)}</span>
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          {/* Excused (confirmed leave on the matching party
                              board) takes priority over the plain "Absent"
                              label for an absent row — same person, but this
                              distinguishes an approved no-show from an
                              unexplained one at a glance. */}
                          {row.attended ? (
                            <span className="inline-block whitespace-nowrap rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                              Attended
                            </span>
                          ) : row.onLeave ? (
                            <span className="inline-block whitespace-nowrap rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-400/30">
                              On Leave
                            </span>
                          ) : (
                            <span className="inline-block whitespace-nowrap rounded-full bg-rose-400/15 px-2 py-0.5 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-400/30">
                              Absent
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-zinc-300">
                          {row.attended ? `${row.minutesPresent}/${windowMinutes} min` : "—"}
                        </td>
                        <td className="px-5 py-3 text-xs text-zinc-400">{row.firstJoinAt ? fmtTime(row.firstJoinAt) : "—"}</td>
                        <td className="px-5 py-3 text-xs text-zinc-400">
                          {row.stillConnected ? "Still in channel" : row.lastLeaveAt ? fmtTime(row.lastLeaveAt) : "—"}
                        </td>
                        <td className="px-5 py-3">
                          {/* key includes both eventKey and date: without
                              it, switching date OR event (GL/WOE) tabs
                              reuses the same component instance for a
                              given member (the <tr> above is keyed only by
                              member.id), and its local `saved` state from
                              the previously-viewed date/event leaks into
                              the newly-selected one until a full page
                              reload. */}
                          <CheckinNoteCell
                            key={`${event.key}-${report.window.date}-${row.member.id}`}
                            eventKey={event.key}
                            date={report.window.date}
                            memberId={row.member.id}
                            note={row.note}
                            isAdmin={session.user.isAdmin}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
