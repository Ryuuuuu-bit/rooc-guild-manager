import type { ReactNode } from "react";
import { requireUser } from "@/lib/authz";
import { SignOutButton } from "@/components/sidebar";
import { BottomBar, ShellProvider, SidebarNav, TopBar } from "@/components/shell/shell-client";
import { FeedbackProvider } from "@/components/feedback";
import { JobClassesProvider } from "@/components/job-classes-provider";
import { listJobClasses } from "@/lib/job-classes";

/**
 * App shell: sidebar (full ≥1024px, icon rail 768–1023px), sticky top bar,
 * phone bottom bar + "More" sheet (<768px), Ctrl+K palette, and the shared
 * confirm/toast layer. Every page gets the same content width (up to
 * 1600px) — see src/components/shell/.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [session, jobClasses] = await Promise.all([requireUser(), listJobClasses()]);
  const signOut = <SignOutButton />;

  return (
    <ShellProvider isAdmin={session.user.isAdmin}>
      <FeedbackProvider>
        <div className="flex min-h-dvh">
          <SidebarNav username={session.user.username} avatarUrl={session.user.avatarUrl} signOut={signOut} />
          <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
            <TopBar signOut={signOut} />
            <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 pb-24 pt-5 sm:px-5 md:pb-10 lg:px-7">
              <JobClassesProvider classes={jobClasses}>{children}</JobClassesProvider>
            </main>
            <footer className="hidden border-t border-zinc-900 px-4 py-4 text-center text-xs text-zinc-600 md:block">
              Divine Guild Manager — Auto-synced with Discord
            </footer>
          </div>
          <BottomBar />
        </div>
      </FeedbackProvider>
    </ShellProvider>
  );
}
