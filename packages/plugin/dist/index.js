/**
 * Org Memory — OpenClaw plugin entry point.
 *
 * Requires OpenClaw >= 2026.3.24 (definePluginEntry, focused subpath imports).
 *
 * Registers:
 * - 6 memory tools (read, save, archive, search, team, company)
 * - 2 user memory tools (read, save — per-user memories)
 * - 3 skill tools (list, read, save)
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
import { skillListDef, executeSkillList } from "./tools/skill-list.js";
import { skillSaveDef, executeSkillSave } from "./tools/skill-save.js";
import { userReadDef, executeUserRead } from "./tools/user-read.js";
import { userSaveDef, executeUserSave } from "./tools/user-save.js";
import { resolveUser } from "./lib/user-resolver.js";
import { createBootstrapHook } from "./hooks/bootstrap.js";
import { createCompactionFlushHook } from "./hooks/compaction-flush.js";
import { createAutoCaptureHook } from "./hooks/auto-capture.js";
let hookRegistered = false;
export default definePluginEntry({
    id: "guild",
    name: "Guild",
    description: "Supabase-backed organizational memory, skills, and per-agent auth for OpenClaw agents",
    register(api) {
        const pluginConfig = resolvePluginConfig(api.pluginConfig);
        if (!pluginConfig) {
            api.logger.warn("Guild plugin: missing or invalid config (supabaseUrl, supabaseAnonKey). Plugin disabled.");
            return;
        }
        const cfg = pluginConfig; // capture for closures (TS narrowing)
        function resolveCreds(ctx) {
            const creds = resolveAgentCredentials(ctx.agentId, cfg);
            if (!creds) {
                throw new Error(`Agent "${ctx.agentId}" is not configured for Org Memory ` +
                    `(add it to plugins.entries.guild.config.agents).`);
            }
            return creds;
        }
        // --- Memory Tools (if enabled) ---
        if (cfg.features.memory) {
            api.registerTool((ctx) => ({
                ...memoryReadDef,
                label: "Read org memories",
                async execute(_id, params) {
                    return executeMemoryRead(resolveCreds(ctx), cfg, params);
                },
            }), { names: ["guild_memory_read"] });
            api.registerTool((ctx) => ({
                ...memorySaveDef,
                label: "Save org memory",
                async execute(_id, params) {
                    return executeMemorySave(resolveCreds(ctx), cfg, params);
                },
            }), { names: ["guild_memory_save"] });
            api.registerTool((ctx) => ({
                ...memoryArchiveDef,
                label: "Archive org memory",
                async execute(_id, params) {
                    return executeMemoryArchive(resolveCreds(ctx), cfg, params);
                },
            }), { names: ["guild_memory_archive"] });
            api.registerTool((ctx) => ({
                ...memorySearchDef,
                label: "Search org memories",
                async execute(_id, params) {
                    return executeMemorySearch(resolveCreds(ctx), cfg, params);
                },
            }), { names: ["guild_memory_search"] });
            api.registerTool((ctx) => ({
                ...memoryTeamDef,
                label: "Read team memories",
                async execute(_id, params) {
                    return executeMemoryTeam(resolveCreds(ctx), cfg, params);
                },
            }), { names: ["guild_memory_team"] });
            api.registerTool((ctx) => ({
                ...memoryCompanyDef,
                label: "Read company memories",
                async execute(_id, params) {
                    return executeMemoryCompany(resolveCreds(ctx), cfg, params);
                },
            }), { names: ["guild_memory_company"] });
            // --- User Memory Tools ---
            api.registerTool((ctx) => ({
                ...userReadDef,
                label: "Read user memories",
                async execute(_id, params) {
                    const creds = resolveCreds(ctx);
                    const user = await resolveUser(ctx, creds, cfg);
                    return executeUserRead(creds, cfg, params, user?.userId);
                },
            }), { names: ["guild_user_read"] });
            api.registerTool((ctx) => ({
                ...userSaveDef,
                label: "Save user memory",
                async execute(_id, params) {
                    const creds = resolveCreds(ctx);
                    const user = await resolveUser(ctx, creds, cfg);
                    return executeUserSave(creds, cfg, params, user?.userId, creds.platformUuid);
                },
            }), { names: ["guild_user_save"] });
        }
        // --- Skill Tools (if enabled) ---
        if (cfg.features.skills) {
            api.registerTool((ctx) => ({
                ...skillReadDef,
                label: "Read guild skill",
                async execute(_id, params) {
                    return executeSkillRead(resolveCreds(ctx), cfg, params);
                },
            }), { names: ["guild_skill_read"] });
            api.registerTool((ctx) => ({
                ...skillListDef,
                label: "List guild skills",
                async execute(_id, _params) {
                    return executeSkillList(resolveCreds(ctx), cfg);
                },
            }), { names: ["guild_skill_list"] });
            api.registerTool((ctx) => ({
                ...skillSaveDef,
                label: "Save guild skill",
                async execute(_id, params) {
                    return executeSkillSave(resolveCreds(ctx), cfg, params);
                },
            }), { names: ["guild_skill_save"] });
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
            api.logger.info(`Guild plugin loaded (${cfg.supabaseUrl})`);
            hookRegistered = true;
        }
    },
});
//# sourceMappingURL=index.js.map