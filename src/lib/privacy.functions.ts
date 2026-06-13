import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyPrivacy> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_privacy_settings")
      .select("is_private, allow_dm_from, allow_engagement_from")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return DEFAULTS;
    return {
      isPrivate: !!data.is_private,
      allowDmFrom: (data.allow_dm_from ?? "everyone") as Audience,
      allowEngagementFrom: (data.allow_engagement_from ?? "everyone") as Audience,
    };
  });

const audience = z.enum(["everyone", "followers", "mutuals", "nobody"]);

const updateInput = z.object({
  isPrivate: z.boolean().optional(),
  allowDmFrom: audience.optional(),
  allowEngagementFrom: audience.optional(),
});

export const updateMyPrivacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }): Promise<MyPrivacy> => {
    const { supabase, userId } = context;
    const patch = {
      user_id: userId,
      updated_at: new Date().toISOString(),
      ...(data.isPrivate !== undefined && { is_private: data.isPrivate }),
      ...(data.allowDmFrom !== undefined && { allow_dm_from: data.allowDmFrom }),
      ...(data.allowEngagementFrom !== undefined && {
        allow_engagement_from: data.allowEngagementFrom,
      }),
    };
    const { error } = await supabase
      .from("user_privacy_settings")
      .upsert(patch, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    // Return fresh row
    const { data: row } = await supabase
      .from("user_privacy_settings")
      .select("is_private, allow_dm_from, allow_engagement_from")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      isPrivate: !!row?.is_private,
      allowDmFrom: (row?.allow_dm_from ?? "everyone") as Audience,
      allowEngagementFrom: (row?.allow_engagement_from ?? "everyone") as Audience,
    };
  });
