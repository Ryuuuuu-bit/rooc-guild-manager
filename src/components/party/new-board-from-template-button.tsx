"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createBoardFromTemplate,
  deletePartyTemplate,
  listPartyTemplates,
  type PartyTemplateItem,
} from "@/app/actions/party-templates";

/** Admin tool: creates a new board pre-populated with a saved template's groups/party-counts, instead of manually recreating them one by one. */
export function NewBoardFromTemplateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<PartyTemplateItem[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [boardName, setBoardName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    const list = await listPartyTemplates();
    setLoading(false);
    setTemplates(list);
    setTemplateId(list[0]?.id ?? "");
  }

  async function handleCreate() {
    if (!templateId || !boardName.trim()) return;
    setCreating(true);
    setError(null);
    const res = await createBoardFromTemplate(boardName, templateId);
    setCreating(false);
    if (!res.ok || !res.id) {
      setError(res.error ?? "สร้างกระดานไม่สำเร็จ");
      return;
    }
    setOpen(false);
    router.push(`/party?board=${res.id}`);
    router.refresh();
  }

  async function handleDeleteTemplate(id: string) {
    if (!confirm("ลบ Template นี้?")) return;
    await deletePartyTemplate(id);
    setTemplates((prev) => prev?.filter((t) => t.id !== id) ?? null);
    if (templateId === id) setTemplateId((prev) => (prev === id ? "" : prev));
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 transition hover:border-indigo-500 hover:text-indigo-300"
      >
        + จาก Template
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">สร้างกระดานใหม่จาก Template</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200">
                ปิด ✕
              </button>
            </div>

            {loading && <p className="py-6 text-center text-sm text-zinc-500">กำลังโหลด...</p>}

            {!loading && templates && templates.length === 0 && (
              <p className="py-6 text-center text-sm text-zinc-500">
                ยังไม่มี Template — บันทึกผังกระดานที่มีอยู่แล้วเป็น Template ได้จากปุ่ม &quot;บันทึกเป็น Template&quot;
              </p>
            )}

            {!loading && templates && templates.length > 0 && (
              <div className="flex flex-col gap-3">
                {error && <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{error}</p>}

                <div className="flex flex-col gap-1.5">
                  {templates.map((t) => (
                    <label
                      key={t.id}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                        templateId === t.id ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-800 hover:bg-zinc-900"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="template"
                          checked={templateId === t.id}
                          onChange={() => setTemplateId(t.id)}
                          className="accent-indigo-500"
                        />
                        <span>
                          <span className="block font-medium text-zinc-200">{t.name}</span>
                          <span className="block text-xs text-zinc-500">
                            {t.structure.map((g) => `${g.name} (${g.partyCount})`).join(", ")}
                          </span>
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          handleDeleteTemplate(t.id);
                        }}
                        className="shrink-0 text-xs text-zinc-600 hover:text-rose-400"
                      >
                        ลบ
                      </button>
                    </label>
                  ))}
                </div>

                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-zinc-400">ชื่อกระดานใหม่</span>
                  <input
                    value={boardName}
                    onChange={(e) => setBoardName(e.target.value)}
                    placeholder="เช่น GVG รอบ 2"
                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!templateId || !boardName.trim() || creating}
                    onClick={handleCreate}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? "กำลังสร้าง..." : "สร้างกระดาน"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
