"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createJobClass, deleteJobClass, moveJobClass, updateJobClass } from "@/app/actions/job-classes";
import { COLOR_KEYS, SWATCH_CLASS, type ColorKey } from "@/lib/job-class-colors";
import type { JobClassClient } from "@/components/job-classes-provider";

interface JobClassItem extends JobClassClient {
  id: string;
  colorKey: string;
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={key}
          className={`h-6 w-6 rounded-full ring-2 transition ${SWATCH_CLASS[key]} ${
            value === key ? "ring-zinc-100" : "ring-transparent hover:ring-zinc-600"
          }`}
        />
      ))}
    </div>
  );
}

function ClassForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: { name: string; emoji: string; colorKey: string };
  onSubmit: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [colorKey, setColorKey] = useState<string>(initial?.colorKey ?? (COLOR_KEYS[0] as ColorKey));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("name", name);
    fd.set("emoji", emoji);
    fd.set("colorKey", colorKey);
    startTransition(async () => {
      const res = await onSubmit(fd);
      if (!res.ok) {
        setError(res.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      {error && <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px]">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-400">ชื่ออาชีพ</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น Sura, Guillotine Cross"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-400">อิโมจิ</span>
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🗡️"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-center text-lg text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </label>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-400">สี</span>
        <ColorPicker value={colorKey} onChange={setColorKey} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "กำลังบันทึก..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function JobClassManager({ classes }: { classes: JobClassItem[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  function handleMove(id: string, direction: "up" | "down") {
    setMovingId(id);
    moveJobClass(id, direction).then(() => {
      setMovingId(null);
      router.refresh();
    });
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`ลบอาชีพ "${name}"? การกระทำนี้ย้อนกลับไม่ได้`)) return;
    const res = await deleteJobClass(id);
    if (!res.ok) {
      setError(res.error ?? "ลบไม่สำเร็จ");
      return;
    }
    setError(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-400">
        อาชีพในรายชื่อนี้จะโผล่ในทุกจุดที่เลือกอาชีพ (โปรไฟล์สมาชิก, จัดปาร์ตี้) และเป็นอิโมจิในข้อความ &quot;เลือกอาชีพ&quot; บน
        Discord — แก้ที่นี่แล้วไม่ต้องรอให้ Claude แก้โค้ดอีก
      </p>

      {error && <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-xs text-rose-300">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <th className="w-10 px-3 py-3 font-medium">ลำดับ</th>
              <th className="px-3 py-3 font-medium">ตัวอย่าง</th>
              <th className="px-3 py-3 font-medium text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {classes.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-zinc-500">
                  ยังไม่มีอาชีพในระบบ — กด &quot;เพิ่มอาชีพใหม่&quot; ด้านล่าง
                </td>
              </tr>
            )}
            {classes.map((c, i) =>
              editingId === c.id ? (
                <tr key={c.id}>
                  <td colSpan={3} className="p-2">
                    <ClassForm
                      initial={c}
                      submitLabel="บันทึก"
                      onCancel={() => setEditingId(null)}
                      onSubmit={(fd) => updateJobClass(c.id, fd)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={c.id} className="transition hover:bg-zinc-800/40">
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        disabled={i === 0 || movingId === c.id}
                        onClick={() => handleMove(c.id, "up")}
                        className="text-zinc-500 transition hover:text-zinc-200 disabled:opacity-20"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={i === classes.length - 1 || movingId === c.id}
                        onClick={() => handleMove(c.id, "down")}
                        className="text-zinc-500 transition hover:text-zinc-200 disabled:opacity-20"
                      >
                        ▼
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.colorClass}`}>
                      <span className="text-sm">{c.emoji}</span>
                      {c.name}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingId(c.id)}
                      className="mr-3 text-xs text-amber-400 transition hover:text-amber-300"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id, c.name)}
                      className="text-xs text-rose-400 transition hover:text-rose-300"
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {showAdd ? (
        <ClassForm submitLabel="เพิ่มอาชีพ" onCancel={() => setShowAdd(false)} onSubmit={createJobClass} />
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="self-start rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:border-amber-500 hover:text-amber-300"
        >
          + เพิ่มอาชีพใหม่
        </button>
      )}
    </div>
  );
}
