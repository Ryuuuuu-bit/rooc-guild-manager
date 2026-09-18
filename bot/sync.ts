import { and, eq, sql } from "drizzle-orm";
import type { Guild, GuildMember, Role } from "discord.js";
import { db } from "../src/db";
import { discordRoles, lootCategories, lootQueueEntries, members, membershipEvents, partyBusyEntries, partySlots } from "../src/db/schema";
import { cancelCurrentLeave } from "./reactions";
import { sendWelcomeMessage } from "./welcome-message";

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

  // Reconcile (discard pending / log ATTENDANCE_RETURN) any open "ลา" on
  // every board this member is currently busy on, BEFORE wiping
  // partyBusyEntries below — mirrors reconcilePendingLeaveEverywhere
  // (src/lib/party-data.ts, used by markMemberKicked/setMemberBenched in
  // src/app/actions/members.ts) and resetDailyBusyLists' own
  // ATTENDANCE_RETURN logging (midnight-reset.ts), reimplemented here via
  // cancelCurrentLeave (bot/reactions.ts) since src/lib/party-data.ts's `@/`
  // imports don't resolve under tsx (see class-emoji.ts's note on that).
  //
  // Without this, a member who leaves Discord — or loses the tracked role —
  // while marked "ลา" left a stale, never-closed-out ATTENDANCE_LEAVE as
  // their most recent event on that board FOREVER. getLeaveMemberIds
  // (src/lib/checkin-data.ts) — the shared source for both /checkin's "On
  // Leave" count and /calendar's per-day leave list — reconstructs status by
  // last-write-wins over that event trail with no date bound, so it kept
  // counting them as on leave on every future round, even though the live
  // party board (which only ever lists currently-ACTIVE, non-benched
  // members — see getPartyBoardDetail in party-data.ts) had already stopped
  // showing them entirely. That mismatch is exactly what made /calendar's
  // "On Leave" count run higher than the number of people actually visible
  // on the board. cancelCurrentLeave already deletes the matching
  // partyBusyEntries row per board internally, so there's no separate
  // delete(partyBusyEntries) left to do here.
  const busyBoards = await db
    .select({ boardId: partyBusyEntries.boardId })
    .from(partyBusyEntries)
    .where(eq(partyBusyEntries.memberId, memberId));
  for (const { boardId } of busyBoards) {
    await cancelCurrentLeave(memberId, boardId, " (ออกจากกิลด์/role หลุด)");
  }

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

/**
 * Resolves EVERY role in the guild matching the tracked role name
 * (case-insensitive) — Discord does not enforce unique role names, so more
 * than one role can legitimately share a name (most often an accidental
 * duplicate created by an admin). Picking just one via `.find()` used to mean
 * whichever role won was arbitrary/undeterministic, and a member holding only
 * the OTHER same-named role was silently treated as not having the tracked
 * role at all — never added to the roster. Checking membership against the
 * whole set instead removes that ambiguity entirely.
 */
export function resolveTrackedRoles(guild: Guild): Role[] {
  return [...guild.roles.cache.filter((r) => r.name.trim().toLowerCase() === TRACKED_ROLE_NAME).values()];
}

