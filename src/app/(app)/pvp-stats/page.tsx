import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { getLatestPvpStats, getMyLatestPvpStat } from "@/lib/pvp-stats";
import { fmtInt, fmtPct } from "@/lib/pvp-stat-fields";
import { memberDisplayName } from "@/lib/ui";
import { ClassBadge } from "@/components/badges";
import { MemberAvatar } from "@/components/member-avatar";
import { PvpStatForm } from "@/components/pvp-stat-form";
import { PvpStatCard } from "@/components/pvp-stat-card";
import { PvpReviewBadge, PvpReviewButton } from "@/components/pvp-stat-review";

export default async function PvpStatsPage() {
  const session = await requireUser();
  const me = await db.query.members.findFirst({ where: eq(members.discordId, session.user.discordId) });
  const isAdmin = session.user.isAdmin;

  const [rows, myLatest] = await Promise.all([
    getLatestPvpStats(),
    me ? getMyLatestPvpStat(me.id) : Promise.resolve(null),
  ]);

  const submittedCount = rows.filter((r) => r.entry !== null).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Stats PVP</h1>
        <p className="mt-1 text-sm text-zinc-400">
          กรอกเอง อัปเดตได้ทุกสัปดาห์ · {submittedCount}/{rows.length} คนกรอกแล้ว
        </p>
      </div>

      <PvpStatForm initial={myLatest} />

      {/* Desktop: one wide table, every column visible at once. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50 lg:block">
        <table className="w-full min-w-[1500px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3 font-medium">สมาชิก</th>
              <th className="px-4 py-3 font-medium">อาชีพ</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 text-right font-medium">CP</th>
              <th className="px-4 py-3 text-right font-medium">P.DEF</th>
              <th className="px-4 py-3 text-right font-medium">M.DEF</th>
              <th className="px-4 py-3 text-right font-medium">PVP Bonus</th>
              <th className="px-4 py-3 text-right font-medium">PVP Reduction</th>
              <th className="px-4 py-3 text-right font-medium">P.DMG Red%</th>
              <th className="px-4 py-3 text-right font-medium">M.DMG Red%</th>
              <th className="px-4 py-3 text-right font-medium">ATK</th>
              <th className="px-4 py-3 text-right font-medium">MATK</th>
              <th className="px-4 py-3 text-right font-medium">Ignore P.DEF</th>
              <th className="px-4 py-3 text-right font-medium">Ignore M.DEF</th>
              <th className="px-4 py-3 text-right font-medium">P.DMG Bonus%</th>
              <th className="px-4 py-3 text-right font-medium">M.DMG Bonus%</th>
              <th className="px-4 py-3 font-medium">การ์ดบอส</th>
              <th className="px-4 py-3 font-medium">อัปเดตล่าสุด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.length === 0 && (
              <tr>
                <td colSpan={19} className="px-4 py-10 text-center text-zinc-500">
                  ยังไม่มีสมาชิกในระบบ
                </td>
              </tr>
            )}
            {rows.map(({ member, entry }) => (
              <tr key={member.id} className="transition hover:bg-zinc-800/40">
                <td className="px-4 py-3">
                  <Link href={`/pvp-stats/${member.id}`} className="flex items-center gap-3">
                    <MemberAvatar
                      src={member.discordAvatar}
                      alt={member.discordUsername}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full ring-1 ring-zinc-700"
                    />
                    <span className="truncate font-medium text-zinc-100">{memberDisplayName(member)}</span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <ClassBadge className={member.characterClass} />
                </td>
                <td className="px-4 py-3 text-zinc-300">{entry?.role ?? "—"}</td>
                <td className="px-4 py-3">
                  {entry && (
                    <div className="flex items-center gap-1.5" title={entry.reviewNote ?? undefined}>
                      <PvpReviewBadge status={entry.reviewStatus} />
                      {isAdmin && (
                        <PvpReviewButton
                          entryId={entry.id}
                          currentStatus={entry.reviewStatus}
                          currentNote={entry.reviewNote}
                        />
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-amber-300">{entry ? fmtInt(entry.cp) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.pDef) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.mDef) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.pvpBonus) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.pvpReduction) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtPct(entry.pDmgReductionPct) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtPct(entry.mDmgReductionPct) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.atk) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.matk) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.ignorePDef) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtInt(entry.ignoreMDef) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtPct(entry.pDmgBonusPct) : "—"}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{entry ? fmtPct(entry.mDmgBonusPct) : "—"}</td>
                <td className="px-4 py-3 text-zinc-400">{entry?.bossCards ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap text-zinc-500">
                  {entry ? new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "ยังไม่กรอก"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile / tablet: one card per member instead of a table that needs horizontal scrolling. */}
      <div className="flex flex-col gap-3 lg:hidden">
        {rows.length === 0 && <p className="py-10 text-center text-sm text-zinc-500">ยังไม่มีสมาชิกในระบบ</p>}
        {rows.map(({ member, entry }) => (
          <PvpStatCard
            key={member.id}
            entry={entry}
            header={
              <div className="flex items-center justify-between gap-3">
                <Link href={`/pvp-stats/${member.id}`} className="flex min-w-0 items-center gap-2.5">
                  <MemberAvatar
                    src={member.discordAvatar}
                    alt={member.discordUsername}
                    width={32}
                    height={32}
                    className="h-8 w-8 shrink-0 rounded-full ring-1 ring-zinc-700"
                  />
                  <span className="truncate font-medium text-zinc-100">{memberDisplayName(member)}</span>
                </Link>
                <ClassBadge className={member.characterClass} />
              </div>
            }
            reviewAction={
              entry && (
                <>
                  <PvpReviewBadge status={entry.reviewStatus} />
                  {isAdmin && (
                    <PvpReviewButton
                      entryId={entry.id}
                      currentStatus={entry.reviewStatus}
                      currentNote={entry.reviewNote}
                    />
                  )}
                </>
              )
            }
            footer={
              <div className="flex items-center justify-between border-t border-zinc-800 pt-2 text-xs text-zinc-500">
                <span>
                  {entry
                    ? new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })
                    : "ยังไม่กรอก"}
                </span>
                <Link href={`/pvp-stats/${member.id}`} className="text-amber-400 transition hover:text-amber-300">
                  ดูประวัติทั้งหมด →
                </Link>
              </div>
            }
          />
        ))}
      </div>
    </div>
  );
}
