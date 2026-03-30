/**
 * Plugin configuration schema and resolution.
 *
 * Agent credentials live in the plugin config (not sandbox env vars).
 * This allows both sandboxed and unsandboxed agents to use the plugin.
 */

export interface AgentAuthConfig {
  uuid: string;
  email?: string;
  password?: string;
  jwt?: string;
}

export interface FeaturesConfig {
  memory: boolean;
  skills: boolean;
}

export interface PluginConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  agents: Record<string, AgentAuthConfig>;
  features: FeaturesConfig;
}

const DEFAULT_FEATURES: FeaturesConfig = {
  memory: true,
  skills: true,
};

/**
 * Resolve a config value that may be an environment variable reference.
 * Values starting with `$` are read from process.env (gateway process).
 * This allows keeping secrets out of openclaw.json while the plugin
 * resolves them at load time inside the gateway (where env var stripping
 * doesn't apply — OpenClaw only strips secrets from sandbox containers).
 */
function resolveEnvRef(value: string): string {
  if (value.startsWith("$")) {
    const envName = value.slice(1);
    const envValue = process.env[envName];
    if (envValue === undefined) {
      console.warn(`[guild] Config references $${envName} but it is not set in the environment`);
      return "";
    }
    return envValue;
  }
  return value;
}

export function resolvePluginConfig(
  raw: Record<string, unknown> | undefined,
): PluginConfig | null {
  const url = raw?.supabaseUrl;
  const key = raw?.supabaseAnonKey;
  if (typeof url !== "string" || !url.trim()) return null;
  if (typeof key !== "string" || !key.trim()) return null;

  // Parse agents map
  const rawAgents = raw?.agents as Record<string, Record<string, unknown>> | undefined;
  const agents: Record<string, AgentAuthConfig> = {};
  if (rawAgents && typeof rawAgents === "object") {
    for (const [agentId, entry] of Object.entries(rawAgents)) {
      if (!entry || typeof entry !== "object") continue;
      const uuid = entry.uuid;
      if (typeof uuid !== "string" || !uuid.trim()) continue;
      agents[agentId] = {
        uuid: uuid.trim(),
        email: typeof entry.email === "string" ? resolveEnvRef(entry.email) : undefined,
        password: typeof entry.password === "string" ? resolveEnvRef(entry.password) : undefined,
        jwt: typeof entry.jwt === "string" ? resolveEnvRef(entry.jwt) : undefined,
      };
    }
  }

  const rawFeatures = raw?.features as Record<string, unknown> | undefined;
  const features: FeaturesConfig = {
    memory: typeof rawFeatures?.memory === "boolean" ? rawFeatures.memory : DEFAULT_FEATURES.memory,
    skills: typeof rawFeatures?.skills === "boolean" ? rawFeatures.skills : DEFAULT_FEATURES.skills,
  };

  return {
    supabaseUrl: resolveEnvRef(url.trim()),
    supabaseAnonKey: resolveEnvRef(key.trim()),
    agents,
    features,
  };
}

/**
 * Agent credentials resolved from the plugin config.
 * Supports session-based auth (email/password) and static JWT.
 */
export interface AgentCredentials {
  agentId: string;
  platformUuid: string;
  email: string | null;
  password: string | null;
  legacyJwt: string | null;
}
