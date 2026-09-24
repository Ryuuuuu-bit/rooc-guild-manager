import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { listJobClasses } from "@/lib/job-classes";
import { PageHeader } from "@/components/ui/kit";
import { JobClassManager, type ClassUsage } from "@/components/job-class-manager";

export default async function ClassesPage() {
  await requireAdmin();
  const [classes, roster] = await Promise.all([
    listJobClasses(),
    db
      .select({ characterClass: members.characterClass, altClasses: members.altClasses })
      .from(members)
      .where(and(eq(members.status, "ACTIVE"), eq(members.benched, false))),
  ]);

  const usage: Record<string, ClassUsage> = {};
  const bump = (name: string, k: keyof ClassUsage) => {
    usage[name] ??= { main: 0, alt: 0 };
    usage[name][k]++;
  };
  for (const m of roster) {
    if (m.characterClass) bump(m.characterClass, "main");
    for (const a of m.altClasses) bump(a, "alt");
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Manage Classes"
        description="The in-game classes used across the site (profiles, party boards, PVP stats) and as the emoji in Discord's “select your class” message. Colour and key stat save instantly."
      />
      <JobClassManager classes={classes} usage={usage} roster={roster.length} />
    </div>
  );
}
