// Pre-event "party health" digest for admins — two messages per occurrence
// of every check-in event (CHECKIN_EVENTS):
//
//   1. the EVENING BEFORE (DAY_BEFORE_HOUR Thai time): who's on leave for
//      it, which parties have empty slots, and who's not placed anywhere
//      (the pool to fill those slots from) — everything an admin needs to
//      rework the board without opening /party first.
//   2. ONE HOUR BEFORE it starts: the same picture, plus what CHANGED since
//      message 1 (new leaves, cancelled leaves) so last-minute reshuffles
//      jump out instead of having to be diffed by eye.
//
// Both go out through admin-notify.ts (channel, or DM fallback). Driven by a
// once-a-minute check in bot/index.ts — see runPreEventDigestCheck below for
// the firing rules and why they survive restarts without a DB table.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { botReactionMessages, members, partyBoards, scheduledLeaves } from "../src/db/schema";
import { CHECKIN_EVENTS, nextOccurrenceDate, windowFor, type CheckinEventConfig } from "../src/lib/checkin-events";
import { DiscordApiError, discordBotFetch } from "../src/lib/discord";
import { adminNotifyConfigured, notifyAdmins } from "./admin-notify";
import { getPartyBoardDetail, type PartyBoardDetail, type PartyBoardMemberRef } from "./party-data";

/** Thai-local hour (0-23) on the day BEFORE an occurrence at which digest #1
 * fires — evening, once most members have had the day to file a leave. */
const DAY_BEFORE_HOUR = 20;
/** How long before the window opens digest #2 fires. */
const HOURS_BEFORE_START = 1;
/** A digest whose trigger instant is older than this is never sent — stops
 * a restart later in the day from replaying a digest that already went out
 * (or one nobody needs anymore). Matches a 60s check loop with room to
 * spare for a slow DB. */
const FIRE_WINDOW_MS = 5 * 60 * 1000;

/** "YYYY-MM-DD" for now in Thailand's local time — local copy, same
 * cross-file-cycle reasoning as every other bot file's copy of this. */
