import Link from "next/link";
import { listDiscordRoles, listMembers } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { StatusBadge, ClassBadge, BenchedBadge } from "@/components/badges";
import { RoleChips } from "@/components/role-chips";
import { memberDisplayName } from "@/lib/ui";
import { MemberAvatar } from "@/components/member-avatar";

interface SearchParams {
  q?: string;
  status?: string;
  role?: string;
  benched?: string;
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const params = await searchParams;
  const status = (params.status ?? "ACTIVE") as "ACTIVE" | "LEFT" | "KICKED" | "ALL";
  const benched = params.benched === "benched" || params.benched === "active" ? params.benched : undefined;

  const [membersList, discordRoleList] = await Promise.all([
    listMembers({
      search: params.q,
      status,
      discordRoleId: params.role,
      benched,
    }),
    listDiscordRoles(),
  ]);

  const rolesById = new Map(discordRoleList.map((r) => [r.id, r]));

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
            className="w-56 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />
          <select
            name="status"
            defaultValue={status}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="ACTIVE">สมาชิกปัจจุบัน</option>
            <option value="LEFT">ออกจากกิลด์</option>
            <option value="KICKED">ถูกเตะออก</option>
            <option value="ALL">แสดงทั้งหมด</option>
          </select>
          <select
            name="role"
            defaultValue={params.role ?? ""}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="">แสดงทุกยศใน Discord</option>
            {discordRoleList.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <select
            name="benched"
            defaultValue={benched ?? ""}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="">แสดงทุกสถานะ</option>
            <option value="active">สถานะออนไลน์</option>
            <option value="benched">สถานะออฟไลน์ (พักการเล่น)</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
          >
            ค้นหา
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">สมาชิก</th>
              <th className="px-5 py-3 font-medium">ชื่อในเกม</th>
              <th className="px-5 py-3 font-medium">อาชีพ</th>
              <th className="px-5 py-3 font-medium">Discord role</th>
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
                    <MemberAvatar
                      src={member.discordAvatar}
                      alt={member.discordUsername}
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-full ring-1 ring-zinc-700"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-zinc-100">
                        {memberDisplayName(member)}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        @{member.discordUsername}
                      </div>
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3 text-zinc-300">{member.inGameName ?? "—"}</td>
                <td className="px-5 py-3 text-zinc-300">
                  <ClassBadge className={member.characterClass} />
                </td>
                <td className="px-5 py-3">
                  <RoleChips roleIds={member.discordRoles} rolesById={rolesById} />
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={member.status} />
                    {member.benched && <BenchedBadge />}
                  </div>
                </td>
                <td className="px-5 py-3 text-zinc-400">
                  {member.joinedDiscordAt
                    ? new Date(member.joinedDiscordAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })
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
