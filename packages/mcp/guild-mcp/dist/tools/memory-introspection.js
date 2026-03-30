import { z } from "zod";
import { mcpJson } from "../lib/types.js";
// ── get_memory_stats ──
const StatsInput = z.object({
    tier: z.enum(["agent", "user", "role", "company"]).optional(),
});
export const getMemoryStatsTool = {
    name: "get_memory_stats",
    description: "Get memory counts and namespace info per tier.",
    inputSchema: {
        type: "object",
        properties: {
            tier: { type: "string", enum: ["agent", "user", "role", "company"] },
        },
    },
};
const TIER_TABLES = {
    agent: "agent_memories",
    user: "user_memories",
    role: "role_memories",
    company: "company_memories",
};
export async function handleGetMemoryStats(db, args) {
    const input = StatsInput.parse(args ?? {});
    const tiers = input.tier
        ? [input.tier]
        : ["agent", "user", "role", "company"];
    const stats = [];
    for (const tier of tiers) {
        const table = TIER_TABLES[tier];
        const { data, error } = await db
            .from(table)
            .select("namespace, created_at")
            .eq("status", "active");
        if (error)
            throw new Error(error.message);
        const rows = data ?? [];
        const namespaces = [...new Set(rows.map((r) => r.namespace))];
        const dates = rows.map((r) => r.created_at).sort();
        stats.push({
            tier,
            count: rows.length,
            namespaces,
            oldest: dates[0] ?? null,
            newest: dates[dates.length - 1] ?? null,
        });
    }
    return mcpJson({ stats });
}
// ── get_audit_log ──
const AuditInput = z.object({
    table_name: z.string().optional(),
    record_id: z.string().uuid().optional(),
    actor_id: z.string().uuid().optional(),
    limit: z.number().min(1).max(200).default(50),
});
export const getAuditLogTool = {
    name: "get_audit_log",
    description: "Retrieve memory audit log entries. Manager+ only.",
    inputSchema: {
        type: "object",
        properties: {
            table_name: { type: "string" },
            record_id: { type: "string" },
            actor_id: { type: "string" },
            limit: { type: "number", description: "Max entries (default 50)" },
        },
    },
};
export async function handleGetAuditLog(db, args) {
    const input = AuditInput.parse(args ?? {});
    let query = db
        .from("memory_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(input.limit);
    if (input.table_name)
        query = query.eq("table_name", input.table_name);
    if (input.record_id)
        query = query.eq("record_id", input.record_id);
    if (input.actor_id)
        query = query.eq("actor_id", input.actor_id);
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    return mcpJson({ entries: data ?? [] });
}
// ── list_grants ──
const GrantsInput = z.object({
    user_id: z.string().uuid().optional(),
});
export const listGrantsTool = {
    name: "list_grants",
    description: "List user-agent memory access grants.",
    inputSchema: {
        type: "object",
        properties: {
            user_id: { type: "string", description: "Filter by user UUID" },
        },
    },
};
export async function handleListGrants(db, args) {
    const input = GrantsInput.parse(args ?? {});
    let query = db.from("user_agent_grants").select("*");
    if (input.user_id)
        query = query.eq("user_id", input.user_id);
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    return mcpJson({ grants: data ?? [] });
}
//# sourceMappingURL=memory-introspection.js.map