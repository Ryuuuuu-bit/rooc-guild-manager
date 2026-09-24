"use client";

import { useEffect, useRef, useState } from "react";
import { memberDisplayName } from "@/lib/ui";
import { AltClassIcons, ClassBadge, BenchedBadge } from "@/components/badges";
import { MemberAvatar } from "@/components/member-avatar";
import { setMuted as setSoundMuted, isMuted as getSoundMuted, playTick, playRevealChime } from "@/lib/race-sounds";

export interface PickableMember {
  id: string;
  discordUsername: string;
  discordNickname: string | null;
  discordGlobalName: string | null;
  discordAvatar: string | null;
  inGameName: string | null;
  characterClass: string | null;
  altClasses: string[];
  benched: boolean;
}

const SPIN_INTERVAL_MS = 70;
const SPIN_MIN_TICKS = 18;
const SPIN_MAX_EXTRA_TICKS = 8;

export function RandomPicker({ members }: { members: PickableMember[] }) {
  const [excludeBenched, setExcludeBenched] = useState(true);
  const [noRepeat, setNoRepeat] = useState(true);
  const [drawnIds, setDrawnIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<PickableMember | null>(null);
  const [drawKey, setDrawKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [muted, setMutedState] = useState(() => getSoundMuted());

  // Stop a running spin if the component unmounts mid-animation (e.g. the
  // admin navigates away right after clicking).
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const pool = members.filter((m) => !excludeBenched || !m.benched);
  const availablePool = noRepeat ? pool.filter((m) => !drawnIds.includes(m.id)) : pool;
  const exhausted = noRepeat && pool.length > 0 && availablePool.length === 0;

  /** Records a winner and resets the busy flag — the one place that
   * mutates drawnIds/current, so "No repeats" and the history stay in sync. */
  function commitWinner(finalPick: PickableMember) {
    setCurrent(finalPick);
    setDrawKey((k) => k + 1);
    if (noRepeat) setDrawnIds((prev) => [...prev, finalPick.id]);
    setSpinning(false);
  }

  function handleDraw() {
    if (spinning || availablePool.length === 0 || pool.length === 0) return;
    setSpinning(true);
    let ticks = 0;
    const totalTicks = SPIN_MIN_TICKS + Math.floor(Math.random() * SPIN_MAX_EXTRA_TICKS);
    intervalRef.current = setInterval(() => {
      // Spin visually over the whole pool (livelier flicker) even though the
      // final landing only picks from availablePool.
      setCurrent(pool[Math.floor(Math.random() * pool.length)]);
      playTick();
      ticks++;
      if (ticks >= totalTicks) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        const finalPick = availablePool[Math.floor(Math.random() * availablePool.length)];
        commitWinner(finalPick);
        playRevealChime();
      }
    }, SPIN_INTERVAL_MS);
  }


  function toggleMuted() {
    const next = !muted;
    setSoundMuted(next);
    setMutedState(next);
  }

  function handleReset() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSpinning(false);
    setDrawnIds([]);
    setCurrent(null);
  }

  const drawnMembers = drawnIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is PickableMember => Boolean(m))
    .reverse();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm">
        <label className="flex items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            checked={noRepeat}
            onChange={(e) => {
              setNoRepeat(e.target.checked);
              if (!e.target.checked) setDrawnIds([]);
            }}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-amber-500"
          />
          No repeats
        </label>
        <label className="flex items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            checked={excludeBenched}
            onChange={(e) => setExcludeBenched(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-amber-500"
          />
          Exclude benched members
        </label>
        <span className="ml-auto text-xs text-zinc-500">
          {availablePool.length} / {pool.length} remaining
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={toggleMuted}
          title={muted ? "Unmute" : "Mute"}
          className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
        >
          {muted ? "🔇 Muted" : "🔊 Sound on"}
        </button>
      </div>

        <div className="flex flex-col items-center gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10">
          {current ? (
            <div key={drawKey} className="flex flex-col items-center gap-3 animate-[divine-pop_0.35s_ease-out]">
              <MemberAvatar
                src={current.discordAvatar}
                alt={current.discordUsername}
                width={112}
                height={112}
                className={`h-28 w-28 rounded-full ring-4 ${
                  spinning ? "ring-zinc-700" : "ring-amber-500/60"
                }`}
              />
              <div className="text-center">
                <p className="text-2xl font-semibold text-zinc-50">{memberDisplayName(current)}</p>
                {/* Always render this line (reserving its height) instead of
                    conditionally showing it only for members who have an
                    in-game name set — during the spin, current cycles rapidly
                    through the pool, and members with vs. without an in-game
                    name would otherwise make the card grow/shrink every ~70ms,
                    reading as the whole card "shaking". Content itself is
                    still only revealed once the spin settles. */}
                <p className="text-sm text-zinc-500">
                  {!spinning && current.inGameName ? `In-game: ${current.inGameName}` : " "}
                </p>
              </div>
              {!spinning && (
                <div className="flex items-center gap-2">
                  <ClassBadge className={current.characterClass} />
                  <AltClassIcons altClasses={current.altClasses} />
                  {current.benched && <BenchedBadge />}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-zinc-700 text-4xl text-zinc-600">
              ?
            </div>
          )}

          {pool.length === 0 ? (
            <p className="text-sm text-zinc-500">No members to pick from (try turning off &quot;Exclude benched members&quot;)</p>
          ) : exhausted ? (
            <p className="text-sm text-zinc-500">Everyone has been picked! Click &quot;Reset&quot; to start over</p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDraw}
              disabled={spinning || availablePool.length === 0}
              className="rounded-xl bg-amber-600 px-8 py-3 text-base font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {spinning ? "Randomizing..." : "Randomize!"}
            </button>
            {drawnIds.length > 0 && (
              <button
                type="button"
                onClick={handleReset}
                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-300 transition hover:bg-zinc-800"
              >
                Reset
              </button>
            )}
          </div>
        </div>

      {noRepeat && drawnMembers.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="mb-2 text-sm font-medium text-zinc-300">
            Pick history ({drawnMembers.length})
          </h2>
          <ul className="flex flex-wrap gap-2">
            {drawnMembers.map((m, i) => (
              <li
                key={m.id}
                className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 py-1 pl-1 pr-3 text-xs text-zinc-300"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-medium text-amber-300">
                  {drawnMembers.length - i}
                </span>
                <MemberAvatar
                  src={m.discordAvatar}
                  alt={m.discordUsername}
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] rounded-full"
                />
                {memberDisplayName(m)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
