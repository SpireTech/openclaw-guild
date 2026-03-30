/**
 * Thin Supabase PostgREST HTTP client.
 * Uses agent-scoped JWTs for all requests (RLS enforced).
 */
import { getAgentToken } from "./auth.js";
async function headers(creds, config, extra) {
    const token = await getAgentToken(creds, config);
    return {
        "apikey": config.supabaseAnonKey,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        ...extra,
    };
}
function buildQueryString(opts) {
    const params = new URLSearchParams();
    if (opts.select)
        params.set("select", opts.select);
    if (opts.filters) {
        for (const [key, value] of Object.entries(opts.filters)) {
            params.set(key, value);
        }
    }
    if (opts.order)
        params.set("order", opts.order);
    if (opts.limit)
        params.set("limit", String(opts.limit));
    return params.toString();
}
/**
 * GET query against a Supabase table.
 */
export async function supabaseGet(creds, config, opts) {
    const qs = buildQueryString(opts);
    const url = `${config.supabaseUrl}/rest/v1/${opts.table}${qs ? `?${qs}` : ""}`;
    const hdrs = await headers(creds, config, opts.single ? { "Accept": "application/vnd.pgrst.object+json" } : undefined);
    const res = await fetch(url, { method: "GET", headers: hdrs });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Supabase GET ${opts.table} failed (${res.status}): ${body}`);
    }
    return (await res.json());
}
/**
 * POST/upsert to a Supabase table.
 */
export async function supabaseUpsert(creds, config, opts) {
    const params = new URLSearchParams();
    if (opts.select)
        params.set("select", opts.select);
    if (opts.onConflict)
        params.set("on_conflict", opts.onConflict);
    const qs = params.toString();
    const url = `${config.supabaseUrl}/rest/v1/${opts.table}${qs ? `?${qs}` : ""}`;
    const hdrs = await headers(creds, config, {
        "Prefer": "resolution=merge-duplicates,return=representation",
        "Accept": "application/vnd.pgrst.object+json",
    });
    const res = await fetch(url, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(opts.body),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Supabase UPSERT ${opts.table} failed (${res.status}): ${body}`);
    }
    return (await res.json());
}
/**
 * PATCH (update) rows in a Supabase table.
 */
export async function supabasePatch(creds, config, opts) {
    const params = new URLSearchParams();
    if (opts.select)
        params.set("select", opts.select);
    for (const [key, value] of Object.entries(opts.filters)) {
        params.set(key, value);
    }
    const qs = params.toString();
    const url = `${config.supabaseUrl}/rest/v1/${opts.table}${qs ? `?${qs}` : ""}`;
    const hdrs = await headers(creds, config, {
        "Prefer": "return=representation",
    });
    const res = await fetch(url, {
        method: "PATCH",
        headers: hdrs,
        body: JSON.stringify(opts.body),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Supabase PATCH ${opts.table} failed (${res.status}): ${body}`);
    }
    return (await res.json());
}
//# sourceMappingURL=supabase.js.map