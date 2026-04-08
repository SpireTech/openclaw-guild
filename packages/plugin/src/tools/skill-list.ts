import { Type } from "@sinclair/typebox";
import type { PluginConfig, AgentCredentials } from "../config.js";
import { resolveSkillCatalog } from "../lib/skill-resolver.js";

export const skillListDef = {
  name: "guild_skill_list",
  description:
    "List all guild skills available to this agent. Returns name, slug, description, and scope for each skill. Use guild_skill_read(slug) to load full content.",
  parameters: Type.Object({}),
};

export async function executeSkillList(
  creds: AgentCredentials,
  config: PluginConfig,
) {
  const catalog = await resolveSkillCatalog(creds, config);

  if (catalog.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No skills are currently available to this agent." }],
      details: undefined,
    };
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(catalog, null, 2) }],
    details: undefined,
  };
}
