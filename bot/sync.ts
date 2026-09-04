import { and, eq, sql } from "drizzle-orm";
import type { Guild, GuildMember, Role } from "discord.js";
import { db } from "../src/db";
import { discordRoles, lootCategories, lootQueueEntries, members, membershipEvents, partyBusyEntries, partySlots } from "../src/db/schema";

/**
 * Removes a member from any party slot / busy entry they're currently
 * placed in, AND drops them from every loot-queue category — called
 * whenever someone stops being ACTIVE (left Discord, kicked/banned, or lost
 * the tracked role). Without the loot-queue part, a departed member's row
 * just sits there forever: `lootQueueEntries.memberId` cascades on delete,
 * but the `members` row itself is never deleted here (only its `status`
 * flips), so the cascade never fires and an admin had to remove them by
 * hand before running a round.
 */
async function clearPartyAssignments(memberId: string) {
  await db
    .update(partySlots)
    .set({ memberId: null, updatedAt: new Date() })
    .where(eq(partySlots.memberId, memberId));
  await db.delete(partyBusyEntries).where(eq(partyBusyEntries.memberId, memberId));
  await db.delete(lootQueueEntries).where(eq(lootQueueEntries.memberId, memberId));
}

/**
 * The other direction: adds a member to the BACK of every existing
 * loot-queue category — called whenever someone starts (or resumes) being
 * ACTIVE (a brand-new join, or a rejoin after having left), so a new
 * recruit doesn't have to be added to each category by hand and naturally
 * queues up behind everyone already there. Skips any category they're
 * already queued in (defensive — shouldn't normally happen right after a
 * fresh ACTIVE transition, but keeps this safe to call from more than one
 * code path without risking the unique (categoryId, memberId) constraint).
 * Deliberately does NOT touch categories created later — this only ever
 * runs at the moment of the join/rejoin itself.
 */
async function addToAllLootQueues(memberId: string) {
  const categories = await db.select({ id: lootCategories.id }).from(lootCategories);
  for (const { id: categoryId } of categories) {
    const existing = await db.query.lootQueueEntries.findFirst({
      where: and(eq(lootQueueEntries.categoryId, categoryId), eq(lootQueueEntries.memberId, memberId)),
    });
    if (existing) continue;

    const [{ maxPos } = { maxPos: -1 }] = await db
      .select({ maxPos: sql<number>`coalesce(max(${lootQueueEntries.position}), -1)::int` })
      .from(lootQueueEntries)
      .where(eq(lootQueueEntries.categoryId, categoryId));

    await db.insert(lootQueueEntries).values({ categoryId, memberId, position: maxPos + 1 });
  }
}

interface NormalizedMember {
  discordId: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  avatarUrl: string;
  roles: string[];
  joinedAt: Date | null;
  hasTrackedRole: boolean;
}

/**
 * Name of the Discord role that gates guild-roster tracking. Only members
 * currently holding this role are synced into the app. Matched
 * case-insensitively. Defaults to "Rooc".
 */
const TRACKED_ROLE_NAME = (process.env.DISCORD_TRACKED_ROLE_NAME || "Rooc").trim().toLowerCase();

/** Resolves the tracked role in a guild by name (case-insensitive). */
export function resolveTrackedRole(guild: Guild): Role | null {
  return guild.roles.cache.find((r) => r.name.trim().toLowerCase() === TRACKED_ROLE_NAME) ?? null;
}

function memberHasTrackedRole(member: GuildMember): boolean {
  const role = resolveTrackedRole(member.guild);
  if (!role) return false;
  return member.roles.cache.has(role.id);
}

