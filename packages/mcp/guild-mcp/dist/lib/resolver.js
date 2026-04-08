/**
 * Resolve all applicable skills for an agent.
 *
 * Resolution order (most specific wins):
 * 1. Agent-level: explicit skill_assignments for this agent
 * 2. Role-level: published skills with scope=role matching agent's roles
 * 3. Company-level: published skills with scope=company
 *
 * For each skill_id, the first match wins. Assignments with is_enabled=false
 * explicitly disable a skill that would otherwise be inherited.
 */
export async function resolveAgentSkills(db, agentId, includeContent = false) {
    // 1. Get agent's roles and owner
    const { data: agent, error: agentError } = await db
        .from("agents")
        .select("id, owner_id")
        .eq("id", agentId)
        .single();
    if (agentError || !agent)
        throw new Error(`Agent ${agentId} not found`);
    const { data: roles } = await db
        .from("agent_role_assignments")
        .select("role")
        .eq("agent_id", agentId);
    const agentRoles = roles?.map((r) => r.role) ?? [];
    // 2. Fetch skills from all scopes
    const versionSelect = includeContent ? "*" : "version, published_at";
    const { data: companySkills } = await db
        .from("skills")
        .select(`*, skill_versions!inner(${versionSelect})`)
        .eq("scope", "company")
        .eq("status", "published");
    const { data: roleSkills } = agentRoles.length
        ? await db
            .from("skills")
            .select(`*, skill_versions!inner(${versionSelect})`)
            .eq("scope", "role")
            .eq("status", "published")
            .in("scope_value", agentRoles)
        : { data: [] };
    const { data: agentSkills } = agent.owner_id
        ? await db
            .from("skills")
            .select(`*, skill_versions!inner(${versionSelect})`)
            .eq("scope", "agent")
            .eq("status", "published")
            .eq("scope_value", agent.owner_id)
        : { data: [] };
    // 3. Get explicit assignments for this agent
    const { data: assignments } = await db
        .from("skill_assignments")
        .select(`*, skills!inner(*, skill_versions!inner(${versionSelect}))`)
        .eq("assignee_id", agentId)
        .eq("assignee_type", "agent");
    // 4. Build map — most specific first, first match wins
    const skillMap = new Map();
    const disabledSet = new Set();
    const extractContent = (s) => {
        if (!includeContent)
            return undefined;
        const versions = s.skill_versions;
        return versions?.[0]?.content;
    };
    // Agent-level assignments (most specific)
    for (const a of assignments ?? []) {
        const skillId = a.skill_id;
        if (!a.is_enabled) {
            disabledSet.add(skillId);
        }
        else {
            const s = a.skills;
            skillMap.set(skillId, {
                skill: s,
                content: extractContent(s),
                source: "assignment",
                is_enabled: true,
            });
        }
    }
    // Agent-level skills
    for (const s of (agentSkills ?? [])) {
        const id = s.id;
        if (!skillMap.has(id) && !disabledSet.has(id)) {
            skillMap.set(id, {
                skill: s,
                content: extractContent(s),
                source: "agent",
                is_enabled: true,
            });
        }
    }
    // Role-level skills
    for (const s of (roleSkills ?? [])) {
        const id = s.id;
        if (!skillMap.has(id) && !disabledSet.has(id)) {
            skillMap.set(id, {
                skill: s,
                content: extractContent(s),
                source: "role",
                is_enabled: true,
            });
        }
    }
    // Company-level skills (least specific)
    for (const s of (companySkills ?? [])) {
        const id = s.id;
        if (!skillMap.has(id) && !disabledSet.has(id)) {
            skillMap.set(id, {
                skill: s,
                content: extractContent(s),
                source: "company",
                is_enabled: true,
            });
        }
    }
    return Array.from(skillMap.values());
}
//# sourceMappingURL=resolver.js.map