// Client-safe (no "@/db" import) — see the Client Component gotcha noted on
// pvpStatEntries in schema.ts. Single source of truth for the admin
// review states on a PVP stat submission.
export const REVIEW_STATUSES = ["PASS", "FAIL"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const reviewStatusLabels: Record<ReviewStatus, string> = {
  PASS: "Pass",
  FAIL: "Fail",
};

export const reviewStatusColors: Record<ReviewStatus, string> = {
  PASS: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30",
  FAIL: "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30",
};

export function isReviewStatus(value: string | null | undefined): value is ReviewStatus {
  return value === "PASS" || value === "FAIL";
}
