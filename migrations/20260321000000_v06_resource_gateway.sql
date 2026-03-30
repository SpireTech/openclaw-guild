-- ============================================================
-- PORTABLE AI KNOWLEDGE PLATFORM
-- Migration Script — v0.5 → v0.6
-- March 2026
--
-- Changes:
--   * CHANGED: vector(1536) → vector(768) on all embedding columns (nomic-embed-text via Ollama)
--   * NEW: external_identities table (multi-platform identity)
--   * NEW: approval_requests table (generalized approvals)
--   * NEW: approval_status enum
--   * NEW: resource_policies table (external resource access rules)
--   * NEW: resource_access_log table (audit trail)
--   * NEW: resource-gateway-mcp OAuth client
--   * NEW: _deny role for global deny rules
--   * NEW: expire_stale_approvals() function
--   * DEPRECATED: memory_promotions (data migrated to approval_requests)
-- ============================================================


-- ============================================================
-- 1. EMBEDDING DIMENSION CHANGE (1536 → 768 for nomic-embed-text)
-- ============================================================

-- Drop the IVFFlat index (cannot alter column type with index present)
DROP INDEX IF EXISTS idx_chunks_embedding;

-- Alter all embedding columns from vector(1536) to vector(768)
ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(768);
ALTER TABLE agent_memories ALTER COLUMN embedding TYPE vector(768);
ALTER TABLE user_memories ALTER COLUMN embedding TYPE vector(768);
ALTER TABLE role_memories ALTER COLUMN embedding TYPE vector(768);
ALTER TABLE company_memories ALTER COLUMN embedding TYPE vector(768);

-- Recreate the embedding index with new dimensions
CREATE INDEX idx_chunks_embedding ON knowledge_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);


-- ============================================================
-- 2. NEW ENUMS
-- ============================================================

CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');


-- ============================================================
-- 2. EXTERNAL IDENTITIES
-- ============================================================

CREATE TABLE external_identities (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform            text NOT NULL,
    platform_user_id    text NOT NULL,
    display_name        text,
    metadata            jsonb DEFAULT '{}',
    linked_at           timestamptz NOT NULL DEFAULT now(),
    linked_by           uuid REFERENCES users(id),
    UNIQUE (platform, platform_user_id)
);
CREATE INDEX idx_ext_id_user ON external_identities(user_id);
CREATE INDEX idx_ext_id_platform ON external_identities(platform, platform_user_id);


-- ============================================================
-- 3. GENERALIZED APPROVAL REQUESTS
-- ============================================================

CREATE TABLE approval_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_type        text NOT NULL,
    requester_id        uuid NOT NULL,
    requester_type      text NOT NULL CHECK (requester_type IN ('user', 'agent')),
    payload             jsonb NOT NULL,
    auto_approved       boolean NOT NULL DEFAULT false,
    policy_id           uuid,
    status              approval_status NOT NULL DEFAULT 'pending',
    decided_by          uuid REFERENCES users(id),
    decision_note       text,
    decided_at          timestamptz,
    result_id           uuid,
    result_metadata     jsonb,
    notified_via        text,
    notified_at         timestamptz,
    notification_id     text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz DEFAULT now() + interval '30 days'
);
CREATE INDEX idx_approval_status ON approval_requests(status);
CREATE INDEX idx_approval_type ON approval_requests(request_type);
CREATE INDEX idx_approval_requester ON approval_requests(requester_id);
CREATE INDEX idx_approval_expires ON approval_requests(expires_at) WHERE status = 'pending';

-- RLS
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- Requesters can read their own requests
CREATE POLICY approval_requester_read ON approval_requests
    FOR SELECT TO authenticated USING (requester_id = auth.uid());

-- Managers+ can read all requests
CREATE POLICY approval_reviewer_read ON approval_requests
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

-- Any authenticated user/agent can create requests
CREATE POLICY approval_create ON approval_requests
    FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());

-- Managers+ can update (approve/reject)
CREATE POLICY approval_review ON approval_requests
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );


-- ============================================================
-- 4. RESOURCE POLICIES
-- ============================================================

-- Sentinel role for global deny rules
INSERT INTO roles (id, display_name, description, is_service_role) VALUES
    ('_deny', 'Global Deny', 'Sentinel role for paths that always require approval', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE resource_policies (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id         text REFERENCES roles(id),
    agent_id        uuid REFERENCES agents(id),
    resource_type   text NOT NULL,
    path_pattern    text NOT NULL,
    access          text NOT NULL CHECK (access IN ('read', 'read_write')),
    file_types      text[],
    max_size_bytes  bigint,
    created_by      uuid NOT NULL REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    is_active       boolean NOT NULL DEFAULT true,
    CHECK (role_id IS NOT NULL OR agent_id IS NOT NULL)
);
CREATE INDEX idx_resource_pol_role ON resource_policies(role_id) WHERE role_id IS NOT NULL;
CREATE INDEX idx_resource_pol_agent ON resource_policies(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_resource_pol_type ON resource_policies(resource_type);

-- RLS
ALTER TABLE resource_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY resource_pol_read ON resource_policies
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
        OR (SELECT get_actor_type()) = 'agent'  -- agents can read policies to check their own access
    );

CREATE POLICY resource_pol_write ON resource_policies
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT get_actor_type()) = 'user' AND (SELECT has_role('owner'))
    );

