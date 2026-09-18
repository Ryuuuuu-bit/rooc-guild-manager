import Image from "next/image";
import { signOut } from "@/auth";
import { SidebarNavLinks } from "@/components/nav-links";

interface SidebarProps {
  username: string;
  avatarUrl: string;
  isAdmin: boolean;
}

/**
 * Persistent left-hand navigation rail — sm and up only. Mobile keeps the
 * compact top bar in Nav (see nav.tsx) untouched instead; this component
 * simply doesn't render anything visible below the sm breakpoint. Carries
 * the same identity block (logo, avatar, admin badge, sign out) the old top
 * Nav used to show, plus the full link list, just laid out top-to-bottom in
 * a rail instead of packed into one row of dropdowns.
 *
 * A plain Server Component (like the old Nav) so the sign-out button below
 * can use an inline Server Action the same way Nav always did — the
 * pathname-aware, "which link is active" part lives in the Client Component
 * SidebarNavLinks instead, same split Nav already used for
 * DesktopNavLinks/MobileNavLinks.
 */
export function Sidebar({ username, avatarUrl, isAdmin }: SidebarProps) {
  return (
    <aside className="hidden sm:sticky sm:top-0 sm:flex sm:h-screen sm:w-64 sm:shrink-0 sm:flex-col sm:border-r sm:border-zinc-800 sm:bg-zinc-950">
      <div className="flex items-center gap-2 px-4 py-4">
        <Image
          src="/brand/divine-icon.png"
          alt="Divine"
          width={32}
          height={32}
          unoptimized
          className="h-8 w-8 rounded-lg object-cover ring-1 ring-amber-500/40"
        />
        <span className="font-semibold text-zinc-50">Divine</span>
      </div>

      <div className="flex items-center gap-2.5 border-y border-zinc-900 px-4 py-3">
        <Image
          src={avatarUrl}
          alt={username}
          width={32}
          height={32}
          unoptimized
          className="h-8 w-8 shrink-0 rounded-full ring-1 ring-zinc-700"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-zinc-200">{username}</p>
          {isAdmin && (
            <span className="mt-0.5 inline-block rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/30">
              Admin
            </span>
          )}
        </div>
      </div>

      <SidebarNavLinks isAdmin={isAdmin} />

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
        className="border-t border-zinc-900 px-3 py-3"
      >
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
        >
          Sign Out
        </button>
      </form>
    </aside>
  );
}
