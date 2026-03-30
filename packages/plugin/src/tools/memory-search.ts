import { Type } from "@sinclair/typebox";
import type { PluginConfig, AgentCredentials } from "../config.js";
import { supabaseGet } from "../supabase.js";

export const memorySearchDef = {
  name: "guild_memory_search",
  description:
    "Search across all accessible memory tiers (agent, role, company). Keyword search against memory values.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    tiers: Type.Optional(Type.Array(
      Type.Union([
        Type.Literal("agent"),
        Type.Literal("role"),
        Type.Literal("company"),
      ]),
      { description: "Tiers to search (default: all)" },
    )),
    namespace: Type.Optional(Type.String({ description: "Filter by namespace" })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Max results (default: 20)" })),
  }),
};

const TIER_TABLES: Record<string, string> = {
  agent: "agent_memories",
  role: "role_memories",
  company: "company_memories",
};

export async function executeMemorySearch(
  creds: AgentCredentials,
  config: PluginConfig,
  params: { query: string; tiers?: string[]; namespace?: string; limit?: number },
) {
  const tiers = params.tiers ?? ["agent", "role", "company"];
  const limit = params.limit ?? 20;
  const results: Array<Record<string, unknown>> = [];

  for (const tier of tiers) {
    const table = TIER_TABLES[tier];
    if (!table) continue;

    const filters: Record<string, string> = {
      status: "eq.active",
      value: `ilike.*${params.query}*`,
    };
    if (params.namespace) filters.namespace = `eq.${params.namespace}`;

    try {
      const data = await supabaseGet<Array<Record<string, unknown>>>(creds, config, {
        table,
        select: "namespace,key,value,tags",
        filters,
        limit,
      });

      for (const row of data) {
        results.push({ tier, ...row });
      }
    } catch {
      // Skip tiers that fail (e.g. RLS denies access)
    }
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ results: results.slice(0, limit) }, null, 2),
    }], details: undefined,
  };
}
