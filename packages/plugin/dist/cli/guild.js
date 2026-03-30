/**
 * CLI commands for the Guild plugin.
 * Registered via api.registerCli() — available as `openclaw guild <command>`.
 */
import { resolvePluginConfig } from "../config.js";
import { resolveAgentCredentials } from "../lib/agent-resolver.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Register all CLI subcommands under `guild`.
 */
export function registerGuildCli(pluginConfig) {
    return ({ program, config, logger }) => {
        const cmd = program
            .command("guild")
            .description("Manage Guild platform (Supabase-backed memory & skills)");

        // --- provision-agent ---
        cmd.command("provision-agent <agent-id>")
            .description("Provision an agent for the Guild platform")
            .option("--all", "Provision all agents that are not yet configured")
            .action(async (agentId, opts) => {
                if (opts.all) {
                    await provisionAll(config, pluginConfig, logger);
                } else {
                    await provisionAgent(agentId, config, pluginConfig, logger);
                }
            });

        // --- doctor ---
        cmd.command("doctor")
            .description("Check Guild connectivity, schema, and agent config")
            .action(async () => {
                await doctor(config, pluginConfig, logger);
            });

        // --- status ---
        cmd.command("status")
            .description("Show Guild plugin status and configured agents")
            .action(async () => {
                await status(config, pluginConfig, logger);
            });

        // --- migrate ---
        cmd.command("migrate <agent-id>")
            .description("Migrate an agent's file-based memory (MEMORY.md) to the platform")
            .option("--all", "Migrate all configured agents")
            .option("--dry-run", "Show what would be migrated without writing")
            .action(async (agentId, opts) => {
                if (opts.all) {
                    const configured = Object.keys(pluginConfig.agents || {});
                    for (const id of configured) {
                        const agentEntry = (config.agents?.list || []).find(a => a.id === id);
                        if (agentEntry?.workspace) {
                            await migrateAgent(id, agentEntry.workspace, config, pluginConfig, logger, opts.dryRun);
                        }
                    }
                } else {
                    const agentEntry = (config.agents?.list || []).find(a => a.id === agentId);
                    if (!agentEntry?.workspace) {
                        console.error(`Agent "${agentId}" not found in agents.list or has no workspace.`);
                        return;
                    }
                    await migrateAgent(agentId, agentEntry.workspace, config, pluginConfig, logger, opts.dryRun);
                }
            });

        // --- setup ---
        cmd.command("setup")
            .description("Interactive setup: detect Supabase, run migrations, configure plugin + memory slot")
            .action(async () => {
                await setup(config, pluginConfig, logger);
            });

        // --- link-user ---
        cmd.command("link-user")
            .description("Link an external identity (Discord, Teams, etc.) to a platform user")
            .requiredOption("--platform <platform>", "Platform name (discord, msteams, slack, etc.)")
            .requiredOption("--platform-id <id>", "User ID on that platform")
            .option("--user-id <uuid>", "Existing platform user UUID to link to")
            .option("--name <name>", "Display name")
            .option("--email <email>", "Email for new user (if creating)")
            .action(async (opts) => {
                await linkUser(opts, config, pluginConfig, logger);
            });
    };
}

/**
 * Resolve the Supabase URL for host-side CLI usage.
 * Replaces host.docker.internal with localhost since the CLI runs on the host, not in Docker.
 */
function resolveUrl(pluginConfig) {
    return pluginConfig.supabaseUrl.replace("host.docker.internal", "localhost");
}

async function supabaseFetch(url, opts, pluginConfig) {
    const res = await fetch(url, {
        ...opts,
        headers: {
            "apikey": pluginConfig.supabaseAnonKey,
            "Content-Type": "application/json",
            ...opts.headers,
        },
    });
    return res;
}

async function getServiceKey(pluginConfig) {
    // Check plugin config first, then env
    const key = pluginConfig.supabaseServiceKey
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY;
    if (!key) {
        throw new Error(
            "Service role key required for admin operations.\n" +
            "Set plugins.entries.guild.config.supabaseServiceKey in openclaw.json\n" +
            "or export SUPABASE_SERVICE_ROLE_KEY in your environment."
        );
    }
    return key;
}

