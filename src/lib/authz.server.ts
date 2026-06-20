import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  follows,
  userBlocks,
  userPrivacySettings,
  conversationParticipants,
  conversations,
} from "@/db/schema";

/**
 * Authorization helpers, ported 1:1 from the old Supabase SECURITY DEFINER SQL
 * functions (can_view_profile, can_engage, dm_status, can_dm, is_mutual,
 * follows_user, is_conversation_member) that used to back RLS. RLS is gone — the
 * app is now the sole enforcement point, so every privacy/engagement/DM decision
 * runs through these and the *.functions.ts call them explicitly.
 *
 * Server-only (`@/db`). See docs/migration-to-self-hosted.md §3-4.
 */

export type DmAudience = "everyone" | "followers" | "mutuals" | "nobody";
export type DmStatus = "allowed" | "request" | "blocked";

/** Does `a` follow `b`? */
export async function followsUser(a: string, b: string): Promise<boolean> {
  const r = await db
    .select({ x: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, a), eq(follows.followingId, b)))
    .limit(1);
  return r.length > 0;
}

/** Mutual follow (a↔b). */
export async function isMutual(a: string, b: string): Promise<boolean> {
  const r = await db
    .select({ follower: follows.followerId, following: follows.followingId })
    .from(follows)
    .where(
      or(
        and(eq(follows.followerId, a), eq(follows.followingId, b)),
        and(eq(follows.followerId, b), eq(follows.followingId, a)),
      ),
    );
  return r.length === 2;
}

/** Either direction of a block between the two users. */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const r = await db
    .select({ x: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
      ),
    )
    .limit(1);
  return r.length > 0;
}

async function privacyOf(userId: string): Promise<{
  isPrivate: boolean;
  allowDmFrom: DmAudience;
  allowEngagementFrom: DmAudience;
}> {
  const r = await db
    .select({
      isPrivate: userPrivacySettings.isPrivate,
      allowDmFrom: userPrivacySettings.allowDmFrom,
      allowEngagementFrom: userPrivacySettings.allowEngagementFrom,
    })
    .from(userPrivacySettings)
    .where(eq(userPrivacySettings.userId, userId))
    .limit(1);
  const row = r[0];
  return {
    isPrivate: row?.isPrivate ?? false,
    allowDmFrom: (row?.allowDmFrom ?? "everyone") as DmAudience,
    allowEngagementFrom: (row?.allowEngagementFrom ?? "everyone") as DmAudience,
  };
}

/** is_account_private(userId): whether the account is set to private. */
export async function isAccountPrivate(userId: string): Promise<boolean> {
  return (await privacyOf(userId)).isPrivate;
}

/** can_view_profile(viewer, target): private accounts are visible only to followers. */
export async function canViewProfile(viewer: string, target: string): Promise<boolean> {
  if (viewer === target) return true;
  const { isPrivate } = await privacyOf(target);
  if (!isPrivate) return true;
  return followsUser(viewer, target);
}

/** can_engage(viewer, author): like/comment/repost gate. */
export async function canEngage(viewer: string, author: string): Promise<boolean> {
  if (viewer === author) return true;
  if (await isBlockedBetween(viewer, author)) return false;
  if (!(await canViewProfile(viewer, author))) return false;

  const { allowEngagementFrom: aud } = await privacyOf(author);
  if (aud === "everyone") return true;
  if (aud === "nobody") return false;
  if (aud === "followers") {
    return (await followsUser(author, viewer)) || (await followsUser(viewer, author));
  }
  if (aud === "mutuals") return isMutual(viewer, author);
  return false;
}

/**
 * dm_status(sender, recipient): 'allowed' | 'request' | 'blocked'.
 * Mirrors the old plpgsql dm_status exactly (note: 'nobody' still allows a
 * 'request' if the sender already follows the recipient).
 */
export async function dmStatus(sender: string, recipient: string): Promise<DmStatus> {
  if (sender === recipient) return "allowed";
  if (await isBlockedBetween(sender, recipient)) return "blocked";

  const { allowDmFrom: audience } = await privacyOf(recipient);
  const recipientFollowsSender = await followsUser(recipient, sender);
  const senderFollowsRecipient = await followsUser(sender, recipient);

  if (audience === "everyone") return "allowed";
  if (audience === "followers" && (recipientFollowsSender || senderFollowsRecipient)) {
    return "allowed";
  }
  if (audience === "mutuals" && recipientFollowsSender && senderFollowsRecipient) {
    return "allowed";
  }
  if (audience === "nobody") {
    return senderFollowsRecipient ? "request" : "blocked";
  }
  return "request";
}

/** can_dm(sender, recipient): may send or at least request. */
export async function canDm(sender: string, recipient: string): Promise<boolean> {
  const status = await dmStatus(sender, recipient);
  return status === "allowed" || status === "request";
}

/** is_conversation_member(conversationId, userId): active (not left) participant. */
export async function isConversationMember(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const r = await db
    .select({ x: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
        isNull(conversationParticipants.leftAt),
      ),
    )
    .limit(1);
  return r.length > 0;
}

/**
 * get_or_create_dm(self, other): returns the id of the 1:1 conversation between
 * the two users, creating it (with both participants) if absent. Ports the old
 * SECURITY DEFINER RPC. Caller must already pass dmStatus/canDm gating.
 */
export async function getOrCreateDm(self: string, other: string): Promise<string> {
  // Candidate non-group conversations that `self` belongs to.
  const candidates = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversationId, conversations.id),
    )
    .where(
      and(
        eq(conversations.isGroup, false),
        eq(conversationParticipants.userId, self),
      ),
    );

  // Among those, find the one whose participant set is exactly {self, other}.
  for (const { id } of candidates) {
    const members = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, id));
    const ids = new Set(members.map((m) => m.userId));
    if (ids.size === 2 && ids.has(self) && ids.has(other)) return id;
  }

  // None — create the conversation and both participant rows.
  const dmStatusValue = await dmStatus(self, other);
  const [conv] = await db
    .insert(conversations)
    .values({ isGroup: false, createdBy: self, isRequest: dmStatusValue === "request" })
    .returning({ id: conversations.id });
  await db.insert(conversationParticipants).values([
    { conversationId: conv.id, userId: self },
    { conversationId: conv.id, userId: other },
  ]);
  return conv.id;
}

/** AFTER-INSERT message side effect: bump conversations.last_message_at. */
export async function bumpConversation(
  conversationId: string,
  at: Date,
): Promise<void> {
  await db
    .update(conversations)
    .set({ lastMessageAt: at })
    .where(eq(conversations.id, conversationId));
}
