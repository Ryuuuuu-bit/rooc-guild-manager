"use client";

import { useState, useTransition } from "react";
import { setCheckinNote } from "@/app/actions/checkin";

/**
 * One member's note cell on the /checkin report table — e.g. a member DMs
 * an admin afterward explaining why they weren't online ("got sick suddenly,
 * couldn't report it in time"), and the admin jots it here so it's visible
 * right on their row instead of living only in a DM someone has to
 * remember. Read-only text for non-admins; click-to-edit for admins.
 */
export function CheckinNoteCell({
  eventKey,
  date,
  memberId,
  note,
  isAdmin,
}: {
  eventKey: string;
  date: string;
  memberId: string;
  note: string | null;
  isAdmin: boolean;
}) {
  const [saved, setSaved] = useState(note);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [pending, startTransition] = useTransition();

  if (!isAdmin) {
    return <span className="text-xs text-zinc-400">{saved || "—"}</span>;
  }

  function save() {
    const next = draft.trim();
    setEditing(false);
    if (next === (saved ?? "")) return;
    setSaved(next || null);
    startTransition(async () => {
      const res = await setCheckinNote(eventKey, date, memberId, next);
      if (!res.ok) {
        alert(res.error ?? "Failed to save note. Please try again.");
        setSaved(note); // revert optimistic update
      }
    });
  }

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(saved ?? "");
            setEditing(false);
          }
        }}
        placeholder="e.g. reported sick leave afterward..."
        className="w-full min-w-[140px] rounded border border-amber-500 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(saved ?? "");
        setEditing(true);
      }}
      disabled={pending}
      title="Edit note"
      className={`w-full max-w-[220px] truncate rounded px-1.5 py-1 text-left text-xs transition hover:bg-zinc-800 disabled:opacity-50 ${
        saved ? "text-zinc-300" : "text-zinc-600 italic"
      }`}
    >
      {saved || "+ Add note"}
    </button>
  );
}
