import { Type } from "@sinclair/typebox";
import { resolveSkillCatalog } from "../lib/skill-resolver.js";
export const skillListDef = {
    name: "guild_skill_list",
    description: "List all guild skills available to this agent. Returns name, slug, description, and scope for each skill. Use guild_skill_read(slug) to load full content.",
    parameters: Type.Object({}),
};
export async function executeSkillList(creds, config) {
    const catalog = await resolveSkillCatalog(creds, config);
    if (catalog.length === 0) {
        return {
            content: [{ type: "text", text: "No skills are currently available to this agent." }],
            details: undefined,
        };
    }
    return {
        content: [{ type: "text", text: JSON.stringify(catalog, null, 2) }],
        details: undefined,
    };
}
//# sourceMappingURL=skill-list.js.map