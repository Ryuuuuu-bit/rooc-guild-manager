"use client";

import { useEffect, useRef, useState } from "react";
import { memberDisplayName } from "@/lib/ui";
import { AltClassIcons, ClassBadge, BenchedBadge } from "@/components/badges";
import { MemberAvatar } from "@/components/member-avatar";
import { AppIcon } from "@/components/shell/app-icon";
import { Card, CardHeader, Chip } from "@/components/ui/kit";
import { useJobClasses } from "@/components/job-classes-provider";
import { uiConfirm } from "@/components/feedback";
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

/**
 * Lucky draw over the active roster. The pool can be narrowed (exclude
 * benched, only people in voice right now, only some classes); "No repeats"
 * takes each winner out of the pool until Reset. The final pick is a plain
 * uniform random choice — the spin is only the reveal.
 */
export function RandomPicker({ members, onlineIds }: { members: PickableMember[]; onlineIds: string[] }) {
  const { options: classOrder } = useJobClasses();
  const [excludeBenched, setExcludeBenched] = useState(true);
  const [noRepeat, setNoRepeat] = useState(true);
  const [voiceOnly, setVoiceOnly] = useState(false);
  const [classes, setClasses] = useState<Set<string>>(new Set());
  const [drawnIds, setDrawnIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<PickableMember | null>(null);
  const [drawKey, setDrawKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [muted, setMutedState] = useState(() => getSoundMuted());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const online = new Set(onlineIds);

  // Stop a running spin if the page is left mid-animation.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const pool = members.filter((m) => (!excludeBenched || !m.benched) && (!voiceOnly || online.has(m.id)) && (!classes.size || (m.characterClass != null && classes.has(m.characterClass))));
  const availablePool = noRepeat ? pool.filter((m) => !drawnIds.includes(m.id)) : pool;
  const exhausted = noRepeat && pool.length > 0 && availablePool.length === 0;
  const presentClasses = [...new Set(members.map((m) => m.characterClass).filter((c): c is string => Boolean(c)))].sort(
    (a, b) => (classOrder.indexOf(a) + 1 || 999) - (classOrder.indexOf(b) + 1 || 999)
  );

  function handleDraw() {
    if (spinning || availablePool.length === 0) return;
    setSpinning(true);
    let ticks = 0;
    const totalTicks = SPIN_MIN_TICKS + Math.floor(Math.random() * SPIN_MAX_EXTRA_TICKS);
    const spinPool = pool.length ? pool : availablePool;
    intervalRef.current = setInterval(() => {
      setCurrent(spinPool[Math.floor(Math.random() * spinPool.length)]);
      playTick();
      ticks++;
      if (ticks >= totalTicks) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        const finalPick = availablePool[Math.floor(Math.random() * availablePool.length)];
        setCurrent(finalPick);
        setDrawKey((k) => k + 1);
        if (noRepeat) setDrawnIds((prev) => [...prev, finalPick.id]);
        setSpinning(false);
        playRevealChime();
      }
    }, SPIN_INTERVAL_MS);
  }

  async function handleReset() {
    if (drawnIds.length && !(await uiConfirm({ title: "Reset the draw history?", message: `Everyone picked so far (${drawnIds.length}) goes back into the pool.`, confirmLabel: "Reset" }))) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSpinning(false);
    setDrawnIds([]);
    setCurrent(null);
  }

  function toggleMuted() {
    const next = !muted;
    setSoundMuted(next);
    setMutedState(next);
  }

  const drawnMembers = drawnIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is PickableMember => Boolean(m))
    .reverse();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-stretch">
      <Card className="flex flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl bg-[radial-gradient(60%_80%_at_50%_0%,rgba(217,119,6,0.16),transparent_70%)] px-4 py-10 text-center">
          {current ? (
            <div key={drawKey} className="flex animate-[divine-pop_0.35s_ease-out] flex-col items-center gap-3">
              <span className={`relative inline-block h-28 w-28 overflow-hidden rounded-full ring-4 ${spinning ? "ring-zinc-700" : "ring-amber-500/60 shadow-[0_0_40px_rgba(245,158,11,0.25)]"}`}>
                <MemberAvatar src={current.discordAvatar} alt="" fill sizes="112px" className="object-cover" />
              </span>
              <div>
                <p className="text-2xl font-bold text-zinc-50">{memberDisplayName(current)}</p>
                {/* Reserved line so the card doesn't jump while names flicker past. */}
                <p className="text-sm text-zinc-500">{!spinning && current.inGameName ? `In-game: ${current.inGameName}` : " "}</p>
              </div>
              <div className={`flex min-h-6 items-center gap-2 ${spinning ? "invisible" : ""}`}>
                <ClassBadge className={current.characterClass} />
                <AltClassIcons altClasses={current.altClasses} />
                {current.benched && <BenchedBadge />}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-28 w-28 items-center justify-center rounded-full text-amber-300 ring-2 ring-amber-500/40">
                <AppIcon name="random" size={46} />
              </span>
              <p className="text-xl font-bold text-zinc-100">Ready</p>
              <p className="text-sm text-zinc-500">{availablePool.length} in the pool</p>
            </div>
          )}

          {pool.length === 0 ? (
            <p className="text-sm text-zinc-500">No one matches the pool filters.</p>
          ) : exhausted ? (
            <p className="text-sm text-zinc-500">Everyone in the pool has been picked — Reset to start over.</p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDraw}
              disabled={spinning || availablePool.length === 0}
              className="rounded-xl bg-amber-600 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-amber-900/30 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {spinning ? "Randomizing…" : "Randomize!"}
            </button>
            <button
              type="button"
              onClick={toggleMuted}
              title={muted ? "Sound off" : "Sound on"}
              aria-label={muted ? "Unmute" : "Mute"}
              className="rounded-xl border border-zinc-700 p-3 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              <AppIcon name={muted ? "mute" : "volume"} size={18} />
            </button>
          </div>
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-3">
        <Card>
          <CardHeader right={<span className="text-xs text-zinc-500">{availablePool.length} / {pool.length} left</span>}>
            <h2 className="text-[13.5px] font-semibold text-zinc-100">Pool</h2>
          </CardHeader>
          <div className="flex flex-col gap-3 p-3.5">
            <div className="flex flex-wrap gap-1.5">
              <Chip on={excludeBenched} onClick={() => setExcludeBenched((v) => !v)}>
                Exclude benched
              </Chip>
              <Chip
                on={noRepeat}
                onClick={() => {
                  setNoRepeat((v) => !v);
                  if (noRepeat) setDrawnIds([]);
                }}
              >
                No repeats
              </Chip>
              <Chip on={voiceOnly} onClick={() => setVoiceOnly((v) => !v)} count={onlineIds.length} title="Only members in a voice channel right now">
                <AppIcon name="mic" size={13} /> In voice only
              </Chip>
            </div>
            {presentClasses.length > 0 && (
              <>
                <p className="text-[11px] text-zinc-500">Classes (none selected = all)</p>
                <div className="flex flex-wrap gap-1.5">
                  {presentClasses.map((c) => (
                    <Chip
                      key={c}
                      on={classes.has(c)}
                      onClick={() =>
                        setClasses((prev) => {
                          const n = new Set(prev);
                          if (n.has(c)) n.delete(c);
                          else n.add(c);
                          return n;
                        })
                      }
                    >
                      {c}
                    </Chip>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="flex flex-1 flex-col">
          <CardHeader
            right={
              drawnIds.length > 0 ? (
                <button type="button" onClick={handleReset} className="rounded-md px-2 py-0.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100">
                  Reset
                </button>
              ) : null
            }
          >
            <h2 className="text-[13.5px] font-semibold text-zinc-100">Picked</h2>
            <span className="text-xs text-zinc-500">{drawnMembers.length}</span>
          </CardHeader>
          {drawnMembers.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-zinc-600">{noRepeat ? "Nobody picked yet" : "History is kept only with “No repeats” on"}</p>
          ) : (
            <ul className="max-h-[360px] flex-1 overflow-y-auto">
              {drawnMembers.map((m, i) => (
                <li key={m.id} className="flex items-center gap-2.5 border-t border-zinc-800/70 px-3.5 py-1.5 first:border-t-0">
                  <span className="w-5 text-right text-[11px] tabular-nums text-zinc-600">{drawnMembers.length - i}</span>
                  <span className="relative inline-block h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-700">
                    <MemberAvatar src={m.discordAvatar} alt="" fill sizes="24px" className="object-cover" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">{memberDisplayName(m)}</span>
                  <ClassBadge className={m.characterClass} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
