import { listMembers } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { listOnlineMemberIds } from "@/lib/checkin-data";
import { PageHeader } from "@/components/ui/kit";
import { RandomPicker } from "@/components/random-picker";

/**
 * A lightweight "lucky draw" mini-game — picks one random member from the
 * active roster. Open to every signed-in member — it's just for fun.
 */
export default async function RandomPickerPage() {
  await requireUser();
  const [activeMembers, online] = await Promise.all([listMembers({ status: "ACTIVE" }), listOnlineMemberIds()]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Random Picker" description="Pick a random member — for giveaways, choosing a team lead, or just for fun." />
      <RandomPicker
        onlineIds={[...online]}
        members={activeMembers.map((m) => ({
          id: m.id,
          discordUsername: m.discordUsername,
          discordNickname: m.discordNickname,
          discordGlobalName: m.discordGlobalName,
          discordAvatar: m.discordAvatar,
          inGameName: m.inGameName,
          characterClass: m.characterClass,
          altClasses: m.altClasses,
          benched: m.benched,
        }))}
      />
    </div>
  );
}
