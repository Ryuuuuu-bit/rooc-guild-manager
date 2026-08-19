import Link from "next/link";
import Image from "next/image";
import { listMembers } from "@/lib/data";
import { RankBadge, StatusBadge } from "@/components/badges";
import { rankOrder, rankLabels } from "@/lib/ui";

interface SearchParams {
  q?: string;
  status?: string;
  rank?: string;
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = (params.status ?? "ACTIVE") as "ACTIVE" | "LEFT" | "KICKED" | "ALL";

  const membersList = await listMembers({
    search: params.q,
    status,
    rank: params.rank,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">สมาชิกกิลด์</h1>
          <p className="mt-1 text-sm text-zinc-400">
            พบ {membersList.length} คน
          </p>
        </div>

        <form className="flex flex-wrap items-center gap-2" method="get">
          <input
            type="text"
            name="q"
            defaultValue={params.q}
            placeholder="ค้นหาชื่อ Discord หรือชื่อในเกม..."
            className="w-56 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
          <select
            name="status"
            defaultValue={status}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="ACTIVE">ยังอยู่ในกิลด์</option>
            <option value="LEFT">ออกไปแล้ว</option>
            <option value="KICKED">ถูกเตะออก</option>
            <option value="ALL">ทั้งหมด</option>
          </select>
          <select
            name="rank"
            defaultValue={params.rank ?? ""}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">ทุกยศ</option>
            {rankOrder.map((rank) => (
              <option key={rank} value={rank}>
                {rankLabels[rank]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            กรอง
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">สมาชิก</th>
              <th className="px-5 py-3 font-medium">ชื่อในเกม</th>
              <th className="px-5 py-3 font-medium">คลาส / เลเวล</th>
              <th className="px-5 py-3 font-medium">ยศ</th>
              <th className="px-5 py-3 font-medium">สถานะ</th>
              <th className="px-5 py-3 font-medium">เข้าร่วมเมื่อ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {membersList.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
                  ไม่พบสมาชิกที่ตรงกับเงื่อนไข
                </td>
              </tr>
            )}
            {membersList.map((member) => (
              <tr key={member.id} className="transition hover:bg-zinc-800/40">
                <td className="px-5 py-3">
                  <Link href={`/members/${member.id}`} className="flex items-center gap-3">
                    <Image
                      src={member.discordAvatar ?? "https://cdn.discordapp.com/embed/avatars/0.png"}
                      alt={member.discordUsername}
                      width={32}
                      height={32}
                      unoptimized
                      className="h-8 w-8 rounded-full ring-1 ring-zinc-700"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-zinc-100">
                        {member.discordGlobalName ?? member.discordUsername}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        @{member.discordUsername}
                      </div>
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3 text-zinc-300">{member.inGameName ?? "—"}</td>
                <td className="px-5 py-3 text-zinc-300">
                  {member.characterClass ?? "—"}
                  {member.level ? ` · Lv.${member.level}` : ""}
                </td>
                <td className="px-5 py-3">
                  <RankBadge rank={member.guildRank} />
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={member.status} />
                </td>
                <td className="px-5 py-3 text-zinc-400">
                  {member.joinedDiscordAt
                    ? new Date(member.joinedDiscordAt).toLocaleDateString("th-TH")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
