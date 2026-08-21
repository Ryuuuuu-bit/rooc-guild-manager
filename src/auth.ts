import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { env } from "@/lib/env";
import { discordUserFetch, discordAvatarUrl, DiscordApiError } from "@/lib/discord";
import { db } from "@/db";
import { discordRoles, members } from "@/db/schema";
import { eq, ilike } from "drizzle-orm";

// Extend the built-in NextAuth types with the fields this app needs.
declare module "next-auth" {
  interface User {
    isAdmin?: boolean;
    avatarUrl?: string;
    /** The actual Discord snowflake — set explicitly in the signIn callback.
     * Auth.js's own `user.id` is NOT reliably this: in this app's adapterless
     * JWT-strategy setup, @auth/core's callback handler can overwrite
     * `user.id` with a freshly generated internal UUID before the jwt
     * callback ever sees it, so reading `user.id` there silently carries the
     * wrong value through to session.user.discordId (see the jwt callback
     * below). Stashing the real id under our own field name sidesteps that
     * entirely. */
    discordId?: string;
  }
  interface Session {
    user: {
      discordId: string;
      username: string;
      avatarUrl: string;
      isAdmin: boolean;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    discordId?: string;
    username?: string;
    avatarUrl?: string;
    isAdmin?: boolean;
  }
}

interface DiscordProfile {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name: string | null;
}

interface GuildMemberResponse {
  roles: string[];
  nick: string | null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: env.discordClientId,
      clientSecret: env.discordClientSecret,
      authorization: {
        params: { scope: "identify guilds.members.read" },
      },
    }),
  ],
  secret: env.authSecret,
  session: { strategy: "jwt" },
  pages: {
    // Custom sign-in page; unauthenticated/rejected visits land here with
    // an explanatory `error` search param instead of NextAuth's default page.
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account?.access_token || !profile) return false;
      const discordProfile = profile as unknown as DiscordProfile;

      // Gate the whole app behind guild membership: only people who are
      // currently members of the configured Discord server may sign in.
      let guildMember: GuildMemberResponse;
      try {
        guildMember = await discordUserFetch(
          `/users/@me/guilds/${env.discordGuildId}/member`,
          account.access_token
        );
      } catch (err) {
        if (err instanceof DiscordApiError && (err.status === 404 || err.status === 403)) {
          return "/login?error=NotAGuildMember";
        }
        console.error("Failed to verify guild membership on sign-in", err);
        return "/login?error=Verification";
      }

      const isAdmin =
        env.adminUserIds.includes(discordProfile.id) ||
        guildMember.roles.some((r) => env.adminRoleIds.includes(r));

      const avatarUrl = discordAvatarUrl(
        discordProfile.id,
        discordProfile.avatar,
        Number(discordProfile.discriminator) || 0
      );

      // Carry the computed values through to the jwt callback below. Set
      // discordId explicitly here (from the verified profile) rather than
      // relying on `user.id` in the jwt callback — see the User interface
      // augmentation above for why.
      user.isAdmin = isAdmin;
      user.avatarUrl = avatarUrl;
      user.discordId = discordProfile.id;

      // Best-effort: if this person currently holds the tracked role (e.g.
      // "Rooc"), make sure they show up in the roster right away rather
      // than waiting for the bot's next sync pass. People without the role
      // can still sign in (guild membership is all that's required to use
      // the app) but are not added to the roster. Never block sign-in on
      // any of this failing.
      try {
        const trackedRole = await db.query.discordRoles.findFirst({
          where: ilike(discordRoles.name, env.trackedRoleName),
        });
        const hasTrackedRole = Boolean(
          trackedRole && guildMember.roles.includes(trackedRole.id)
        );

        if (hasTrackedRole) {
          const existing = await db.query.members.findFirst({
            where: eq(members.discordId, discordProfile.id),
          });

          if (!existing) {
            await db.insert(members).values({
              discordId: discordProfile.id,
              discordUsername: discordProfile.username,
              discordGlobalName: discordProfile.global_name,
              discordNickname: guildMember.nick,
              discordAvatar: avatarUrl,
              discordRoles: guildMember.roles,
              status: "ACTIVE",
              joinedDiscordAt: new Date(),
              lastSyncedAt: new Date(),
            });
          } else {
            await db
              .update(members)
              .set({
                discordUsername: discordProfile.username,
                discordGlobalName: discordProfile.global_name,
                discordNickname: guildMember.nick,
                discordAvatar: avatarUrl,
                discordRoles: guildMember.roles,
                status: "ACTIVE",
                leftDiscordAt: null,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(members.id, existing.id));
          }
        }
      } catch (err) {
        console.error("Failed to upsert member on sign-in", err);
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        // NOT user.id — see the User.discordId doc comment above. Bug found
        // in production logs: requireAdmin()'s live Discord role check was
        // calling Discord's API with an internal UUID instead of the real
        // snowflake ID on every single request (400 "not a snowflake"),
        // silently falling back to the cached session value every time —
        // which meant the "revoked admin access takes effect immediately"
        // fix never actually took effect.
        token.discordId = user.discordId ?? "";
        token.username = user.name ?? "unknown";
        token.avatarUrl = user.avatarUrl ?? user.image ?? "";
        token.isAdmin = user.isAdmin ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.discordId = token.discordId ?? "";
      session.user.username = token.username ?? "";
      session.user.avatarUrl = token.avatarUrl ?? "";
      session.user.isAdmin = token.isAdmin ?? false;
      return session;
    },
  },
});
