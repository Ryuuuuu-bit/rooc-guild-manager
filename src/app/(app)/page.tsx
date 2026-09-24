import { requireUser } from "@/lib/authz";
import { getRecentActivity } from "@/lib/data";
import { getOverview } from "@/lib/overview-data";
import { memberDisplayName } from "@/lib/ui";
import { OverviewDashboard, type FeedItem } from "@/components/overview-dashboard";

export default async function DashboardPage() {
  const session = await requireUser();
  const isAdmin = session.user.isAdmin;
  const [overview, activity] = await Promise.all([getOverview({ isAdmin }), getRecentActivity(15)]);

  const feed: FeedItem[] = activity.map(({ event, member }) => ({
    id: event.id,
    type: event.type,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
    member: { id: member.id, name: memberDisplayName(member), avatar: member.discordAvatar },
  }));

  return <OverviewDashboard overview={overview} isAdmin={isAdmin} now={new Date().getTime()} feed={feed} />;
}
