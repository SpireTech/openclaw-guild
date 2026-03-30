import { z } from "zod";
import type { SupabaseClient } from "../lib/supabase.js";
import { mcpJson } from "../lib/types.js";

const ProposeInput = z.object({
  source_type: z.enum(["agent_memory", "user_memory", "role_memory"]),
  source_id: z.string().uuid(),
  target_type: z.enum(["role_memory", "company_memory"]),
  target_role: z.string().optional(),
  proposed_namespace: z.string(),
  proposed_key: z.string(),
  proposed_value: z.string(),
  proposed_client_id: z.string().uuid().optional(),
  proposed_tags: z.array(z.string()).optional(),
});

const ListPromotionsInput = z.object({
  status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
});

const ReviewInput = z.object({
  promotion_id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});

export const proposePromotionTool = {
  name: "propose_promotion",
  description: "Propose promoting a memory from one tier to a higher tier (e.g. agent -> role, role -> company).",
  inputSchema: {
    type: "object" as const,
    properties: {
      source_type: { type: "string", enum: ["agent_memory", "user_memory", "role_memory"] },
      source_id: { type: "string", description: "UUID of the source memory" },
      target_type: { type: "string", enum: ["role_memory", "company_memory"] },
      target_role: { type: "string", description: "Required if target_type = role_memory" },
      proposed_namespace: { type: "string" },
      proposed_key: { type: "string" },
      proposed_value: { type: "string", description: "Snapshotted value for the promotion" },
      proposed_client_id: { type: "string" },
      proposed_tags: { type: "array", items: { type: "string" } },
    },
    required: ["source_type", "source_id", "target_type", "proposed_namespace", "proposed_key", "proposed_value"],
  },
};

export const listPromotionsTool = {
  name: "list_promotions",
  description: "List memory promotion proposals, optionally filtered by status.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: { type: "string", enum: ["pending", "approved", "rejected", "expired"] },
    },
  },
};

export const reviewPromotionTool = {
  name: "review_promotion",
  description: "Approve or reject a pending memory promotion. Manager+ only. On approval, creates memory in target tier.",
  inputSchema: {
    type: "object" as const,
    properties: {
      promotion_id: { type: "string" },
      decision: { type: "string", enum: ["approve", "reject"] },
      note: { type: "string", description: "Optional reviewer note" },
    },
    required: ["promotion_id", "decision"],
  },
};

export async function handleProposePromotion(
  db: SupabaseClient,
  args: Record<string, unknown> | undefined,
) {
  const input = ProposeInput.parse(args);

  const { data, error } = await db
    .from("memory_promotions")
    .insert({
      source_type: input.source_type,
      source_id: input.source_id,
      target_type: input.target_type,
      target_role: input.target_role ?? null,
      proposed_namespace: input.proposed_namespace,
      proposed_key: input.proposed_key,
      proposed_value: input.proposed_value,
      proposed_client_id: input.proposed_client_id ?? null,
      proposed_tags: input.proposed_tags ?? [],
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return mcpJson({ promotion: data });
}

export async function handleListPromotions(
  db: SupabaseClient,
  args: Record<string, unknown> | undefined,
) {
  const input = ListPromotionsInput.parse(args ?? {});

  let query = db.from("memory_promotions").select("*");
  if (input.status) query = query.eq("status", input.status);
  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return mcpJson({ promotions: data ?? [] });
}

export async function handleReviewPromotion(
  db: SupabaseClient,
  args: Record<string, unknown> | undefined,
) {
  const input = ReviewInput.parse(args);

  const { data: promo, error: fetchError } = await db
    .from("memory_promotions")
    .select("*")
    .eq("id", input.promotion_id)
    .eq("status", "pending")
    .single();

  if (fetchError || !promo) throw new Error("Promotion not found or not pending");

  if (input.decision === "reject") {
    const { data, error } = await db
      .from("memory_promotions")
      .update({
        status: "rejected",
        review_note: input.note ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", promo.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return mcpJson({ promotion: data });
  }

  // Approve: create memory in target tier
  const targetTable =
    promo.target_type === "role_memory" ? "role_memories" : "company_memories";

  const newMemory: Record<string, unknown> = {
    namespace: promo.proposed_namespace,
    key: promo.proposed_key,
    value: promo.proposed_value,
    status: "active",
    tags: promo.proposed_tags,
    client_id: promo.proposed_client_id,
    written_by: promo.proposed_by,
    written_by_type: promo.proposed_by_type,
  };
  if (promo.target_type === "role_memory") {
    newMemory.role = promo.target_role;
  }

  // Supersede existing active memory with same key
  const matchKey: Record<string, unknown> =
    promo.target_type === "role_memory"
      ? { role: promo.target_role, namespace: promo.proposed_namespace, key: promo.proposed_key }
      : { namespace: promo.proposed_namespace, key: promo.proposed_key };

  const { data: existing } = await db
    .from(targetTable)
    .select("id")
    .match(matchKey)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    await db.from(targetTable).update({ status: "superseded" }).eq("id", existing.id);
    newMemory.supersedes = existing.id;
  }

  const { data: created, error: createError } = await db
    .from(targetTable)
    .insert(newMemory)
    .select()
    .single();

  if (createError) throw new Error(createError.message);

  const { data: updated, error: updateError } = await db
    .from("memory_promotions")
    .update({
      status: "approved",
      review_note: input.note ?? null,
      reviewed_at: new Date().toISOString(),
      created_memory_id: created.id,
    })
    .eq("id", promo.id)
    .select()
    .single();

  if (updateError) throw new Error(updateError.message);

  return mcpJson({ promotion: updated, created_memory: created });
}
