#!/usr/bin/env node
/**
 * OpenClaw Guild — Consolidated MCP Server
 *
 * Combines memory (17 tools), skills (8 tools), and knowledge (4 tools)
 * into a single MCP server with config-driven tool group activation.
 *
 * Environment:
 *   GUILD_TOOLS  — Comma-separated tool groups to enable (default: "memory,skills,knowledge")
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — Supabase config
 *   OAUTH_CLIENT_ID — OAuth client ID for RLS
 *   OLLAMA_URL — Ollama embedding service (for knowledge tools)
 *   EMBEDDING_MODEL — Embedding model name (default: nomic-embed-text)
 */

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createUserClient } from "./lib/supabase.js";

// ── Tool group type ──

type ToolDef = { name: string; description: string; inputSchema: unknown };
type ToolHandler = (
  db: ReturnType<typeof createUserClient>,
  args: Record<string, unknown> | undefined,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

// ── Parse enabled groups ──

const enabledGroups = new Set(
  (process.env.GUILD_TOOLS || "memory,skills,knowledge")
    .split(",")
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean),
);

console.error(`[guild-mcp] Enabled tool groups: ${[...enabledGroups].join(", ")}`);

// ── Collect tools and handlers ──

const allTools: ToolDef[] = [];
const handlers: Record<string, ToolHandler> = {};

function registerGroup(tools: ToolDef[], handlerMap: Record<string, ToolHandler>) {
  for (const tool of tools) {
    allTools.push(tool);
  }
  Object.assign(handlers, handlerMap);
}

// ── Memory tools (17) ──

if (enabledGroups.has("memory")) {
  const { agentGetMemoriesTool, agentSetMemoryTool, agentDeleteMemoryTool, handleAgentGetMemories, handleAgentSetMemory, handleAgentDeleteMemory } = await import("./tools/memory-agent-memory.js");
  const { userGetMemoriesTool, userSetMemoryTool, userDeleteMemoryTool, handleUserGetMemories, handleUserSetMemory, handleUserDeleteMemory } = await import("./tools/memory-user-memory.js");
  const { roleGetMemoriesTool, roleSetMemoryTool, handleRoleGetMemories, handleRoleSetMemory } = await import("./tools/memory-role-memory.js");
  const { companyGetMemoriesTool, companySetMemoryTool, handleCompanyGetMemories, handleCompanySetMemory } = await import("./tools/memory-company-memory.js");
  const { proposePromotionTool, listPromotionsTool, reviewPromotionTool, handleProposePromotion, handleListPromotions, handleReviewPromotion } = await import("./tools/memory-promotions.js");
  const { searchMemoriesTool, handleSearchMemories } = await import("./tools/memory-search.js");
  const { getMemoryStatsTool, getAuditLogTool, listGrantsTool, handleGetMemoryStats, handleGetAuditLog, handleListGrants } = await import("./tools/memory-introspection.js");

  registerGroup(
    [
      agentGetMemoriesTool, agentSetMemoryTool, agentDeleteMemoryTool,
      userGetMemoriesTool, userSetMemoryTool, userDeleteMemoryTool,
      roleGetMemoriesTool, roleSetMemoryTool,
      companyGetMemoriesTool, companySetMemoryTool,
      proposePromotionTool, listPromotionsTool, reviewPromotionTool,
      searchMemoriesTool,
      getMemoryStatsTool, getAuditLogTool, listGrantsTool,
    ],
    {
      agent_get_memories: handleAgentGetMemories,
      agent_set_memory: handleAgentSetMemory,
      agent_delete_memory: handleAgentDeleteMemory,
      user_get_memories: handleUserGetMemories,
      user_set_memory: handleUserSetMemory,
      user_delete_memory: handleUserDeleteMemory,
      role_get_memories: handleRoleGetMemories,
      role_set_memory: handleRoleSetMemory,
      company_get_memories: handleCompanyGetMemories,
      company_set_memory: handleCompanySetMemory,
      propose_promotion: handleProposePromotion,
      list_promotions: handleListPromotions,
      review_promotion: handleReviewPromotion,
      search_memories: handleSearchMemories,
      get_memory_stats: handleGetMemoryStats,
      get_audit_log: handleGetAuditLog,
      list_grants: handleListGrants,
    },
  );
  console.error(`[guild-mcp] Memory tools loaded (17)`);
}

// ── Skills tools (8) ──

if (enabledGroups.has("skills")) {
  const { listSkillsTool, getSkillTool, getSkillVersionTool, handleListSkills, handleGetSkill, handleGetSkillVersion } = await import("./tools/skills-discovery.js");
  const { createSkillTool, createSkillVersionTool, handleCreateSkill, handleCreateSkillVersion } = await import("./tools/skills-authoring.js");
  const { resolveSkillsTool, assignSkillTool, unassignSkillTool, handleResolveSkills, handleAssignSkill, handleUnassignSkill } = await import("./tools/skills-assignments.js");

  registerGroup(
    [
      listSkillsTool, getSkillTool, getSkillVersionTool,
      createSkillTool, createSkillVersionTool,
      resolveSkillsTool, assignSkillTool, unassignSkillTool,
    ],
    {
      list_skills: handleListSkills,
      get_skill: handleGetSkill,
      get_skill_version: handleGetSkillVersion,
      create_skill: handleCreateSkill,
      create_skill_version: handleCreateSkillVersion,
      resolve_skills: handleResolveSkills,
      assign_skill: handleAssignSkill,
      unassign_skill: handleUnassignSkill,
    },
  );
  console.error(`[guild-mcp] Skills tools loaded (8)`);
}

// ── Knowledge tools (4) ──

if (enabledGroups.has("knowledge")) {
  const { searchKnowledgeTool, handleSearchKnowledge } = await import("./tools/knowledge-search.js");
  const { getChunkTool, handleGetChunk } = await import("./tools/knowledge-get-chunk.js");
  const { listClientsTool, handleListClients } = await import("./tools/knowledge-list-clients.js");
  const { clientSummaryTool, handleClientSummary } = await import("./tools/knowledge-client-summary.js");

  registerGroup(
    [searchKnowledgeTool, getChunkTool, listClientsTool, clientSummaryTool],
    {
      search_knowledge: handleSearchKnowledge,
      get_chunk: handleGetChunk,
      list_clients: handleListClients,
      get_client_summary: handleClientSummary,
    },
  );
  console.error(`[guild-mcp] Knowledge tools loaded (4)`);
}

console.error(`[guild-mcp] Total tools: ${allTools.length}`);

// ── MCP Server ──

const server = new Server(
  { name: "guild-mcp", version: "0.6.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const jwt = request.params._meta?.jwt as string;
  const db = createUserClient(jwt);
  const handler = handlers[request.params.name];

  if (!handler) throw new Error(`Unknown tool: ${request.params.name}`);

  return handler(db, request.params.arguments as Record<string, unknown> | undefined);
});

const transport = new StdioServerTransport();
await server.connect(transport);