async function getOwnerUserId(pluginConfig, serviceKey) {
    const url = `${resolveUrl(pluginConfig)}/rest/v1/users?select=id&limit=1`;
    const res = await fetch(url, {
        headers: {
            "apikey": pluginConfig.supabaseAnonKey,
            "Authorization": `Bearer ${serviceKey}`,
        },
    });
    if (!res.ok) throw new Error(`Failed to fetch owner user: ${res.status}`);
    const users = await res.json();
    if (!users.length) throw new Error("No users found in the platform. Run setup first.");
    return users[0].id;
}

async function provisionAgent(agentId, config, pluginConfig, logger) {
    console.log(`\nProvisioning agent: ${agentId}`);

    // Check if already configured
    const existing = pluginConfig.agents?.[agentId];
    if (existing) {
        console.log(`  Agent "${agentId}" already has credentials in plugin config.`);
        console.log(`  UUID: ${existing.uuid}`);
        console.log(`  Auth: ${existing.email ? "session (email/password)" : existing.jwt ? "JWT" : "none"}`);
        return;
    }

    const serviceKey = await getServiceKey(pluginConfig);
    const ownerId = await getOwnerUserId(pluginConfig, serviceKey);

    // Step 1: Check if agent already exists in Supabase
    const checkUrl = `${resolveUrl(pluginConfig)}/rest/v1/agents?name=eq.${agentId}&select=id`;
    const checkRes = await fetch(checkUrl, {
        headers: {
            "apikey": pluginConfig.supabaseAnonKey,
            "Authorization": `Bearer ${serviceKey}`,
        },
    });
    const existingAgents = await checkRes.json();

    let agentUuid;
    if (existingAgents.length > 0) {
        agentUuid = existingAgents[0].id;
        console.log(`  Agent record already exists in Supabase: ${agentUuid}`);
    } else {
        // Create agent record
        const createUrl = `${resolveUrl(pluginConfig)}/rest/v1/agents`;
        const createRes = await fetch(createUrl, {
            method: "POST",
            headers: {
                "apikey": pluginConfig.supabaseAnonKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            body: JSON.stringify({
                name: agentId,
                display_name: agentId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
                owner_id: ownerId,
                platform: "openclaw",
                status: "active",
                config: {},
            }),
        });
        if (!createRes.ok) {
            const body = await createRes.text();
            throw new Error(`Failed to create agent record: ${createRes.status} ${body}`);
        }
        const agent = (await createRes.json())[0] || await createRes.json();
        agentUuid = agent.id;
        console.log(`  Created agent record: ${agentUuid}`);
    }

    // Step 2: Create auth account
    const email = `agent-${agentId}@platform.local`;
    const password = Array.from(
        { length: 32 },
        () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
    ).join("");

    const authUrl = `${resolveUrl(pluginConfig)}/auth/v1/admin/users`;
    const authRes = await fetch(authUrl, {
        method: "POST",
        headers: {
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            app_metadata: {
                actor_type: "agent",
                agent_id: agentUuid,
                agent_name: agentId,
            },
        }),
    });

    if (!authRes.ok) {
        const body = await authRes.text();
        // Check if user already exists — reset password instead
        if (body.includes("already been registered") || body.includes("already exists")) {
            console.log(`  Auth account already exists: ${email}`);
            // Find the auth user and reset password
            const listUrl = `${resolveUrl(pluginConfig)}/auth/v1/admin/users`;
            const listRes = await fetch(listUrl, {
                headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` },
            });
            if (listRes.ok) {
                const listData = await listRes.json();
                const users = listData.users || listData;
                const authUser = users.find(u => u.email === email);
                if (authUser) {
                    const updateUrl = `${resolveUrl(pluginConfig)}/auth/v1/admin/users/${authUser.id}`;
                    const updateRes = await fetch(updateUrl, {
                        method: "PUT",
                        headers: {
                            "apikey": serviceKey,
                            "Authorization": `Bearer ${serviceKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ password }),
                    });
                    if (updateRes.ok) {
                        console.log(`  Reset password for existing auth account`);
                        await addToOpenclawConfig(agentId, agentUuid, email, password, config, pluginConfig, logger);
                        console.log(`\n✓ Agent "${agentId}" provisioned successfully (existing auth account, password reset).`);
                        console.log(`  UUID: ${agentUuid}`);
                        console.log(`  Email: ${email}`);
                        console.log(`  Restart the gateway to apply: docker compose restart openclaw-gateway\n`);
                        return;
                    }
                }
            }
            console.log(`  ⚠️  Could not reset password. Adding credentials with UUID only.`);
            await addToOpenclawConfig(agentId, agentUuid, null, null, config, pluginConfig, logger);
            return;
        }
        throw new Error(`Failed to create auth account: ${authRes.status} ${body}`);
    }

    console.log(`  Created auth account: ${email}`);

    // Step 3: Create user-agent grant
    const grantUrl = `${resolveUrl(pluginConfig)}/rest/v1/user_agent_grants`;
    await fetch(grantUrl, {
        method: "POST",
        headers: {
            "apikey": pluginConfig.supabaseAnonKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            user_id: ownerId,
            agent_id: agentUuid,
            can_read: true,
            can_write: true,
        }),
    });
    console.log(`  Created owner memory grant`);

    // Step 4: Add to openclaw.json
    await addToOpenclawConfig(agentId, agentUuid, email, password, config, pluginConfig, logger);

    console.log(`\n✓ Agent "${agentId}" provisioned successfully.`);
    console.log(`  UUID: ${agentUuid}`);
    console.log(`  Email: ${email}`);
    console.log(`  Restart the gateway to apply: docker compose restart openclaw-gateway\n`);
}