function memberHasTrackedRole(member: GuildMember): boolean {
  return resolveTrackedRoles(member.guild).some((role) => member.roles.cache.has(role.id));
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

// See src/lib/loot-queue-data.ts's identical DbOrTx for why this shape —
// lets logEvent join an existing transaction below instead of always
// opening its own separate write.
type DbOrTx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

async function logEvent(
  memberId: string,
  type: (typeof membershipEvents.$inferInsert)["type"],
  detail: string,
  dbOrTx: DbOrTx = db
) {
  await dbOrTx.insert(membershipEvents).values({
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
    try {
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
      await sendWelcomeMessage(inserted);
    } catch (err) {
      const isDuplicate = typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
      if (!isDuplicate) throw err;
      // Same benign race runFullSync's own insert guards against (see its
      // comment) — a concurrent runFullSync pass already inserted this same
      // brand-new member. Previously unguarded here, so this side of the
      // race surfaced as a raw, unexplained-looking DB error in the logs
      // instead of being recognized as "two paths handled the same join."
    }
    return;
  }

  const wasInactive = existing.status !== "ACTIVE";
  // A KICKED member is never silently resurrected by a sync pass — an admin
  // set that status deliberately (see markMemberKicked in
  // src/app/actions/members.ts), often specifically BECAUSE the bot's actual
  // Discord kick failed and the person is still physically in the server.
  // Undoing that is a separate, explicit admin action (restoreMemberStatus).
  const wasKicked = existing.status === "KICKED";
  await maybeLogNameChange(existing, normalized);

  if (wasKicked) {
    // Profile fields still refresh normally — only status/leftDiscordAt (and
    // the JOIN/loot-queue re-add that would follow a real reactivation) stay
    // untouched.
    await db
      .update(members)
      .set({
        discordUsername: normalized.username,
        discordGlobalName: normalized.globalName,
        discordNickname: normalized.nickname,
        discordAvatar: normalized.avatarUrl,
        discordRoles: normalized.roles,
        inGameName: normalized.nickname || existing.inGameName,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(members.id, existing.id));
    return;
  }

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

/**
 * Mark a member LEFT on a live guildMemberRemove event.
 *
 * Runs clearPartyAssignments BEFORE flipping status, then flips status and
 * logs the LEAVE event together in one transaction — the reverse of the
 * order this used to run in. Flipping status to LEFT first meant that if the
 * bot got killed (a routine Railway redeploy — see this whole file's other
 * transaction-safety notes) anywhere after that write, the stale party
 * slot/loot-queue/busy-entry state clearPartyAssignments was supposed to
 * clean up was stuck there PERMANENTLY: runFullSync's own LEFT-detection
 * loop below only ever looks at members still marked ACTIVE, so a member
 * already flipped to LEFT is never revisited to finish the cleanup. Doing
 * the cleanup first (safe to re-run — clearPartyAssignments only touches
 * rows that still reference this member, so an already-cleared board is a
 * no-op) and only then committing the status flip means a crash anywhere in
 * between just leaves the member looking ACTIVE-but-gone, which the next
 * sync pass (or the next real leave event) retries from scratch.
 */
export async function markMemberLeftFromGateway(discordId: string) {
  const existing = await db.query.members.findFirst({
    where: eq(members.discordId, discordId),
  });
  if (!existing || existing.status !== "ACTIVE") return;

  await clearPartyAssignments(existing.id);

  await db.transaction(async (tx) => {
    await tx
      .update(members)
      .set({ status: "LEFT", leftDiscordAt: new Date(), lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(members.id, existing.id));
    await logEvent(existing.id, "LEAVE", "ออกจาก Discord server", tx);
  });
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
  const seenDiscordIds = new Set<string>();

  let joined = 0;
  let reactivated = 0;
  let left = 0;

  for (const normalized of normalizedList) {
    seenDiscordIds.add(normalized.discordId);

    try {
      // Re-read this member's row fresh right here, rather than trusting the
      // bulk `dbMembers` snapshot taken above before guild.members.fetch()
      // (which can take a while on a large guild). A concurrent real
      // Discord leave — the gateway's markMemberLeftFromGateway — can commit
      // its LEFT status in that gap; reading fresh means this loop sees that
      // write instead of blindly flipping the member back to ACTIVE and
      // silently undoing a leave that just happened for real. This narrows
      // the race window down to a single query+update instead of the whole
      // fetch+loop duration, though it can't close it completely without
      // row-level locking, which isn't worth the complexity here.
      const existing = await db.query.members.findFirst({ where: eq(members.discordId, normalized.discordId) });

      if (!existing) {
        try {
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
          await sendWelcomeMessage(inserted);
          joined++;
        } catch (err) {
          const isDuplicate = typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
          if (!isDuplicate) throw err;
          // A gateway event (upsertMemberFromGateway) already inserted this
          // same brand-new member concurrently while this full sync was
          // fetching/diffing — not an error, just two paths racing to
          // handle the same join. Nothing left to do this cycle.
        }
        continue;
      }

      const wasInactive = existing.status !== "ACTIVE";
      // Same KICKED guard as upsertMemberFromGateway above — see its comment.
      const wasKicked = existing.status === "KICKED";
      await maybeLogNameChange(existing, normalized);

      if (wasKicked) {
        await db
          .update(members)
          .set({
            discordUsername: normalized.username,
            discordGlobalName: normalized.globalName,
            discordNickname: normalized.nickname,
            discordAvatar: normalized.avatarUrl,
            discordRoles: normalized.roles,
            inGameName: normalized.nickname || existing.inGameName,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(members.id, existing.id));
        continue;
      }

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
    } catch (err) {
      // One member's row failing to process (a transient DB hiccup, or
      // anything else unexpected) shouldn't abort the whole reconciliation —
      // in particular, it must not skip the LEFT-detection pass below, which
      // used to happen when this loop threw partway through.
      console.error(`runFullSync: failed to process member ${normalized.discordId}`, err);
    }
  }

  // Anyone marked ACTIVE in the DB but absent from the current tracked-role
  // list either left the Discord server, was kicked/banned, or simply lost
  // the tracked role — in every case they drop out of the roster. Same
  // cleanup-before-status-flip ordering as markMemberLeftFromGateway above,
  // and for the same reason: once status leaves ACTIVE this loop's own
  // `dbMember.status === "ACTIVE"` filter above means nothing ever revisits
  // this member again, so a crash after the old status-first write left
  // stale party-slot/loot-queue state stuck forever.
  for (const dbMember of dbMembers) {
    if (dbMember.status === "ACTIVE" && !seenDiscordIds.has(dbMember.discordId)) {
      await clearPartyAssignments(dbMember.id);
      await db.transaction(async (tx) => {
        await tx
          .update(members)
          .set({ status: "LEFT", leftDiscordAt: new Date(), lastSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(members.id, dbMember.id));
        await logEvent(dbMember.id, "LEAVE", "ออกจากกิลด์ (ออกจาก Discord server หรือไม่มี role ที่ติดตามแล้ว)", tx);
      });
      left++;
    }
  }

  return { total: normalizedList.length, joined, reactivated, left };
}
