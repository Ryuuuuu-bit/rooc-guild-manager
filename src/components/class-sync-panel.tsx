"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyClassSync, fetchClassSyncProposals, type ClassSyncSelection } from "@/app/actions/sheet-sync";
import type { ClassSyncResult } from "@/lib/sheet-sync";
import { CLASS_OPTIONS } from "@/lib/classes";
import { ClassIcon } from "@/components/class-icon";
import { classColors } from "@/lib/classes";

/**
 * Admin tool: pulls class data from the guild's Google Sheet (members fill
 * it in themselves) and proposes updates to each matching member's class.
 * Sheet class labels don't map 1:1 onto our finer-grained CLASS_OPTIONS
 * (e.g. sheet "Wiz" could be WizMeteo or WizCC), so every proposed row is
 * shown for review — with a best guess prefilled where unambiguous — and
 * nothing is written until the admin hits "ยืนยันการซิงค์".
 */
export function ClassSyncPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ClassSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setApplyMessage(null);
    const res = await fetchClassSyncProposals();
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? "ซิงค์ไม่สำเร็จ");
      setResult(null);
      return;
    }
    setResult(res.data);
    const initial: Record<string, string> = {};
    for (const p of res.data.proposals) {
      initial[p.memberId] = p.suggestedClass ?? "";
    }
    setSelections(initial);
  }

  function handleApply() {
    if (!result) return;
    const toApply: ClassSyncSelection[] = result.proposals
      .filter((p) => selections[p.memberId])
      .map((p) => ({
        memberId: p.memberId,
        className: selections[p.memberId],
        sheetClassRaw: p.sheetClassRaw,
      }));
    if (toApply.length === 0) {
      setApplyMessage("ไม่มีรายการที่เลือกไว้ให้บันทึก");
      return;
    }
    startTransition(async () => {
      const res = await applyClassSync(toApply);
      if (!res.ok) {
        setApplyMessage(res.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setApplyMessage(`บันทึกแล้ว ${res.appliedCount} รายการ`);
      setResult(null);
      router.refresh();
    });
  }

  const includedCount = Object.values(selections).filter(Boolean).length;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:border-indigo-500 hover:text-indigo-300"
      >
        ซิงค์ Class จาก Sheet
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">ซิงค์ Class จาก Google Sheet</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200"
              >
                ปิด ✕
              </button>
            </div>

            {loading && <p className="py-6 text-center text-sm text-zinc-500">กำลังดึงข้อมูลจาก Sheet...</p>}

            {!loading && error && (
              <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</p>
            )}

            {!loading && !error && result && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-zinc-500">
                  พบ {result.totalSheetRows} แถวใน Sheet · จับคู่ชื่อในเกมได้ {result.proposals.length} รายการที่มีการเปลี่ยนแปลง
                </p>

                {result.duplicateNames.length > 0 && (
                  <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-300">
                    ชื่อในเกมซ้ำกันหลายสมาชิก ข้ามให้ไม่ auto-match: {result.duplicateNames.join(", ")}
                  </p>
                )}

                {result.unmatchedSheetNames.length > 0 && (
                  <details className="rounded-lg border border-zinc-800 p-2 text-xs text-zinc-500">
                    <summary className="cursor-pointer select-none text-zinc-400">
                      ไม่พบชื่อในระบบ ({result.unmatchedSheetNames.length} ชื่อ)
                    </summary>
                    <p className="mt-1">{result.unmatchedSheetNames.join(", ")}</p>
                  </details>
                )}

                {result.proposals.length === 0 ? (
                  <p className="py-6 text-center text-sm text-zinc-500">ไม่มีอะไรต้องอัปเดต ทุกคนตรงกับ Sheet อยู่แล้ว</p>
                ) : (
                  <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-800">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                        <tr>
                          <th className="px-2 py-2 font-medium">สมาชิก</th>
                          <th className="px-2 py-2 font-medium">Sheet</th>
                          <th className="px-2 py-2 font-medium">ปัจจุบัน</th>
                          <th className="px-2 py-2 font-medium">ตั้งเป็น</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {result.proposals.map((p) => (
                          <tr key={p.memberId}>
                            <td className="px-2 py-1.5 text-zinc-200">{p.memberDisplayName}</td>
                            <td className="px-2 py-1.5 text-zinc-400">
                              {p.sheetName} · <span className="text-zinc-500">{p.sheetClassRaw}</span>
                            </td>
                            <td className="px-2 py-1.5 text-zinc-400">{p.currentClass ?? "—"}</td>
                            <td className="px-2 py-1.5">
                              <select
                                value={selections[p.memberId] ?? ""}
                                onChange={(e) =>
                                  setSelections((prev) => ({ ...prev, [p.memberId]: e.target.value }))
                                }
                                className={`rounded border px-1.5 py-1 text-xs focus:outline-none ${
                                  selections[p.memberId]
                                    ? `border-transparent ${classColors[selections[p.memberId]] ?? "bg-zinc-800 text-zinc-200"}`
                                    : "border-amber-700/60 bg-zinc-900 text-amber-300"
                                }`}
                              >
                                <option value="">- ข้าม -</option>
                                {CLASS_OPTIONS.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              {selections[p.memberId] && <ClassIcon job={selections[p.memberId]} size={10} className="ml-1 inline" />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {applyMessage && <p className="text-xs text-indigo-300">{applyMessage}</p>}

                {result.proposals.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleApply}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
                    >
                      ยืนยันการซิงค์ ({includedCount} รายการ)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
