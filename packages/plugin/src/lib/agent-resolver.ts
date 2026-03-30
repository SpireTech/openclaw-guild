/**
 * Resolve agent credentials from the plugin config.
 *
 * Credentials are stored in plugins.entries.guild.config.agents,
 * keyed by OpenClaw agent ID. Works for both sandboxed and unsandboxed agents.
 */

import type { AgentCredentials, PluginConfig } from "../config.js";

export function resolveAgentCredentials(
  agentId: string | undefined,
  pluginConfig: PluginConfig,
): AgentCredentials | null {
  if (!agentId) return null;

  // Case-insensitive lookup
  const entry = Object.entries(pluginConfig.agents).find(
    ([id]) => id.toLowerCase() === agentId.toLowerCase(),
  );
  if (!entry) return null;

  const [, auth] = entry;

  const email = auth.email ?? null;
  const password = auth.password ?? null;
  const legacyJwt = auth.jwt ?? null;

  // Must have at least one auth method
  if (!email && !password && !legacyJwt) return null;

  return {
    agentId,
    platformUuid: auth.uuid,
    email,
    password,
    legacyJwt,
  };
}