function thaiDateString(d: Date = new Date()): string {
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00+07:00`).toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

type DigestKind = "eve" | "hour";

/** In-memory "already sent" set, keyed `${eventKey}|${date}|${kind}`. Lost on
 * restart — which is fine, because FIRE_WINDOW_MS above means a restart can
 * only ever re-send a digest whose trigger was in the last 5 minutes, a
 * duplicate that's rare and harmless rather than a whole-day replay. */
const sent = new Set<string>();

/** The on-leave set captured by digest #1, so digest #2 can report exactly
 * who was added/removed since — keyed `${eventKey}|${date}`. Also in-memory:
 * if the bot restarted in between, digest #2 just omits the diff section
 * and says so rather than guessing from the event log (a cancelled
 * still-pending leave leaves no log row behind, so a log-based diff would
 * miss exactly the cancellations admins most need to see). */
const eveSnapshots = new Map<string, Set<string>>();

interface OccurrenceDigest {
  event: CheckinEventConfig;
  date: string;
  board: { id: string; name: string } | null;
  detail: PartyBoardDetail | null;
  /** Members on leave for this occurrence: currently on the board's Busy/ลา
   * list, plus advance /leave requests filed for this exact date that
   * haven't been applied yet (the day-before digest sees those as
   * scheduledLeaves rows; by the 1h-before digest they've long since been
   * applied at midnight and show up as busy instead). */
  onLeave: PartyBoardMemberRef[];
  trackedMessageMissing: boolean;
}

async function buildDigest(event: CheckinEventConfig, date: string): Promise<OccurrenceDigest> {
  const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.checkinEventKey, event.key) });
  if (!board) return { event, date, board: null, detail: null, onLeave: [], trackedMessageMissing: false };

  const detail = await getPartyBoardDetail(board.id);

  const onLeaveById = new Map<string, PartyBoardMemberRef>();
  for (const m of detail?.busy ?? []) onLeaveById.set(m.id, m);

  const scheduled = await db
    .select({ memberId: scheduledLeaves.memberId })
    .from(scheduledLeaves)
    .where(and(eq(scheduledLeaves.boardId, board.id), eq(scheduledLeaves.date, date)));
  const missingIds = scheduled.map((s) => s.memberId).filter((id) => !onLeaveById.has(id));
  if (missingIds.length > 0) {
    const rows = await db.select().from(members).where(inArray(members.id, missingIds));
    for (const m of rows) {
      if (m.status !== "ACTIVE" || m.benched) continue;
      onLeaveById.set(m.id, {
        id: m.id,
        displayName: m.discordNickname || m.discordGlobalName || m.discordUsername,
        className: m.characterClass,
        classEmoji: null,
      });
    }
  }

  // Is the board's "ลา" message still there? The nightly reset only notices
  // a deleted message for boards that had something to clear that night
  // (see midnight-reset.ts) — checking here too means a board whose message
  // vanished on a quiet night still gets flagged before its next event.
  let trackedMessageMissing = false;
  const tracked = await db.query.botReactionMessages.findFirst({
    where: and(eq(botReactionMessages.kind, "ATTENDANCE"), eq(botReactionMessages.boardId, board.id)),
  });
  if (tracked) {
    try {
      await discordBotFetch(`/channels/${tracked.channelId}/messages/${tracked.messageId}`);
    } catch (err) {
      if (err instanceof DiscordApiError && err.status === 404) trackedMessageMissing = true;
    }
  }

  const onLeave = [...onLeaveById.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));
  return { event, date, board: { id: board.id, name: board.name }, detail, onLeave, trackedMessageMissing };
}

function memberLine(m: PartyBoardMemberRef): string {
  return `${m.classEmoji ?? "❔"} ${m.displayName}`;
}

/**
 * Renders one digest. `previousOnLeave` is digest #1's snapshot (for the
 * 1h-before diff); undefined when this IS digest #1, null when #2 has no
 * snapshot to compare against (bot restarted in between).
 */
function renderDigest(d: OccurrenceDigest, kind: DigestKind, previousOnLeave: Set<string> | null | undefined): string {
  const { start, end } = windowFor(d.event, d.date);
  const when = `${formatDateLabel(d.date)} ${formatTime(start)}–${formatTime(end)} น.`;
  const title = kind === "eve" ? `📣 สรุปปาร์ตี้ล่วงหน้า — ${d.event.label} ${when}` : `⏰ อีก ${HOURS_BEFORE_START} ชม.เริ่ม ${d.event.label} — ${when}`;

  if (!d.board || !d.detail) {
    return `${title}\nยังไม่มีกระดานปาร์ตี้ที่ผูกกับกิจกรรมนี้ (ตั้งได้จากหน้าต่าง "Post Leave in Discord" ใน /party)`;
  }

  const lines: string[] = [title, `กระดาน: "${d.board.name}"`];

  // Changes since digest #1 — first, so a last-minute reshuffle is the
  // first thing an admin reads.
  if (kind === "hour") {
    if (previousOnLeave === null) {
      lines.push("", "🔁 เปลี่ยนแปลงจากสรุปเมื่อวาน: ไม่มีข้อมูลเปรียบเทียบ (bot รีสตาร์ทระหว่างนั้น) — รายชื่อด้านล่างคือสถานะปัจจุบันทั้งหมด");
    } else if (previousOnLeave) {
      const nowIds = new Set(d.onLeave.map((m) => m.id));
      const added = d.onLeave.filter((m) => !previousOnLeave.has(m.id));
      const removedIds = [...previousOnLeave].filter((id) => !nowIds.has(id));
      const allKnown = new Map<string, PartyBoardMemberRef>();
      for (const g of d.detail.groups) for (const p of g.parties) for (const s of p.slots) if (s.member) allKnown.set(s.member.id, s.member);
      for (const m of d.detail.unassigned) allKnown.set(m.id, m);
      for (const m of d.detail.busy) allKnown.set(m.id, m);
      const removed = removedIds.map((id) => allKnown.get(id)?.displayName ?? id);
      if (added.length === 0 && removed.length === 0) {
        lines.push("", "🔁 เปลี่ยนแปลงจากสรุปเมื่อวาน: ไม่มี — รายชื่อลาเหมือนเดิม");
      } else {
        lines.push("", "🔁 เปลี่ยนแปลงจากสรุปเมื่อวาน:");
        if (added.length) lines.push(`  ➕ ลาเพิ่ม (${added.length}): ${added.map(memberLine).join(", ")}`);
        if (removed.length) lines.push(`  ➖ ยกเลิกลา/กลับมา (${removed.length}): ${removed.join(", ")}`);
      }
    }
  }

  lines.push("", d.onLeave.length ? `🏖 ลา (${d.onLeave.length}): ${d.onLeave.map(memberLine).join(", ")}` : "🏖 ลา: ไม่มีใครลา");

  // Parties with empty slots — the thing an admin actually has to act on.
  const gaps: string[] = [];
  let totalEmpty = 0;
  for (const g of d.detail.groups) {
    for (const p of g.parties) {
      const empty = p.slots.filter((s) => s.member === null).length;
      if (empty === 0) continue;
      totalEmpty += empty;
      const filled = p.slots.filter((s) => s.member !== null).map((s) => memberLine(s.member!)).join(", ");
      gaps.push(`  • ${g.name} / ${p.label} — ว่าง ${empty} (มี: ${filled || "ยังไม่มีใครเลย"})`);
    }
  }
  lines.push("", gaps.length ? `🕳 ปาร์ตี้ที่มีช่องว่าง (${totalEmpty} ช่อง):` : "🕳 ปาร์ตี้: เต็มทุกปาร์ตี้ ✅", ...gaps);

  // The pool to fill those slots from — grouped by class so a same-class
  // replacement for whoever left is easy to spot.
  const pool = d.detail.unassigned;
  if (pool.length) {
    const byClass = new Map<string, PartyBoardMemberRef[]>();
    for (const m of pool) {
      const key = m.className ?? "ไม่ระบุอาชีพ";
      byClass.set(key, [...(byClass.get(key) ?? []), m]);
    }
    lines.push("", `👥 ยังไม่ได้อยู่ในปาร์ตี้ — เอาไปแทนได้ (${pool.length}):`);
    for (const [cls, list] of [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0], "th"))) {
      lines.push(`  ${list[0].classEmoji ?? "❔"} ${cls}: ${list.map((m) => m.displayName).join(", ")}`);
    }
  } else {
    lines.push("", "👥 ยังไม่ได้อยู่ในปาร์ตี้: ไม่มี (ทุกคนถูกจัดแล้ว)");
  }

  if (d.trackedMessageMissing) {
    lines.push("", `⚠️ ข้อความ "ลา" ของกระดานนี้ใน Discord หายไปแล้ว — สมาชิกกด reaction ลาไม่ได้ กด "Post Leave in Discord" ใน /party เพื่อโพสต์ใหม่`);
  }

  lines.push("", "เปิด /party เพื่อจัดคนแทนที่ได้เลยครับ");
  return lines.join("\n");
}

function triggerInstant(event: CheckinEventConfig, date: string, kind: DigestKind): Date {
  if (kind === "eve") return new Date(`${addDays(date, -1)}T${String(DAY_BEFORE_HOUR).padStart(2, "0")}:00:00+07:00`);
  return new Date(windowFor(event, date).start.getTime() - HOURS_BEFORE_START * 60 * 60 * 1000);
}

/**
 * Called once a minute from bot/index.ts. For each event's next occurrence,
 * fires whichever of the two digests has a trigger instant in the last
 * FIRE_WINDOW_MS and hasn't been sent yet this process. Returns how many
 * were sent (for the caller's log line).
 */
export async function runPreEventDigestCheck(now: Date = new Date()): Promise<number> {
  if (!adminNotifyConfigured()) return 0;
  let fired = 0;

  for (const event of CHECKIN_EVENTS) {
    const date = nextOccurrenceDate(event, now);
    for (const kind of ["eve", "hour"] as DigestKind[]) {
      const at = triggerInstant(event, date, kind);
      const age = now.getTime() - at.getTime();
      if (age < 0 || age > FIRE_WINDOW_MS) continue;
      const key = `${event.key}|${date}|${kind}`;
      if (sent.has(key)) continue;
      sent.add(key); // marked before the await so an overlapping tick can't double-send

      try {
        const digest = await buildDigest(event, date);
        const snapshotKey = `${event.key}|${date}`;
        let previous: Set<string> | null | undefined;
        if (kind === "eve") {
          eveSnapshots.set(snapshotKey, new Set(digest.onLeave.map((m) => m.id)));
          previous = undefined;
        } else {
          previous = eveSnapshots.get(snapshotKey) ?? null;
          eveSnapshots.delete(snapshotKey);
        }
        await notifyAdmins(renderDigest(digest, kind, previous));
        fired++;
      } catch (err) {
        console.error(`[bot] pre-event digest failed (${key})`, err);
      }
    }
  }

  // Keep the sent-set from growing forever on a long-lived process — only
  // today's and tomorrow's keys can ever matter.
  const today = thaiDateString(now);
  for (const key of sent) {
    const keyDate = key.split("|")[1];
    if (keyDate < today) sent.delete(key);
  }
  return fired;
}

/** Test/debug hook — builds and returns (without sending) the digest text
 * for an event's next occurrence, e.g. from a one-off script. */
export async function previewDigest(eventKey: string, kind: DigestKind, now: Date = new Date()): Promise<string | null> {
  const event = CHECKIN_EVENTS.find((e) => e.key === eventKey);
  if (!event) return null;
  const digest = await buildDigest(event, nextOccurrenceDate(event, now));
  return renderDigest(digest, kind, kind === "eve" ? undefined : null);
}
