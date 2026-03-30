import { Type } from "@sinclair/typebox";
import { supabaseGet } from "../supabase.js";
export const memoryTeamDef = {
    name: "guild_memory_team",
    description: "Read shared team (role-scoped) memories visible to your agent.",
    parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Filter by namespace" })),
    }),
};
export async function executeMemoryTeam(creds, config, params) {
    const filters = { status: "eq.active" };
    if (params.namespace)
        filters.namespace = `eq.${params.namespace}`;
    const data = await supabaseGet(creds, config, {
        table: "role_memories",
        select: "role,namespace,key,value,tags,created_at",
        filters,
        order: "updated_at.desc",
        limit: 100,
    });
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: undefined,
    };
}
//# sourceMappingURL=memory-team.js.map