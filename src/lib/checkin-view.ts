// View-model for the /checkin page: the round strip (rate per round, voided
// "break" rounds flagged) and per-member rows with late/left-early labels.
// Pure reads on top of getCheckinReport — attendance rules live there.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leaves, partyBoards } from "@/db/schema";
import { getCheckinEvent, getCheckinReport, windowFor, type CheckinWindow } from "@/lib/checkin-data";
import { memberDisplayName } from "@/lib/ui";

/** Joining this many minutes after the start (or leaving this long before the end) earns a "late" / "left early" label. Display only. */
export const LATE_MINUTES = 5;

export interface StripRound {
  date: string;
  startIso: string;
  /** Attended ÷ expected (on-leave no-shows excluded); null when nobody was expected. */
  rate: number | null;
  attended: number;
  expected: number;
  voided: boolean;
  live: boolean;
}

export type CheckinStatus = "in" | "late" | "early" | "live" | "leave" | "absent";

export interface CheckinRow {
  id: string;
  name: string;
  avatar: string | null;
  className: string | null;
  status: CheckinStatus;
  minutes: number;
  firstJoinIso: string | null;
  lastLeaveIso: string | null;
  stillConnected: boolean;
  note: string | null;
  /** Minutes late / left early (for the label). */
  lateBy: number;
  earlyBy: number;
}

/** Dates (of this event) where a leave was cancelled AFTER the round ended — the admin "void leaves for a period" tool, i.e. a break. */
async function voidedDates(eventKey: string, dates: string[]): Promise<Set<string>> {
  const event = getCheckinEvent(eventKey);
  if (!event || !dates.length) return new Set();
  const rows = await db
    .select({ date: leaves.occurrenceDate, cancelledAt: leaves.cancelledAt })
    .from(leaves)
    .innerJoin(partyBoards, eq(leaves.boardId, partyBoards.id))
    .where(and(eq(leaves.status, "CANCELLED"), eq(partyBoards.checkinEventKey, eventKey), inArray(leaves.occurrenceDate, dates)));
  const out = new Set<string>();
  for (const r of rows) if (r.cancelledAt && r.cancelledAt >= windowFor(event, r.date).end) out.add(r.date);
  return out;
}

export async function getCheckinStrip(eventKey: string, windows: CheckinWindow[], limit = 12): Promise<StripRound[]> {
  const recent = windows.slice(0, limit);
  const now = Date.now();
  const [reports, voided] = await Promise.all([Promise.all(recent.map((w) => getCheckinReport(eventKey, w.date))), voidedDates(eventKey, recent.map((w) => w.date))]);
  return recent.map((w, i) => {
    const r = reports[i];
    const expected = r ? r.totalCount - r.onLeaveCount : 0;
    return {
      date: w.date,
      startIso: w.start.toISOString(),
      rate: r && expected > 0 ? r.attendedCount / expected : null,
      attended: r?.attendedCount ?? 0,
      expected,
      voided: voided.has(w.date),
      live: w.start.getTime() <= now && now < w.end.getTime(),
    };
  });
}

export function toCheckinRows(report: NonNullable<Awaited<ReturnType<typeof getCheckinReport>>>): CheckinRow[] {
  const start = report.window.start.getTime();
  const end = report.window.end.getTime();
  return report.results.map((r) => {
    let status: CheckinStatus;
    let lateBy = 0;
    let earlyBy = 0;
    if (!r.attended) status = r.onLeave ? "leave" : "absent";
    else {
      lateBy = r.firstJoinAt ? Math.round((r.firstJoinAt.getTime() - start) / 60000) : 0;
      earlyBy = r.lastLeaveAt ? Math.round((end - r.lastLeaveAt.getTime()) / 60000) : 0;
      status = r.stillConnected ? "live" : lateBy >= LATE_MINUTES ? "late" : earlyBy >= LATE_MINUTES ? "early" : "in";
    }
    return {
      id: r.member.id,
      name: memberDisplayName(r.member),
      avatar: r.member.discordAvatar,
      className: r.member.characterClass,
      status,
      minutes: r.minutesPresent,
      firstJoinIso: r.firstJoinAt?.toISOString() ?? null,
      lastLeaveIso: r.lastLeaveAt?.toISOString() ?? null,
      stillConnected: r.stillConnected,
      note: r.note,
      lateBy: Math.max(0, lateBy),
      earlyBy: Math.max(0, earlyBy),
    };
  });
}
