import Link from "next/link";
import { CHECKIN_EVENTS, getCheckinEvent, getCheckinReport, listCheckinWindows } from "@/lib/checkin-data";
import { requireUser } from "@/lib/authz";
import { memberDisplayName } from "@/lib/ui";
import { MemberAvatar } from "@/components/member-avatar";
import { CheckinNoteCell } from "@/components/checkin-note-cell";

interface SearchParams {
  event?: string;
  date?: string;
}

const WEEKDAY_LABELS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสฯ", "ศุกร์", "เสาร์"];

function fmtDatePill(d: Date): string {
  return d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

function fmtHHMM(time: string): string {
  return time.slice(0, 5).replace(":", ".");
}

export default async function CheckinPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireUser();
  const params = await searchParams;

  const event = getCheckinEvent(params.event ?? "") ?? CHECKIN_EVENTS[0];
  const scheduleLabel = `${event.weekdays.map((w) => WEEKDAY_LABELS[w]).join("/")} ${fmtHHMM(event.startTime)}-${fmtHHMM(event.endTime)} น.`;

  const windows = await listCheckinWindows(event.key);
  const selected = windows.find((w) => w.date === params.date) ?? windows[0] ?? null;
  const report = selected ? await getCheckinReport(event.key, selected.date) : null;
  const windowMinutes = selected ? Math.round((selected.end.getTime() - selected.start.getTime()) / 60_000) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">เช็คชื่อกิจกรรม — {event.label}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            ใครอยู่ใน voice channel ช่วงกิจกรรม ({scheduleLabel}) บ้าง — นับว่า &quot;เข้าร่วม&quot; ถ้าเข้าห้องแม้แค่
            ช่วงเดียวในช่วงเวลานี้ ไม่บังคับเวลาขั้นต่ำ พร้อมเวลาสะสมที่อยู่จริงให้ดูประกอบ
          </p>
          {session.user.isAdmin && (
            <p className="mt-1 text-xs text-zinc-500">
              ระบบเริ่มเก็บข้อมูลอัตโนมัติตั้งแต่วันที่ deploy ฟีเจอร์นี้ (หรือแต่ละกิจกรรม) เป็นต้นไป — Discord
              ไม่มีประวัติ voice ย้อนหลังให้ดึงมาได้ รอบก่อนหน้านั้นต้องใช้การแคปแบบเดิม และถ้าบอทออฟไลน์ช่วงกิจกรรม
              (เช่นตอน deploy) ข้อมูลช่วงนั้นจะขาดหายไปบางส่วน
            </p>
          )}
        </div>
        {CHECKIN_EVENTS.length > 1 && (
          <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
            {CHECKIN_EVENTS.map((e) => (
              <Link
                key={e.key}
                href={`/checkin?event=${e.key}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  event.key === e.key ? "bg-amber-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {e.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {windows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-500">
          ยังไม่มีข้อมูล — ระบบจะเริ่มเก็บอัตโนมัติตั้งแต่รอบ {scheduleLabel.split(" ")[0]} ถัดไปที่มีคนเข้าห้อง
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
            {windows.map((w) => (
              <Link
                key={w.date}
                href={`/checkin?event=${event.key}&date=${w.date}`}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  selected?.date === w.date
                    ? "bg-amber-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {fmtDatePill(w.start)}
              </Link>
            ))}
          </div>

          {report && (
            <>
              <p className="text-sm text-zinc-400">
                รอบ {fmtDatePill(report.window.start)} ({fmtTime(report.window.start)}-{fmtTime(report.window.end)} น.)
                — เข้าร่วม <span className="font-medium text-emerald-400">{report.attendedCount}</span>/
                {report.totalCount} คน
              </p>

              <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                      <th className="w-10 px-5 py-3 font-medium">#</th>
                      <th className="px-5 py-3 font-medium">สมาชิก</th>
                      <th className="px-5 py-3 font-medium">สถานะ</th>
                      <th className="px-5 py-3 font-medium">เวลาสะสม</th>
                      <th className="px-5 py-3 font-medium">เข้าห้องครั้งแรก</th>
                      <th className="px-5 py-3 font-medium">ออกจากห้องล่าสุด</th>
                      <th className="px-5 py-3 font-medium">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {report.results.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-10 text-center text-zinc-500">
                          ไม่มีข้อมูลสมาชิก
                        </td>
                      </tr>
                    )}
                    {report.results.map((row, i) => (
                      <tr key={row.member.id} className={`hover:bg-zinc-800/40 ${row.attended ? "" : "bg-rose-950/10"}`}>
                        <td className="px-5 py-3 text-zinc-500">{i + 1}</td>
                        <td className="px-5 py-3">
                          <Link href={`/members/${row.member.id}`} className="flex items-center gap-3">
                            <MemberAvatar
                              src={row.member.discordAvatar}
                              alt={row.member.discordUsername}
                              width={28}
                              height={28}
                              className="h-7 w-7 rounded-full ring-1 ring-zinc-700"
                            />
                            <span className="truncate font-medium text-zinc-100">{memberDisplayName(row.member)}</span>
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          {row.attended ? (
                            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                              เข้าร่วม
                            </span>
                          ) : (
                            <span className="rounded-full bg-rose-400/15 px-2 py-0.5 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-400/30">
                              ไม่เข้าร่วม
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-zinc-300">
                          {row.attended ? `${row.minutesPresent}/${windowMinutes} นาที` : "—"}
                        </td>
                        <td className="px-5 py-3 text-xs text-zinc-400">{row.firstJoinAt ? fmtTime(row.firstJoinAt) : "—"}</td>
                        <td className="px-5 py-3 text-xs text-zinc-400">
                          {row.stillConnected ? "ยังอยู่ในห้อง" : row.lastLeaveAt ? fmtTime(row.lastLeaveAt) : "—"}
                        </td>
                        <td className="px-5 py-3">
                          <CheckinNoteCell
                            eventKey={event.key}
                            date={report.window.date}
                            memberId={row.member.id}
                            note={row.note}
                            isAdmin={session.user.isAdmin}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
