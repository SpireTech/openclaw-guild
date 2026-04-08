import { Type } from "@sinclair/typebox";
import type { PluginConfig, AgentCredentials } from "../config.js";
import { supabaseGet } from "../supabase.js";

export const userReadDef = {
  name: "guild_user_read",
  description:
    "Read memories about the person you are currently talking to. Returns their preferences, context, and notes. Automatically identifies the user from the conversation.",
  parameters: Type.Object({
    namespace: Type.Optional(Type.String({ description: "Filter by namespace (e.g., preferences, context, notes)" })),
    key: Type.Optional(Type.String({ description: "Filter by specific key" })),
  }),
};

export async function executeUserRead(
  creds: AgentCredentials,
  config: PluginConfig,
  params: { namespace?: string; key?: string },
  userId: string | undefined,
) {
  if (!userId) {
    return {
      content: [{ type: "text" as const, text: "Cannot identify the current user. This tool only works in conversations with a known user." }],
      details: undefined,
    };
  }

  const filters: Record<string, string> = { user_id: `eq.${userId}` };
  if (params.namespace) filters.namespace = `eq.${params.namespace}`;
  if (params.key) filters.key = `eq.${params.key}`;

  const data = await supabaseGet<Array<Record<string, unknown>>>(creds, config, {
    table: "user_memories",
    select: "namespace,key,value,tags,written_by_type,created_at,updated_at",
    filters,
    order: "updated_at.desc",
    limit: 100,
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: undefined,
  };
}
