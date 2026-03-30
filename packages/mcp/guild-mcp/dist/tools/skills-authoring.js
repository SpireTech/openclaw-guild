import { z } from "zod";
import { mcpJson } from "../lib/types.js";
const CreateSkillInput = z.object({
    name: z.string(),
    slug: z.string(),
    scope: z.enum(["company", "role", "individual"]),
    scope_value: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
    content: z.string(),
    change_note: z.string().optional(),
});
const CreateSkillVersionInput = z.object({
    skill_id: z.string().uuid(),
    content: z.string(),
    change_note: z.string().optional(),
});
export const createSkillTool = {
    name: "create_skill",
    description: "Create a new skill record in draft status with version 1. Admin/owner only based on JWT claims.",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string" },
            slug: { type: "string", description: "URL-safe, unique within scope" },
            scope: { type: "string", enum: ["company", "role", "individual"] },
            scope_value: { type: "string", description: "Role name or user ID" },
            description: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object" },
            content: { type: "string", description: "Initial draft content" },
            change_note: { type: "string" },
        },
        required: ["name", "slug", "scope", "content"],
    },
};
export const createSkillVersionTool = {
    name: "create_skill_version",
    description: "Add a new version to an existing skill. Versions are immutable once created. The version number auto-increments.",
    inputSchema: {
        type: "object",
        properties: {
            skill_id: { type: "string", description: "UUID of the skill" },
            content: { type: "string", description: "The skill content for this version" },
            change_note: { type: "string", description: "Description of changes" },
        },
        required: ["skill_id", "content"],
    },
};
export async function handleCreateSkill(db, args) {
    const input = CreateSkillInput.parse(args);
    const { data: skill, error: skillError } = await db
        .from("skills")
        .insert({
        name: input.name,
        slug: input.slug,
        scope: input.scope,
        scope_value: input.scope_value ?? null,
        description: input.description ?? null,
        current_version: 1,
        status: "draft",
        tags: input.tags ?? [],
        metadata: input.metadata ?? {},
    })
        .select()
        .single();
    if (skillError)
        throw new Error(skillError.message);
    const { data: version, error: verError } = await db
        .from("skill_versions")
        .insert({
        skill_id: skill.id,
        version: 1,
        content: input.content,
        change_note: input.change_note ?? "Initial version",
    })
        .select()
        .single();
    if (verError)
        throw new Error(verError.message);
    return mcpJson({ skill, version });
}
export async function handleCreateSkillVersion(db, args) {
    const input = CreateSkillVersionInput.parse(args);
    // Get the current highest version number for this skill
    const { data: latest, error: fetchError } = await db
        .from("skill_versions")
        .select("version")
        .eq("skill_id", input.skill_id)
        .order("version", { ascending: false })
        .limit(1)
        .single();
    if (fetchError)
        throw new Error(`Skill not found or has no versions: ${fetchError.message}`);
    const nextVersion = latest.version + 1;
    const { data: version, error: verError } = await db
        .from("skill_versions")
        .insert({
        skill_id: input.skill_id,
        version: nextVersion,
        content: input.content,
        change_note: input.change_note ?? null,
    })
        .select()
        .single();
    if (verError)
        throw new Error(verError.message);
    // Update the skill's current_version to point to the new version
    const { error: updateError } = await db
        .from("skills")
        .update({ current_version: nextVersion })
        .eq("id", input.skill_id);
    if (updateError)
        throw new Error(updateError.message);
    return mcpJson({ version });
}
//# sourceMappingURL=skills-authoring.js.map