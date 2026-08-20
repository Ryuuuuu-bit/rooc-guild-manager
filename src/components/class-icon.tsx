"use client";

import { useJobClasses } from "@/components/job-classes-provider";

interface ClassIconProps {
  job: string | null | undefined;
  size?: number;
  className?: string;
}

/** Renders a class's admin-configured emoji (see /classes) as its visual marker wherever a class is shown. */
export function ClassIcon({ job, size = 12, className }: ClassIconProps) {
  const { emojiOf } = useJobClasses();
  if (!job) return null;
  const emoji = emojiOf(job);
  if (!emoji) return null;
  return (
    <span style={{ fontSize: size, lineHeight: 1 }} className={className}>
      {emoji}
    </span>
  );
}
