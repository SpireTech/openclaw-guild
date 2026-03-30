// @ts-nocheck — legacy untyped file, works at runtime
/**
 * Resolve a message sender to a platform user.
 *
 * Looks up external_identities by (platform, platform_user_id).
 * If not found, auto-creates a users record + external identity + default grants.
 */
const userCache = new Map();
/**
 * Resolve sender to platform user_id.
 * Returns { userId, isNew, displayName } or null if no sender info.
 */
export async function resolveUser(ctx, creds, pluginConfig) {
    const senderId = ctx.requesterSenderId;
    const platform = ctx.messageChannel;
    if (!senderId || !platform)
        return null;
    const cacheKey = `${platform}:${senderId}`;
    const cached = userCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached;
    }
    const { getAgentToken } = await import("../auth.js");
    const token = await getAgentToken(creds, pluginConfig);
    const url = pluginConfig.supabaseUrl;
    const apikey = pluginConfig.supabaseAnonKey;
    // Look up external identity
    const lookupRes = await fetch(`${url}/rest/v1/external_identities?platform=eq.${platform}&platform_user_id=eq.${senderId}&select=user_id,display_name`, { headers: { "apikey": apikey, "Authorization": `Bearer ${token}` } });
    if (lookupRes.ok) {
        const rows = await lookupRes.json();
        if (rows.length > 0) {
            const result = {
                userId: rows[0].user_id,
                displayName: rows[0].display_name,
                isNew: false,
                expiresAt: Date.now() + 5 * 60 * 1000, // cache 5 min
            };
            userCache.set(cacheKey, result);
            return result;
        }
    }
    // Not found — auto-create user
    // Need service key for admin operations
    const serviceKey = pluginConfig.supabaseServiceKey;
    if (!serviceKey) {
        // Can't auto-create without service key, return null
        return null;
    }
    // Create auth user first (users table requires auth.users FK)
    const email = `${platform}-${senderId}@guild.local`;
    const password = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
    let userId;
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
            app_metadata: { actor_type: "user", platform, platform_user_id: senderId },
        }),
    });
    if (authRes.ok) {
        const authData = await authRes.json();
        userId = authData.id;
    }
    else {
        // Auth user might already exist
        const listRes = await fetch(`${url}/auth/v1/admin/users`, {
            headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` },
        });
        if (listRes.ok) {
            const listData = await listRes.json();
            const users = listData.users || listData;
            const existing = users.find(u => u.email === email);
            if (existing)
                userId = existing.id;
        }
        if (!userId)
            return null;
    }
    // Create users table record (FK to auth.users)
    const createUserRes = await fetch(`${url}/rest/v1/users`, {
        method: "POST",
        headers: {
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        body: JSON.stringify({
            id: userId,
            email,
            display_name: `${platform} user ${senderId}`,
        }),
    });
    // Create external identity
    await fetch(`${url}/rest/v1/external_identities`, {
        method: "POST",
        headers: {
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            user_id: userId,
            platform,
            platform_user_id: senderId,
            display_name: `${platform} user ${senderId}`,
        }),
    });
    // Create default grants for all configured agents
    const agentIds = Object.values(pluginConfig.agents || {}).map(a => a.uuid).filter(Boolean);
    for (const agentUuid of agentIds) {
        await fetch(`${url}/rest/v1/user_agent_grants`, {
            method: "POST",
            headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
            body: JSON.stringify({
                user_id: userId,
                agent_id: agentUuid,
                can_read: true,
                can_write: true,
            }),
        });
    }
    const result = {
        userId,
        displayName: null,
        isNew: true,
        expiresAt: Date.now() + 5 * 60 * 1000,
    };
    userCache.set(cacheKey, result);
    return result;
}
export function clearUserCache() {
    userCache.clear();
}
//# sourceMappingURL=user-resolver.js.map
//# sourceMappingURL=user-resolver.js.map