/**
 * Org Memory — OpenClaw plugin entry point.
 *
 * Requires OpenClaw >= 2026.3.24 (definePluginEntry, focused subpath imports).
 *
 * Registers:
 * - 6 memory tools (read, save, archive, search, team, company)
 * - 1 skill tool (read skill content on demand)
 * - 1 bootstrap hook (skill catalog + memory hints injection)
 *
 * All features are configurable via plugin config.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolvePluginConfig } from "./config.js";
import { resolveAgentCredentials } from "./lib/agent-resolver.js";
import { memoryReadDef, executeMemoryRead } from "./tools/memory-read.js";
import { memorySaveDef, executeMemorySave } from "./tools/memory-save.js";
import { memoryArchiveDef, executeMemoryArchive } from "./tools/memory-archive.js";
import { memorySearchDef, executeMemorySearch } from "./tools/memory-search.js";
import { memoryTeamDef, executeMemoryTeam } from "./tools/memory-team.js";
import { memoryCompanyDef, executeMemoryCompany } from "./tools/memory-company.js";
import { skillReadDef, executeSkillRead } from "./tools/skill-read.js";
import { createBootstrapHook } from "./hooks/bootstrap.js";
import { createCompactionFlushHook } from "./hooks/compaction-flush.js";
import { createAutoCaptureHook } from "./hooks/auto-capture.js";

let hookRegistered = false;

export default definePluginEntry({
  id: "guild",
  name: "Guild",
  description:
    "Supabase-backed organizational memory, skills, and per-agent auth for OpenClaw agents",
  register(api) {
    const pluginConfig = resolvePluginConfig(
      api.pluginConfig as Record<string, unknown> | undefined,
    );
    if (!pluginConfig) {
      api.logger.warn(
        "Guild plugin: missing or invalid config (supabaseUrl, supabaseAnonKey). Plugin disabled.",
      );
      return;
    }

    const cfg = pluginConfig; // capture for closures (TS narrowing)

    function resolveCreds(ctx: { agentId?: string }) {
      const creds = resolveAgentCredentials(ctx.agentId, cfg);
      if (!creds) {
        throw new Error(
          `Agent "${ctx.agentId}" is not configured for Org Memory ` +
          `(add it to plugins.entries.guild.config.agents).`,
        );
      }
      return creds;
    }

    // --- Memory Tools (if enabled) ---

    if (cfg.features.memory) {
      api.registerTool(
        (ctx) => ({
          ...memoryReadDef,
          label: "Read org memories",
          async execute(_id: string, params: any) {
            return executeMemoryRead(resolveCreds(ctx), cfg, params);
          },
        }),
        { names: ["guild_memory_read"] },
      );

      api.registerTool(
        (ctx) => ({
          ...memorySaveDef,
          label: "Save org memory",
          async execute(_id: string, params: any) {
            return executeMemorySave(resolveCreds(ctx), cfg, params);
          },
        }),
        { names: ["guild_memory_save"] },
      );

      api.registerTool(
        (ctx) => ({
          ...memoryArchiveDef,
          label: "Archive org memory",
          async execute(_id: string, params: any) {
            return executeMemoryArchive(resolveCreds(ctx), cfg, params);
          },
        }),
        { names: ["guild_memory_archive"] },
      );

      api.registerTool(
        (ctx) => ({
          ...memorySearchDef,
          label: "Search org memories",
          async execute(_id: string, params: any) {
            return executeMemorySearch(resolveCreds(ctx), cfg, params);
          },
        }),
        { names: ["guild_memory_search"] },
      );

      api.registerTool(
        (ctx) => ({
          ...memoryTeamDef,
          label: "Read team memories",
          async execute(_id: string, params: any) {
            return executeMemoryTeam(resolveCreds(ctx), cfg, params);
          },
        }),
        { names: ["guild_memory_team"] },
      );

      api.registerTool(
        (ctx) => ({
          ...memoryCompanyDef,
          label: "Read company memories",
          async execute(_id: string, params: any) {
            return executeMemoryCompany(resolveCreds(ctx), cfg, params);
          },
        }),
        { names: ["guild_memory_company"] },
      );
    }

    // --- Skill Tool (if enabled) ---

    if (cfg.features.skills) {
      api.registerTool(
        (ctx) => ({
          ...skillReadDef,
          label: "Read guild skill",
          async execute(_id: string, params: any) {
            return executeSkillRead(resolveCreds(ctx), cfg, params);
          },
        }),
        { names: ["guild_skill_read"] },
      );
    }

    // --- Hooks (register once, not per-agent) ---

    if (!hookRegistered) {
      // Bootstrap: inject skill catalog + memory tool reference + onboarding
      // Uses before_prompt_build (plugin hook) instead of agent:bootstrap (internal hook)
      // because internal hooks registered by plugins don't dispatch reliably.
      api.on("before_prompt_build", createBootstrapHook(cfg));

      // Memory flush: save context before compaction
      if (cfg.features.memory) {
        api.on("before_compaction", createCompactionFlushHook(cfg));
      }

      // Auto-capture: detect and save user facts on session end
      if (cfg.features.memory) {
        api.on("agent_end", createAutoCaptureHook(cfg));
      }

      api.logger.info(
        `Guild plugin loaded (${cfg.supabaseUrl})`,
      );
      hookRegistered = true;
    }
  },
});
