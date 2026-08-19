import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

const errorMessages: Record<string, string> = {
  NotAGuildMember:
    "บัญชี Discord ของคุณไม่ได้เป็นสมาชิกของ Discord server กิลด์นี้ กรุณาเข้าร่วม server ก่อนแล้วลองใหม่อีกครั้ง",
  Verification: "ตรวจสอบสถานะสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  AdminOnly: "หน้านี้สำหรับแอดมินเท่านั้น",
  Default: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const { error } = await searchParams;
  const message = error
    ? (errorMessages[error] ?? errorMessages.Default)
    : null;

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl font-bold shadow-lg shadow-indigo-900/40">
            R
          </div>
          <h1 className="text-xl font-semibold text-zinc-50">
            ROOC Guild Manager
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            เข้าสู่ระบบด้วยบัญชี Discord ของกิลด์
          </p>
        </div>

        {message && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {message}
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#4a54d6] focus:outline-none focus:ring-2 focus:ring-[#5865F2]/50"
          >
            <svg viewBox="0 0 127.14 96.36" className="h-5 w-5 fill-current">
              <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
            </svg>
            เข้าสู่ระบบด้วย Discord
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-500">
          ต้องเป็นสมาชิกของ Discord server กิลด์เท่านั้นจึงจะเข้าใช้งานได้
        </p>
      </div>
    </div>
  );
}