async function addToOpenclawConfig(agentId, uuid, email, password, config, pluginConfig, logger) {
    // Read and modify openclaw.json
    const configPath = path.join(process.env.HOME || "~", ".openclaw", "openclaw.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw);

    // Add agent credentials to plugin config
    const agents = cfg.plugins.entries["guild"].config.agents;
    if (!agents[agentId]) {
        agents[agentId] = { uuid };
        if (email && password) {
            agents[agentId].email = email;
            agents[agentId].password = password;
        }
        console.log(`  Added credentials to plugin config`);
    }

    // Add org tools to agent's tool allow list
    const orgTools = [
        "guild_memory_read", "guild_memory_save", "guild_memory_archive",
        "guild_memory_search", "guild_memory_team", "guild_memory_company",
        "guild_skill_read", "guild_skill_list",
    ];
    const agentEntry = cfg.agents?.list?.find(a => a.id === agentId);
    if (agentEntry) {
        const allow = agentEntry.tools?.sandbox?.tools?.allow;
        if (Array.isArray(allow)) {
            let added = 0;
            for (const tool of orgTools) {
                if (!allow.includes(tool)) {
                    allow.push(tool);
                    added++;
                }
            }
            if (added > 0) console.log(`  Added ${added} org tools to allow list`);
        }
    }

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`  Updated openclaw.json`);
}

async function provisionAll(config, pluginConfig, logger) {
    console.log("\nProvisioning all unconfigured agents...\n");
    const agentList = config.agents?.list || [];
    const configured = new Set(Object.keys(pluginConfig.agents || {}));
    const unconfigured = agentList
        .map(a => a.id)
        .filter(id => !configured.has(id));

    if (unconfigured.length === 0) {
        console.log("All agents are already configured.");
        return;
    }

    console.log(`Found ${unconfigured.length} unconfigured agent(s): ${unconfigured.join(", ")}\n`);
    for (const agentId of unconfigured) {
        try {
            await provisionAgent(agentId, config, pluginConfig, logger);
        } catch (err) {
            console.error(`  ✗ Failed to provision "${agentId}": ${err.message}`);
        }
    }
}

