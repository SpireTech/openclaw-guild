import { z } from "zod";
import { mcpJson } from "../lib/types.js";
import { resolveAgentSkills } from "../lib/resolver.js";
const ResolveSkillsInput = z.object({
    agent_id: z.string().uuid(),
    include_content: z.boolean().default(false),
});
const AssignSkillInput = z.object({
    skill_id: z.string().uuid(),
    assignee_id: z.string().uuid(),
    assignee_type: z.enum(["agent", "user"]),
    is_enabled: z.boolean().default(true),
});
const UnassignSkillInput = z.object({
    skill_id: z.string().uuid(),
    assignee_id: z.string().uuid(),
    assignee_type: z.enum(["agent", "user"]),
});
export const resolveSkillsTool = {
    name: "resolve_skills",
    description: "Given an agent_id, resolve the effective skill set by walking: agent assignments → role assignments → company defaults. Most specific wins (agent > role > company). Returns merged skill list with sources.",
    inputSchema: {
        type: "object",
        properties: {
            agent_id: { type: "string", description: "Agent UUID to resolve skills for" },
            include_content: {
                type: "boolean",
                description: "Include skill content in response (default: false)",
            },
        },
        required: ["agent_id"],
    },
};
export const assignSkillTool = {
    name: "assign_skill",
    description: "Assign a skill to an agent or user. Use is_enabled=false to explicitly disable an inherited skill.",
    inputSchema: {
        type: "object",
        properties: {
            skill_id: { type: "string", description: "UUID of the skill to assign" },
            assignee_id: { type: "string", description: "Agent or User UUID" },
            assignee_type: { type: "string", enum: ["agent", "user"] },
            is_enabled: {
                type: "boolean",
                description: "true = grant, false = disable for this assignee (default: true)",
            },
        },
        required: ["skill_id", "assignee_id", "assignee_type"],
    },
};
export const unassignSkillTool = {
    name: "unassign_skill",
    description: "Remove a skill assignment, reverting to inherited defaults.",
    inputSchema: {
        type: "object",
        properties: {
            skill_id: { type: "string", description: "UUID of the skill" },
            assignee_id: { type: "string", description: "Agent or User UUID" },
            assignee_type: { type: "string", enum: ["agent", "user"] },
        },
        required: ["skill_id", "assignee_id", "assignee_type"],
    },
};
export async function handleResolveSkills(db, args) {
    const input = ResolveSkillsInput.parse(args);
    const skills = await resolveAgentSkills(db, input.agent_id, input.include_content);
    return mcpJson({ skills });
}
export async function handleAssignSkill(db, args) {
    const input = AssignSkillInput.parse(args);
    const { data, error } = await db
        .from("skill_assignments")
        .upsert({
        skill_id: input.skill_id,
        assignee_id: input.assignee_id,
        assignee_type: input.assignee_type,
        is_enabled: input.is_enabled,
    }, { onConflict: "skill_id,assignee_id,assignee_type", ignoreDuplicates: false })
        .select()
        .single();
    if (error)
        throw new Error(error.message);
    return mcpJson({ assignment: data });
}
export async function handleUnassignSkill(db, args) {
    const input = UnassignSkillInput.parse(args);
    const { data, error } = await db
        .from("skill_assignments")
        .delete()
        .eq("skill_id", input.skill_id)
        .eq("assignee_id", input.assignee_id)
        .eq("assignee_type", input.assignee_type)
        .select()
        .single();
    if (error)
        throw new Error(error.message);
    return mcpJson({ removed: data });
}
//# sourceMappingURL=skills-assignments.js.map