// Plain data only — deliberately no DB/discord.js/Next.js imports, so both
// the bot (via a relative import, see bot/voice-attendance.ts) and the web
// app (via the @/ alias, see src/lib/checkin-data.ts and /checkin) can pull
// from this ONE list instead of keeping two copies of the channel IDs in
// sync by hand.
//
// To add another event: append an entry here, redeploy BOTH services (bot
// needs the new channelIds to actually log anything for it; web needs the
// new schedule to know when its window is). Grab a channel ID from its
// Discord URL: .../channels/<guildId>/<channelId>.
export interface CheckinEventConfig {
  key: string;
  label: string;
  /** JS getUTCDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat. */
  weekdays: number[];
  startTime: string; // "HH:MM:SS", Thailand local time
  endTime: string;
  /** Being in ANY of these channels counts as present for this event — e.g. two separate team rooms for the same event. */
  channelIds: string[];
}

export const CHECKIN_EVENTS: CheckinEventConfig[] = [
  {
    key: "gl",
    label: "Tyr Cup",
    weekdays: [2, 4], // Tue, Thu
    startTime: "19:55:00",
    endTime: "20:20:00",
    channelIds: ["1488971259113902090", "1488971308225269943"],
  },
  {
    key: "woe",
    label: "WOE (Emperium Overrun)",
    weekdays: [0], // Sun
    startTime: "19:55:00",
    endTime: "20:40:00",
    channelIds: ["1490330449275260988"],
  },
];

export function getCheckinEvent(key: string): CheckinEventConfig | undefined {
  return CHECKIN_EVENTS.find((e) => e.key === key);
}

/** Every channel ID watched by any check-in event — what the bot subscribes to. */
export function allWatchedChannelIds(): string[] {
  return CHECKIN_EVENTS.flatMap((e) => e.channelIds);
}
