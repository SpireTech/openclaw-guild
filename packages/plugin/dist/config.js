/**
 * Plugin configuration schema and resolution.
 *
 * Agent credentials live in the plugin config (not sandbox env vars).
 * This allows both sandboxed and unsandboxed agents to use the plugin.
 */
const DEFAULT_FEATURES = {
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
function resolveEnvRef(value) {
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
export function resolvePluginConfig(raw) {
    const url = raw?.supabaseUrl;
    const key = raw?.supabaseAnonKey;
    if (typeof url !== "string" || !url.trim())
        return null;
    if (typeof key !== "string" || !key.trim())
        return null;
    // Parse agents map
    const rawAgents = raw?.agents;
    const agents = {};
    if (rawAgents && typeof rawAgents === "object") {
        for (const [agentId, entry] of Object.entries(rawAgents)) {
            if (!entry || typeof entry !== "object")
                continue;
            const uuid = entry.uuid;
            if (typeof uuid !== "string" || !uuid.trim())
                continue;
            agents[agentId] = {
                uuid: uuid.trim(),
                email: typeof entry.email === "string" ? resolveEnvRef(entry.email) : undefined,
                password: typeof entry.password === "string" ? resolveEnvRef(entry.password) : undefined,
                jwt: typeof entry.jwt === "string" ? resolveEnvRef(entry.jwt) : undefined,
            };
        }
    }
    const rawFeatures = raw?.features;
    const features = {
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
//# sourceMappingURL=config.js.map