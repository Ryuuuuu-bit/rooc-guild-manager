import { getRecentActivity } from "@/lib/data";
import { requireUser } from "@/lib/authz";
import { eventLabels, memberDisplayName } from "@/lib/ui";
import { PageHeader, Segmented } from "@/components/ui/kit";
import { ActivityFeed, type FeedEvent } from "@/components/activity/activity-feed";

const DAY_OPTIONS = [
  { value: "1", label: "24 h" },
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

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireUser();
  const params = await searchParams;
  const daysParam = DAY_OPTIONS.some((o) => o.value === params.days) ? params.days! : "30";
  const days = daysParam === "all" ? undefined : Number(daysParam);
  // Old links may still carry ?q= / ?type= — honoured server-side (type is
  // validated against the enum first; Postgres rejects unknown enum values).
  const type = params.type && params.type in eventLabels ? params.type : undefined;

  const activity = await getRecentActivity(MAX_ROWS, days, { search: params.q, type });
  const events: FeedEvent[] = activity.map(({ event, member }) => ({
    id: event.id,
    type: event.type,
    label: eventLabels[event.type] ?? event.type,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
    member: { id: member.id, name: memberDisplayName(member), avatar: member.discordAvatar },
  }));
  const rangeLabel = daysParam === "all" ? "All time" : daysParam === "1" ? "Last 24 hours" : `Last ${daysParam} days`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Activity Log"
        description="Everything that happens to a member, newest first — joins and leaves, leave requests, class and name changes, and admin actions. Logged automatically."
        actions={<Segmented value={daysParam} items={DAY_OPTIONS.map((o) => ({ key: o.value, label: o.label, href: `/activity?days=${o.value}` }))} />}
      />
      <ActivityFeed events={events} isAdmin={session.user.isAdmin} now={new Date().getTime()} rangeLabel={rangeLabel} capped={activity.length === MAX_ROWS} />
    </div>
  );
}
