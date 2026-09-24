import { CHECKIN_EVENTS, getCheckinEvent, getCheckinReport, listCheckinWindows } from "@/lib/checkin-data";
import { getCheckinStrip, toCheckinRows } from "@/lib/checkin-view";
import { requireUser } from "@/lib/authz";
import { PageHeader } from "@/components/ui/kit";
import { CheckinView } from "@/components/checkin/checkin-view";

interface SearchParams {
  event?: string;
  date?: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STRIP_ROUNDS = 12;

export default async function CheckinPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireUser();
  const params = await searchParams;

  const event = getCheckinEvent(params.event ?? "") ?? CHECKIN_EVENTS[0];
  const schedule = `${event.weekdays.map((w) => WEEKDAY_LABELS[w]).join("/")} ${event.startTime.slice(0, 5)}–${event.endTime.slice(0, 5)}`;

  const windows = await listCheckinWindows(event.key);
  const selected = windows.find((w) => w.date === params.date) ?? windows[0] ?? null;
  const [strip, report] = await Promise.all([
    getCheckinStrip(event.key, windows, STRIP_ROUNDS),
    selected ? getCheckinReport(event.key, selected.date) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Check-in [Voice]"
        description={
          <>
            Who was in the {event.label} voice channel ({schedule}). Joining for even a moment counts as present; a
            member with approved leave is never counted absent. “Late” / “left early” = more than 5 minutes after the
            start / before the end.
            {session.user.isAdmin && (
              <span className="mt-1 block text-xs text-zinc-500">
                Data exists only from the day the bot started logging voice — if the bot was offline during an event,
                part of that round may be missing.
              </span>
            )}
          </>
        }
      />
      {windows.length === 0 || !report || !selected ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-500">
          No data yet — logging starts automatically from the next {event.label} round where someone joins the channel.
        </div>
      ) : (
        <CheckinView
          events={CHECKIN_EVENTS.map((e) => ({ key: e.key, label: e.label }))}
          eventKey={event.key}
          strip={strip}
          older={windows.slice(STRIP_ROUNDS).map((w) => w.date)}
          selectedDate={selected.date}
          window={{ startIso: report.window.start.toISOString(), endIso: report.window.end.toISOString() }}
          rows={toCheckinRows(report)}
          isAdmin={session.user.isAdmin}
          now={new Date().getTime()}
        />
      )}
    </div>
  );
}
