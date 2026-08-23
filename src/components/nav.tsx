import Link from "next/link";
import Image from "next/image";
import { signOut } from "@/auth";

interface NavProps {
  username: string;
  avatarUrl: string;
  isAdmin: boolean;
}

// Kept inline in the top bar — the pages people open every session.
const primaryLinks = [
  { href: "/", label: "ภาพรวม" },
  { href: "/members", label: "สมาชิก" },
  { href: "/party", label: "จัดปาร์ตี้" },
  { href: "/random", label: "สุ่มสมาชิก" },
];

// Grouped under one "กิจกรรม & บันทึก" dropdown on desktop — record-keeping
// pages people check less often, so they don't crowd the top bar. Mobile
// keeps everything flat in the scrollable strip below (see `links`), since
// a dropdown adds friction on touch without saving meaningful space there.
const activityLinks = [
  { href: "/activity", label: "ประวัติกิจกรรม" },
  { href: "/attendance", label: "สถิติการลา" },
  { href: "/checkin", label: "เช็คชื่อ [DC]" },
  { href: "/loot-queue", label: "คิวประมูล" },
];

const links = [...primaryLinks, ...activityLinks];

const linkClass =
  "rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100";

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
            {primaryLinks.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass}>
                {link.label}
              </Link>
            ))}
            <details className="group relative">
              <summary
                className={`${linkClass} flex list-none cursor-pointer items-center gap-1 [&::-webkit-details-marker]:hidden`}
              >
                กิจกรรม &amp; บันทึก
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5 transition group-open:rotate-180"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                    clipRule="evenodd"
                  />
                </svg>
              </summary>
              <div className="absolute left-0 top-full z-20 mt-1 flex w-48 flex-col gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 shadow-xl">
                {activityLinks.map((link) => (
                  <Link key={link.href} href={link.href} className={`${linkClass} block hover:bg-zinc-800`}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </details>
            {isAdmin && (
              <Link href="/classes" className={linkClass}>
                จัดการอาชีพ
              </Link>
            )}
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
