import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { checkIsCurrentlyAdmin } from "@/lib/discord";
import { env } from "@/lib/env";

/** Require a signed-in guild member; redirects to /login otherwise. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/**
 * Require a signed-in admin; redirects non-admins to the dashboard.
 *
 * Re-verifies admin status live against Discord on every call rather than
 * trusting the session's cached isAdmin flag (which is only ever computed
 * once, at sign-in) — see checkIsCurrentlyAdmin for why, and for the
 * fail-open behavior on a transient Discord API problem.
 */
export async function requireAdmin() {
  const session = await requireUser();
  const liveIsAdmin = await checkIsCurrentlyAdmin(
    env.discordGuildId,
    session.user.discordId,
    env.adminUserIds,
    env.adminRoleIds
  );
  const isAdmin = liveIsAdmin ?? session.user.isAdmin;
  if (!isAdmin) {
    redirect("/?error=AdminOnly");
  }
  return session;
}
