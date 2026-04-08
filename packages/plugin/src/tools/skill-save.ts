import { Type } from "@sinclair/typebox";
import type { PluginConfig, AgentCredentials } from "../config.js";
import { supabaseGet } from "../supabase.js";
import { getAgentToken } from "../auth.js";

export const skillSaveDef = {
  name: "guild_skill_save",
  description:
    "Create a new skill or add a new version to an existing skill. " +
    "To create: provide name, slug, scope, and content. " +
    "To update: provide skill_id and content (a new version is created).",
  parameters: Type.Object({
    skill_id: Type.Optional(Type.String({ description: "UUID of existing skill to add a new version to" })),
    name: Type.Optional(Type.String({ description: "Skill name (required for new skills)" })),
    slug: Type.Optional(Type.String({ description: "URL-safe identifier (required for new skills)" })),
    scope: Type.Optional(Type.Union([
      Type.Literal("company"),
      Type.Literal("role"),
      Type.Literal("agent"),
    ], { description: "Skill scope (required for new skills)" })),
    scope_value: Type.Optional(Type.String({ description: "Role name or agent owner ID (required when scope is role or agent)" })),
    description: Type.Optional(Type.String({ description: "One-line description of what this skill teaches" })),
    tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for categorization" })),
    content: Type.String({ description: "The skill content (markdown)" }),
    change_note: Type.Optional(Type.String({ description: "Description of changes (for updates)" })),
  }),
};

interface SkillRow {
  id: string;
  name: string;
  slug: string;
  current_version: number;
}

interface VersionRow {
  id: string;
  version: number;
}

export async function executeSkillSave(
  creds: AgentCredentials,
  config: PluginConfig,
  params: {
    skill_id?: string;
    name?: string;
    slug?: string;
    scope?: string;
    scope_value?: string;
    description?: string;
    tags?: string[];
    content: string;
    change_note?: string;
  },
) {
  const token = await getAgentToken(creds, config);
  const url = config.supabaseUrl;
  const headers = {
    "apikey": config.supabaseAnonKey,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  if (params.skill_id) {
    // --- Update mode: add a new version to existing skill ---
    return await addVersion(url, headers, creds, config, params.skill_id, params.content, params.change_note);
  }

  // --- Create mode: new skill + version 1 ---
  if (!params.name || !params.slug || !params.scope) {
    return {
      content: [{ type: "text" as const, text: "To create a new skill, name, slug, and scope are required." }],
      details: undefined,
    };
  }

  return await createSkill(url, headers, creds, params as {
    name: string; slug: string; scope: string;
    scope_value?: string; description?: string; tags?: string[];
    content: string; change_note?: string;
  });
}

async function createSkill(
  url: string,
  headers: Record<string, string>,
  creds: AgentCredentials,
  params: {
    name: string;
    slug: string;
    scope: string;
    scope_value?: string;
    description?: string;
    tags?: string[];
    content: string;
    change_note?: string;
  },
) {
  // Insert the skill record
  const skillRes = await fetch(`${url}/rest/v1/skills`, {
    method: "POST",
    headers: {
      ...headers,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      name: params.name,
      slug: params.slug,
      scope: params.scope,
      scope_value: params.scope_value ?? null,
      description: params.description ?? null,
      current_version: 1,
      status: "draft",
      tags: params.tags ?? [],
      metadata: {},
      created_by: creds.platformUuid,
      created_by_type: "agent",
    }),
  });

  if (!skillRes.ok) {
    const body = await skillRes.text();
    return {
      content: [{ type: "text" as const, text: `Failed to create skill: ${skillRes.status} ${body}` }],
      details: undefined,
    };
  }

  const skills = await skillRes.json() as SkillRow[];
  const skill = skills[0];

  // Insert version 1
  const verRes = await fetch(`${url}/rest/v1/skill_versions`, {
    method: "POST",
    headers: {
      ...headers,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      skill_id: skill.id,
      version: 1,
      content: params.content,
      change_note: params.change_note ?? "Initial version",
    }),
  });

  if (!verRes.ok) {
    const body = await verRes.text();
    return {
      content: [{ type: "text" as const, text: `Skill created but failed to save version: ${verRes.status} ${body}` }],
      details: undefined,
    };
  }

  return {
    content: [{ type: "text" as const, text: `Created skill "${params.name}" (${params.slug}) as draft with version 1.` }],
    details: undefined,
  };
}

async function addVersion(
  url: string,
  headers: Record<string, string>,
  creds: AgentCredentials,
  config: PluginConfig,
  skillId: string,
  content: string,
  changeNote?: string,
) {
  // Get current version number
  const versions = await supabaseGet<VersionRow[]>(creds, config, {
    table: "skill_versions",
    select: "id,version",
    filters: { skill_id: `eq.${skillId}` },
    order: "version.desc",
    limit: 1,
  });

  if (versions.length === 0) {
    return {
      content: [{ type: "text" as const, text: `Skill "${skillId}" not found or has no versions.` }],
      details: undefined,
    };
  }

  const nextVersion = versions[0].version + 1;

  // Insert new version
  const verRes = await fetch(`${url}/rest/v1/skill_versions`, {
    method: "POST",
    headers: {
      ...headers,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      skill_id: skillId,
      version: nextVersion,
      content,
      change_note: changeNote ?? null,
    }),
  });

  if (!verRes.ok) {
    const body = await verRes.text();
    return {
      content: [{ type: "text" as const, text: `Failed to save version: ${verRes.status} ${body}` }],
      details: undefined,
    };
  }

  // Update skill's current_version
  const patchRes = await fetch(
    `${url}/rest/v1/skills?id=eq.${skillId}`,
    {
      method: "PATCH",
      headers: {
        ...headers,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ current_version: nextVersion }),
    },
  );

  if (!patchRes.ok) {
    const body = await patchRes.text();
    return {
      content: [{ type: "text" as const, text: `Version ${nextVersion} saved but failed to update skill pointer: ${patchRes.status} ${body}` }],
      details: undefined,
    };
  }

  return {
    content: [{ type: "text" as const, text: `Added version ${nextVersion} to skill "${skillId}".` }],
    details: undefined,
  };
}