async function doctor(config, pluginConfig, logger) {
    console.log("\nGuild Doctor\n");

    // Check Supabase connectivity
    const url = resolveUrl(pluginConfig);
    console.log(`Supabase URL: ${url}`);
    try {
        const res = await fetch(`${url}/rest/v1/`, {
            headers: { "apikey": pluginConfig.supabaseAnonKey },
        });
        console.log(`  Connectivity: ${res.ok ? "✓ OK" : "✗ FAILED (" + res.status + ")"}`);
    } catch (err) {
        console.log(`  Connectivity: ✗ FAILED (${err.message})`);
    }

    // Check agents table
    try {
        const res = await fetch(`${url}/rest/v1/agents?select=id,name,status&limit=100`, {
            headers: {
                "apikey": pluginConfig.supabaseAnonKey,
                "Authorization": `Bearer ${pluginConfig.supabaseAnonKey}`,
            },
        });
        if (res.ok) {
            const agents = await res.json();
            console.log(`  Agents table: ✓ ${agents.length} agent(s)`);
        } else {
            console.log(`  Agents table: ✗ ${res.status}`);
        }
    } catch (err) {
        console.log(`  Agents table: ✗ ${err.message}`);
    }

    // Check configured agents
    const configuredAgents = Object.keys(pluginConfig.agents || {});
    const openclawAgents = (config.agents?.list || []).map(a => a.id);
    console.log(`\nConfigured agents (${configuredAgents.length}):`);
    for (const id of configuredAgents) {
        const creds = pluginConfig.agents[id];
        const inOpenClaw = openclawAgents.includes(id);
        const authType = creds.email ? "session" : creds.jwt ? "jwt" : "none";
        console.log(`  ${id}: uuid=${creds.uuid?.slice(0, 8)}... auth=${authType} ${inOpenClaw ? "✓" : "⚠ not in agents.list"}`);
    }

    // Show unconfigured
    const unconfigured = openclawAgents.filter(id => !configuredAgents.includes(id));
    if (unconfigured.length > 0) {
        console.log(`\nUnconfigured agents (${unconfigured.length}): ${unconfigured.join(", ")}`);
        console.log(`  Run: openclaw guild provision-agent --all`);
    }

    // Check features
    console.log(`\nFeatures:`);
    console.log(`  Memory: ${pluginConfig.features?.memory !== false ? "✓ enabled" : "✗ disabled"}`);
    console.log(`  Skills: ${pluginConfig.features?.skills !== false ? "✓ enabled" : "✗ disabled"}`);

    // Check memory slot
    const memorySlot = config.plugins?.slots?.memory;
    console.log(`\nMemory slot: ${memorySlot || "default (memory-core)"}`);
    if (memorySlot === "guild") {
        console.log(`  ✓ Guild owns the memory slot`);
    } else {
        console.log(`  ⚠ Guild does not own the memory slot. Set plugins.slots.memory: "guild"`);
    }

    console.log("");
}

async function status(config, pluginConfig, logger) {
    console.log("\nGuild Status\n");
    console.log(`Plugin ID: guild`);
    console.log(`Supabase: ${resolveUrl(pluginConfig)}`);
    console.log(`Memory slot: ${config.plugins?.slots?.memory === "guild" ? "✓ active" : "⚠ not active"}`);
    console.log(`Memory: ${pluginConfig.features?.memory !== false ? "enabled" : "disabled"}`);
    console.log(`Skills: ${pluginConfig.features?.skills !== false ? "enabled" : "disabled"}`);

    const agents = Object.entries(pluginConfig.agents || {});
    console.log(`\nAgents (${agents.length}):`);
    for (const [id, creds] of agents) {
        const authType = creds.email ? "session" : creds.jwt ? "jwt" : "none";
        console.log(`  ${id} — ${authType} auth, uuid: ${creds.uuid?.slice(0, 8)}...`);
    }
    console.log("");
}

