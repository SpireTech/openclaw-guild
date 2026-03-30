import { Type } from "@sinclair/typebox";
import type { PluginConfig, AgentCredentials } from "../config.js";
import { supabasePatch } from "../supabase.js";

const SCOPE_TABLES: Record<string, string> = {
  agent: "agent_memories",
  team: "role_memories",
  company: "company_memories",
};

export const memoryArchiveDef = {
  name: "guild_memory_archive",
  description:
    "Archive (soft-delete) a memory. The memory is not permanently deleted — it can be restored.",
  parameters: Type.Object({
    namespace: Type.String({ description: "Memory namespace" }),
    key: Type.String({ description: "Memory key to archive" }),
    scope: Type.Optional(
      Type.Union(
        [Type.Literal("agent"), Type.Literal("team"), Type.Literal("company")],
        { description: "Memory scope (default: agent)", default: "agent" },
      ),
    ),
  }),
};

export async function executeMemoryArchive(
  creds: AgentCredentials,
  config: PluginConfig,
  params: { namespace: string; key: string; scope?: string },
) {
  const scope = params.scope ?? "agent";
  const table = SCOPE_TABLES[scope];
  if (!table) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid scope: ${scope}. Use agent, team, or company.` }) }],
      details: undefined,
    };
  }

  const data = await supabasePatch(creds, config, {
    table,
    filters: {
      namespace: `eq.${params.namespace}`,
      key: `eq.${params.key}`,
      status: "eq.active",
    },
    body: { status: "archived" },
    select: "namespace,key",
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ archived: true, scope, memory: data }) }],
    details: undefined,
  };
}
