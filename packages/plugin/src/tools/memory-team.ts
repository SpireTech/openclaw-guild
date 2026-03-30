import { Type } from "@sinclair/typebox";
import type { PluginConfig, AgentCredentials } from "../config.js";
import { supabaseGet } from "../supabase.js";

export const memoryTeamDef = {
  name: "guild_memory_team",
  description:
    "Read shared team (role-scoped) memories visible to your agent.",
  parameters: Type.Object({
    namespace: Type.Optional(Type.String({ description: "Filter by namespace" })),
  }),
};

export async function executeMemoryTeam(
  creds: AgentCredentials,
  config: PluginConfig,
  params: { namespace?: string },
) {
  const filters: Record<string, string> = { status: "eq.active" };
  if (params.namespace) filters.namespace = `eq.${params.namespace}`;

  const data = await supabaseGet<Array<Record<string, unknown>>>(creds, config, {
    table: "role_memories",
    select: "role,namespace,key,value,tags,created_at",
    filters,
    order: "updated_at.desc",
    limit: 100,
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: undefined,
  };
}
