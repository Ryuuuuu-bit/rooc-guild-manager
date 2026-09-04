import { notFound } from "next/navigation";
import { getMemberById } from "@/lib/data";
import { listPartyBoards } from "@/lib/party-data";
import { requireUser } from "@/lib/authz";
import { StatusBadge, ClassBadge, BenchedBadge } from "@/components/badges";
import { memberDisplayName } from "@/lib/ui";
import { MemberEditForm } from "@/components/member-edit-form";
import { MemberStatusActions } from "@/components/member-status-actions";
import { MemberNotes } from "@/components/member-notes";
import { LogManualLeaveForm } from "@/components/log-manual-leave-form";
import { ActivityListItem } from "@/components/activity-list-item";
import { MemberAvatar } from "@/components/member-avatar";
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

  const { member, events, notes } = data;
  const boards = session.user.isAdmin ? await listPartyBoards() : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
        <MemberAvatar
          src={member.discordAvatar}
          alt={member.discordUsername}
          width={64}
          height={64}
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
            <h2 className="mb-4 font-medium text-zinc-100">Member Information</h2>
            {session.user.isAdmin ? (
              <MemberEditForm member={member} />
            ) : (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-zinc-500">In-game Name</dt>
                  <dd className="text-sm text-zinc-200">{member.inGameName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Class</dt>
                  <dd className="text-sm text-zinc-200">
                    <ClassBadge className={member.characterClass} />
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50">
            <h2 className="px-6 pt-6 pb-4 font-medium text-zinc-100">Activity History</h2>
            <ul className="divide-y divide-zinc-800">
              {events.length === 0 && (
                <li className="px-6 pb-6 text-sm text-zinc-500">No activity yet</li>
              )}
              {events.map((event) => (
                <ActivityListItem
                  key={event.id}
                  event={event}
                  member={member}
                  isAdmin={session.user.isAdmin}
                />
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-4 font-medium text-zinc-100">Discord Status</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-500">Discord Server Nickname</dt>
                <dd className="text-zinc-200">{member.discordNickname ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Joined Discord</dt>
                <dd className="text-zinc-200">
                  {member.joinedDiscordAt
                    ? new Date(member.joinedDiscordAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
                    : "Unknown"}
                </dd>
              </div>
              {member.leftDiscordAt && (
                <div>
                  <dt className="text-xs text-zinc-500">Left Discord</dt>
                  <dd className="text-zinc-200">
                    {new Date(member.leftDiscordAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-zinc-500">Last Synced</dt>
                <dd className="text-zinc-200">
                  {formatDistanceToNow(member.lastSyncedAt, { addSuffix: true })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Discord Role Count</dt>
                <dd className="text-zinc-200">{member.discordRoles.length}</dd>
              </div>
            </dl>
          </section>

          {session.user.isAdmin && (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="mb-4 font-medium text-zinc-100">Member Management</h2>
              <MemberStatusActions member={member} />
            </section>
          )}

          {session.user.isAdmin && (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="mb-1 font-medium text-zinc-100">Manual Leave Log</h2>
              <p className="mb-4 text-xs text-zinc-500">
                For cases where a member notified their leave privately (e.g. via DM) without reacting in Discord
              </p>
              <LogManualLeaveForm memberId={member.id} todayStr={new Date().toISOString().slice(0, 10)} boards={boards} />
            </section>
          )}

          {session.user.isAdmin && (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="mb-1 font-medium text-zinc-100">Internal Notes</h2>
              <p className="mb-4 text-xs text-zinc-500">Visible to admins only — e.g. AFK during events, already warned</p>
              <MemberNotes memberId={member.id} notes={notes} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
