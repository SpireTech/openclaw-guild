import { z } from "zod";
import { mcpJson } from "../lib/types.js";
const GetChunkInput = z.object({
    chunk_id: z.string().uuid(),
});
export const getChunkTool = {
    name: "get_chunk",
    description: "Retrieve a specific knowledge chunk by ID.",
    inputSchema: {
        type: "object",
        properties: {
            chunk_id: { type: "string", description: "UUID of the chunk" },
        },
        required: ["chunk_id"],
    },
};
export async function handleGetChunk(db, args) {
    const input = GetChunkInput.parse(args);
    const { data, error } = await db
        .from("knowledge_chunks")
        .select("id, content, summary, source_system, source_url, client_id, data_type, category, product_name, error_code, tags, source_updated_at, created_at")
        .eq("id", input.chunk_id)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return mcpJson({ chunk: data });
}
//# sourceMappingURL=knowledge-get-chunk.js.map