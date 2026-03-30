/**
 * Resolve the skill catalog for an agent.
 *
 * Resolution: company skills + role skills + individual skills,
 * minus explicitly disabled assignments.
 * Returns name + description only (no content) for the catalog.
 */

import type { PluginConfig, AgentCredentials } from "../config.js";
import { supabaseGet } from "../supabase.js";

export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string;
  scope: string;
}

interface SkillRow {
  id: string;
  name: string;
  slug: string;
  scope: string;
  scope_value: string | null;
  description: string | null;
}

interface AssignmentRow {
  skill_id: string;
  is_enabled: boolean;
}

interface AgentRow {
  id: string;
  owner_id: string | null;
}

interface RoleRow {
  role: string;
}

/**
 * Fetch the compact skill catalog for an agent (name + description only).
 */
export async function resolveSkillCatalog(
  creds: AgentCredentials,
  config: PluginConfig,
): Promise<SkillCatalogEntry[]> {
  // 1. Get agent roles
  let roles: string[] = [];
  try {
    const roleRows = await supabaseGet<RoleRow[]>(creds, config, {
      table: "agent_role_assignments",
      select: "role",
      filters: { agent_id: `eq.${creds.platformUuid}` },
    });
    roles = roleRows.map((r) => r.role);
  } catch {
    // Agent may not have roles
  }

  // 2. Fetch company skills
  let companySkills: SkillRow[] = [];
  try {
    companySkills = await supabaseGet<SkillRow[]>(creds, config, {
      table: "skills",
      select: "id,name,slug,scope,scope_value,description",
      filters: { scope: "eq.company", status: "eq.published" },
    });
  } catch {
    // May fail if RLS blocks
  }

  // 3. Fetch role skills
  let roleSkills: SkillRow[] = [];
  if (roles.length > 0) {
    try {
      roleSkills = await supabaseGet<SkillRow[]>(creds, config, {
        table: "skills",
        select: "id,name,slug,scope,scope_value,description",
        filters: {
          scope: "eq.role",
          status: "eq.published",
          scope_value: `in.(${roles.join(",")})`,
        },
      });
    } catch {
      // May fail
    }
  }

  // 4. Fetch explicit assignments (to detect disabled skills)
  let assignments: AssignmentRow[] = [];
  try {
    assignments = await supabaseGet<AssignmentRow[]>(creds, config, {
      table: "skill_assignments",
      select: "skill_id,is_enabled",
      filters: {
        assignee_id: `eq.${creds.platformUuid}`,
        assignee_type: "eq.agent",
      },
    });
  } catch {
    // May not have assignments
  }

  // 5. Build map — company then role (role overrides company for same name)
  const disabledIds = new Set(
    assignments.filter((a) => !a.is_enabled).map((a) => a.skill_id),
  );

  const catalog = new Map<string, SkillCatalogEntry>();

  for (const skill of companySkills) {
    if (disabledIds.has(skill.id)) continue;
    catalog.set(skill.id, {
      slug: skill.slug,
      name: skill.name,
      description: skill.description ?? skill.name,
      scope: "company",
    });
  }

  for (const skill of roleSkills) {
    if (disabledIds.has(skill.id)) continue;
    catalog.set(skill.id, {
      slug: skill.slug,
      name: skill.name,
      description: skill.description ?? skill.name,
      scope: "role",
    });
  }

  return Array.from(catalog.values());
}

/**
 * Format the skill catalog as XML for injection into the system prompt.
 */
export function formatSkillCatalogXml(skills: SkillCatalogEntry[]): string {
  if (skills.length === 0) return "";

  const lines: string[] = [
    "",
    "The following guild skills are available. Use `guild_skill_read(slug)` to load full content when a skill matches the current task.",
    "",
    "<guild_skills>",
  ];

  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <slug>${escapeXml(skill.slug)}</slug>`);
    lines.push("  </skill>");
  }

  lines.push("</guild_skills>");
  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
