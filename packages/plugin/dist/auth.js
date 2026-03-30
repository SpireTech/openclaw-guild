/**
 * Per-agent Supabase authentication manager.
 *
 * Supports two auth modes:
 * 1. Session-based: email/password → JWT (preferred, auto-refresh)
 * 2. Legacy JWT: static PLATFORM_JWT token (fallback)
 *
 * RLS enforces data isolation at the database level.
 */
const sessionCache = new Map();
/**
 * Get a valid access token for the given agent.
 * Tries session auth first, falls back to legacy JWT.
 */
export async function getAgentToken(creds, pluginConfig) {
    const cacheKey = creds.agentId;
    const cached = sessionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
        return cached.accessToken;
    }
    // Try refresh if we have a refresh token
    if (cached?.refreshToken) {
        const refreshed = await tryRefresh(cached.refreshToken, pluginConfig);
        if (refreshed) {
            sessionCache.set(cacheKey, refreshed);
            return refreshed.accessToken;
        }
    }
    // Try session-based auth (email/password)
    if (creds.email && creds.password) {
        try {
            const session = await signIn(creds, pluginConfig);
            sessionCache.set(cacheKey, session);
            return session.accessToken;
        }
        catch {
            // Fall through to legacy JWT
        }
    }
    // Fall back to legacy JWT
    if (creds.legacyJwt) {
        const session = {
            accessToken: creds.legacyJwt,
            refreshToken: null,
            expiresAt: Infinity, // Static JWTs have long expiry built-in
        };
        sessionCache.set(cacheKey, session);
        return session.accessToken;
    }
    throw new Error(`No valid auth method for agent "${creds.agentId}". ` +
        `Need PLATFORM_AGENT_EMAIL + PLATFORM_AGENT_AUTH, or PLATFORM_JWT.`);
}
async function signIn(creds, config) {
    const url = `${config.supabaseUrl}/auth/v1/token?grant_type=password`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "apikey": config.supabaseAnonKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Supabase auth failed for agent "${creds.agentId}" (${res.status}): ${body}`);
    }
    const data = (await res.json());
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
    };
}
async function tryRefresh(refreshToken, config) {
    try {
        const url = `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "apikey": config.supabaseAnonKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
        };
    }
    catch {
        return null;
    }
}
/** Clear cached session for an agent. */
export function clearAgentSession(agentId) {
    sessionCache.delete(agentId);
}
/** Clear all cached sessions. */
export function clearAllSessions() {
    sessionCache.clear();
}
//# sourceMappingURL=auth.js.map