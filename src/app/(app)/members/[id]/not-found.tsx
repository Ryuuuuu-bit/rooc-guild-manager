import Link from "next/link";

export default function MemberNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
      <h1 className="text-lg font-semibold text-zinc-100">Member Not Found</h1>
      <p className="text-sm text-zinc-500">This member may have been deleted, or the link is incorrect</p>
      <Link href="/members" className="mt-2 text-sm text-amber-400 hover:text-amber-300">
        ← Back to member list
      </Link>
    </div>
  );
}
