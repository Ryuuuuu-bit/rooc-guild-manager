"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface JobClassClient {
  id: string;
  name: string;
  emoji: string;
  colorClass: string;
}

interface JobClassesContextValue {
  classes: JobClassClient[];
  /** Class names in admin-configured display order — used for <select> options everywhere. */
  options: string[];
  emojiOf: (name: string | null | undefined) => string;
  colorClassOf: (name: string | null | undefined) => string;
}

const JobClassesContext = createContext<JobClassesContextValue | null>(null);

/**
 * Makes the admin-managed job class list available to every Client Component
 * in the tree without threading it through props at every level — fetched
 * once, server-side, in the (app) layout and handed down here. Client
 * Components that need it (badges, dropdowns, party board) call
 * `useJobClasses()` instead of importing a static constant.
 */
export function JobClassesProvider({ classes, children }: { classes: JobClassClient[]; children: ReactNode }) {
  const value = useMemo<JobClassesContextValue>(() => {
    const byName = new Map(classes.map((c) => [c.name, c]));
    return {
      classes,
      options: classes.map((c) => c.name),
      emojiOf: (name) => (name ? (byName.get(name)?.emoji ?? "") : ""),
      colorClassOf: (name) => (name ? (byName.get(name)?.colorClass ?? "bg-zinc-700 text-zinc-300") : "bg-zinc-700 text-zinc-300"),
    };
  }, [classes]);

  return <JobClassesContext.Provider value={value}>{children}</JobClassesContext.Provider>;
}

export function useJobClasses(): JobClassesContextValue {
  const ctx = useContext(JobClassesContext);
  if (!ctx) throw new Error("useJobClasses must be used within a JobClassesProvider");
  return ctx;
}
