import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { getLatestPvpStats, getMyLatestPvpStat, getPvpStatFieldDefs } from "@/lib/pvp-stats";
import { memberDisplayName } from "@/lib/ui";
import { fmtInt } from "@/lib/pvp-stat-fields";
import { isReviewStatus } from "@/lib/pvp-stat-review";
import { PvpStatForm } from "@/components/pvp-stat-form";
import { PvpStatsTable } from "@/components/pvp-stats-table";
import { AdminAddEntryButton } from "@/components/pvp-stat-admin-entry";
import { StatCard } from "@/components/stat-card";

export default async function PvpStatsPage() {
  const session = await requireUser();
  const me = await db.query.members.findFirst({ where: eq(members.discordId, session.user.discordId) });
  const isAdmin = session.user.isAdmin;

  const [rows, myLatest, allFieldDefs] = await Promise.all([
    getLatestPvpStats(),
    me ? getMyLatestPvpStat(me.id) : Promise.resolve(null),
    getPvpStatFieldDefs(),
  ]);
  const activeFieldDefs = allFieldDefs.filter((f) => f.active);

  const submittedCount = rows.filter((r) => r.entry !== null).length;
  const memberOptions = rows.map(({ member }) => ({ id: member.id, name: memberDisplayName(member) }));

  // Same "submitted"/review data the page already fetched, just also
  // summarized as a few at-a-glance numbers above the table/cards — no new
  // queries, just a different view of `rows`.
  const pendingReviewCount = rows.filter((r) => r.entry !== null && !isReviewStatus(r.entry.reviewStatus)).length;
  const cpValues = rows
    .map((r) => r.entry?.cp)
    .filter((cp): cp is number => cp !== null && cp !== undefined);
  const avgCp = cpValues.length > 0 ? Math.round(cpValues.reduce((sum, v) => sum + v, 0) / cpValues.length) : null;
  const topRow = rows.reduce<(typeof rows)[number] | null>((top, r) => {
    if (r.entry?.cp == null) return top;
    if (!top || (top.entry?.cp ?? -Infinity) < r.entry.cp) return r;
    return top;
  }, null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">PVP Stats</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Self-reported, update weekly · {submittedCount}/{rows.length} submitted
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <AdminAddEntryButton members={memberOptions} customFieldDefs={activeFieldDefs} />
          </div>
        )}
      </div>

      {/* At-a-glance summary before the update form / full roster below — same numbers already
          in the page copy and the table's own filter counts, just pulled up front so an admin
          checking in on review progress doesn't have to scroll the whole list first. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Submitted" value={`${submittedCount}/${rows.length}`} accent="positive" />
        <StatCard label="Pending Review" value={pendingReviewCount} accent={pendingReviewCount > 0 ? "warning" : "positive"} />
        <StatCard label="Average CP" value={fmtInt(avgCp)} />
        <StatCard label="Top CP" value={fmtInt(topRow?.entry?.cp ?? null)} hint={topRow ? memberDisplayName(topRow.member) : undefined} />
      </div>

      {/* Surfaced right above the update button — a member who got reviewed shouldn't have to
          find their own row in the full list below to learn an admin left them a note. */}
      {/* Gated on reviewStatus, not just reviewNote — a FAIL left with no note
          still needs to tell the member to fix and resubmit; requiring a
          note here would silently hide that a review even happened. */}
      {(myLatest?.reviewStatus === "FAIL" || myLatest?.reviewNote) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            myLatest?.reviewStatus === "FAIL"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}
        >
          <p className="font-medium">
            {myLatest?.reviewStatus === "FAIL"
              ? "An admin reviewed your latest stats — please adjust and update again."
              : "Admin note on your latest stats"}
          </p>
          {myLatest?.reviewNote && <p className="mt-1 opacity-90">{myLatest.reviewNote}</p>}
        </div>
      )}

      <PvpStatForm initial={myLatest} customFieldDefs={activeFieldDefs} />

      <PvpStatsTable rows={rows} activeFieldDefs={activeFieldDefs} isAdmin={isAdmin} />
    </div>
  );
}
