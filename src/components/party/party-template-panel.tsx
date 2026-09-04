"use client";

import { useState } from "react";
import {
  applyPartyTemplate,
  deletePartyTemplate,
  listPartyTemplates,
  saveBoardAsTemplate,
  type PartyTemplateListItem,
} from "@/app/actions/party-templates";

interface PartyTemplatePanelProps {
  boardId: string;
  boardName: string;
  /** Structural change (board's groups/parties/slots got rebuilt) — the
   * parent re-syncs local optimistic state from the server the same way it
   * already does after create/rename/delete group/party. */
  onApplied: () => void;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });
}

/**
 * Save the current board's party layout (who's in which party) as a
 * reusable template, or load one back in — for running the same
 * composition again on a fresh week's board instead of re-dragging
 * everyone from scratch every time. See saveBoardAsTemplate/
 * applyPartyTemplate in app/actions/party-templates.ts for what is and
 * isn't captured (the layout, not the busy list or unassigned pool).
 */
export function PartyTemplatePanel({ boardId, boardName, onApplied }: PartyTemplatePanelProps) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<PartyTemplateListItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function openPanel() {
    setOpen(true);
    setTemplates(null);
    setTemplates(await listPartyTemplates());
  }

  async function handleSave() {
    const name = window.prompt(`Save "${boardName}"'s layout as a template named:`);
    if (!name) return;
    const result = await saveBoardAsTemplate(boardId, name);
    if (!result.ok) alert(result.error ?? "Failed to save. Please try again.");
  }

  async function handleApply(t: PartyTemplateListItem) {
    if (
      !confirm(
        `Apply template "${t.name}" to board "${boardName}"?\n\nThis board's current party layout will be completely replaced (the Busy/Leave list is unaffected for anyone the template does not place).`
      )
    )
      return;
    setBusyId(t.id);
    const result = await applyPartyTemplate(boardId, t.id);
    setBusyId(null);
    if (result.ok) {
      setOpen(false);
      onApplied();
    } else {
      alert(result.error ?? "Failed to load template. Please try again.");
    }
  }

  async function handleDelete(t: PartyTemplateListItem) {
    if (!confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    setBusyId(t.id);
    const result = await deletePartyTemplate(t.id);
    setBusyId(null);
    if (result.ok) setTemplates((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleSave}
        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
      >
        Save as Template
      </button>
      <button
        type="button"
        onClick={openPanel}
        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
      >
        Load Template
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-zinc-100">Select Template</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-1.5 py-0.5 text-zinc-500 transition hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            {templates === null ? (
              <p className="py-4 text-center text-sm text-zinc-500">Loading...</p>
            ) : templates.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-500">
                No templates saved yet — click &quot;Save as Template&quot; from a layout you have already set up to
                start collecting them.
              </p>
            ) : (
              <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">{t.name}</p>
                      <p className="text-xs text-zinc-500">
                        {t.groupCount} groups · {t.partyCount} parties · {t.filledSlotCount} people · {fmtDate(t.createdAt)}
                        {t.createdByUsername ? ` · ${t.createdByUsername}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => handleApply(t)}
                        className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => handleDelete(t)}
                        className="rounded-lg border border-rose-900/60 px-2 py-1 text-xs text-rose-400 transition hover:bg-rose-950/40 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
