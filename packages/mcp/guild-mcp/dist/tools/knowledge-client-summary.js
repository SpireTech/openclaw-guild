import { z } from "zod";
import { mcpJson } from "../lib/types.js";
const ClientSummaryInput = z.object({
    client_id: z.string().uuid(),
});
export const clientSummaryTool = {
    name: "get_client_summary",
    description: "Get a summary of a client's knowledge: chunk count, data types, and last update time.",
    inputSchema: {
        type: "object",
        properties: {
            client_id: { type: "string", description: "UUID of the client" },
        },
        required: ["client_id"],
    },
};
export async function handleClientSummary(db, args) {
    const input = ClientSummaryInput.parse(args);
    const { data: chunks, error } = await db
        .from("knowledge_chunks")
        .select("data_type, source_updated_at")
        .eq("client_id", input.client_id)
        .eq("status", "active");
    if (error)
        throw new Error(error.message);
    const dataTypes = [...new Set((chunks ?? []).map((c) => c.data_type))];
    const dates = (chunks ?? [])
        .map((c) => c.source_updated_at)
        .filter(Boolean);
    const lastUpdated = dates.length
        ? dates.sort().reverse()[0]
        : null;
    return mcpJson({
        summary: `Client has ${chunks?.length ?? 0} active knowledge chunks across ${dataTypes.length} data types.`,
        chunk_count: chunks?.length ?? 0,
        data_types: dataTypes,
        last_updated: lastUpdated,
    });
}
//# sourceMappingURL=knowledge-client-summary.js.map