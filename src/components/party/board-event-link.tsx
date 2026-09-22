"use client";

import { useState } from "react";
import { setBoardCheckinEventKey } from "@/app/actions/bot-messages";
import { CHECKIN_EVENTS } from "@/lib/checkin-events";

interface BoardEventLinkProps {
  boardId: string;
  /** Current link (partyBoards.checkinEventKey) — see PartyBoardDetail. */
  checkinEventKey: string | null;
  onChanged: () => void;
}

/**
 * Links this board to a check-in event (GL / WOE). The link is what turns a
 * "ลา" on this board into a leave for a specific round (src/lib/leaves.ts
 * keys every leave by the linked event's occurrence date), and what lets
 * ห้องลา, /checkin and /calendar find "the GL board". Lives in the board's
 * summary bar since it replaced the old "Post Leave in Discord" dialog,
 * which was the only place it could be set.
 */
export function BoardEventLink({ boardId, checkinEventKey, onChanged }: BoardEventLinkProps) {
  const [saving, setSaving] = useState(false);

  async function handleChange(value: string) {
    setSaving(true);
    try {
      const res = await setBoardCheckinEventKey(boardId, value || null);
      if (!res.ok) {
        alert(res.error ?? "Failed to update the event link.");
        return;
      }
      onChanged();
    } catch (err) {
      console.error("Failed to update check-in event link", err);
      alert("Failed to update the event link. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-400" title="Which check-in event this board's leaves belong to">
      Event
      <select
        value={checkinEventKey ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">Not linked</option>
        {CHECKIN_EVENTS.map((e) => (
          <option key={e.key} value={e.key}>
            {e.label}
          </option>
        ))}
      </select>
    </label>
  );
}
