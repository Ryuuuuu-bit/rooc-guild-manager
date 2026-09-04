import Link from "next/link";
import Image from "next/image";
import { signOut } from "@/auth";
import { DesktopNavLinks, MobileNavLinks } from "@/components/nav-links";

interface NavProps {
  username: string;
  avatarUrl: string;
  isAdmin: boolean;
}

export function Nav({ username, avatarUrl, isAdmin }: NavProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-50">
            <Image
              src="/brand/divine-icon.png"
              alt="Divine"
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 rounded-lg object-cover ring-1 ring-amber-500/40"
            />
            Divine
          </Link>
          <DesktopNavLinks isAdmin={isAdmin} />
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <span className="hidden whitespace-nowrap rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-500/30 sm:inline-block">
              Admin
            </span>
          )}
          <Image
            src={avatarUrl}
            alt={username}
            width={32}
            height={32}
            unoptimized
            className="h-8 w-8 rounded-full ring-1 ring-zinc-700"
          />
          <span className="hidden text-sm text-zinc-300 sm:inline">{username}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
      <MobileNavLinks isAdmin={isAdmin} />
    </header>
  );
}
