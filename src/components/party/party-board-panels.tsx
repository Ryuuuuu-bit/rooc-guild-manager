"use client";

// The organiser-facing extras around the party grid: readiness strip,
// class highlight chips, "หาแทน" popover, side-panel cards, recipe editor
// and the undo toast. Pure presentation — every decision (who's a good sub,
// what a party is missing) comes from party-board-logic.ts.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClassIcon } from "@/components/class-icon";
import { MemberAvatar } from "@/components/member-avatar";
import { useJobClasses } from "@/components/job-classes-provider";
import type { PartyRecipeEntry } from "@/db/schema";
import type { PartyBoardDetail, PartyBoardMemberRef, PartyGroupView } from "@/lib/party-data";
import { findSubCandidates, fmtCp, fullSlots, groupMedianCp, isFullParty, partyCpEstimate, partyStats, seatedClass, type SubCandidate } from "./party-board-logic";

export function Avatar({ member, size = 22 }: { member: Pick<PartyBoardMemberRef, "discordAvatar" | "displayName">; size?: number }) {
  return (
    <span className="relative inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-700" style={{ width: size, height: size, minWidth: size }}>
      <MemberAvatar src={member.discordAvatar} alt={member.displayName} fill sizes={`${size}px`} className="object-cover" />
    </span>
  );
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Thu 24 Sep 19:55" in Thai time — built by hand (not toLocaleString) so
 * the server and browser render the exact same text (no hydration mismatch). */
function fmtRoundWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]} ${hh}:${mm}`;
}

function fmtCountdown(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------------------------------------------------------------------------

function ReadyCard({ label, value, hint, tone, children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "ok" | "warn" | "bad"; children?: React.ReactNode }) {
  const toneClass = tone === "ok" ? "text-emerald-400" : tone === "warn" ? "text-amber-300" : tone === "bad" ? "text-rose-400" : "text-zinc-50";
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
      <div className="truncate text-[10.5px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="truncate text-[11px] text-zinc-500">{hint}</div> : null}
      {children}
    </div>
  );
}

export function ReadinessStrip({
  board,
  activeGroup,
  now,
  isAdmin,
  onEditRecipe,
}: {
  board: PartyBoardDetail;
  activeGroup: PartyGroupView | null;
  now: number;
  isAdmin: boolean;
  onEditRecipe: () => void;
}) {
  // Ticks once a minute so the countdown stays honest on a page left open.
  const [nowMs, setNowMs] = useState(now);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const parties = board.groups.flatMap((g) => g.parties);
  const stats = parties.map((p) => partyStats(p, board.recipe));
  const totalSlots = parties.length * 5;
  const present = stats.reduce((a, s) => a + s.present, 0);
  const empty = stats.reduce((a, s) => a + s.empty, 0);
  const leaveSeated = stats.reduce((a, s) => a + s.leaveSeated, 0);
  const missingParties = stats.filter((s) => s.missing.length).length;

  // Full parties only — one with a hole is "weak" until it's filled, which isn't imbalance.
  const fallbackCp = activeGroup ? groupMedianCp(activeGroup) : 0;
  const fullCps = activeGroup ? activeGroup.parties.filter(isFullParty).map((p) => partyCpEstimate(p, fallbackCp)) : [];
  const groupStats = fullCps; // (length drives the "—" states below)
  const avg = fullCps.length ? fullCps.reduce((a, c) => a + c, 0) / fullCps.length : 0;
  const spread = fullCps.length > 1 ? Math.max(...fullCps) - Math.min(...fullCps) : 0;

  let roundValue: string;
  let roundHint: string;
  if (board.round) {
    const start = new Date(board.round.start).getTime();
    const end = new Date(board.round.end).getTime();
    roundValue = nowMs < start ? `starts in ${fmtCountdown(start - nowMs)}` : nowMs < end ? "live now" : "ended";
    roundHint = `${board.busy.length} on leave this round`;
  } else {
    roundValue = "not linked";
    roundHint = `${board.busy.length} on leave · name the board GL or WOE to link`;
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[1.3fr_repeat(4,1fr)]">
      <div className="col-span-2 min-w-0 rounded-xl border border-zinc-800 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(56,189,248,0.16),transparent_60%)] bg-zinc-900/60 px-3 py-2.5 lg:col-span-1">
        <div className="truncate text-[10.5px] uppercase tracking-wider text-zinc-400">
          {board.round ? `${board.round.label} · ${fmtRoundWhen(board.round.start)}` : `ลา ${board.occurrenceDate}`}
        </div>
        <div className="mt-0.5 text-base font-bold text-zinc-50">{roundValue}</div>
        <div className="truncate text-[11px] text-zinc-500">{roundHint}</div>
      </div>
      <ReadyCard
        label="Seated"
        value={
          <>
            {present}
            <span className="text-sm font-medium text-zinc-500">/{totalSlots}</span>
          </>
        }
        hint={`${empty} empty`}
      />
      <ReadyCard label="Seated but on leave" value={leaveSeated} tone={leaveSeated ? "bad" : "ok"} hint={leaveSeated ? "ต้องหาคนแทน" : "พร้อม ✓"} />
      <ReadyCard
        label="Parties missing a role"
        value={board.recipe.length ? missingParties : "—"}
        tone={!board.recipe.length ? undefined : missingParties ? "warn" : "ok"}
        hint={
          <span className="flex items-center gap-1">
            {board.recipe.length ? (
              <span className="truncate">
                recipe:{" "}
                {board.recipe.map((r) => (
                  <span key={r.className} title={r.className} className="mr-1">
                    <ClassIcon job={r.className} size={11} />
                    {r.count}
                  </span>
                ))}
              </span>
            ) : (
              <span>no recipe set</span>
            )}
            {isAdmin && (
              <button type="button" onClick={onEditRecipe} className="ml-auto shrink-0 text-amber-300 hover:text-amber-200">
                Edit
              </button>
            )}
          </span>
        }
      />
      <ReadyCard
        label={`${activeGroup?.name ?? "Group"} balance`}
        value={groupStats.length > 1 ? `±${fmtCp(spread / 2)}` : "—"}
        tone={groupStats.length > 1 ? (spread > avg * 0.1 ? "warn" : "ok") : undefined}
        hint="CP spread · full parties (no stats = median)"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ClassHighlightBar({ board, value, onChange }: { board: PartyBoardDetail; value: string | null; onChange: (c: string | null) => void }) {
  const placed = new Map<string, number>();
  const total = new Map<string, Set<string>>();
  const add = (c: string | null, id: string) => {
    if (!c) return;
    if (!total.has(c)) total.set(c, new Set());
    total.get(c)!.add(id);
  };
  for (const m of [...board.unassigned, ...board.busy]) add(m.className, m.id);
  for (const g of board.groups)
    for (const p of g.parties)
      for (const s of p.slots) {
        if (!s.member) continue;
        add(s.member.className, s.member.id);
        const c = seatedClass(s);
        if (c && !s.onLeave) {
          placed.set(c, (placed.get(c) ?? 0) + 1);
          add(c, s.member.id); // someone fielded as this class counts toward it too
        }
      }
  const classes = [...total.keys()].sort((a, b) => total.get(b)!.size - total.get(a)!.size || a.localeCompare(b));
  if (!classes.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[10.5px] uppercase tracking-wider text-zinc-600">Highlight class</span>
      {classes.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(value === c ? null : c)}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition ${
            value === c ? "border-amber-400 bg-amber-500/10 text-amber-200 ring-1 ring-amber-400/40" : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600"
          }`}
        >
          <ClassIcon job={c} size={12} />
          {c}
          <span className="tabular-nums text-[11px] text-zinc-500">
            {placed.get(c) ?? 0}/{total.get(c)!.size}
          </span>
        </button>
      ))}
      <span className="ml-1 text-[11px] text-zinc-600">placed / total</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface SubTarget {
  partyId: string;
  slotIndex: number;
  rect: { left: number; top: number; bottom: number };
}