CREATE POLICY resource_pol_update ON resource_policies
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND (SELECT has_role('owner'))
    );

CREATE POLICY resource_pol_delete ON resource_policies
    FOR DELETE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND (SELECT has_role('owner'))
    );


-- ============================================================
-- 5. RESOURCE ACCESS LOG
-- ============================================================

CREATE TABLE resource_access_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        uuid REFERENCES agents(id),
    user_id         uuid REFERENCES users(id),
    resource_type   text NOT NULL,
    resource_path   text NOT NULL,
    access          text NOT NULL,
    status          text NOT NULL CHECK (status IN ('auto_approved', 'approved', 'denied', 'expired')),
    policy_id       uuid REFERENCES resource_policies(id),
    approval_id     uuid REFERENCES approval_requests(id),
    staged_path     text,
    staged_until    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_resource_log_agent ON resource_access_log(agent_id);
CREATE INDEX idx_resource_log_user ON resource_access_log(user_id);
CREATE INDEX idx_resource_log_type ON resource_access_log(resource_type);
CREATE INDEX idx_resource_log_created ON resource_access_log(created_at);

-- RLS
ALTER TABLE resource_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY resource_log_read ON resource_access_log
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

CREATE POLICY resource_log_insert ON resource_access_log
    FOR INSERT TO authenticated WITH CHECK (
        -- Resource gateway service or owner
        (SELECT has_role('owner'))
        OR check_oauth_client_access('resource_access_log', 'insert')
    );


-- ============================================================
-- 6. OAUTH CLIENT REGISTRATION
-- ============================================================

INSERT INTO oauth_clients (client_id, display_name, allowed_resources, allowed_operations, max_scope) VALUES
    ('resource-gateway-mcp',
     'Resource Gateway MCP Server',
     ARRAY['resource_policies', 'resource_access_log', 'approval_requests', 'agents', 'agent_role_assignments'],
     ARRAY['select', 'insert', 'update'],
     'all')
ON CONFLICT (client_id) DO NOTHING;

-- Update web-dashboard to include new tables
UPDATE oauth_clients
SET allowed_resources = array_cat(allowed_resources, ARRAY['approval_requests', 'external_identities', 'resource_policies', 'resource_access_log'])
WHERE client_id = 'web-dashboard'
AND NOT 'approval_requests' = ANY(allowed_resources);


-- ============================================================
-- 7. UPDATED BACKGROUND JOBS
-- ============================================================

-- Generalized approval expiry (replaces expire_stale_promotions)
CREATE OR REPLACE FUNCTION expire_stale_approvals()
RETURNS integer AS $$
DECLARE
    expired_count integer;
BEGIN
    UPDATE approval_requests
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < now();
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 8. MIGRATE memory_promotions → approval_requests
-- ============================================================

-- Copy existing promotions to the new approval_requests table
INSERT INTO approval_requests (
    id,
    request_type,
    requester_id,
    requester_type,
    payload,
    status,
    decided_by,
    decision_note,
    decided_at,
    result_id,
    created_at,
    expires_at
)
SELECT
    id,
    'memory_promotion',
    proposed_by,
    coalesce(proposed_by_type, 'agent'),
    jsonb_build_object(
        'source_type', source_type,
        'source_id', source_id,
        'target_type', target_type,
        'target_role', target_role,
        'proposed_namespace', proposed_namespace,
        'proposed_key', proposed_key,
        'proposed_value', proposed_value,
        'proposed_client_id', proposed_client_id,
        'proposed_tags', proposed_tags
    ),
    status::text::approval_status,
    reviewed_by,
    review_note,
    reviewed_at,
    created_memory_id,
    created_at,
    expires_at
FROM memory_promotions;

-- Keep memory_promotions for rollback but add deprecation comment
COMMENT ON TABLE memory_promotions IS 'DEPRECATED in v0.6 — data migrated to approval_requests. Table kept for rollback. Drop in v0.7.';


-- ============================================================
-- 9. SEED: Global deny rules for resource policies
--
-- These paths always require manual approval, regardless of
-- agent or role policies. Use a system-level user ID as
-- created_by (replace with actual owner user ID).
-- ============================================================

-- NOTE: Replace '00000000-0000-0000-0000-000000000000' with
-- the actual owner user UUID before running.

-- INSERT INTO resource_policies (role_id, resource_type, path_pattern, access, created_by) VALUES
--     ('_deny', 'filesystem', '**/.ssh/**',         'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'filesystem', '**/.gnupg/**',       'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'filesystem', '**/*.env',           'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'filesystem', '**/*credential*',    'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'filesystem', '**/*secret*',        'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'filesystem', '**/*.pem',           'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'filesystem', '**/*.key',           'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'sharepoint', '/sites/finance/**',  'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'sharepoint', '/sites/hr/**',       'read', '00000000-0000-0000-0000-000000000000'),
--     ('_deny', 'sharepoint', '/sites/legal/**',    'read', '00000000-0000-0000-0000-000000000000');


-- ============================================================
-- End of Migration v0.5 → v0.6
-- ============================================================
