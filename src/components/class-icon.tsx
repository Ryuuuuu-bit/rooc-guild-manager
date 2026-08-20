import {
  Cross,
  EyeOff,
  Flame,
  FlaskConical,
  Music2,
  PawPrint,
  ShieldCheck,
  Snowflake,
  Swords,
  Wand2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ClassOption } from "@/lib/classes";

// Generic stand-in icons per class archetype (not game assets — avoids any
// copyright issue with Ragnarok Origin's actual job icons) so each class
// reads as a consistent little pictogram wherever it shows up in the UI.
const classIconMap: Record<ClassOption, LucideIcon> = {
  Bio: FlaskConical,
  "B/D": Music2,
  DoramSTR: PawPrint,
  DoramINT: Wand2,
  Knight: Swords,
  Priest: Cross,
  WizMeteo: Flame,
  WizCC: Snowflake,
  Paladin: ShieldCheck,
  Rouge: Zap,
  Assassin: EyeOff,
};

interface ClassIconProps {
  job: string | null | undefined;
  size?: number;
  className?: string;
}

export function ClassIcon({ job, size = 12, className }: ClassIconProps) {
  const Icon = job ? classIconMap[job as ClassOption] : undefined;
  if (!Icon) return null;
  return <Icon size={size} className={className} strokeWidth={2.25} />;
}
