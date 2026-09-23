import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { getLatestPvpStats, getMyLatestPvpStat, getPvpStatFieldDefs } from "@/lib/pvp-stats";
import { memberDisplayName } from "@/lib/ui";
import { fmtInt, pvpEntryLastUpdated } from "@/lib/pvp-stat-fields";
import { PvpStatForm } from "@/components/pvp-stat-form";
import { PvpStatsTable } from "@/components/pvp-stats-table";
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

  // At-a-glance numbers derived from the same `rows` the table gets — no extra queries.
  // "Stale" mirrors the table's red marker: no submission, or none touched in 14 days.
  const STALE_DAYS = 14;
  const staleCutoff = new Date().getTime() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const staleCount = rows.filter((r) => !r.entry || pvpEntryLastUpdated(r.entry).getTime() < staleCutoff).length;
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
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Submitted" value={`${submittedCount}/${rows.length}`} accent="positive" />
        <StatCard label="Stale / Missing" value={staleCount} hint={`not updated in ${STALE_DAYS}+ days`} accent={staleCount > 0 ? "warning" : "positive"} />
        <StatCard label="Average CP" value={fmtInt(avgCp)} />
        <StatCard label="Top CP" value={fmtInt(topRow?.entry?.cp ?? null)} hint={topRow ? memberDisplayName(topRow.member) : undefined} />
      </div>

      <PvpStatForm initial={myLatest} customFieldDefs={activeFieldDefs} />

      <PvpStatsTable rows={rows} activeFieldDefs={activeFieldDefs} isAdmin={isAdmin} />
    </div>
  );
}
