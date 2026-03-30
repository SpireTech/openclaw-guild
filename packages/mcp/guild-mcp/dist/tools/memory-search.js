import { z } from "zod";
import { mcpJson } from "../lib/types.js";
const SearchInput = z.object({
    query: z.string(),
    tiers: z
        .array(z.enum(["agent", "user", "role", "company"]))
        .optional(),
    namespace: z.string().optional(),
    client_id: z.string().uuid().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().min(1).max(100).default(20),
});
export const searchMemoriesTool = {
    name: "search_memories",
    description: "Cross-tier keyword search across all accessible memory tiers. V1 uses keyword matching; V2 will add vector similarity.",
    inputSchema: {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query" },
            tiers: {
                type: "array",
                items: { type: "string", enum: ["agent", "user", "role", "company"] },
                description: "Tiers to search (default: all accessible)",
            },
            namespace: { type: "string" },
            client_id: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "number", description: "Max results (default 20)" },
        },
        required: ["query"],
    },
};
const TIER_TABLES = {
    agent: "agent_memories",
    user: "user_memories",
    role: "role_memories",
    company: "company_memories",
};
export async function handleSearchMemories(db, args) {
    const input = SearchInput.parse(args);
    const tiers = input.tiers ?? ["agent", "user", "role", "company"];
    const results = [];
    for (const tier of tiers) {
        const table = TIER_TABLES[tier];
        let query = db
            .from(table)
            .select("id, namespace, key, value, tags")
            .eq("status", "active")
            .ilike("value", `%${input.query}%`);
        if (input.namespace)
            query = query.eq("namespace", input.namespace);
        if (input.tags?.length)
            query = query.contains("tags", input.tags);
        if (input.client_id && (tier === "role" || tier === "company")) {
            query = query.eq("client_id", input.client_id);
        }
        const { data } = await query.limit(input.limit);
        for (const row of data ?? []) {
            results.push({ tier, ...row, relevance: 1.0 });
        }
    }
    // Sort by relevance (all 1.0 for keyword search) and limit
    return mcpJson({ results: results.slice(0, input.limit) });
}
//# sourceMappingURL=memory-search.js.map