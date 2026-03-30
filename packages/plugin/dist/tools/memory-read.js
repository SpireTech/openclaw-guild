import { Type } from "@sinclair/typebox";
import { supabaseGet } from "../supabase.js";
export const memoryReadDef = {
    name: "guild_memory_read",
    description: "Read your own memories from the OpenClaw Guild. Filter by namespace, key, or tags.",
    parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Filter by namespace (e.g. context, todo, lessons)" })),
        key: Type.Optional(Type.String({ description: "Get a specific memory by key" })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tags" })),
    }),
};
export async function executeMemoryRead(creds, config, params) {
    const filters = { status: "eq.active" };
    if (params.namespace)
        filters.namespace = `eq.${params.namespace}`;
    if (params.key)
        filters.key = `eq.${params.key}`;
    if (params.tags?.length)
        filters.tags = `cs.{${params.tags.join(",")}}`;
    const data = await supabaseGet(creds, config, {
        table: "agent_memories",
        select: "namespace,key,value,tags,confidence,source,created_at,updated_at",
        filters,
        order: "updated_at.desc",
        limit: 100,
    });
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: undefined,
    };
}
//# sourceMappingURL=memory-read.js.map