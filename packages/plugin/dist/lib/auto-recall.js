// @ts-nocheck — legacy untyped file, works at runtime
/**
 * Auto-recall: inject user/company/role context into the prompt
 * before each agent turn.
 *
 * Uses before_dispatch to cache sender ID per session,
 * then before_agent_start to fetch and inject context.
 */
import { getAgentToken } from "../auth.js";
// Cache sender per session key
const senderCache = new Map();
// Cache company/role memories (rarely change)
const contextCache = new Map();
const CONTEXT_CACHE_TTL = 5 * 60 * 1000; // 5 min
/**
 * before_dispatch handler — cache the sender ID for this session.
 */
export function createDispatchHandler() {
    return (event, ctx) => {
        if (event.senderId && event.sessionKey) {
            senderCache.set(event.sessionKey, {
                senderId: event.senderId,
                channel: event.channel || ctx.channelId,
            });
        }
    };
}
/**
 * before_agent_start handler — fetch and inject context.
 */
export function createRecallHandler(pluginConfig) {
    return async (event, ctx) => {
        // Skip trivial prompts
        if (!event.prompt || event.prompt.length < 5)
            return;
        // Skip heartbeats — they have their own startup instructions
        if (ctx.trigger === "heartbeat" || ctx.trigger === "cron")
            return;
        const agentId = ctx.agentId;
        if (!agentId)
            return;
        const agentCreds = pluginConfig.agents?.[agentId];
        if (!agentCreds)
            return; // Agent not configured for Guild
        let token;
        try {
            token = await getAgentToken({ agentId, platformUuid: agentCreds.uuid, email: agentCreds.email, password: agentCreds.password, legacyJwt: agentCreds.jwt }, pluginConfig);
        }
        catch {
            return; // Auth failed, skip silently
        }
        const url = pluginConfig.supabaseUrl;
        const apikey = pluginConfig.supabaseAnonKey;
        const headers = { "apikey": apikey, "Authorization": `Bearer ${token}` };
        const sections = [];
        try {
            // 1. User context — resolve sender
            const sender = senderCache.get(ctx.sessionKey);
            if (sender?.senderId && sender?.channel) {
                const userContext = await fetchUserContext(url, headers, sender.senderId, sender.channel);
                if (userContext)
                    sections.push(userContext);
            }
            // 2. Company context (cached)
            const companyContext = await fetchCachedContext("company", url, headers, pluginConfig);
            if (companyContext)
                sections.push(companyContext);
            // 3. Role context (cached)
            const roleContext = await fetchRoleContext(url, headers, agentCreds.uuid);
            if (roleContext)
                sections.push(roleContext);
        }
        catch (err) {
            // Don't break the agent if context fetch fails
            return;
        }
        if (sections.length === 0)
            return;
        const context = sections.join("\n\n");
        return { prependContext: context };
    };
}
async function fetchUserContext(url, headers, senderId, channel) {
    // Resolve sender to platform user
    try {
        const idRes = await fetch(`${url}/rest/v1/external_identities?platform=eq.${channel}&platform_user_id=eq.${senderId}&select=user_id,display_name`, { headers });
        if (!idRes.ok)
            return null;
        const ids = await idRes.json();
        if (ids.length === 0)
            return "[User: new — no prior context]";
        const userId = ids[0].user_id;
        const displayName = ids[0].display_name;
        // Fetch user memories (compact: key preferences and context)
        const memRes = await fetch(`${url}/rest/v1/user_memories?user_id=eq.${userId}&select=namespace,key,value&limit=20`, { headers });
        if (!memRes.ok)
            return displayName ? `[User: ${displayName}]` : null;
        const memories = await memRes.json();
        if (memories.length === 0) {
            return displayName ? `[User: ${displayName} — no saved preferences yet]` : null;
        }
        // Format compactly
        const lines = [`[User: ${displayName || "known user"}]`];
        for (const m of memories) {
            const line = `- ${m.key}: ${truncate(m.value, 80)}`;
            lines.push(line);
            if (lines.join("\n").length > 500)
                break; // Budget cap
        }
        return lines.join("\n");
    }
    catch {
        return null;
    }
}
async function fetchCachedContext(type, url, headers, pluginConfig) {
    const cacheKey = `${type}:${pluginConfig.supabaseUrl}`;
    const cached = contextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now())
        return cached.text;
    try {
        const table = type === "company" ? "company_memories" : "role_memories";
        const fetchUrl = `${url}/rest/v1/${table}?status=eq.active&select=namespace,key,value&order=updated_at.desc&limit=15`;
        const res = await fetch(fetchUrl, { headers });
        if (!res.ok) {
            return null;
        }
        const memories = await res.json();
        if (memories.length === 0)
            return null;
        const lines = [`[${type === "company" ? "Company" : "Role"} context]`];
        for (const m of memories) {
            lines.push(`- ${m.key}: ${truncate(m.value, 80)}`);
            if (lines.join("\n").length > 500)
                break;
        }
        const text = lines.join("\n");
        contextCache.set(cacheKey, { text, expiresAt: Date.now() + CONTEXT_CACHE_TTL });
        return text;
    }
    catch {
        return null;
    }
}
async function fetchRoleContext(url, headers, agentUuid) {
    const cacheKey = `role:${agentUuid}`;
    const cached = contextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now())
        return cached.text;
    try {
        const res = await fetch(`${url}/rest/v1/role_memories?status=eq.active&select=namespace,key,value&order=updated_at.desc&limit=10`, { headers });
        if (!res.ok)
            return null;
        const memories = await res.json();
        if (memories.length === 0)
            return null;
        const lines = ["[Role context]"];
        for (const m of memories) {
            lines.push(`- ${m.key}: ${truncate(m.value, 80)}`);
            if (lines.join("\n").length > 300)
                break;
        }
        const text = lines.join("\n");
        contextCache.set(cacheKey, { text, expiresAt: Date.now() + CONTEXT_CACHE_TTL });
        return text;
    }
    catch {
        return null;
    }
}
function truncate(text, maxLen) {
    if (!text || text.length <= maxLen)
        return text;
    return text.slice(0, maxLen - 3) + "...";
}
//# sourceMappingURL=auto-recall.js.map
//# sourceMappingURL=auto-recall.js.map