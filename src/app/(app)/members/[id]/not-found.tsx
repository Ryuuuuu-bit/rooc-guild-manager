import Link from "next/link";

export default function MemberNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
      <h1 className="text-lg font-semibold text-zinc-100">ไม่พบสมาชิกนี้</h1>
      <p className="text-sm text-zinc-500">อาจถูกลบ หรือลิงก์ไม่ถูกต้อง</p>
      <Link href="/members" className="mt-2 text-sm text-amber-400 hover:text-amber-300">
        ← กลับไปหน้ารายชื่อสมาชิก
      </Link>
    </div>
  );
}
