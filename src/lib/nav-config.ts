// The app's page list in ONE place — the sidebar, the phone bottom bar and
// "More" sheet, the top bar's breadcrumb and the Ctrl+K palette all read
// from here, so a page added once shows up everywhere.

export type NavBadgeKey = "party" | "members" | "activity" | "leave" | "checkin";

export interface NavItem {
  href: string;
  label: string;
  /** AppIcon name. */
  icon: string;
  group: "main" | "events" | "logs" | "system";
  adminOnly?: boolean;
  badge?: NavBadgeKey;
  /** Shown in the phone bottom bar (the rest live under "More"). */
  tab?: string;
}

export const NAV_GROUP_LABELS: Record<NavItem["group"], string | null> = {
  main: null,
  events: "Events",
  logs: "Logs & Stats",
  system: "System",
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: "home", group: "main", tab: "Home" },
  { href: "/members", label: "Members", icon: "users", group: "main", badge: "members", tab: "Members" },
  { href: "/party", label: "Party", icon: "party", group: "events", badge: "party", tab: "Party" },
  { href: "/random", label: "Random Picker", icon: "random", group: "events" },
  { href: "/loot-queue", label: "Loot Queue", icon: "loot", group: "events", tab: "Loot" },
  { href: "/calendar", label: "Calendar", icon: "calendar", group: "logs" },
  { href: "/activity", label: "Activity Log", icon: "activity", group: "logs", badge: "activity" },
  { href: "/attendance", label: "Leave Stats", icon: "clock", group: "logs", badge: "leave" },
  { href: "/checkin", label: "Check-in [Voice]", icon: "mic", group: "logs", badge: "checkin" },
  { href: "/pvp-stats", label: "PVP Stats", icon: "swords", group: "logs" },
  { href: "/classes", label: "Manage Classes", icon: "sliders", group: "system", adminOnly: true },
];

/** "/members" matches "/members" and "/members/123", but "/" only matches itself. */
export function isNavActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function navItemsFor(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);
}
