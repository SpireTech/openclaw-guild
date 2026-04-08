import { Type } from "@sinclair/typebox";
import type { PluginConfig, AgentCredentials } from "../config.js";
import { getAgentToken } from "../auth.js";

export const userSaveDef = {
  name: "guild_user_save",
  description:
    "Save a memory about the person you are currently talking to. Use for their preferences, name, role, timezone, communication style, etc. Automatically identifies the user.",
  parameters: Type.Object({
    namespace: Type.String({ description: "Category: preferences, context, notes" }),
    key: Type.String({ description: "Descriptive key (e.g., 'name', 'timezone', 'report-format')" }),
    value: Type.String({ description: "The information to remember" }),
    tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for search" })),
  }),
};

export async function executeUserSave(
  creds: AgentCredentials,
  config: PluginConfig,
  params: { namespace: string; key: string; value: string; tags?: string[] },
  userId: string | undefined,
  agentUuid: string,
) {
  if (!userId) {
    return {
      content: [{ type: "text" as const, text: "Cannot identify the current user. This tool only works in conversations with a known user." }],
      details: undefined,
    };
  }

  const token = await getAgentToken(creds, config);
  const url = config.supabaseUrl;
  const res = await fetch(`${url}/rest/v1/user_memories`, {
    method: "POST",
    headers: {
      "apikey": config.supabaseAnonKey,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      user_id: userId,
      namespace: params.namespace,
      key: params.key,
      value: params.value,
      tags: params.tags || [],
      written_by: agentUuid,
      written_by_type: "agent",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return {
      content: [{ type: "text" as const, text: `Failed to save user memory: ${res.status} ${body}` }],
      details: undefined,
    };
  }

  return {
    content: [{ type: "text" as const, text: `Saved user memory: ${params.namespace}/${params.key}` }],
    details: undefined,
  };
}
