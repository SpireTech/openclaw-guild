import { z } from "zod";
import { mcpJson } from "../lib/types.js";
const ListSkillsInput = z.object({
    company_id: z.string().uuid().optional(),
    scope: z.enum(["company", "role", "individual"]).optional(),
    status: z.enum(["draft", "published", "deprecated"]).optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().optional(),
});
const GetSkillInput = z.object({
    skill_id: z.string().uuid().optional(),
    slug: z.string().optional(),
    scope: z.string().optional(),
    scope_value: z.string().optional(),
    version: z.number().optional(),
});
const GetSkillVersionInput = z.object({
    skill_id: z.string().uuid(),
    version: z.number(),
});
export const listSkillsTool = {
    name: "list_skills",
    description: "List available skills, filterable by company_id, scope, status, tags, or keyword search.",
    inputSchema: {
        type: "object",
        properties: {
            company_id: { type: "string", description: "Filter by company UUID" },
            scope: { type: "string", enum: ["company", "role", "individual"] },
            status: { type: "string", enum: ["draft", "published", "deprecated"] },
            tags: { type: "array", items: { type: "string" } },
            search: {
                type: "string",
                description: "Keyword search in name + description",
            },
        },
    },
};
export const getSkillTool = {
    name: "get_skill",
    description: "Fetch a single skill by ID (or slug+scope) with its current active version content.",
    inputSchema: {
        type: "object",
        properties: {
            skill_id: { type: "string", description: "UUID of the skill" },
            slug: { type: "string", description: "Skill slug (requires scope)" },
            scope: { type: "string", description: "Required with slug" },
            scope_value: {
                type: "string",
                description: "Required with slug for role/individual",
            },
            version: {
                type: "number",
                description: "Specific version (default: current)",
            },
        },
    },
};
export const getSkillVersionTool = {
    name: "get_skill_version",
    description: "Fetch a specific version of a skill by skill_id and version number.",
    inputSchema: {
        type: "object",
        properties: {
            skill_id: { type: "string", description: "UUID of the skill" },
            version: { type: "number", description: "Version number to fetch" },
        },
        required: ["skill_id", "version"],
    },
};
export async function handleListSkills(db, args) {
    const input = ListSkillsInput.parse(args ?? {});
    let query = db
        .from("skills")
        .select("id, name, slug, scope, scope_value, description, current_version, status, tags, metadata");
    if (input.company_id)
        query = query.eq("company_id", input.company_id);
    if (input.scope)
        query = query.eq("scope", input.scope);
    if (input.status)
        query = query.eq("status", input.status);
    if (input.tags?.length)
        query = query.contains("tags", input.tags);
    if (input.search) {
        query = query.or(`name.ilike.%${input.search}%,description.ilike.%${input.search}%`);
    }
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    return mcpJson({ skills: data ?? [] });
}
export async function handleGetSkill(db, args) {
    const input = GetSkillInput.parse(args);
    let skillQuery;
    if (input.skill_id) {
        skillQuery = db.from("skills").select("*").eq("id", input.skill_id).single();
    }
    else if (input.slug && input.scope) {
        let q = db
            .from("skills")
            .select("*")
            .eq("slug", input.slug)
            .eq("scope", input.scope);
        if (input.scope_value)
            q = q.eq("scope_value", input.scope_value);
        skillQuery = q.single();
    }
    else {
        throw new Error("Either skill_id or slug+scope is required");
    }
    const { data: skill, error: skillError } = await skillQuery;
    if (skillError)
        throw new Error(skillError.message);
    const version = input.version ?? skill.current_version;
    const { data: ver, error: verError } = await db
        .from("skill_versions")
        .select("*")
        .eq("skill_id", skill.id)
        .eq("version", version)
        .single();
    if (verError)
        throw new Error(verError.message);
    return mcpJson({
        skill,
        content: ver.content,
        version: ver.version,
        published_at: ver.published_at,
    });
}
export async function handleGetSkillVersion(db, args) {
    const input = GetSkillVersionInput.parse(args);
    const { data: ver, error } = await db
        .from("skill_versions")
        .select("*")
        .eq("skill_id", input.skill_id)
        .eq("version", input.version)
        .single();
    if (error)
        throw new Error(error.message);
    return mcpJson({ version: ver });
}
//# sourceMappingURL=skills-discovery.js.map