import { z } from "zod";
import type { SupabaseClient } from "../lib/supabase.js";
import { mcpJson } from "../lib/types.js";

const RoleGetInput = z.object({
  role: z.string(),
  namespace: z.string().optional(),
  client_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

const RoleSetInput = z.object({
  role: z.string(),
  namespace: z.string(),
  key: z.string(),
  value: z.string(),
  client_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

export const roleGetMemoriesTool = {
  name: "role_get_memories",
  description: "Retrieve role-tier memories. Shared tribal knowledge by role.",
  inputSchema: {
    type: "object" as const,
    properties: {
      role: { type: "string", description: "Role name" },
      namespace: { type: "string" },
      client_id: { type: "string", description: "Filter by client" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["role"],
  },
};

export const roleSetMemoryTool = {
  name: "role_set_memory",
  description: "Create or update a role memory. Only callable by users in the matching role or manager+.",
  inputSchema: {
    type: "object" as const,
    properties: {
      role: { type: "string" },
      namespace: { type: "string" },
      key: { type: "string" },
      value: { type: "string" },
      client_id: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["role", "namespace", "key", "value"],
  },
};

export async function handleRoleGetMemories(
  db: SupabaseClient,
  args: Record<string, unknown> | undefined,
) {
  const input = RoleGetInput.parse(args);

  let query = db
    .from("role_memories")
    .select("*")
    .eq("role", input.role)
    .eq("status", "active");

  if (input.namespace) query = query.eq("namespace", input.namespace);
  if (input.client_id) query = query.eq("client_id", input.client_id);
  if (input.tags?.length) query = query.contains("tags", input.tags);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return mcpJson({ memories: data ?? [] });
}

export async function handleRoleSetMemory(
  db: SupabaseClient,
  args: Record<string, unknown> | undefined,
) {
  const input = RoleSetInput.parse(args);

  const { data, error } = await db
    .from("role_memories")
    .upsert(
      {
        role: input.role,
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        client_id: input.client_id ?? null,
        tags: input.tags ?? [],
        status: "active",
      },
      { onConflict: "role,namespace,key", ignoreDuplicates: false },
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  return mcpJson({ memory: data });
}