async function migrateAgent(agentId, workspaceDir, config, pluginConfig, logger, dryRun) {
    console.log(`\n${dryRun ? "[DRY RUN] " : ""}Migrating memory for: ${agentId}`);
    console.log(`  Workspace: ${workspaceDir}`);

    // Check agent has credentials
    const agentCreds = pluginConfig.agents?.[agentId];
    if (!agentCreds) {
        console.log(`  ✗ Agent "${agentId}" not configured. Run: openclaw guild provision-agent ${agentId}`);
        return;
    }

    const url = resolveUrl(pluginConfig);

    // Authenticate as agent
    let token;
    if (agentCreds.email && agentCreds.password) {
        try {
            const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
                method: "POST",
                headers: {
                    "apikey": pluginConfig.supabaseAnonKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email: agentCreds.email, password: agentCreds.password }),
            });
            if (!authRes.ok) throw new Error(`Auth failed: ${authRes.status}`);
            const authData = await authRes.json();
            token = authData.access_token;
        } catch (err) {
            console.log(`  ✗ Auth failed: ${err.message}`);
            return;
        }
    } else if (agentCreds.jwt) {
        token = agentCreds.jwt;
    } else {
        console.log(`  ✗ No auth credentials for agent "${agentId}"`);
        return;
    }

    // Check for existing memories
    const existingRes = await fetch(
        `${url}/rest/v1/agent_memories?agent_id=eq.${agentCreds.uuid}&status=eq.active&select=namespace,key&limit=500`,
        { headers: { "apikey": pluginConfig.supabaseAnonKey, "Authorization": `Bearer ${token}` } }
    );
    const existing = existingRes.ok ? await existingRes.json() : [];
    const existingKeys = new Set(existing.map(m => `${m.namespace}:${m.key}`));
    console.log(`  Existing memories in platform: ${existing.length}`);

    // Find MEMORY.md files in workspace (check both root and agent subdirs)
    const memoryFiles = [];
    const candidates = [
        path.join(workspaceDir, "MEMORY.md"),
        path.join(workspaceDir, "memory.md"),
    ];

    // Also check agent subdirectories (e.g. workspace-marketing/lead/MEMORY.md)
    try {
        const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                candidates.push(path.join(workspaceDir, entry.name, "MEMORY.md"));
                candidates.push(path.join(workspaceDir, entry.name, "memory.md"));
            }
        }
    } catch {}

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            memoryFiles.push(candidate);
        }
    }

    // Also check for memory/*.md session files
    const memoryDir = path.join(workspaceDir, "memory");
    let sessionFiles = [];
    if (fs.existsSync(memoryDir)) {
        sessionFiles = fs.readdirSync(memoryDir)
            .filter(f => f.endsWith(".md"))
            .map(f => path.join(memoryDir, f));
    }

    if (memoryFiles.length === 0 && sessionFiles.length === 0) {
        console.log(`  No MEMORY.md or memory/*.md files found. Nothing to migrate.`);
        return;
    }

    console.log(`  Found: ${memoryFiles.length} MEMORY.md file(s), ${sessionFiles.length} session transcript(s)`);

    // Parse and import MEMORY.md files
    let imported = 0;
    let skipped = 0;
    for (const memFile of memoryFiles) {
        const content = fs.readFileSync(memFile, "utf-8").trim();

        // Skip stub files (already migrated)
        if (content.includes("Memory has moved") || content.includes("Do NOT write to this file")) {
            console.log(`  Skipping ${path.relative(workspaceDir, memFile)} (already migrated stub)`);
            skipped++;
            continue;
        }

        // Skip empty files
        if (!content || content.length < 10) {
            continue;
        }

        // Parse structured entries from MEMORY.md
        // Common formats:
        // ## Section Name
        // - **key**: value
        // - key: value
        // Or markdown sections as namespaces
        const entries = parseMemoryMd(content, memFile, workspaceDir);
        console.log(`  Parsed ${entries.length} entries from ${path.relative(workspaceDir, memFile)}`);

        for (const entry of entries) {
            const key = `${entry.namespace}:${entry.key}`;
            if (existingKeys.has(key)) {
                skipped++;
                continue;
            }

            if (dryRun) {
                console.log(`    [DRY RUN] Would save: ${entry.namespace}/${entry.key} (${entry.value.length} chars)`);
                imported++;
                continue;
            }

            // Upsert via REST API
            const saveRes = await fetch(`${url}/rest/v1/agent_memories`, {
                method: "POST",
                headers: {
                    "apikey": pluginConfig.supabaseAnonKey,
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates",
                },
                body: JSON.stringify({
                    agent_id: agentCreds.uuid,
                    namespace: entry.namespace,
                    key: entry.key,
                    value: entry.value,
                    source: "migrated",
                    tags: ["migrated"],
                    status: "active",
                }),
            });

            if (saveRes.ok) {
                imported++;
                existingKeys.add(key);
            } else {
                const body = await saveRes.text();
                console.log(`    ✗ Failed to save ${key}: ${saveRes.status} ${body}`);
            }
        }
    }

    // Report on session transcripts
    if (sessionFiles.length > 0) {
        console.log(`\n  Session transcripts (${sessionFiles.length} files in memory/):`);
        console.log(`  These are conversation logs saved by OpenClaw's session-memory hook.`);
        console.log(`  They are NOT migrated — they continue to be saved automatically.`);
        console.log(`  To review: ls ${memoryDir}/`);
    }

    console.log(`\n  ${dryRun ? "[DRY RUN] " : ""}Results: ${imported} imported, ${skipped} skipped (already exist or stub)`);
}

