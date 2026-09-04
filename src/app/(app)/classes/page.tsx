import { requireAdmin } from "@/lib/authz";
import { listJobClasses } from "@/lib/job-classes";
import { JobClassManager } from "@/components/job-class-manager";

export default async function ClassesPage() {
  await requireAdmin();
  const classes = await listJobClasses();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Manage Classes</h1>
        <p className="mt-1 text-sm text-zinc-400">Add, edit, delete, or reorder in-game classes right from this page.</p>
      </div>
      <JobClassManager classes={classes} />
    </div>
  );
}
