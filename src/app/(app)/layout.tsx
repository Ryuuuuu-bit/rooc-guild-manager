import type { ReactNode } from "react";
import { requireUser } from "@/lib/authz";
import { Nav } from "@/components/nav";
import { JobClassesProvider } from "@/components/job-classes-provider";
import { listJobClasses } from "@/lib/job-classes";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [session, jobClasses] = await Promise.all([requireUser(), listJobClasses()]);

  return (
    <div className="flex min-h-screen flex-col">
      <Nav
        username={session.user.username}
        avatarUrl={session.user.avatarUrl}
        isAdmin={session.user.isAdmin}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <JobClassesProvider classes={jobClasses}>{children}</JobClassesProvider>
      </main>
      <footer className="border-t border-zinc-900 px-4 py-4 text-center text-xs text-zinc-600 sm:px-6">
        Divine Guild Manager — sync อัตโนมัติกับ Discord
      </footer>
    </div>
  );
}