/**
 * Parse MEMORY.md content into namespace/key/value entries.
 * Handles common OpenClaw MEMORY.md formats:
 * - ## Section headers become namespaces
 * - Bullet items become key/value entries
 * - Freeform text under a section becomes a single entry
 */
function parseMemoryMd(content, filePath, workspaceDir) {
    const entries = [];
    const lines = content.split("\n");
    let currentNamespace = "context";
    let currentSection = [];
    let sectionTitle = null;

    // Determine a prefix from the file path (e.g., "lead" from workspace-marketing/lead/MEMORY.md)
    const relPath = path.relative(workspaceDir, filePath);
    const parts = relPath.split(path.sep);
    const prefix = parts.length > 1 ? parts[0] : "";

    for (const line of lines) {
        // ## Section header → new namespace
        const h2Match = line.match(/^##\s+(.+)/);
        if (h2Match) {
            // Flush previous section
            if (sectionTitle && currentSection.length > 0) {
                const key = slugify(sectionTitle);
                entries.push({
                    namespace: currentNamespace,
                    key: prefix ? `${prefix}-${key}` : key,
                    value: currentSection.join("\n").trim(),
                });
            }
            currentSection = [];
            sectionTitle = h2Match[1].trim();

            // Map common section names to namespaces
            const lower = sectionTitle.toLowerCase();
            if (lower.includes("todo") || lower.includes("task")) currentNamespace = "todo";
            else if (lower.includes("lesson") || lower.includes("learned")) currentNamespace = "lessons";
            else if (lower.includes("decision")) currentNamespace = "decisions";
            else if (lower.includes("observation")) currentNamespace = "observations";
            else if (lower.includes("note")) currentNamespace = "notes";
            else currentNamespace = "context";
            continue;
        }

        // # Top-level header → skip (title)
        if (line.match(/^#\s+/)) continue;

        // Collect content under current section
        if (line.trim()) {
            currentSection.push(line);
        }
    }

    // Flush final section
    if (sectionTitle && currentSection.length > 0) {
        const key = slugify(sectionTitle);
        entries.push({
            namespace: currentNamespace,
            key: prefix ? `${prefix}-${key}` : key,
            value: currentSection.join("\n").trim(),
        });
    }

    // If no sections found, save the whole file as one entry
    if (entries.length === 0 && content.trim().length > 10) {
        const key = prefix ? `${prefix}-memory-md` : "memory-md";
        entries.push({
            namespace: "context",
            key,
            value: content.trim(),
        });
    }

    return entries;
}

function slugify(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);
}

async function setup(config, pluginConfig, logger) {
    console.log("\nOpenClaw Guild Setup\n");

    const configPath = path.join(process.env.HOME || "~", ".openclaw", "openclaw.json");

    // Step 1: Detect Supabase
    console.log("Step 1: Detecting Supabase...");
    const supabaseUrl = pluginConfig?.supabaseUrl
        ? resolveUrl(pluginConfig)
        : "http://localhost:54321";

    let supabaseOk = false;
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/`, {
            headers: { "apikey": pluginConfig?.supabaseAnonKey || "test" },
        });
        supabaseOk = res.ok || res.status === 401;
        console.log(`  ${supabaseOk ? "✓" : "✗"} Supabase at ${supabaseUrl}`);
    } catch (err) {
        console.log(`  ✗ Cannot reach Supabase at ${supabaseUrl}`);
        console.log(`  Make sure Supabase is running: npx supabase start`);
        return;
    }

    // Step 2: Get Supabase keys
    let anonKey = pluginConfig?.supabaseAnonKey;
    let serviceKey = pluginConfig?.supabaseServiceKey;

    if (!anonKey) {
        console.log("\nStep 2: Detecting Supabase keys...");
        try {
            const { execSync } = await import("node:child_process");
            const statusJson = execSync("npx supabase status --output json 2>/dev/null", { encoding: "utf-8" });
            const status = JSON.parse(statusJson);
            anonKey = status.ANON_KEY;
            serviceKey = status.SERVICE_ROLE_KEY;
            console.log(`  ✓ Detected keys from supabase status`);
        } catch {
            console.log(`  ✗ Could not detect keys. Set supabaseAnonKey in plugin config.`);
            return;
        }
    } else {
        console.log("\nStep 2: Using configured Supabase keys ✓");
    }

    // Step 3: Check schema
    console.log("\nStep 3: Checking database schema...");
    const migrationsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "migrations");
    if (fs.existsSync(migrationsDir)) {
        const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
        console.log(`  Found ${migrationFiles.length} migration files in ${migrationsDir}`);
        try {
            const checkRes = await fetch(`${supabaseUrl}/rest/v1/agents?select=id&limit=1`, {
                headers: { "apikey": serviceKey || anonKey, "Authorization": `Bearer ${serviceKey || anonKey}` },
            });
            if (checkRes.ok) {
                console.log(`  ✓ Schema exists (agents table accessible)`);
            } else {
                console.log(`  Schema may need migration. Run: npx supabase db push`);
                console.log(`  Or apply manually from: ${migrationsDir}/`);
            }
        } catch {
            console.log(`  ⚠ Could not check schema status`);
        }
    } else {
        console.log(`  ⚠ Migrations not found at ${migrationsDir}`);
    }

    // Step 4: Configure openclaw.json
    console.log("\nStep 4: Configuring openclaw.json...");
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    let changed = false;

    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins.entries) cfg.plugins.entries = {};
    if (!cfg.plugins.load) cfg.plugins.load = {};
    if (!cfg.plugins.slots) cfg.plugins.slots = {};

    // Memory slot
    if (cfg.plugins.slots.memory !== "guild") {
        cfg.plugins.slots.memory = "guild";
        console.log(`  Set plugins.slots.memory = "guild"`);
        changed = true;
    } else {
        console.log(`  ✓ Memory slot already set`);
    }

    // Load path
    const loadPaths = cfg.plugins.load.paths || [];
    if (!loadPaths.some(p => p.includes("guild"))) {
        const pluginPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
        loadPaths.push(pluginPath);
        cfg.plugins.load.paths = loadPaths;
        console.log(`  Added plugin to load paths`);
        changed = true;
    } else {
        console.log(`  ✓ Plugin already in load paths`);
    }

    // Plugin entry
    if (!cfg.plugins.entries.guild) {
        const dockerUrl = supabaseUrl.replace("localhost", "host.docker.internal");
        cfg.plugins.entries.guild = {
            enabled: true,
            config: {
                supabaseUrl: dockerUrl,
                supabaseAnonKey: anonKey,
                supabaseServiceKey: serviceKey || undefined,
                agents: {},
                features: { memory: true, skills: true },
            },
        };
        console.log(`  Created plugin entry`);
        changed = true;
    } else {
        console.log(`  ✓ Plugin entry exists`);
    }

    if (changed) {
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
        console.log(`  Wrote openclaw.json`);
    }

    // Summary
    const agentList = cfg.agents?.list || [];
    const configured = Object.keys(cfg.plugins.entries.guild?.config?.agents || {});
    const unconfigured = agentList.map(a => a.id).filter(id => !configured.includes(id));

    console.log("\n✓ Guild setup complete!\n");
    console.log("Next steps:");
    if (unconfigured.length > 0) {
        console.log(`  1. Provision agents: openclaw guild provision-agent dummy --all`);
        console.log(`  2. Restart gateway: docker compose restart openclaw-gateway`);
        console.log(`  3. Verify: openclaw guild doctor`);
    } else {
        console.log(`  1. Restart gateway: docker compose restart openclaw-gateway`);
        console.log(`  2. Verify: openclaw guild doctor`);
    }
    console.log("");
}

async function linkUser(opts, config, pluginConfig, logger) {
    console.log(`\nLinking ${opts.platform} user ${opts.platformId}...\n`);

    const url = resolveUrl(pluginConfig);
    const serviceKey = await getServiceKey(pluginConfig);

    // Check if this external identity already exists
    const checkRes = await fetch(
        `${url}/rest/v1/external_identities?platform=eq.${opts.platform}&platform_user_id=eq.${opts.platformId}&select=user_id,display_name`,
        { headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` } }
    );
    const existing = checkRes.ok ? await checkRes.json() : [];

    if (existing.length > 0 && !opts.userId) {
        console.log(`  Already linked to user ${existing[0].user_id} (${existing[0].display_name || "no name"})`);
        console.log(`  Use --user-id to relink to a different user.`);
        return;
    }

    let targetUserId = opts.userId;

    if (!targetUserId) {
        // Create a new platform user
        const email = opts.email || `${opts.platform}-${opts.platformId}@guild.local`;
        const displayName = opts.name || `${opts.platform} user ${opts.platformId}`;
        const password = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");

        // Create auth user
        const authRes = await fetch(`${url}/auth/v1/admin/users`, {
            method: "POST",
            headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email,
                password,
                email_confirm: true,
                app_metadata: { actor_type: "user" },
            }),
        });

        if (authRes.ok) {
            const authData = await authRes.json();
            targetUserId = authData.id;
            console.log(`  Created auth user: ${email}`);
        } else {
            const body = await authRes.text();
            if (body.includes("already") || body.includes("registered")) {
                // Find existing
                const listRes = await fetch(`${url}/auth/v1/admin/users`, {
                    headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` },
                });
                if (listRes.ok) {
                    const data = await listRes.json();
                    const users = data.users || data;
                    const found = users.find(u => u.email === email);
                    if (found) targetUserId = found.id;
                }
            }
            if (!targetUserId) {
                console.error(`  Failed to create auth user: ${body}`);
                return;
            }
            console.log(`  Auth user already exists: ${targetUserId}`);
        }

        // Create users table record
        await fetch(`${url}/rest/v1/users`, {
            method: "POST",
            headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
            body: JSON.stringify({
                id: targetUserId,
                email,
                display_name: displayName,
            }),
        });
        console.log(`  Created platform user: ${displayName}`);
    }

    // Create or update external identity
    if (existing.length > 0) {
        await fetch(
            `${url}/rest/v1/external_identities?platform=eq.${opts.platform}&platform_user_id=eq.${opts.platformId}`,
            {
                method: "PATCH",
                headers: {
                    "apikey": serviceKey,
                    "Authorization": `Bearer ${serviceKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    user_id: targetUserId,
                    display_name: opts.name || existing[0].display_name,
                }),
            }
        );
        console.log(`  Updated external identity link`);
    } else {
        await fetch(`${url}/rest/v1/external_identities`, {
            method: "POST",
            headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                user_id: targetUserId,
                platform: opts.platform,
                platform_user_id: opts.platformId,
                display_name: opts.name || null,
            }),
        });
        console.log(`  Created external identity link`);
    }

    // Create default grants for all configured agents
    const agentUuids = Object.values(pluginConfig.agents || {}).map(a => a.uuid).filter(Boolean);
    let grantCount = 0;
    for (const agentUuid of agentUuids) {
        const grantRes = await fetch(`${url}/rest/v1/user_agent_grants`, {
            method: "POST",
            headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
            body: JSON.stringify({
                user_id: targetUserId,
                agent_id: agentUuid,
                can_read: true,
                can_write: true,
            }),
        });
        if (grantRes.ok || grantRes.status === 201 || grantRes.status === 409) grantCount++;
    }
    console.log(`  Created ${grantCount} agent grants`);

    console.log(`\n✓ Linked ${opts.platform}:${opts.platformId} → user ${targetUserId}`);
    if (opts.name) console.log(`  Display name: ${opts.name}`);
    console.log("");
}
//# sourceMappingURL=guild.js.map
