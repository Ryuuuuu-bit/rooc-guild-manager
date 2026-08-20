// Class -> emoji mapping used to live here as a static constant; classes are
// now admin-managed in the `job_classes` DB table (see src/lib/job-classes.ts
// for the web app, bot/job-classes.ts for the bot worker — kept separate
// because the bot runs via `tsx` and can't resolve the "@/" path alias).
// This file now only holds the one emoji that ISN'T a per-class thing.

/** Reaction emoji members use to mark themselves "ลา" (opting out of a board's roster this round). */
export const ATTENDANCE_EMOJI = "🙋";
