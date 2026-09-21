// Plain data only (no DB/Next.js imports) so both the bot (relative import)
// and the web app (@/ alias) share ONE definition of the guild's leave rule.
//
// Guild rule as of Aug 2026: roughly 2 leaves per board per month. NOT
// enforced anywhere — nothing blocks a third leave. It only decides (a) the
// "ครั้งที่ N/2 เดือนนี้" hint in the member's own DM (bot/reactions.ts),
// (b) the "เกินโควต้า" flag in the admin notification
// (bot/attendance-confirm.ts), and (c) the over-quota panel on /attendance
// (src/lib/data.ts's getOverQuotaThisMonth). Bump it here if the rule changes.
export const MONTHLY_LEAVE_LIMIT = 2;
