import { eq } from "drizzle-orm";
import type { Guild, GuildMember } from "discord.js";
import { db } from "../src/db";
import { members, membershipEvents } from "../src/db/schema";

interface NormalizedMember {
  discordId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
  roles: string[];
  joinedAt: Date | null;
}

export function normalizeMember(member: GuildMember): NormalizedMember {
  return {
    discordId: member.id,
    username: member.user.username,
    globalName: member.user.globalName ?? null,
    avatarUrl: member.displayAvatarURL({ size: 128, extension: "png" }),
    roles: member.roles.cache.map((r) => r.id).filter((id) => id !== member.guild.id),
    joinedAt: member.joinedAt,
  };
}

async function logEvent(memberId: string, type: (typeof membershipEvents.$inferInsert)["type"], detail: string) {
  await db.insert(membershipEvents).values({
    memberId,
    type,
    detail,
    actor: "bot:sync",
  });
}

/** Upsert a single member on a live gateway event (join/update). Logs a JOIN event only for brand-new rows or reactivations. */
export async function upsertMemberFromGateway(normalized: NormalizedMember) {
  const existing = await db.query.members.findFirst({
    where: eq(members.discordId, normalized.discordId),
  });

  if (!existing) {
    const [inserted] = await db
      .insert(members)
      .values({
        discordId: normalized.discordId,
        discordUsername: normalized.username,
        discordGlobalName: normalized.globalName,
        discordAvatar: normalized.avatarUrl,
        discordRoles: normalized.roles,
        status: "ACTIVE",
        joinedDiscordAt: normalized.joinedAt ?? new Date(),
        lastSyncedAt: new Date(),
      })
      .returning();
    await logEvent(inserted.id, "JOIN", "เข้าร่วม Discord server");
    return;
  }

  const wasInactive = existing.status !== "ACTIVE";
  await db
    .update(members)
    .set({
      discordUsername: normalized.username,
      discordGlobalName: normalized.globalName,
      discordAvatar: normalized.avatarUrl,
      discordRoles: normalized.roles,
      status: "ACTIVE",
      leftDiscordAt: null,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(members.id, existing.id));

  if (wasInactive) {
    await logEvent(existing.id, "JOIN", "กลับเข้าร่วม Discord server อีกครั้ง");
  }
}

/** Mark a member LEFT on a live guildMemberRemove event. */
export async function markMemberLeftFromGateway(discordId: string) {
  const existing = await db.query.members.findFirst({
    where: eq(members.discordId, discordId),
  });
  if (!existing || existing.status !== "ACTIVE") return;

  await db
    .update(members)
    .set({ status: "LEFT", leftDiscordAt: new Date(), lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(members.id, existing.id));

  await logEvent(existing.id, "LEAVE", "ออกจาก Discord server");
}

/** Update cached role list on a guildMemberUpdate event, logging only real changes. */
export async function syncRolesFromGateway(normalized: NormalizedMember) {
  const existing = await db.query.members.findFirst({
    where: eq(members.discordId, normalized.discordId),
  });
  if (!existing) return;

  const before = new Set(existing.discordRoles);
  const after = new Set(normalized.roles);
  const changed =
    before.size !== after.size || [...before].some((r) => !after.has(r));

  await db
    .update(members)
    .set({
      discordUsername: normalized.username,
      discordGlobalName: normalized.globalName,
      discordAvatar: normalized.avatarUrl,
      discordRoles: normalized.roles,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(members.id, existing.id));

  if (changed) {
    await logEvent(existing.id, "ROLE_UPDATE", "role ใน Discord เปลี่ยนแปลง");
  }
}

/**
 * Full roster reconciliation: fetches every current guild member and diffs
 * it against the database. Run once on bot startup and periodically as a
 * safety net for events the bot may have missed while offline.
 */
export async function runFullSync(guild: Guild) {
  const discordMembers = await guild.members.fetch();
  const normalizedList = [...discordMembers.values()]
    .filter((m) => !m.user.bot)
    .map(normalizeMember);

  const dbMembers = await db.select().from(members);
  const dbByDiscordId = new Map(dbMembers.map((m) => [m.discordId, m]));
  const seenDiscordIds = new Set<string>();

  let joined = 0;
  let reactivated = 0;
  let left = 0;

  for (const normalized of normalizedList) {
    seenDiscordIds.add(normalized.discordId);
    const existing = dbByDiscordId.get(normalized.discordId);

    if (!existing) {
      const [inserted] = await db
        .insert(members)
        .values({
          discordId: normalized.discordId,
          discordUsername: normalized.username,
          discordGlobalName: normalized.globalName,
          discordAvatar: normalized.avatarUrl,
          discordRoles: normalized.roles,
          status: "ACTIVE",
          joinedDiscordAt: normalized.joinedAt ?? new Date(),
          lastSyncedAt: new Date(),
        })
        .returning();
      await logEvent(inserted.id, "JOIN", "พบจากการซิงค์ครั้งแรก");
      joined++;
      continue;
    }

    const wasInactive = existing.status !== "ACTIVE";
    await db
      .update(members)
      .set({
        discordUsername: normalized.username,
        discordGlobalName: normalized.globalName,
        discordAvatar: normalized.avatarUrl,
        discordRoles: normalized.roles,
        status: "ACTIVE",
        leftDiscordAt: null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(members.id, existing.id));

    if (wasInactive) {
      await logEvent(existing.id, "JOIN", "กลับเข้าร่วม Discord server (พบจากการซิงค์)");
      reactivated++;
    }
  }

  // Anyone marked ACTIVE in the DB but absent from the current member list
  // left (or was kicked/banned) while the bot was not running.
  for (const dbMember of dbMembers) {
    if (dbMember.status === "ACTIVE" && !seenDiscordIds.has(dbMember.discordId)) {
      await db
        .update(members)
        .set({ status: "LEFT", leftDiscordAt: new Date(), lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(members.id, dbMember.id));
      await logEvent(dbMember.id, "LEAVE", "ออกจาก Discord server (พบจากการซิงค์)");
      left++;
    }
  }

  return { total: normalizedList.length, joined, reactivated, left };
}
