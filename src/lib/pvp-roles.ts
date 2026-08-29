// Split out from pvp-stats.ts (which imports "@/db" and pulls in the
// `postgres` driver — Node-only, breaks the client bundle with "Can't
// resolve 'net'/'tls'/'perf_hooks'") so pvp-stat-form.tsx, a Client
// Component, can use the role list without dragging the DB driver into the
// browser bundle. Same split as job-class-colors.ts / job-classes.ts.
export const PVP_ROLES = ["MainDMG", "SecondDMG", "MainSupport", "SecondSup", "Overall"] as const;
export type PvpRole = (typeof PVP_ROLES)[number];
