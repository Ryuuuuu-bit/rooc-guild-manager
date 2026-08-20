import Image from "next/image";
import { notFound } from "next/navigation";
import { getMemberById } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { StatusBadge, ClassBadge, BenchedBadge } from "@/components/badges";
import { eventLabels, memberDisplayName } from "@/lib/ui";
import { MemberEditForm } from "@/components/member-edit-form";
import { MemberStatusActions } from "@/components/member-status-actions";
import { formatDistanceToNow } from "date-fns";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireUser();
  const data = await getMemberById(id);
  if (!data) notFound();

  const { member, events } = data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
        <Image
          src={member.discordAvatar ?? "https://cdn.discordapp.com/embed/avatars/0.png"}
          alt={member.discordUsername}
          width={64}
          height={64}
          unoptimized
          className="h-16 w-16 rounded-full ring-2 ring-zinc-700"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-zinc-50">
            {memberDisplayName(member)}
          </h1>
          <p className="text-sm text-zinc-500">@{member.discordUsername}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={member.status} />
          {member.benched && <BenchedBadge />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-4 font-medium text-zinc-100">ข้อมูลสมาชิก</h2>
            {session.user.isAdmin ? (
              <MemberEditForm member={member} />
            ) : (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-zinc-500">ชื่อในเกม</dt>
                  <dd className="text-sm text-zinc-200">{member.inGameName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">คลาส</dt>
                  <dd className="text-sm text-zinc-200">
                    <ClassBadge className={member.characterClass} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">เลเวล</dt>
                  <dd className="text-sm text-zinc-200">{member.level ?? "—"}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-4 font-medium text-zinc-100">ประวัติกิจกรรม</h2>
            <ol className="flex flex-col gap-4">
              {events.length === 0 && (
                <li className="text-sm text-zinc-500">ยังไม่มีประวัติ</li>
              )}
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                  <div className="min-w-0">
                    <p className="text-zinc-200">
                      {eventLabels[event.type] ?? event.type}
                      {event.detail ? ` — ${event.detail}` : ""}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatDistanceToNow(event.createdAt, { addSuffix: true })}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-4 font-medium text-zinc-100">สถานะ Discord</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-500">ชื่อเล่นในเซิร์ฟเวอร์ (nickname)</dt>
                <dd className="text-zinc-200">{member.discordNickname ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">เข้าร่วม Discord เมื่อ</dt>
                <dd className="text-zinc-200">
                  {member.joinedDiscordAt
                    ? new Date(member.joinedDiscordAt).toLocaleString("th-TH")
                    : "ไม่ทราบ"}
                </dd>
              </div>
              {member.leftDiscordAt && (
                <div>
                  <dt className="text-xs text-zinc-500">ออกจาก Discord เมื่อ</dt>
                  <dd className="text-zinc-200">
                    {new Date(member.leftDiscordAt).toLocaleString("th-TH")}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-zinc-500">ซิงค์ล่าสุด</dt>
                <dd className="text-zinc-200">
                  {formatDistanceToNow(member.lastSyncedAt, { addSuffix: true })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">จำนวน role ใน Discord</dt>
                <dd className="text-zinc-200">{member.discordRoles.length}</dd>
              </div>
            </dl>
          </section>

          {session.user.isAdmin && (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="mb-4 font-medium text-zinc-100">การจัดการสมาชิก</h2>
              <MemberStatusActions member={member} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
