import { listMembers } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { RandomPicker } from "@/components/random-picker";

/**
 * A lightweight "lucky draw" mini-game — spins through the active guild
 * roster and lands on one random member. Handy for picking who leads the
 * next run, who gets a giveaway item, etc. Open to every signed-in member,
 * not just admins — it's just for fun, not a management tool.
 */
export default async function RandomPickerPage() {
  await requireUser();
  const activeMembers = await listMembers({ status: "ACTIVE" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Random Member</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Click &quot;Randomize!&quot; to pick a random name from the active guild roster — for fun, picking a team lead, giveaways, etc.
        </p>
      </div>

      <RandomPicker
        members={activeMembers.map((m) => ({
          id: m.id,
          discordUsername: m.discordUsername,
          discordNickname: m.discordNickname,
          discordGlobalName: m.discordGlobalName,
          discordAvatar: m.discordAvatar,
          inGameName: m.inGameName,
          characterClass: m.characterClass,
          benched: m.benched,
        }))}
      />
    </div>
  );
}
