import { requireUser } from "@/lib/authz";
import { listDiscordRoles } from "@/lib/data";
import { getMembersDirectory } from "@/lib/members-directory";
import { MembersDirectoryView } from "@/components/members-directory";

interface SearchParams {
  q?: string;
  status?: string;
  role?: string;
  benched?: string;
  class?: string;
}

// Old query-string filters (?status=LEFT, ?benched=benched, ?class=Priest …)
// still work as the directory's starting filters, so existing links land
// on the same view; everything after that filters client-side instantly.
function initialStatus(params: SearchParams): "current" | "active" | "benched" | "left" | "all" | undefined {
  if (params.benched === "benched") return "benched";
  if (params.benched === "active") return "active";
  if (params.status === "LEFT" || params.status === "KICKED") return "left";
  if (params.status === "ALL") return "all";
  return undefined;
}

export default async function MembersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireUser();
  const params = await searchParams;
  const isAdmin = session.user.isAdmin;

  const [directory, roles] = await Promise.all([getMembersDirectory({ includeAdminData: isAdmin }), listDiscordRoles()]);

  return (
    <MembersDirectoryView
      directory={directory}
      roles={roles}
      isAdmin={isAdmin}
      now={new Date().getTime()}
      initial={{ status: initialStatus(params), className: params.class || undefined, roleId: params.role || undefined, q: params.q || undefined }}
    />
  );
}
