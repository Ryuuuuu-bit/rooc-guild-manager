import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { getLatestPvpStats, getMyLatestPvpStat, getPvpStatFieldDefs } from "@/lib/pvp-stats";
import { memberDisplayName } from "@/lib/ui";
import { PvpStatForm } from "@/components/pvp-stat-form";
import { PvpStatsTable } from "@/components/pvp-stats-table";
import { AdminAddEntryButton } from "@/components/pvp-stat-admin-entry";
import { PvpFieldManagerButton } from "@/components/pvp-field-manager";

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
            <PvpFieldManagerButton fields={allFieldDefs} />
            <AdminAddEntryButton members={memberOptions} customFieldDefs={activeFieldDefs} />
          </div>
        )}
      </div>

      {/* Surfaced right above the update button — a member who got reviewed shouldn't have to
          find their own row in the full list below to learn an admin left them a note. */}
      {myLatest?.reviewNote && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            myLatest.reviewStatus === "FAIL"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}
        >
          <p className="font-medium">
            {myLatest.reviewStatus === "FAIL"
              ? "An admin reviewed your latest stats — please adjust and update again."
              : "Admin note on your latest stats"}
          </p>
          <p className="mt-1 opacity-90">{myLatest.reviewNote}</p>
        </div>
      )}

      <PvpStatForm initial={myLatest} customFieldDefs={activeFieldDefs} />

      <PvpStatsTable rows={rows} activeFieldDefs={activeFieldDefs} isAdmin={isAdmin} />
    </div>
  );
}
