import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Require a signed-in guild member; redirects to /login otherwise. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/** Require a signed-in admin; redirects non-admins to the dashboard. */
export async function requireAdmin() {
  const session = await requireUser();
  if (!session.user.isAdmin) {
    redirect("/?error=AdminOnly");
  }
  return session;
}
