import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { getPvpStatHistory, getPvpStatFieldDefs } from "@/lib/pvp-stats";
import { fmtInt, fmtPct } from "@/lib/pvp-stat-fields";
import { memberDisplayName } from "@/lib/ui";
import { ClassBadge } from "@/components/badges";
import { MemberAvatar } from "@/components/member-avatar";
import { PvpStatCard } from "@/components/pvp-stat-card";
import { PvpReviewBadge, PvpReviewButton } from "@/components/pvp-stat-review";
import { AdminEditEntryButton, AdminDeleteEntryButton } from "@/components/pvp-stat-admin-entry";

export default async function PvpStatHistoryPage({ params }: { params: Promise<{ memberId: string }> }) {
  const session = await requireUser();
  const { memberId } = await params;
  const isAdmin = session.user.isAdmin;

  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member) notFound();

  const [history, allFieldDefs] = await Promise.all([getPvpStatHistory(memberId), getPvpStatFieldDefs()]);
  const activeFieldDefs = allFieldDefs.filter((f) => f.active);

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
            <p className="text-sm text-zinc-400">PVP Stats history · {history.length} entries</p>
          </div>
        </div>
        <Link href="/pvp-stats" className="text-sm text-zinc-400 transition hover:text-zinc-100">
          ← Back to leaderboard
        </Link>
      </div>

      {/* Same 2xl switch point as the leaderboard table — see that page for why. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50 2xl:block">
        <table className="w-full min-w-[1300px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="sticky left-0 z-20 bg-zinc-900 px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
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
              {activeFieldDefs.map((f) => (
                <th key={f.key} className="px-4 py-3 text-right font-medium">
                  {f.label}
                </th>
              ))}
              <th className="px-4 py-3 font-medium">Boss Cards</th>
              {isAdmin && <th className="px-4 py-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {history.length === 0 && (
              <tr>
                <td colSpan={40} className="px-4 py-10 text-center text-zinc-500">
                  No stats submitted yet
                </td>
              </tr>
            )}
            {history.map((entry, i) => (
              <tr key={entry.id} className={`group ${i === 0 ? "bg-amber-500/5" : ""}`}>
                <td
                  className={`sticky left-0 z-10 whitespace-nowrap border-r border-zinc-800 px-4 py-3 text-zinc-300 ${
                    i === 0 ? "bg-zinc-900" : "bg-zinc-900 group-hover:bg-zinc-800/90"
                  }`}
                >
                  {new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}
                  {i === 0 && <span className="ml-2 text-xs text-amber-400">Latest</span>}
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
                {activeFieldDefs.map((f) => (
                  <td key={f.key} className="px-4 py-3 text-right text-zinc-300">
                    {f.isPercent ? fmtPct(entry.customValues?.[f.key]) : fmtInt(entry.customValues?.[f.key])}
                  </td>
                ))}
                <td className="px-4 py-3 text-zinc-400">{entry.bossCards ?? "—"}</td>
                {isAdmin && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <AdminEditEntryButton entry={entry} customFieldDefs={activeFieldDefs} />
                      <AdminDeleteEntryButton entryId={entry.id} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Card list is the default on anything narrower than 2xl — laptops included. */}
      <div className="flex flex-col gap-3 2xl:hidden">
        {history.length === 0 && <p className="py-10 text-center text-sm text-zinc-500">No stats submitted yet</p>}
        {history.map((entry, i) => (
          <PvpStatCard
            key={entry.id}
            entry={entry}
            customFieldDefs={activeFieldDefs}
            header={
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-100">
                  {new Date(entry.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}
                  {i === 0 && <span className="ml-2 text-xs text-amber-400">Latest</span>}
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
            footer={
              isAdmin && (
                <div className="flex justify-end gap-1 border-t border-zinc-800 pt-2">
                  <AdminEditEntryButton entry={entry} customFieldDefs={activeFieldDefs} />
                  <AdminDeleteEntryButton entryId={entry.id} />
                </div>
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
