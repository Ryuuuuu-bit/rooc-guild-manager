import Link from "next/link";
import Image from "next/image";
import { signOut } from "@/auth";

interface NavProps {
  username: string;
  avatarUrl: string;
  isAdmin: boolean;
}

const links = [
  { href: "/", label: "ภาพรวม" },
  { href: "/members", label: "สมาชิก" },
  { href: "/activity", label: "ประวัติกิจกรรม" },
];

export function Nav({ username, avatarUrl, isAdmin }: NavProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-50">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold">
              R
            </span>
            ROOC Guild
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <span className="hidden rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 sm:inline-block">
              แอดมิน
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
              ออกจากระบบ
            </button>
          </form>
        </div>
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
