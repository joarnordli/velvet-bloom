import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { userPrivacySettings } from "@/db/schema";
import { requireAuth } from "./auth-middleware";

export type Audience = "everyone" | "followers" | "mutuals" | "nobody";

export type MyPrivacy = {
  isPrivate: boolean;
  allowDmFrom: Audience;
  allowEngagementFrom: Audience;
};

const DEFAULTS: MyPrivacy = {
  isPrivate: false,
  allowDmFrom: "everyone",
  allowEngagementFrom: "everyone",
};

export const getMyPrivacy = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<MyPrivacy> => {
    const { userId } = context;
    const row = await db
      .select({
        isPrivate: userPrivacySettings.isPrivate,
        allowDmFrom: userPrivacySettings.allowDmFrom,
        allowEngagementFrom: userPrivacySettings.allowEngagementFrom,
      })
      .from(userPrivacySettings)
      .where(eq(userPrivacySettings.userId, userId))
      .limit(1);
    if (!row.length) return DEFAULTS;
    return {
      isPrivate: !!row[0].isPrivate,
      allowDmFrom: (row[0].allowDmFrom ?? "everyone") as Audience,
      allowEngagementFrom: (row[0].allowEngagementFrom ?? "everyone") as Audience,
    };
  });

const audience = z.enum(["everyone", "followers", "mutuals", "nobody"]);

const updateInput = z.object({
  isPrivate: z.boolean().optional(),
  allowDmFrom: audience.optional(),
  allowEngagementFrom: audience.optional(),
});

export const updateMyPrivacy = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }): Promise<MyPrivacy> => {
    const { userId } = context;
    const set = {
      ...(data.isPrivate !== undefined && { isPrivate: data.isPrivate }),
      ...(data.allowDmFrom !== undefined && { allowDmFrom: data.allowDmFrom }),
      ...(data.allowEngagementFrom !== undefined && {
        allowEngagementFrom: data.allowEngagementFrom,
      }),
      updatedAt: new Date(),
    };
    await db
      .insert(userPrivacySettings)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: userPrivacySettings.userId, set });

    const row = await db
      .select({
        isPrivate: userPrivacySettings.isPrivate,
        allowDmFrom: userPrivacySettings.allowDmFrom,
        allowEngagementFrom: userPrivacySettings.allowEngagementFrom,
      })
      .from(userPrivacySettings)
      .where(eq(userPrivacySettings.userId, userId))
      .limit(1);
    return {
      isPrivate: !!row[0]?.isPrivate,
      allowDmFrom: (row[0]?.allowDmFrom ?? "everyone") as Audience,
      allowEngagementFrom: (row[0]?.allowEngagementFrom ?? "everyone") as Audience,
    };
  });
