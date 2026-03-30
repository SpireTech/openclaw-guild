import { Type } from "@sinclair/typebox";
import { supabaseGet } from "../supabase.js";
export const memoryCompanyDef = {
    name: "guild_memory_company",
    description: "Read company-wide memories shared across all agents.",
    parameters: Type.Object({
        namespace: Type.Optional(Type.String({ description: "Filter by namespace" })),
    }),
};
export async function executeMemoryCompany(creds, config, params) {
    const filters = { status: "eq.active" };
    if (params.namespace)
        filters.namespace = `eq.${params.namespace}`;
    const data = await supabaseGet(creds, config, {
        table: "company_memories",
        select: "namespace,key,value,tags,created_at",
        filters,
        order: "updated_at.desc",
        limit: 100,
    });
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: undefined,
    };
}
//# sourceMappingURL=memory-company.js.map