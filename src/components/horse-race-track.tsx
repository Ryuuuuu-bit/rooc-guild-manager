"use client";

import { useEffect, useRef, useState } from "react";
import { memberDisplayName } from "@/lib/ui";
import { MemberAvatar } from "@/components/member-avatar";
import { playStartGun, startGallopLoop, playCheer, playFanfare } from "@/lib/race-sounds";
import type { PickableMember } from "@/components/random-picker";

export interface RaceRacer {
  member: PickableMember;
  isWinner: boolean;
  finishTime: number;
  wobbleFreq: number;
  wobblePhase: number;
  wobbleAmp: number;
}

/**
 * Builds the racer list for one race, including a shuffled lane order and
 * per-racer timing. Deliberately a plain function called from an event
 * handler (RandomPicker's "เริ่มแข่ง!" onClick), NOT from inside the track
 * component's render — Math.random() there would make the component
 * impure and re-shuffle on every re-render. The winner is picked by the
 * caller beforehand via the exact same uniform random draw as classic
 * mode; this function only decides how the race *looks*, never who wins —
 * the winner is simply given the shortest finishTime so it's guaranteed
 * to cross the line first.
 */
export function buildRacers(winner: PickableMember, others: PickableMember[]): RaceRacer[] {
  const all = [winner, ...others];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.map((member) => ({
    member,
    isWinner: member.id === winner.id,
    finishTime: member.id === winner.id ? 4.0 + Math.random() * 0.3 : 4.6 + Math.random() * 1.3,
    wobbleFreq: 2 + Math.random() * 2,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleAmp: 1.2 + Math.random() * 1.2,
  }));
}

interface HorseRaceTrackProps {
  /** Pre-built by buildRacers() — this component only animates to the
   * given outcome, it never influences who wins. */
  racers: RaceRacer[];
  /** Called once the finish celebration has played out, so the parent can
   * commit the winner and swap this track back out for the reveal card. */
  onFinish: () => void;
}

const LANE_COLORS = ["#f59e0b", "#38bdf8", "#f472b6", "#a78bfa", "#34d399", "#fb7185", "#facc15", "#60a5fa"];

export function HorseRaceTrack({ racers, onFinish }: HorseRaceTrackProps) {
  const [phase, setPhase] = useState<"countdown" | "racing" | "finished">("countdown");
  const [count, setCount] = useState(3);
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dustRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stopGallopRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const winner = racers.find((r) => r.isWinner)?.member ?? racers[0]?.member;

  function spawnDust(laneIndex: number, pct: number) {
    const container = dustRefs.current[laneIndex];
    if (!container) return;
    const el = document.createElement("div");
    el.className = "race-dust";
    el.style.left = `calc(${pct}% - 6px)`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 500);
  }

  function finishRace() {
    stopGallopRef.current?.();
    setPhase("finished");
    playCheer();
    playFanfare();
    setTimeout(onFinish, 1900);
  }

  // Countdown: 3 -> 2 -> 1 -> gunshot -> racing. Runs once — this component
  // is mounted fresh for every race (the parent unmounts it after
  // onFinish), so there's no "restart mid-race" case to handle.
  useEffect(() => {
    const t1 = setTimeout(() => setCount(2), 650);
    const t2 = setTimeout(() => setCount(1), 1300);
    const t3 = setTimeout(() => {
      playStartGun();
      setPhase("racing");
    }, 1950);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // Racing: rAF-driven position updates, written straight to the DOM via
  // refs rather than React state — smoother at 60fps and avoids re-running
  // this whole component every frame.
  useEffect(() => {
    if (phase !== "racing") return;
    stopGallopRef.current = startGallopLoop();
    startedAtRef.current = performance.now();

    function frame(now: number) {
      const t = (now - startedAtRef.current) / 1000;
      let allDone = true;
      racers.forEach((r, i) => {
        const x = Math.min(t / r.finishTime, 1);
        const eased = 1 - Math.pow(1 - x, 2);
        const wobble = x < 1 ? Math.sin(t * r.wobbleFreq + r.wobblePhase) * r.wobbleAmp * (1 - x) : 0;
        const pct = Math.max(0, Math.min(93, eased * 92 + wobble));
        const el = laneRefs.current[i];
        if (el) el.style.left = `${pct}%`;
        if (x < 1) {
          allDone = false;
          if (Math.random() < 0.35) spawnDust(i, pct);
        }
      });
      if (!allDone) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        finishRace();
      }
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopGallopRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-amber-900/40 bg-gradient-to-b from-emerald-950 via-emerald-950 to-emerald-900 shadow-inner">
      {phase === "countdown" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45">
          <span
            key={count}
            className="animate-[divine-pop_0.35s_ease-out] text-7xl font-black text-amber-300 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]"
          >
            {count > 0 ? count : "ไป!"}
          </span>
        </div>
      )}
      {phase === "finished" && winner && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/55 text-center">
          <span className="animate-[divine-pop_0.35s_ease-out] text-5xl">🏆</span>
          <span className="animate-[divine-pop_0.35s_ease-out] text-xl font-bold text-amber-200">
            {memberDisplayName(winner)} ชนะ!
          </span>
        </div>
      )}

      {/* Racer legend — stays put (doesn't move with the horses) so it's
          readable throughout the race, not just at the very start. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-black/30 bg-black/25 px-3 py-2 text-[11px] text-zinc-200">
        {racers.map((r, i) => (
          <span key={r.member.id} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LANE_COLORS[i % LANE_COLORS.length] }} />
            {memberDisplayName(r.member)}
          </span>
        ))}
      </div>

      <div className="relative flex flex-col gap-1.5 p-3">
        {racers.map((r, i) => (
          <div
            key={r.member.id}
            className="relative h-11 overflow-visible rounded-md bg-amber-950/40"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(146,100,52,0.35) 0px, rgba(146,100,52,0.35) 2px, transparent 2px, transparent 22px)",
            }}
          >
            <span
              className="absolute left-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-bold text-zinc-900"
              style={{ background: LANE_COLORS[i % LANE_COLORS.length] }}
            >
              {i + 1}
            </span>
            <div ref={(el) => { dustRefs.current[i] = el; }} className="pointer-events-none absolute inset-0" />
            <div
              ref={(el) => { laneRefs.current[i] = el; }}
              className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center"
              style={{ left: "0%" }}
            >
              <span
                className="z-10 -mb-1.5 inline-block h-5 w-5 shrink-0 overflow-hidden rounded-full"
                style={{ boxShadow: `0 0 0 2px ${LANE_COLORS[i % LANE_COLORS.length]}` }}
              >
                <MemberAvatar
                  src={r.member.discordAvatar}
                  alt={r.member.discordUsername}
                  width={20}
                  height={20}
                  className="h-5 w-5 rounded-full object-cover"
                />
              </span>
              <span
                className="text-2xl leading-none"
                style={{
                  display: "inline-block",
                  transform: "scaleX(-1)",
                  animation: "gallop-bob 0.4s ease-in-out infinite",
                }}
              >
                🐎
              </span>
            </div>
          </div>
        ))}
        <div
          className="pointer-events-none absolute inset-y-0 right-3 z-10 w-1.5 rounded-full"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, #000 0 6px, #fff 6px 12px)" }}
        />
      </div>
    </div>
  );
}
