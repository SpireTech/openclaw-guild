# OpenClaw Guild — TODO

---

## Publish

- [ ] Publish `openclaw-guild` to npm
- [ ] Make SpireTech/openclaw-guild repo public
- [ ] Make SpireTech/openclaw-guild-admin repo public
- [ ] Publish admin UI Docker image to `ghcr.io/openclaw/guild-admin`

## MCP Server

MCP server (`packages/mcp/guild-mcp/`) is not published to npm — install from repo. Separate from the plugin to keep the plugin package lean for ClawHub/VirusTotal scanning.

- [ ] Add HTTP/SSE transport (currently stdio only — needs network access for LAN clients)
- [ ] Add authentication layer for HTTP mode (API key or JWT validation before passing to Supabase)
- [ ] Test with Claude Desktop (stdio mode)
- [ ] Evaluate publishing as separate `openclaw-guild-mcp` npm package (after HTTP transport done)

## Remaining

- [ ] Vector embeddings for memory search (schema has `embedding` columns but search uses keyword `ilike` — should embed on save via Ollama and use vector similarity for `guild_memory_search`)
- [ ] Admin user management UI enhancements (promote/demote controls, permission display, custom admin roles)
- [ ] CLI `openclaw guild rotate-credentials`
- [ ] Create Memory button in admin UI
- [ ] JWT signature verification in `validateAgent()`
- [ ] Password policies (complexity, expiration, reuse)
- [ ] Session management (list, revoke, concurrent limits)
- [ ] Company memory fine-grained ACLs
- [ ] Multi-tenancy (tenant_id scoping)
- [ ] SSO/SAML/OIDC
- [ ] Data export / GDPR
- [ ] Backup/restore in admin UI
- [ ] Monitoring/alerting (thresholds, webhooks)
- [ ] Self-service user portal
- [ ] Bulk operations
- [ ] Audit log retention policy
- [ ] Configurable bootstrap/onboarding text (currently hardcoded in `guild-bootstrap.ts` and `TOOL_REFERENCE` in `bootstrap.ts` — could be stored in Supabase or plugin config so admins can customize without rebuilding)

---

## Completed

<details>
<summary>Security hardening (2026-03-29, QA verified 20/20)</summary>

- [x] RLS on external_identities — fixed to use `get_agent_id()`
- [x] RLS fix: grants_agent_read — pre-existing bug, `auth.uid()` → `get_agent_id()`
- [x] Rate limit admin login — 5 attempts/min/IP
- [x] Env var references in plugin config — `$ENV_VAR` syntax
- [x] Per-resource permission checks — `requirePermission()` on sensitive routes
- [x] Owner-only admin role grants
- [x] Middleware JWT expiry validation
- [x] Bootstrap context awareness — agents told about stored user memories
- [x] Auto-capture opt-out — per-user toggle
- [x] Deactivate User — cascading cleanup
- [x] Agent credential rotation — rotate + audit log
- [x] User DELETE API

</details>

<details>
<summary>QA bug fixes and features (2026-03-30)</summary>

- [x] PLATFORM_AGENT_PASSWORD → PLATFORM_AGENT_AUTH
- [x] React Fragment key warnings
- [x] User source filter
- [x] OpenClaw link configurable via env var
- [x] Skill created_by uses session user
- [x] Deploy confirmation dialog
- [x] Audit filter expanded to all tables
- [x] Toast consistency
- [x] Scope value placeholder hints
- [x] Logout button
- [x] Skill deprecate/restore/delete
- [x] Admin Actions tab in Audit
- [x] Role/user memory edit/delete

</details>

<details>
<summary>Plugin phases 1–5 (2026-03-28/29)</summary>

- [x] Plugin built, installed, configured
- [x] Cut over from legacy CLI, all agents migrated
- [x] Memory slot takeover, CLI tools, agent provisioning, auto-recall
- [x] 10 tools: guild_memory_* (6), guild_skill_* (2), guild_user_* (2)
- [x] Lifecycle hooks: before_prompt_build, before_compaction, agent_end
- [x] MCP server consolidation (29 tools, config-driven activation)
- [x] Admin UI branding, Docker image, documentation
- [x] Comprehensive README, INSTALL.md, agent setup runbook

</details>

---

## Decisions

- **`guild_` tool prefix** — branding, permanent
- **Config editing** — use `python3 json module` on openclaw.json, never sed/regex
- **Plugin runs in gateway** — credentials never enter agent containers
- **`before_prompt_build` hook** — not `agent:bootstrap` (internal hooks don't dispatch for plugins)
- **`get_agent_id()`** — not `auth.uid()` for RLS agent identity (platform UUID vs auth UUID)
