import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { getPvpStatHistory } from "@/lib/pvp-stats";
import { fmtInt, fmtPct } from "@/lib/pvp-stat-fields";
import { memberDisplayName } from "@/lib/ui";
import { ClassBadge } from "@/components/badges";
import { MemberAvatar } from "@/components/member-avatar";
import { PvpStatCard } from "@/components/pvp-stat-card";
import { PvpReviewBadge, PvpReviewButton } from "@/components/pvp-stat-review";

export default async function PvpStatHistoryPage({ params }: { params: Promise<{ memberId: string }> }) {
  const session = await requireUser();
  const { memberId } = await params;
  const isAdmin = session.user.isAdmin;

  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member) notFound();

  const history = await getPvpStatHistory(memberId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MemberAvatar
            src={member.discordAvatar}
            alt={member.discordUsername}
            width={40}
            height={40}
            className="h-10 w-10 rounded-full ring-1 ring-zinc-700"
          />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-50">
              {memberDisplayName(member)}
              <ClassBadge className={member.characterClass} />
            </h1>
            <p className="text-sm text-zinc-400">ประวัติ Stats PVP · {history.length} ครั้ง</p>
          </div>
        </div>
        <Link href="/pvp-stats" className="text-sm text-zinc-400 transition hover:text-zinc-100">
          ← กลับไปตารางรวม
        </Link>
      </div>

      {/* Desktop: full history table. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50 lg:block">
        <table className="w-full min-w-[1300px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3 font-medium">วันที่</th>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {history.length === 0 && (
              <tr>
                <td colSpan={17} className="px-4 py-10 text-center text-zinc-500">
                  ยังไม่เคยกรอกสถิติ
                </td>
              </tr>
            )}
            {history.map((entry, i) => (
              <tr key={entry.id} className={i === 0 ? "bg-amber-500/5" : ""}>
                <td className="px-4 py-3 whitespace-nowrap text-zinc-300">
                  {new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}
                  {i === 0 && <span className="ml-2 text-xs text-amber-400">ล่าสุด</span>}
                </td>
                <td className="px-4 py-3 text-zinc-300">{entry.role ?? "—"}</td>
                <td className="px-4 py-3">
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
                </td>
                <td className="px-4 py-3 text-right font-medium text-amber-300">{fmtInt(entry.cp)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtInt(entry.pDef)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtInt(entry.mDef)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtInt(entry.pvpBonus)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtInt(entry.pvpReduction)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtPct(entry.pDmgReductionPct)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtPct(entry.mDmgReductionPct)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtInt(entry.atk)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtInt(entry.matk)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtInt(entry.ignorePDef)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtInt(entry.ignoreMDef)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtPct(entry.pDmgBonusPct)}</td>
                <td className="px-4 py-3 text-right text-zinc-300">{fmtPct(entry.mDmgBonusPct)}</td>
                <td className="px-4 py-3 text-zinc-400">{entry.bossCards ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile / tablet: one card per submission. */}
      <div className="flex flex-col gap-3 lg:hidden">
        {history.length === 0 && <p className="py-10 text-center text-sm text-zinc-500">ยังไม่เคยกรอกสถิติ</p>}
        {history.map((entry, i) => (
          <PvpStatCard
            key={entry.id}
            entry={entry}
            header={
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-100">
                  {new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}
                  {i === 0 && <span className="ml-2 text-xs text-amber-400">ล่าสุด</span>}
                </p>
              </div>
            }
            reviewAction={
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
            }
          />
        ))}
      </div>
    </div>
  );
}
