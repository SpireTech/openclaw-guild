import { z } from "zod";
import { mcpJson } from "../lib/types.js";
// ── Schemas ──
const AgentGetInput = z.object({
    namespace: z.string().optional(),
    key: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.string().default("active"),
});
const AgentSetInput = z.object({
    namespace: z.string(),
    key: z.string(),
    value: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    source: z.enum(["observed", "told", "inferred"]).optional(),
    tags: z.array(z.string()).optional(),
});
const AgentDeleteInput = z.object({
    namespace: z.string(),
    key: z.string(),
});
// ── Tool definitions ──
export const agentGetMemoriesTool = {
    name: "agent_get_memories",
    description: "Retrieve agent's own memories, optionally filtered by namespace, key, tags, or status.",
    inputSchema: {
        type: "object",
        properties: {
            namespace: { type: "string", description: "Filter by namespace" },
            key: { type: "string", description: "Get specific memory by key" },
            tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
            status: { type: "string", description: "Filter by status (default: active)" },
        },
    },
};
export const agentSetMemoryTool = {
    name: "agent_set_memory",
    description: "Create or update an agent memory. Upserts on (agent_id, namespace, key).",
    inputSchema: {
        type: "object",
        properties: {
            namespace: { type: "string", description: "e.g. tool_notes, user_observations" },
            key: { type: "string", description: "e.g. scott_report_format" },
            value: { type: "string", description: "The memory content" },
            confidence: { type: "number", description: "0-1 confidence score" },
            source: { type: "string", enum: ["observed", "told", "inferred"] },
            tags: { type: "array", items: { type: "string" } },
        },
        required: ["namespace", "key", "value"],
    },
};
export const agentDeleteMemoryTool = {
    name: "agent_delete_memory",
    description: "Delete (archive) an agent memory by namespace and key.",
    inputSchema: {
        type: "object",
        properties: {
            namespace: { type: "string" },
            key: { type: "string" },
        },
        required: ["namespace", "key"],
    },
};
// ── Handlers ──
export async function handleAgentGetMemories(db, args) {
    const input = AgentGetInput.parse(args ?? {});
    let query = db.from("agent_memories").select("*").eq("status", input.status);
    if (input.namespace)
        query = query.eq("namespace", input.namespace);
    if (input.key)
        query = query.eq("key", input.key);
    if (input.tags?.length)
        query = query.contains("tags", input.tags);
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    return mcpJson({ memories: data ?? [] });
}
export async function handleAgentSetMemory(db, args) {
    const input = AgentSetInput.parse(args);
    const { data, error } = await db
        .from("agent_memories")
        .upsert({
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        confidence: input.confidence ?? null,
        source: input.source ?? null,
        tags: input.tags ?? [],
        status: "active",
    }, { onConflict: "agent_id,namespace,key", ignoreDuplicates: false })
        .select()
        .single();
    if (error)
        throw new Error(error.message);
    return mcpJson({ memory: data });
}
export async function handleAgentDeleteMemory(db, args) {
    const input = AgentDeleteInput.parse(args);
    const { error } = await db
        .from("agent_memories")
        .update({ status: "archived" })
        .eq("namespace", input.namespace)
        .eq("key", input.key)
        .eq("status", "active");
    if (error)
        throw new Error(error.message);
    return mcpJson({ deleted: true });
}
//# sourceMappingURL=memory-agent-memory.js.map