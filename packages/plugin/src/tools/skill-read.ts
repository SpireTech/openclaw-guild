import { Type } from "@sinclair/typebox";
import type { PluginConfig, AgentCredentials } from "../config.js";
import { supabaseGet } from "../supabase.js";

export const skillReadDef = {
  name: "guild_skill_read",
  description:
    "Load the full content of an guild skill by slug. Use this when a skill from the guild_skills catalog matches the current task.",
  parameters: Type.Object({
    slug: Type.String({ description: "Skill slug (from the guild_skills catalog)" }),
  }),
};

interface SkillRow {
  id: string;
  name: string;
  current_version: number;
}

interface SkillVersionRow {
  content: string;
  version: number;
}

export async function executeSkillRead(
  creds: AgentCredentials,
  config: PluginConfig,
  params: { slug: string },
) {
  // Step 1: Find the skill by slug
  const skills = await supabaseGet<SkillRow[]>(creds, config, {
    table: "skills",
    select: "id,name,current_version",
    filters: {
      slug: `eq.${params.slug}`,
      status: "eq.published",
    },
    limit: 1,
  });

  if (!skills.length) {
    return {
      content: [{ type: "text" as const, text: `Skill "${params.slug}" not found or not published.` }],
      details: undefined,
    };
  }

  const skill = skills[0];

  // Step 2: Fetch the current published version's content
  const versions = await supabaseGet<SkillVersionRow[]>(creds, config, {
    table: "skill_versions",
    select: "content,version",
    filters: {
      skill_id: `eq.${skill.id}`,
      version: `eq.${skill.current_version}`,
    },
    limit: 1,
  });

  const content = versions[0]?.content;
  if (!content) {
    return {
      content: [{ type: "text" as const, text: `Skill "${params.slug}" has no published content.` }],
      details: undefined,
    };
  }

  return {
    content: [{ type: "text" as const, text: content }],
    details: undefined,
  };
}
