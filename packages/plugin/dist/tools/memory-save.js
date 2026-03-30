import { Type } from "@sinclair/typebox";
import { supabaseGet, supabasePatch } from "../supabase.js";
import { getAgentToken } from "../auth.js";
export const memorySaveDef = {
    name: "guild_memory_save",
    description: "Save a memory to the OpenClaw Guild. Creates or updates based on (namespace, key). Use namespaces: context, todo, lessons, notes, decisions, observations.",
    parameters: Type.Object({
        namespace: Type.String({ description: "Memory namespace (e.g. context, todo, lessons, notes, decisions, observations)" }),
        key: Type.String({ description: "Memory key (e.g. current-work, deploy-envoy)" }),
        value: Type.String({ description: "Memory content (the thing to remember)" }),
        confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: "Confidence score 0-1" })),
        source: Type.Optional(Type.Union([
            Type.Literal("observed"),
            Type.Literal("told"),
            Type.Literal("inferred"),
        ], { description: "How this memory was acquired" })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for categorization" })),
    }),
};
export async function executeMemorySave(creds, config, params) {
    // Check if memory already exists (partial unique index prevents normal upsert)
    const existing = await supabaseGet(creds, config, {
        table: "agent_memories",
        select: "id",
        filters: {
            namespace: `eq.${params.namespace}`,
            key: `eq.${params.key}`,
            status: "eq.active",
        },
        limit: 1,
    });
    const fields = {
        value: params.value,
        confidence: params.confidence ?? null,
        source: params.source ?? null,
        tags: params.tags ?? [],
        status: "active",
    };
    let result;
    if (existing.length > 0) {
        // Update existing
        result = await supabasePatch(creds, config, {
            table: "agent_memories",
            filters: { id: `eq.${existing[0].id}` },
            body: fields,
            select: "namespace,key,value,updated_at",
        });
    }
    else {
        // Insert new — must include agent_id for RLS WITH CHECK
        const token = await getAgentToken(creds, config);
        const url = `${config.supabaseUrl}/rest/v1/agent_memories?select=namespace,key,value,updated_at`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "apikey": config.supabaseAnonKey,
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "Prefer": "return=representation",
                "Accept": "application/vnd.pgrst.object+json",
            },
            body: JSON.stringify({
                agent_id: creds.platformUuid,
                namespace: params.namespace,
                key: params.key,
                ...fields,
            }),
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new Error(`Memory save failed (${res.status}): ${errBody}`);
        }
        result = await res.json();
    }
    return {
        content: [{ type: "text", text: JSON.stringify({ saved: true, memory: result }) }],
        details: undefined,
    };
}
//# sourceMappingURL=memory-save.js.map