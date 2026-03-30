import { z } from "zod";
import type { SupabaseClient } from "../lib/supabase.js";
import { embed } from "../lib/embeddings.js";
import { mcpJson } from "../lib/types.js";

const SearchInput = z.object({
  query: z.string(),
  client_id: z.string().uuid().optional(),
  data_type: z.string().optional(),
  category: z.string().optional(),
  product_name: z.string().optional(),
  error_code: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().min(1).max(50).default(10),
  similarity_threshold: z.number().min(0).max(1).default(0.7),
});

export const searchKnowledgeTool = {
  name: "search_knowledge",
  description:
    "Semantic similarity search across embedded knowledge chunks. Supports filtering by client, data type, category, product, error code, and tags.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Natural language search query" },
      client_id: { type: "string", description: "Filter to specific client UUID" },
      data_type: { type: "string", description: "Filter: ticket, kb_article, contract, sop, internal_note, project" },
      category: { type: "string", description: "Filter: printing, networking, onboarding, etc." },
      product_name: { type: "string", description: "Filter: exact product match" },
      error_code: { type: "string", description: "Filter: exact error code" },
      tags: { type: "array", items: { type: "string" }, description: "Filter: must include all tags" },
      limit: { type: "number", description: "Max results (default 10, max 50)" },
      similarity_threshold: { type: "number", description: "Min similarity 0-1 (default 0.7)" },
    },
    required: ["query"],
  },
};

export async function handleSearchKnowledge(
  db: SupabaseClient,
  args: Record<string, unknown> | undefined,
) {
  const input = SearchInput.parse(args);

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(input.query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return mcpJson({
      error: `Embedding service unavailable: ${msg}`,
      results: [],
      total: 0,
    });
  }

  const { data, error } = await db.rpc("search_knowledge_chunks", {
    query_embedding: JSON.stringify(queryEmbedding),
    filter_client_id: input.client_id ?? null,
    filter_data_type: input.data_type ?? null,
    filter_category: input.category ?? null,
    filter_product_name: input.product_name ?? null,
    filter_error_code: input.error_code ?? null,
    filter_tags: input.tags ?? null,
    similarity_min: input.similarity_threshold,
    result_limit: input.limit,
  });

  if (error) throw new Error(error.message);

  return mcpJson({ results: data ?? [], total: data?.length ?? 0 });
}
