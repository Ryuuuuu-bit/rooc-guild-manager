import Link from "next/link";
import { getRecentActivity } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { ActivityListItem } from "@/components/activity-list-item";
import { eventLabels } from "@/lib/ui";

const DAY_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All" },
];

// Capped even in "All" mode — this table only grows, so an unbounded
// feed on a guild active for a year+ would eventually get slow to load.
const MAX_ROWS = 500;

interface SearchParams {
  days?: string;
  q?: string;
  type?: string;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireUser();
  const params = await searchParams;
  const daysParam = DAY_OPTIONS.some((o) => o.value === params.days) ? params.days : "30";
  const days = daysParam === "all" ? undefined : Number(daysParam);
  // Validated against the known event types before it ever reaches the DB —
  // Postgres enum columns reject an unrecognized value outright (the query
  // would 500), so a bogus/stale ?type= in the URL is just treated as "all".
  const type = params.type && params.type in eventLabels ? params.type : undefined;

  const activity = await getRecentActivity(MAX_ROWS, days, { search: params.q, type });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Activity Log</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Automatically logged every time someone joins/leaves the guild, takes leave, changes class, changes their Discord name, or an admin edits their data
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {DAY_OPTIONS.map((opt) => {
            const qs = new URLSearchParams();
            qs.set("days", opt.value);
            if (params.q) qs.set("q", params.q);
            if (type) qs.set("type", type);
            return (
              <Link
                key={opt.value}
                href={`/activity?${qs.toString()}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  daysParam === opt.value
                    ? "bg-amber-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-2" method="get">
        {/* Preserve the day-range filter across a search submit. */}
        <input type="hidden" name="days" value={daysParam} />
        <input
          type="text"
          name="q"
          defaultValue={params.q}
          placeholder="Search member name..."
          className="w-56 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
        />
        <select
          name="type"
          defaultValue={type ?? ""}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
        >
          <option value="">All event types</option>
          {Object.entries(eventLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-500"
        >
          Search
        </button>
        {(params.q || type) && (
          <Link
            href={`/activity?days=${daysParam}`}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            Clear filters
          </Link>
        )}
      </form>

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <ul className="divide-y divide-zinc-800">
          {activity.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-zinc-500">
              {params.q || type ? "No activity matches the filters" : "No activity in this time range"}
            </li>
          )}
          {activity.map(({ event, member }) => (
            <ActivityListItem
              key={event.id}
              event={event}
              member={member}
              isAdmin={session.user.isAdmin}
            />
          ))}
        </ul>
        {activity.length === MAX_ROWS && (
          <p className="border-t border-zinc-800 px-5 py-3 text-center text-xs text-zinc-600">
            Showing only the {MAX_ROWS} most recent entries in the selected range — older entries may not be shown
          </p>
        )}
      </div>
    </div>
  );
}
