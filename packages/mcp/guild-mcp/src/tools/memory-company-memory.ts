import { z } from "zod";
import type { SupabaseClient } from "../lib/supabase.js";
import { mcpJson } from "../lib/types.js";

const CompanyGetInput = z.object({
  namespace: z.string().optional(),
  client_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

const CompanySetInput = z.object({
  namespace: z.string(),
  key: z.string(),
  value: z.string(),
  client_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

export const companyGetMemoriesTool = {
  name: "company_get_memories",
  description: "Retrieve company-tier memories. Organization-wide institutional knowledge.",
  inputSchema: {
    type: "object" as const,
    properties: {
      namespace: { type: "string" },
      client_id: { type: "string", description: "Filter by client" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
};

export const companySetMemoryTool = {
  name: "company_set_memory",
  description: "Create or update a company memory. Manager+ only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      namespace: { type: "string" },
      key: { type: "string" },
      value: { type: "string" },
      client_id: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["namespace", "key", "value"],
  },
};

export async function handleCompanyGetMemories(
  db: SupabaseClient,
  args: Record<string, unknown> | undefined,
) {
  const input = CompanyGetInput.parse(args ?? {});

  let query = db.from("company_memories").select("*").eq("status", "active");
  if (input.namespace) query = query.eq("namespace", input.namespace);
  if (input.client_id) query = query.eq("client_id", input.client_id);
  if (input.tags?.length) query = query.contains("tags", input.tags);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return mcpJson({ memories: data ?? [] });
}

export async function handleCompanySetMemory(
  db: SupabaseClient,
  args: Record<string, unknown> | undefined,
) {
  const input = CompanySetInput.parse(args);

  const { data, error } = await db
    .from("company_memories")
    .upsert(
      {
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        client_id: input.client_id ?? null,
        tags: input.tags ?? [],
        status: "active",
      },
      { onConflict: "namespace,key", ignoreDuplicates: false },
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  return mcpJson({ memory: data });
}
