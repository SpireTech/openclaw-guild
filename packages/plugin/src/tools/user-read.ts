// @ts-nocheck — legacy untyped file, works at runtime
import { Type } from "@sinclair/typebox";
import { supabaseGet } from "../supabase.js";
export const userReadDef = {
    name: "guild_user_read",
    description: "Read memories about the person you are currently talking to. Returns their preferences, context, and notes. Automatically identifies the user from the conversation.",
    parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Filter by namespace (e.g., preferences, context, notes)" })),
        key: Type.Optional(Type.String({ description: "Filter by specific key" })),
    }),
};
export async function executeUserRead(creds, config, params, userId) {
    if (!userId) {
        return {
            content: [{ type: "text", text: "Cannot identify the current user. This tool only works in conversations with a known user." }],
            details: undefined,
        };
    }
    const filters = { user_id: `eq.${userId}` };
    if (params.namespace) filters.namespace = `eq.${params.namespace}`;
    if (params.key) filters.key = `eq.${params.key}`;
    const data = await supabaseGet(creds, config, {
        table: "user_memories",
        select: "namespace,key,value,tags,written_by_type,created_at,updated_at",
        filters,
        order: "updated_at.desc",
        limit: 100,
    });
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: undefined,
    };
}
//# sourceMappingURL=user-read.js.map
