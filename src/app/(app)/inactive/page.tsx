import Link from "next/link";
import { DEFAULT_INACTIVE_DAYS, getInactiveMembers } from "@/lib/inactivity-data";
import { requireAdmin } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";
import { MemberAvatar } from "@/components/member-avatar";
import { BenchedBadge, ClassBadge } from "@/components/badges";

interface SearchParams {
  days?: string;
}

const DAY_OPTIONS = [7, 14, 21, 30];

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
}

export default async function InactiveMembersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = await searchParams;
  const minDays = DAY_OPTIONS.includes(Number(params.days)) ? Number(params.days) : DEFAULT_INACTIVE_DAYS;

  const rows = await getInactiveMembers(minDays);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Inactive Members</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Active members with no GL/WOE check-in and no PVP stats submission in a while — whichever is more recent
            counts as &quot;last active&quot;, so this only catches people quiet on both fronts.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {DAY_OPTIONS.map((d) => (
            <Link
              key={d}
              href={`/inactive?days=${d}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                minDays === d ? "bg-amber-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {d}+ days
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-500">
          No one&apos;s been quiet for {minDays}+ days — everyone active has checked in or updated PVP stats recently.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <th className="w-10 px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Member</th>
                <th className="px-5 py-3 font-medium">Class</th>
                <th className="px-5 py-3 font-medium">Last Checked In (GL/WOE)</th>
                <th className="px-5 py-3 font-medium">Last PVP Stats Update</th>
                <th className="px-5 py-3 font-medium">Quiet For</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((row, i) => (
                <tr key={row.member.id} className="hover:bg-zinc-800/40">
                  <td className="px-5 py-3 text-zinc-500">{i + 1}</td>
                  <td className="px-5 py-3">
                    <Link href={`/members/${row.member.id}`} className="flex items-center gap-3">
                      <MemberAvatar
                        src={row.member.discordAvatar}
                        alt={row.member.discordUsername}
                        width={28}
                        height={28}
                        className="h-7 w-7 rounded-full ring-1 ring-zinc-700"
                      />
                      <span className="flex flex-col">
                        <span className="truncate font-medium text-zinc-100">{memberDisplayName(row.member)}</span>
                        {row.member.benched && <span className="mt-0.5 w-fit"><BenchedBadge /></span>}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <ClassBadge className={row.member.characterClass} />
                  </td>
                  <td className="px-5 py-3 text-zinc-300">
                    {row.lastAttendedAt ? fmtDate(row.lastAttendedAt) : <span className="text-zinc-500">Never</span>}
                  </td>
                  <td className="px-5 py-3 text-zinc-300">
                    {row.lastPvpSubmittedAt ? fmtDate(row.lastPvpSubmittedAt) : <span className="text-zinc-500">Never</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-rose-400/15 px-2.5 py-0.5 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-400/30">
                      {row.daysSinceActive} days
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