export function normalizeMember(member: GuildMember): NormalizedMember {
  return {
    discordId: member.id,
    username: member.user.username,
    globalName: member.user.globalName ?? null,
    nickname: member.nickname ?? null,
    avatarUrl: member.displayAvatarURL({ size: 128, extension: "png" }),
    roles: member.roles.cache.map((r) => r.id).filter((id) => id !== member.guild.id),
    joinedAt: member.joinedAt,
    hasTrackedRole: memberHasTrackedRole(member),
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

/** Same priority as `memberDisplayName` in src/lib/ui.ts (kept local — that
 * file isn't safe to import here, see class-emoji.ts's note on `@/` aliases
 * not resolving under tsx). Used to detect an actual visible name change. */
function displayNameOf(m: { nickname: string | null; globalName: string | null; username: string }): string {
  return m.nickname || m.globalName || m.username;
}

/** Logs NAME_CHANGE only if the effective displayed name actually differs — not on every routine profile refresh. */
async function maybeLogNameChange(
  existing: { id: string; discordNickname: string | null; discordGlobalName: string | null; discordUsername: string },
  normalized: NormalizedMember
) {
  const oldName = displayNameOf({
    nickname: existing.discordNickname,
    globalName: existing.discordGlobalName,
    username: existing.discordUsername,
  });
  const newName = displayNameOf(normalized);
  if (oldName === newName) return;
  await logEvent(existing.id, "NAME_CHANGE", `เปลี่ยนชื่อ Discord จาก "${oldName}" เป็น "${newName}"`);
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
        discordNickname: normalized.nickname,
        discordAvatar: normalized.avatarUrl,
        discordRoles: normalized.roles,
        status: "ACTIVE",
        joinedDiscordAt: normalized.joinedAt ?? new Date(),
        lastSyncedAt: new Date(),
      })
      .returning();
    await logEvent(inserted.id, "JOIN", "เข้าร่วม Discord server");
    await addToAllLootQueues(inserted.id);
    return;
  }

  const wasInactive = existing.status !== "ACTIVE";
  await maybeLogNameChange(existing, normalized);
  await db
    .update(members)
    .set({
      discordUsername: normalized.username,
      discordGlobalName: normalized.globalName,
      discordNickname: normalized.nickname,
      discordAvatar: normalized.avatarUrl,
      discordRoles: normalized.roles,
      // Per the guild's policy, members rename their Discord nickname to
      // match their in-game name — so the nickname is treated as the
      // authoritative source for inGameName too, kept in sync automatically
      // on every sync. Falls back to whatever was already stored if the
      // member currently has no nickname set (never overwrite with null).
      inGameName: normalized.nickname || existing.inGameName,
      status: "ACTIVE",
      leftDiscordAt: null,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(members.id, existing.id));

  if (wasInactive) {
    await logEvent(existing.id, "JOIN", "กลับเข้าร่วม Discord server อีกครั้ง");
    await addToAllLootQueues(existing.id);
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
  await clearPartyAssignments(existing.id);

  await logEvent(existing.id, "LEAVE", "ออกจาก Discord server");
}

/** Upsert the cached name/color/position for a single Discord role. */
export async function upsertRole(role: Role) {
  await db
    .insert(discordRoles)
    .values({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: discordRoles.id,
      set: {
        name: role.name,
        color: role.color,
        position: role.position,
        updatedAt: new Date(),
      },
    });
}

export async function removeRole(roleId: string) {
  await db.delete(discordRoles).where(eq(discordRoles.id, roleId));
}

/** Refresh the full role cache (id -> name/color/position) for the guild. */
export async function syncGuildRoles(guild: Guild) {
  const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id);
  for (const role of roles) {
    await upsertRole(role);
  }
  return roles.length;
}

/**
 * Full roster reconciliation: fetches every current guild member and diffs
 * it against the database. Run once on bot startup and periodically as a
 * safety net for events the bot may have missed while offline.
 */
export async function runFullSync(guild: Guild) {
  await syncGuildRoles(guild);

  const discordMembers = await guild.members.fetch();
  const normalizedList = [...discordMembers.values()]
    .filter((m) => !m.user.bot)
    .map(normalizeMember)
    // Only track members who currently hold the configured role (default
    // "Rooc"). Everyone else is left out of the roster entirely — if they
    // were previously tracked and lost the role, the reconciliation loop
    // below will mark them LEFT.
    .filter((m) => m.hasTrackedRole);

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
          discordNickname: normalized.nickname,
          discordAvatar: normalized.avatarUrl,
          discordRoles: normalized.roles,
          status: "ACTIVE",
          joinedDiscordAt: normalized.joinedAt ?? new Date(),
          lastSyncedAt: new Date(),
        })
        .returning();
      await logEvent(inserted.id, "JOIN", "พบจากการซิงค์ครั้งแรก");
      await addToAllLootQueues(inserted.id);
      joined++;
      continue;
    }

    const wasInactive = existing.status !== "ACTIVE";
    await maybeLogNameChange(existing, normalized);
    await db
      .update(members)
      .set({
        discordUsername: normalized.username,
        discordGlobalName: normalized.globalName,
        discordNickname: normalized.nickname,
        discordAvatar: normalized.avatarUrl,
        discordRoles: normalized.roles,
        inGameName: normalized.nickname || existing.inGameName,
        status: "ACTIVE",
        leftDiscordAt: null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(members.id, existing.id));

    if (wasInactive) {
      await logEvent(existing.id, "JOIN", "กลับเข้าร่วม Discord server (พบจากการซิงค์)");
      await addToAllLootQueues(existing.id);
      reactivated++;
    }
  }

  // Anyone marked ACTIVE in the DB but absent from the current tracked-role
  // list either left the Discord server, was kicked/banned, or simply lost
  // the tracked role — in every case they drop out of the roster.
  for (const dbMember of dbMembers) {
    if (dbMember.status === "ACTIVE" && !seenDiscordIds.has(dbMember.discordId)) {
      await db
        .update(members)
        .set({ status: "LEFT", leftDiscordAt: new Date(), lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(members.id, dbMember.id));
      await clearPartyAssignments(dbMember.id);
      await logEvent(dbMember.id, "LEAVE", "ออกจากกิลด์ (ออกจาก Discord server หรือไม่มี role ที่ติดตามแล้ว)");
      left++;
    }
  }

  return { total: normalizedList.length, joined, reactivated, left };
}
