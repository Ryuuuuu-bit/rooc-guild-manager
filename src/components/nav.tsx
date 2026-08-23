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
  { href: "/party", label: "จัดปาร์ตี้" },
  { href: "/activity", label: "ประวัติกิจกรรม" },
  { href: "/attendance", label: "สถิติการลา" },
  { href: "/checkin", label: "เช็คชื่อ [DC]" },
  { href: "/loot-queue", label: "คิวประมูล" },
  { href: "/random", label: "สุ่มสมาชิก" },
];

export function Nav({ username, avatarUrl, isAdmin }: NavProps) {
  const navLinks = isAdmin ? [...links, { href: "/classes", label: "จัดการอาชีพ" }] : links;
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
          <nav className="hidden items-center gap-1 sm:flex">
            {navLinks.map((link) => (
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
            <span className="hidden rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-500/30 sm:inline-block">
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
        {navLinks.map((link) => (
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