export function SubFinderPopover({ board, target, onPick, onClose }: { board: PartyBoardDetail; target: SubTarget; onPick: (c: SubCandidate) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const left = Math.max(8, Math.min(target.rect.left, window.innerWidth - w - 8));
    const below = target.rect.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, target.rect.top - h - 6) : below;
    // Measured after mount on purpose — the popover's own height decides above vs below.
    setPos({ left, top });
  }, [target]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  let outName = "";
  for (const g of board.groups) for (const p of g.parties) if (p.id === target.partyId) outName = p.slots.find((s) => s.slotIndex === target.slotIndex)?.member?.displayName ?? "";
  const { need, sameClass, others } = findSubCandidates(board, target.partyId, target.slotIndex);

  const row = (c: SubCandidate) => (
    <button
      key={`${c.member.id}-${c.kind}`}
      type="button"
      onClick={() => onPick(c)}
      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs transition hover:bg-zinc-800"
    >
      <Avatar member={c.member} />
      <ClassIcon job={c.playingAs ?? c.member.className} size={12} />
      <span className="min-w-0 flex-1 truncate text-zinc-100">
        {c.member.displayName}
        {c.kind === "alt" && <span className="ml-1 text-[10px] text-amber-300">(รอง)</span>}
      </span>
      <span className="shrink-0 text-right text-[10.5px] leading-tight text-zinc-500">
        <span className="tabular-nums">{fmtCp(c.member.cp)}</span>
        <br />
        {c.from ? <span className="text-amber-300/80">{c.from.label}</span> : "waiting"}
      </span>
    </button>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Find a substitute"
      style={{ left: pos?.left ?? target.rect.left, top: pos?.top ?? target.rect.bottom + 6, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-50 max-h-[70vh] w-[290px] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-2.5 shadow-2xl shadow-black/60"
    >
      <div className="px-1 text-[13px] font-semibold text-zinc-100">หาคนแทน {outName}</div>
      <div className="mb-1.5 px-1 text-[11px] text-zinc-500">
        {need ? (
          <>
            ต้องการ <ClassIcon job={need} size={11} /> {need} · เรียงตาม CP · คลิกเพื่อลงแทน
          </>
        ) : (
          "No class set — showing everyone waiting, by CP"
        )}
      </div>
      {need && (
        <>
          <div className="mx-1 mb-0.5 mt-2 text-[10px] uppercase tracking-wider text-zinc-600">อาชีพเดียวกัน</div>
          {sameClass.length ? sameClass.map(row) : <div className="px-1 py-1 text-[11px] text-zinc-500">ไม่มี {need} ว่าง</div>}
        </>
      )}
      {others.length > 0 && (
        <>
          <div className="mx-1 mb-0.5 mt-2 text-[10px] uppercase tracking-wider text-zinc-600">{need ? "คนว่างอาชีพอื่น" : "Waiting"}</div>
          {others.map(row)}
        </>
      )}
      <div className="mt-2 border-t border-zinc-800 px-1 pt-1.5 text-[10.5px] text-zinc-600">คนที่ลายังอยู่ในรายชื่อ ลา · ช่องเดิมของคนที่ย้ายมาจะว่าง</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SideCard({ title, count, children, className = "" }: { title: React.ReactNode; count?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 ${className}`}>
      <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-zinc-100">
        {title}
        {count != null && <span className="ml-auto text-[11px] font-medium text-zinc-500">{count}</span>}
      </h3>
      {children}
    </div>
  );
}

export function NeedsSubCard({ board, isAdmin, onFindSub }: { board: PartyBoardDetail; isAdmin: boolean; onFindSub: (partyId: string, slotIndex: number, el: HTMLElement) => void }) {
  const rows: { key: string; member: PartyBoardMemberRef; cls: string | null; where: string; partyId: string; slotIndex: number }[] = [];
  for (const g of board.groups)
    for (const p of g.parties)
      for (const s of p.slots)
        if (s.member && s.onLeave) rows.push({ key: `${p.id}:${s.slotIndex}`, member: s.member, cls: seatedClass(s), where: `${g.name} · ${p.label}`, partyId: p.id, slotIndex: s.slotIndex });
  return (
    <SideCard title="🔁 Needs a sub" count={rows.length}>
      {rows.length === 0 ? (
        <div className="text-[11px] text-emerald-400">ทุกปาร์ตี้พร้อม ✓</div>
      ) : (
        <div className="flex flex-col">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2 rounded-lg px-1 py-1 text-xs hover:bg-zinc-800/60">
              <Avatar member={r.member} />
              <ClassIcon job={r.cls} size={12} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-zinc-200">{r.member.displayName}</span>
                <span className="block truncate text-[10.5px] text-zinc-500">{r.where}</span>
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={(e) => onFindSub(r.partyId, r.slotIndex, e.currentTarget)}
                  className="shrink-0 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10.5px] font-bold text-white transition hover:bg-rose-500"
                >
                  หาแทน
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SideCard>
  );
}

export function PartyPowerCard({ group, recipe }: { group: PartyGroupView; recipe: PartyRecipeEntry[] }) {
  // Unknown CP counts at the group median here (same as Auto-balance), so a
  // missing stats entry doesn't make a party look weak.
  const fallback = groupMedianCp(group);
  const rows = group.parties
    .map((p) => ({ id: p.id, label: p.label, st: partyStats(p, recipe), est: partyCpEstimate(p, fallback) }))
    .filter((r) => r.st.present > 0);
  const avg = rows.length ? rows.reduce((a, r) => a + r.est, 0) / rows.length : 0;
  const maxDev = Math.max(1, ...rows.map((r) => Math.abs(r.est - avg)));
  return (
    <SideCard title="⚖ Party power" count={`avg ${fmtCp(avg)} · ${group.name}`}>
      {rows.length < 2 ? (
        <div className="text-[11px] text-zinc-500">Needs at least two parties with members.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((r) => {
            const d = r.est - avg;
            const w = (Math.abs(d) / maxDev) * 50;
            return (
              <div key={r.id} className="grid grid-cols-[56px_1fr_48px] items-center gap-1.5 text-[11px]" title={`${r.label}: ${fmtCp(r.est)}${r.st.cpUnknown ? ` (${r.st.cpUnknown} without PVP stats, counted at median)` : ""}${r.st.present < 5 ? ` · ${r.st.present}/5 present` : ""}`}>
                <span className="truncate text-zinc-400">{r.label.replace(/^Party /, "P")}</span>
                <span className="relative h-[7px] overflow-hidden rounded bg-zinc-800">
                  <i className={`absolute inset-y-0 rounded ${d < 0 ? "bg-rose-400" : "bg-emerald-400"}`} style={{ left: `${d < 0 ? 50 - w : 50}%`, width: `${w}%` }} />
                  <i className="absolute inset-y-0 left-1/2 w-px bg-zinc-600" />
                </span>
                <span className="text-right tabular-nums text-zinc-400">
                  {d >= 0 ? "+" : "−"}
                  {fmtCp(Math.abs(d))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </SideCard>
  );
}

export interface ChangeLogEntry {
  id: number;
  text: string;
  at: string; // "HH:MM"
}

export function ChangesCard({ log }: { log: ChangeLogEntry[] }) {
  return (
    <SideCard title="🕘 Changes" count={log.length ? "this session" : undefined}>
      {log.length === 0 ? (
        <div className="text-[11px] text-zinc-500">ยังไม่มีการเปลี่ยนแปลง</div>
      ) : (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto text-[11.5px] text-zinc-400">
          {log.map((l) => (
            <span key={l.id}>
              <span className="tabular-nums text-zinc-600">{l.at}</span> {l.text}
            </span>
          ))}
        </div>
      )}
    </SideCard>
  );
}

// ---------------------------------------------------------------------------

export function RecipeEditor({ initial, onSave, onClose }: { initial: PartyRecipeEntry[]; onSave: (r: PartyRecipeEntry[]) => Promise<void>; onClose: () => void }) {
  const { options } = useJobClasses();
  const [rows, setRows] = useState<PartyRecipeEntry[]>(initial.length ? initial : [{ className: options[0] ?? "", count: 1 }]);
  const [saving, setSaving] = useState(false);
  const total = rows.reduce((a, r) => a + (r.className ? r.count : 0), 0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
        <h2 className="text-sm font-semibold text-zinc-100">Party recipe</h2>
        <p className="mt-0.5 text-xs text-zinc-500">What every party on this board should have. Parties short of it get an amber “ขาด” badge — a hint only, nothing is blocked.</p>
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={r.className}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, className: e.target.value } : x)))}
                className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
              >
                {options.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="text-xs text-zinc-500">×</span>
              <input
                type="number"
                min={1}
                max={5}
                value={r.count}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, count: Math.max(1, Math.min(5, Number(e.target.value) || 1)) } : x)))}
                className="w-14 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
              />
              <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="px-1 text-xs text-zinc-500 hover:text-rose-400" title="Remove">
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows([...rows, { className: options.find((c) => !rows.some((r) => r.className === c)) ?? options[0] ?? "", count: 1 }])}
            className="self-start rounded-md border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-amber-500 hover:text-amber-300"
          >
            + Add class
          </button>
        </div>
        {total > 5 && <p className="mt-2 text-xs text-rose-400">A party only has 5 slots.</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || total > 5}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(rows.filter((r) => r.className));
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function UndoToast({ text, onUndo, lifted }: { text: string; onUndo?: () => void; lifted: boolean }) {
  return (
    <div className={`fixed inset-x-0 z-40 flex justify-center px-4 ${lifted ? "bottom-20" : "bottom-4"}`}>
      <div className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-[12.5px] text-zinc-100 shadow-xl shadow-black/50">
        <span>{text}</span>
        {onUndo && (
          <button type="button" onClick={onUndo} className="font-semibold text-amber-300 hover:text-amber-200">
            Undo
          </button>
        )}
      </div>
    </div>
  );
}

/** Party-card header for the working (non-screenshot) view: CP, composition, recipe badge, power bar. */
export function PartyCardHeader({
  party,
  recipe,
  groupAvg,
  isAdmin,
  onDelete,
}: {
  party: PartyGroupView["parties"][number];
  recipe: PartyRecipeEntry[];
  groupAvg: number;
  isAdmin: boolean;
  onDelete: () => void;
}) {
  const st = partyStats(party, recipe);
  const slots = fullSlots(party);
  const low = st.present > 0 && groupAvg > 0 && st.cp < groupAvg * 0.93;
  return (
    <div className="rounded-t-lg border-b border-zinc-800 bg-sky-500/[0.06] px-2.5 pb-1.5 pt-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
        <span className="truncate">{party.label}</span>
        <span className="ml-auto shrink-0 text-[11px] font-semibold tabular-nums text-amber-200" title={st.cpUnknown ? `${st.cpUnknown} member(s) without PVP stats not counted` : "Total CP of members present"}>
          {st.present ? fmtCp(st.cp) : ""}
          {st.cpUnknown ? <span className="text-zinc-500">*</span> : null}
        </span>
        <span className="shrink-0 font-normal text-sky-400/70">{st.present}/5</span>
        {isAdmin && (
          <button type="button" onClick={onDelete} className="shrink-0 text-sky-400/60 hover:text-rose-400" title={`Delete ${party.label}`}>
            ✕
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-0.5">
        {slots.map((s) =>
          s.member && !s.onLeave ? (
            <span key={s.slotIndex} title={seatedClass(s) ?? "no class"} className="w-4 text-center">
              {seatedClass(s) ? <ClassIcon job={seatedClass(s)} size={12} /> : <span className="text-[10px] text-zinc-500">?</span>}
            </span>
          ) : (
            <span key={s.slotIndex} className="w-4 text-center text-[10px] text-zinc-700">
              ○
            </span>
          )
        )}
        <span className="ml-auto">
          {st.missing.length ? (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10.5px] text-amber-300" title={`Missing: ${st.missing.map((m) => `${m.className}×${m.short}`).join(", ")}`}>
              ขาด{" "}
              {st.missing.map((m) => (
                <ClassIcon key={m.className} job={m.className} size={10} />
              ))}
            </span>
          ) : st.leaveSeated ? (
            <span className="rounded-full bg-rose-500/15 px-1.5 py-px text-[10.5px] text-rose-300">{st.leaveSeated} ลา</span>
          ) : st.present ? (
            <span className="text-[10.5px] text-emerald-400">✓</span>
          ) : null}
        </span>
      </div>
      {groupAvg > 0 && st.present > 0 && (
        <div className="mt-1.5 h-[3px] overflow-hidden rounded bg-zinc-800" title={`vs group average ${fmtCp(groupAvg)}`}>
          <i className={`block h-full ${low ? "bg-rose-400" : "bg-amber-400"}`} style={{ width: `${Math.min(100, (st.cp / (groupAvg * 1.15)) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
