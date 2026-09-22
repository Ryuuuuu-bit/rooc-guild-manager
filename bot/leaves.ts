// Leave v2 — the bot's side effects around a leave: the member's DM and the
// admin channel post. The leave ROW itself is written by src/lib/leaves.ts
// (requestLeave / cancelLeave), which the picker in interactions.ts calls
// directly; this file only knows how to tell people about it.
//
// Imports only from src/lib and admin-notify (leaf helpers), never from
// another bot/*.ts module — same cycle rule as admin-notify.ts.
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { members, partyBoards } from "../src/db/schema";
import { sendDirectMessage } from "../src/lib/discord";
import { MONTHLY_LEAVE_LIMIT } from "../src/lib/leave-quota";
import { countLeavesThisMonth, formatThaiDateLabel, roundEnd, roundStart } from "../src/lib/leaves";
import { adminNotifyConfigured, notifyAdmins } from "./admin-notify";

export interface LeaveNotice {
  memberId: string;
  boardId: string;
  /** "YYYY-MM-DD" the leave is for. */
  date: string;
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

/**
 * ONE admin-channel post covering every leave in `items` (a "ลายาว" pick can
 * be six or seven dates at once — one post, not seven). Each line carries
 * the member's monthly count on that board, flagged when past the guild
 * rule, so a repeat offender is visible without opening /attendance. Never
 * throws; a Discord failure is logged by notifyAdmins.
 */
export async function notifyAdminsOfLeaves(items: LeaveNotice[]): Promise<void> {
  if (!adminNotifyConfigured() || items.length === 0) return;

  const lines: string[] = [];
  let overQuota = 0;
  for (const item of items) {
    const member = await db.query.members.findFirst({ where: eq(members.id, item.memberId) });
    if (!member) continue;
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, item.boardId) });
    const displayName = member.discordNickname || member.discordGlobalName || member.discordUsername;
    const monthCount = await countLeavesThisMonth(item.memberId, item.boardId);
    const over = monthCount > MONTHLY_LEAVE_LIMIT;
    if (over) overQuota++;
    const quotaClause = over
      ? ` ⚠️ **เกินโควต้า — ครั้งที่ ${monthCount}/${MONTHLY_LEAVE_LIMIT} เดือนนี้**`
      : ` (ครั้งที่ ${monthCount}/${MONTHLY_LEAVE_LIMIT} เดือนนี้)`;
    lines.push(`• ${displayName} ลา "${board?.name ?? item.boardId}" วันที่ ${formatThaiDateLabel(item.date)}${quotaClause}`);
  }
  if (lines.length === 0) return;

  const header = lines.length === 1 ? "📋 แจ้งลา:" : `📋 แจ้งลา ${lines.length} รายการ:`;
  const quotaFooter = overQuota > 0 ? `\n⚠️ มี ${overQuota} คนที่ลาเกินโควต้าเดือนนี้ — ดูรายละเอียดที่หน้า /attendance` : "";
  await notifyAdmins(`${header}\n${lines.join("\n")}\nยกเลิกได้จนถึงเวลากิจกรรมจบ — เช็ค /party ก่อนเริ่มงานถ้าจะย้ายคนแทนที่${quotaFooter}`);
}

/**
 * ONE DM to the member summarising what they just filed, with their monthly
 * count per board. Best-effort: a closed-DM member (50007) just doesn't get
 * it — the picker reply already told them.
 */
export async function dmMemberLeaveFiled(memberId: string, items: LeaveNotice[]): Promise<void> {
  if (items.length === 0) return;
  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member) return;

  const lines: string[] = [];
  for (const item of items) {
    const board = await db.query.partyBoards.findFirst({ where: eq(partyBoards.id, item.boardId) });
    if (!board) continue;
    const count = await countLeavesThisMonth(memberId, board.id);
    const start = roundStart(board, item.date);
    const end = roundEnd(board, item.date);
    lines.push(
      `• ${board.name} ${formatThaiDateLabel(item.date)}${start ? ` (${timeLabel(start)}–${timeLabel(end)})` : ""} — ครั้งที่ ${count}/${MONTHLY_LEAVE_LIMIT} เดือนนี้`
    );
  }
  if (lines.length === 0) return;

  try {
    await sendDirectMessage(
      member.discordId,
      `✅ บันทึกการลาแล้ว:\n${lines.join("\n")}\n` +
        "ยกเลิกได้ที่ห้องลา (ปุ่มเดิม) จนกว่ากิจกรรมวันนั้นจะจบ — ยกเลิกก่อนจบไม่นับเป็นการลา"
    );
  } catch (err) {
    console.error(`[bot] leave DM to ${member.discordId} failed`, err);
  }
}
