-- ============================================================
-- PORTABLE AI KNOWLEDGE PLATFORM
-- Complete Schema — v0.5
-- March 2026
--
-- Three-service architecture:
--   Service 1: Knowledge Store (vector search, ingestion)
--   Service 2: Memory (4-tier agent→user→role→company)
--   Service 3: Skills (company→role→agent skill registry)
--
-- Changes from v0.4:
-- * Generalized vendor-specific columns (halo_client_id → external_id, entra_oid → external_id)
-- * Ingestion adapter architecture (ISourceAdapter interface)
-- * Removed HaloPSA/SharePoint assumptions from schema
-- * All v0.4 features carried forward
--   * NEW: Skills system (skills, skill_versions, skill_assignments)
--   * NEW: skill_scope and skill_status enums
--   * NEW: Skills MCP server oauth_client registration
--   * NEW: Skills-related permissions seed data
--   * NEW: Ingestion log UPDATE policy (flagged in v0.3 review)
--   * NEW: Promotion expiry function
--   * NEW: check_permission() enhanced with scope comparison
--   * Separated oauth_client registrations by service boundary
--   * Added embedding_model to knowledge_chunks (from v0.3)
--   * Added status to agent_memories (from v0.3)
--   * Added embedding columns to all memory tiers (from v0.3)
-- ============================================================


-- ============================================================
-- 0. EXTENSIONS & ENUMS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Shared enums
CREATE TYPE agent_status     AS ENUM ('active', 'suspended', 'decommissioned');
CREATE TYPE memory_status    AS ENUM ('active', 'proposed', 'archived', 'superseded');
CREATE TYPE promotion_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE chunk_status     AS ENUM ('active', 'superseded', 'invalidated');
CREATE TYPE client_status    AS ENUM ('active', 'inactive', 'prospect');

-- Skills enums (new in v0.4)
CREATE TYPE skill_scope      AS ENUM ('company', 'role', 'agent');
CREATE TYPE skill_status     AS ENUM ('draft', 'published', 'deprecated', 'archived');


-- ============================================================
-- 0.5 GENERIC TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. CORE TABLES
-- ============================================================

CREATE TABLE users (
    id              uuid PRIMARY KEY REFERENCES auth.users(id),
    email           text UNIQUE NOT NULL,
    display_name    text,
    external_id     text,             -- ID in identity provider (Entra, Okta, etc.)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE clients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     text,             -- ID in source system (PSA, CRM, etc.)
    name            text NOT NULL,
    status          client_status NOT NULL DEFAULT 'active',
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_status  ON clients(status);
CREATE INDEX idx_clients_external_id ON clients(external_id);
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 2. ACL TABLES
-- ============================================================

CREATE TABLE roles (
    id              text PRIMARY KEY,
    display_name    text NOT NULL,
    description     text,
    is_service_role boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PERMISSIONS — APPLICATION-LAYER ENFORCEMENT ONLY
-- Not referenced by RLS policies. Used by MCP servers via
-- check_permission() for defense-in-depth, and by the web
-- dashboard to render role-appropriate UI.
-- ============================================================
CREATE TABLE permissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id         text NOT NULL REFERENCES roles(id),
    resource        text NOT NULL,
    operation       text NOT NULL CHECK (operation IN ('select', 'insert', 'update', 'delete')),
    scope           text NOT NULL CHECK (scope IN ('own', 'assigned', 'all', 'none')),
    conditions      jsonb,
    UNIQUE (role_id, resource, operation)
);
CREATE INDEX idx_permissions_role ON permissions(role_id);

CREATE TABLE user_roles (
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         text NOT NULL REFERENCES roles(id),
    client_ids      uuid[],
    granted_by      uuid REFERENCES users(id),
    granted_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_user    ON user_roles(user_id);
CREATE INDEX idx_user_roles_expires ON user_roles(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE oauth_clients (
    client_id          text PRIMARY KEY,
    display_name       text NOT NULL,
    allowed_resources  text[] NOT NULL,
    allowed_operations text[] NOT NULL,
    max_scope          text NOT NULL DEFAULT 'assigned',
    is_active          boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- 3. AGENT REGISTRY
-- ============================================================

CREATE TABLE agents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text UNIQUE NOT NULL,
    display_name    text,
    description     text,
    owner_id        uuid NOT NULL REFERENCES users(id),
    status          agent_status NOT NULL DEFAULT 'active',
    platform        text,
    config          jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agents_owner  ON agents(owner_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE agent_role_assignments (
    agent_id        uuid REFERENCES agents(id) ON DELETE CASCADE,
    role            text NOT NULL,
    assigned_by     uuid REFERENCES users(id),
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, role)
);

CREATE TABLE agent_client_assignments (
    agent_id        uuid REFERENCES agents(id) ON DELETE CASCADE,
    client_id       uuid REFERENCES clients(id) ON DELETE CASCADE,
    assigned_by     uuid REFERENCES users(id),
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, client_id)
);


-- ============================================================
-- 4. ACTORS VIEW
-- ============================================================

CREATE VIEW actors AS
    SELECT id, display_name, email AS identifier, 'user'  AS actor_type FROM users
    UNION ALL
    SELECT id, display_name, name  AS identifier, 'agent' AS actor_type FROM agents;


-- ============================================================
-- 5. KNOWLEDGE STORE
-- ============================================================

CREATE TABLE knowledge_chunks (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    embedding         vector(1536),
    embedding_model   text,
    content           text NOT NULL,
    summary           text,
    source_system     text NOT NULL,
    source_id         text NOT NULL,
    source_url        text,
    client_id         uuid REFERENCES clients(id),
    visibility        text NOT NULL DEFAULT 'all_staff',
    data_type         text NOT NULL,
    tags              text[] DEFAULT '{}',
    status            chunk_status NOT NULL DEFAULT 'active',
    product_name      text,
    error_code        text,
    category          text,
    embedded_at       timestamptz,
    source_updated_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_system, source_id, status)
);
CREATE INDEX idx_chunks_client          ON knowledge_chunks(client_id);
CREATE INDEX idx_chunks_status          ON knowledge_chunks(status);
CREATE INDEX idx_chunks_source          ON knowledge_chunks(source_system, source_id);
CREATE INDEX idx_chunks_visibility      ON knowledge_chunks(visibility);
CREATE INDEX idx_chunks_data_type       ON knowledge_chunks(data_type);
CREATE INDEX idx_chunks_category        ON knowledge_chunks(category);
CREATE INDEX idx_chunks_tags            ON knowledge_chunks USING gin(tags);
CREATE INDEX idx_chunks_embedding_model ON knowledge_chunks(embedding_model);
CREATE INDEX idx_chunks_embedding       ON knowledge_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);


-- ============================================================
-- 6. MEMORY TABLES — Four Tiers
-- ============================================================

-- Tier 1: Agent Memories
CREATE TABLE agent_memories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    namespace       text NOT NULL DEFAULT 'general',
    key             text NOT NULL,
    value           text NOT NULL,
    confidence      real CHECK (confidence BETWEEN 0 AND 1),
    source          text,
    tags            text[] DEFAULT '{}',
    status          memory_status NOT NULL DEFAULT 'active',
    embedding       vector(1536),
    last_accessed   timestamptz,
    access_count    integer NOT NULL DEFAULT 0,
    review_by       timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_agent_mem_active_key ON agent_memories(agent_id, namespace, key)
    WHERE status = 'active';
CREATE INDEX idx_agent_mem_agent     ON agent_memories(agent_id);
CREATE INDEX idx_agent_mem_ns        ON agent_memories(agent_id, namespace);
CREATE INDEX idx_agent_mem_tags      ON agent_memories USING gin(tags);
CREATE INDEX idx_agent_mem_status    ON agent_memories(agent_id, status);
CREATE INDEX idx_agent_mem_review    ON agent_memories(review_by) WHERE review_by IS NOT NULL;
CREATE TRIGGER trg_agent_mem_updated BEFORE UPDATE ON agent_memories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION set_agent_memory_review_by()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.review_by IS NULL THEN
        NEW.review_by := NEW.created_at + interval '90 days';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_agent_mem_review_by BEFORE INSERT ON agent_memories
    FOR EACH ROW EXECUTE FUNCTION set_agent_memory_review_by();

-- Tier 2: User Memories
CREATE TABLE user_memories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    namespace       text NOT NULL DEFAULT 'general',
    key             text NOT NULL,
    value           text NOT NULL,
    tags            text[] DEFAULT '{}',
    embedding       vector(1536),
    written_by      uuid,
    written_by_type text CHECK (written_by_type IN ('user', 'agent')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, namespace, key)
);
CREATE INDEX idx_user_mem_user ON user_memories(user_id);
CREATE INDEX idx_user_mem_tags ON user_memories USING gin(tags);
CREATE TRIGGER trg_user_mem_updated BEFORE UPDATE ON user_memories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_agent_grants (
    user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
    agent_id    uuid REFERENCES agents(id) ON DELETE CASCADE,
    can_read    boolean NOT NULL DEFAULT true,
    can_write   boolean NOT NULL DEFAULT false,
    granted_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, agent_id)
);

-- Tier 3: Role Memories
CREATE TABLE role_memories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role            text NOT NULL,
    namespace       text NOT NULL DEFAULT 'general',
    key             text NOT NULL,
    value           text NOT NULL,
    status          memory_status NOT NULL DEFAULT 'active',
    tags            text[] DEFAULT '{}',
    embedding       vector(1536),
    client_id       uuid REFERENCES clients(id),
    written_by      uuid NOT NULL,
    written_by_type text CHECK (written_by_type IN ('user', 'agent')),
    approved_by     uuid REFERENCES users(id),
    supersedes      uuid REFERENCES role_memories(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_role_mem_active_key ON role_memories(role, namespace, key)
    WHERE status = 'active';
CREATE INDEX idx_role_mem_role   ON role_memories(role);
CREATE INDEX idx_role_mem_status ON role_memories(role, status);
CREATE INDEX idx_role_mem_client ON role_memories(client_id);
CREATE INDEX idx_role_mem_tags   ON role_memories USING gin(tags);
CREATE TRIGGER trg_role_mem_updated BEFORE UPDATE ON role_memories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tier 4: Company Memories
CREATE TABLE company_memories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace       text NOT NULL DEFAULT 'general',
    key             text NOT NULL,
    value           text NOT NULL,
    status          memory_status NOT NULL DEFAULT 'active',
    tags            text[] DEFAULT '{}',
    embedding       vector(1536),
    client_id       uuid REFERENCES clients(id),
    written_by      uuid NOT NULL,
    written_by_type text CHECK (written_by_type IN ('user', 'agent')),
    approved_by     uuid REFERENCES users(id),
    supersedes      uuid REFERENCES company_memories(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_company_mem_active_key ON company_memories(namespace, key)
    WHERE status = 'active';
CREATE INDEX idx_company_mem_status ON company_memories(status);
CREATE INDEX idx_company_mem_ns     ON company_memories(namespace);
CREATE INDEX idx_company_mem_client ON company_memories(client_id);
CREATE INDEX idx_company_mem_tags   ON company_memories USING gin(tags);
CREATE TRIGGER trg_company_mem_updated BEFORE UPDATE ON company_memories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 7. SKILLS SYSTEM (NEW in v0.4)
--
-- Skills are versioned instruction sets scoped to three levels:
--   company  → all agents in the org
--   role     → agents assigned to a specific role
--   agent    → a specific user's agents
--
-- Skills differ from memories:
--   Memory = descriptive ("Client X resets firewalls on update")
--   Skill  = prescriptive ("When troubleshooting Client X, check firmware first")
--
-- Skills are authored by humans, optionally refined by agents (draft→review).
-- Each skill has immutable versions; publishing creates a new version.
-- ============================================================

CREATE TABLE skills (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    slug            text NOT NULL,                          -- URL-safe identifier (e.g. "p1-escalation-procedure")
    scope           skill_scope NOT NULL,                   -- company, role, agent
    scope_value     text,                                   -- role name (when scope=role), owner_id (when scope=agent), null (when scope=company)
    description     text,                                   -- one-liner: what this skill teaches
    current_version integer NOT NULL DEFAULT 0,             -- 0 = no published version yet
    status          skill_status NOT NULL DEFAULT 'draft',
    tags            text[] DEFAULT '{}',
    metadata        jsonb DEFAULT '{}',                     -- flexible: category, complexity, estimated_time, prerequisites
    created_by      uuid NOT NULL,
    created_by_type text NOT NULL CHECK (created_by_type IN ('user', 'agent')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_skills_slug_scope ON skills(slug, scope, coalesce(scope_value, ''))
    WHERE status != 'archived';
CREATE INDEX idx_skills_scope  ON skills(scope, scope_value);
CREATE INDEX idx_skills_status ON skills(status);
CREATE INDEX idx_skills_tags   ON skills USING gin(tags);
CREATE TRIGGER trg_skills_updated BEFORE UPDATE ON skills
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE skill_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id        uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    version         integer NOT NULL,
    content         text NOT NULL,                          -- The skill content (markdown). This IS the skill.
    change_note     text,                                   -- "Added step for firmware check", "Initial version"
    published_by    uuid,                                   -- null if still draft
    published_at    timestamptz,                            -- null if still draft
    created_by      uuid NOT NULL,
    created_by_type text NOT NULL CHECK (created_by_type IN ('user', 'agent')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (skill_id, version)
);
CREATE INDEX idx_skill_ver_skill ON skill_versions(skill_id);

-- Explicit skill assignments beyond scope-based defaults.
-- A company skill is available to all agents by default (no assignment needed).
-- A role skill is available to all agents in that role by default.
-- This table handles: overrides (disable a company skill for one agent),
-- grants (give an agent-scoped skill to a specific agent), and
-- cross-scope sharing (share a role skill with an agent not in that role).
CREATE TABLE skill_assignments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id        uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    assignee_id     uuid NOT NULL,                          -- agent_id, user_id, or synthetic role id
    assignee_type   text NOT NULL CHECK (assignee_type IN ('agent', 'user')),
    is_enabled      boolean NOT NULL DEFAULT true,          -- false = explicitly disabled for this assignee
    assigned_by     uuid REFERENCES users(id),
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (skill_id, assignee_id, assignee_type)
);
CREATE INDEX idx_skill_assign_assignee ON skill_assignments(assignee_id, assignee_type);
CREATE INDEX idx_skill_assign_skill    ON skill_assignments(skill_id);


-- ============================================================
-- 8. MEMORY PROMOTION
-- ============================================================

CREATE TABLE memory_promotions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type        text NOT NULL CHECK (source_type IN ('agent_memory', 'user_memory', 'role_memory')),
    source_id          uuid NOT NULL,
    target_type        text NOT NULL CHECK (target_type IN ('role_memory', 'company_memory')),
    target_role        text,
    proposed_namespace text NOT NULL,
    proposed_key       text NOT NULL,
    proposed_value     text NOT NULL,
    proposed_client_id uuid REFERENCES clients(id),
    proposed_tags      text[] DEFAULT '{}',
    proposed_by        uuid NOT NULL,
    proposed_by_type   text CHECK (proposed_by_type IN ('user', 'agent')),
    status             promotion_status NOT NULL DEFAULT 'pending',
    reviewed_by        uuid REFERENCES users(id),
    review_note        text,
    reviewed_at        timestamptz,
    created_memory_id  uuid,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz DEFAULT now() + interval '30 days'
);
CREATE INDEX idx_promo_status     ON memory_promotions(status);
CREATE INDEX idx_promo_proposed   ON memory_promotions(proposed_by);
CREATE INDEX idx_promo_expires    ON memory_promotions(expires_at) WHERE status = 'pending';


-- ============================================================
-- 9. INGESTION LOG
-- ============================================================

CREATE TABLE ingestion_log (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system      text NOT NULL,
    status             text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    records_processed  integer DEFAULT 0,
    chunks_created     integer DEFAULT 0,
    chunks_updated     integer DEFAULT 0,
    chunks_invalidated integer DEFAULT 0,
    errors             jsonb,
    started_at         timestamptz NOT NULL DEFAULT now(),
    completed_at       timestamptz
);
CREATE INDEX idx_ingestion_source ON ingestion_log(source_system);
CREATE INDEX idx_ingestion_status ON ingestion_log(status);


-- ============================================================
-- 10. AUDIT LOG
-- ============================================================

CREATE TABLE memory_audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name  text NOT NULL,
    record_id   uuid NOT NULL,
    action      text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'promote', 'archive')),
    actor_id    uuid NOT NULL,
    actor_type  text CHECK (actor_type IN ('user', 'agent', 'system')),
    old_value   jsonb,
    new_value   jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_table   ON memory_audit_log(table_name, record_id);
CREATE INDEX idx_audit_actor   ON memory_audit_log(actor_id);
CREATE INDEX idx_audit_created ON memory_audit_log(created_at);


-- ============================================================
-- 11. RLS HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_actor_type()
RETURNS text AS $$
    SELECT coalesce(
        current_setting('request.jwt.claims', true)::jsonb->>'actor_type',
        'user'
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_user_roles()
RETURNS text[] AS $$
    SELECT coalesce(array_agg(role_id), ARRAY[]::text[])
    FROM user_roles
    WHERE user_id = auth.uid()
    AND (expires_at IS NULL OR expires_at > now());
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_role(check_role text)
RETURNS boolean AS $$
    SELECT check_role = ANY(get_user_roles());
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_user_client_ids()
RETURNS uuid[] AS $$
DECLARE
    has_null boolean;
    ids uuid[];
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid()
        AND client_ids IS NULL
        AND (expires_at IS NULL OR expires_at > now())
    ) INTO has_null;
    IF has_null THEN RETURN NULL; END IF;
    SELECT array_agg(DISTINCT cid) INTO ids
    FROM user_roles, LATERAL unnest(client_ids) AS cid
    WHERE user_id = auth.uid()
    AND (expires_at IS NULL OR expires_at > now());
    RETURN coalesce(ids, ARRAY[]::uuid[]);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_oauth_client_access(p_resource text, p_operation text)
RETURNS boolean AS $$
DECLARE
    v_client_id text;
    v_client oauth_clients%ROWTYPE;
BEGIN
    v_client_id := current_setting('request.headers', true)::jsonb->>'x-oauth-client-id';
    IF v_client_id IS NULL THEN RETURN true; END IF;
    SELECT * INTO v_client FROM oauth_clients WHERE client_id = v_client_id;
    IF NOT FOUND OR NOT v_client.is_active THEN RETURN false; END IF;
    IF NOT (p_resource = ANY(v_client.allowed_resources)
            AND p_operation = ANY(v_client.allowed_operations)) THEN
        RETURN false;
    END IF;
    RETURN true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Application-layer permission check. Called by MCP servers, not by RLS.
CREATE OR REPLACE FUNCTION check_permission(
    p_role_id text, p_resource text, p_operation text
)
RETURNS TABLE (allowed boolean, scope text, conditions jsonb) AS $$
BEGIN
    RETURN QUERY
    SELECT true, p.scope, p.conditions
    FROM permissions p
    WHERE p.role_id = p_role_id AND p.resource = p_resource AND p.operation = p_operation;
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'none'::text, NULL::jsonb;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_agent_roles()
RETURNS text[] AS $$
    SELECT coalesce(array_agg(role), ARRAY[]::text[])
    FROM agent_role_assignments WHERE agent_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_agent_client_ids()
RETURNS uuid[] AS $$
    SELECT array_agg(client_id)
    FROM agent_client_assignments WHERE agent_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ============================================================
-- 12. ROW-LEVEL SECURITY POLICIES
-- ============================================================

ALTER TABLE knowledge_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_agent_grants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_memories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_promotions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills             ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_assignments  ENABLE ROW LEVEL SECURITY;

-- ----- Knowledge Chunks -----

CREATE POLICY chunks_staff_select ON knowledge_chunks
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user'
        AND check_oauth_client_access('knowledge_chunks', 'select')
        AND status = 'active'
        AND (
            (SELECT has_role('owner')) OR (SELECT has_role('manager'))
            OR (
                (
                    get_user_client_ids() IS NULL
                    OR client_id = ANY(get_user_client_ids())
                )
                AND visibility IN ('all_staff', 'technician_assigned')
            )
        )
    );

CREATE POLICY chunks_client_select ON knowledge_chunks
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user'
        AND (SELECT has_role('client_viewer'))
        AND status = 'active'
        AND client_id = ANY(get_user_client_ids())
        AND visibility = 'client_visible'
    );

CREATE POLICY chunks_agent_select ON knowledge_chunks
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'agent'
        AND check_oauth_client_access('knowledge_chunks', 'select')
        AND status = 'active'
        AND (
            get_agent_client_ids() IS NULL
            OR client_id = ANY(get_agent_client_ids())
        )
    );

CREATE POLICY chunks_service_insert ON knowledge_chunks
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT has_role('service_ingestion'))
        AND client_id IS NOT NULL AND source_system IS NOT NULL
    );

CREATE POLICY chunks_service_update ON knowledge_chunks
    FOR UPDATE TO authenticated USING (
        (SELECT has_role('service_ingestion'))
    );

-- ----- Agent Memories -----

CREATE POLICY agent_mem_self ON agent_memories
    FOR ALL TO authenticated
    USING  (agent_id = auth.uid() AND (SELECT get_actor_type()) = 'agent')
    WITH CHECK (agent_id = auth.uid() AND (SELECT get_actor_type()) = 'agent');

CREATE POLICY agent_mem_owner_read ON agent_memories
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user'
        AND EXISTS (SELECT 1 FROM agents WHERE agents.id = agent_memories.agent_id AND agents.owner_id = auth.uid())
    );

-- ----- User Memories -----

CREATE POLICY user_mem_owner ON user_memories
    FOR ALL TO authenticated
    USING  (user_id = auth.uid() AND (SELECT get_actor_type()) = 'user')
    WITH CHECK (user_id = auth.uid() AND (SELECT get_actor_type()) = 'user');

CREATE POLICY user_mem_agent_read ON user_memories
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'agent'
        AND EXISTS (SELECT 1 FROM user_agent_grants g
            WHERE g.user_id = user_memories.user_id AND g.agent_id = auth.uid() AND g.can_read)
    );

CREATE POLICY user_mem_agent_insert ON user_memories
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT get_actor_type()) = 'agent' AND written_by_type = 'agent'
        AND EXISTS (SELECT 1 FROM user_agent_grants g
            WHERE g.user_id = user_memories.user_id AND g.agent_id = auth.uid() AND g.can_write)
    );

CREATE POLICY user_mem_agent_update ON user_memories
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'agent'
        AND written_by = auth.uid() AND written_by_type = 'agent'
        AND EXISTS (SELECT 1 FROM user_agent_grants g
            WHERE g.user_id = user_memories.user_id AND g.agent_id = auth.uid() AND g.can_write)
    );

CREATE POLICY user_mem_agent_delete ON user_memories
    FOR DELETE TO authenticated USING (
        (SELECT get_actor_type()) = 'agent'
        AND written_by = auth.uid() AND written_by_type = 'agent'
        AND EXISTS (SELECT 1 FROM user_agent_grants g
            WHERE g.user_id = user_memories.user_id AND g.agent_id = auth.uid() AND g.can_write)
    );

-- ----- User Agent Grants -----

CREATE POLICY grants_owner ON user_agent_grants
    FOR ALL TO authenticated
    USING  (user_id = auth.uid() AND (SELECT get_actor_type()) = 'user')
    WITH CHECK (user_id = auth.uid() AND (SELECT get_actor_type()) = 'user');

-- Agent: read own grants (required for user_memories RLS subquery)
CREATE POLICY grants_agent_read ON user_agent_grants
    FOR SELECT TO authenticated
    USING (
        (SELECT get_actor_type()) = 'agent'
        AND agent_id = auth.uid()
    );

-- ----- Role Memories -----

CREATE POLICY role_mem_read ON role_memories
    FOR SELECT TO authenticated USING (
        status = 'active' AND (
            ((SELECT get_actor_type()) = 'user' AND (
                role = ANY(get_user_roles()) OR (SELECT has_role('owner')) OR (SELECT has_role('manager'))
            ))
            OR
            ((SELECT get_actor_type()) = 'agent' AND role = ANY(get_agent_roles()))
        )
    );

CREATE POLICY role_mem_write ON role_memories
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT get_actor_type()) = 'user' AND (
            role = ANY(get_user_roles()) OR (SELECT has_role('owner')) OR (SELECT has_role('manager'))
        )
    );

CREATE POLICY role_mem_update ON role_memories
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

CREATE POLICY role_mem_delete ON role_memories
    FOR DELETE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND (SELECT has_role('owner'))
    );

-- ----- Company Memories -----

CREATE POLICY company_mem_read ON company_memories
    FOR SELECT TO authenticated USING (
        status = 'active' AND (
            (SELECT get_actor_type()) = 'user'
            OR ((SELECT get_actor_type()) = 'agent'
                AND EXISTS (SELECT 1 FROM agents WHERE agents.id = auth.uid() AND agents.status = 'active'))
        )
    );

CREATE POLICY company_mem_write ON company_memories
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

CREATE POLICY company_mem_update ON company_memories
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

CREATE POLICY company_mem_delete ON company_memories
    FOR DELETE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND (SELECT has_role('owner'))
    );

-- ----- Promotions -----

CREATE POLICY promo_proposer_read ON memory_promotions
    FOR SELECT TO authenticated USING (proposed_by = auth.uid());

CREATE POLICY promo_reviewer_read ON memory_promotions
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

CREATE POLICY promo_create ON memory_promotions
    FOR INSERT TO authenticated WITH CHECK (proposed_by = auth.uid());

CREATE POLICY promo_review ON memory_promotions
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

-- ----- Skills -----

-- All authenticated users and active agents can read published skills in their scope
CREATE POLICY skills_read ON skills
    FOR SELECT TO authenticated USING (
        status = 'published' AND (
            -- Company skills: everyone
            scope = 'company'
            -- Role skills: matching role (user or agent)
            OR (scope = 'role' AND (
                ((SELECT get_actor_type()) = 'user' AND scope_value = ANY(get_user_roles()))
                OR ((SELECT get_actor_type()) = 'agent' AND scope_value = ANY(get_agent_roles()))
                OR ((SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager'))))
            ))
            -- Agent skills: the owning user or their agents
            OR (scope = 'agent' AND (
                ((SELECT get_actor_type()) = 'user' AND scope_value = auth.uid()::text)
                OR ((SELECT get_actor_type()) = 'agent' AND EXISTS (
                    SELECT 1 FROM agents WHERE agents.id = auth.uid() AND agents.owner_id::text = skills.scope_value
                ))
            ))
        )
    );

-- Managers+ can also read draft/deprecated skills (for review)
CREATE POLICY skills_read_all ON skills
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

-- Managers+ can create company and role skills; users create their own agent skills
CREATE POLICY skills_insert ON skills
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT get_actor_type()) = 'user' AND (
            (scope IN ('company', 'role') AND ((SELECT has_role('owner')) OR (SELECT has_role('manager'))))
            OR (scope = 'agent' AND scope_value = auth.uid()::text)
        )
    );

-- Managers+ can update company/role skills; users update their own agent skills
CREATE POLICY skills_update ON skills
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND (
            (scope IN ('company', 'role') AND ((SELECT has_role('owner')) OR (SELECT has_role('manager'))))
            OR (scope = 'agent' AND scope_value = auth.uid()::text)
        )
    );

-- Owner-only delete
CREATE POLICY skills_delete ON skills
    FOR DELETE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND (SELECT has_role('owner'))
    );

-- Skill versions: inherit read from parent skill (via join), write follows same rules
CREATE POLICY skill_ver_read ON skill_versions
    FOR SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM skills s WHERE s.id = skill_versions.skill_id)
    );

CREATE POLICY skill_ver_insert ON skill_versions
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT get_actor_type()) = 'user'
        AND EXISTS (
            SELECT 1 FROM skills s WHERE s.id = skill_versions.skill_id
            AND (
                (s.scope IN ('company', 'role') AND ((SELECT has_role('owner')) OR (SELECT has_role('manager'))))
                OR (s.scope = 'agent' AND s.scope_value = auth.uid()::text)
            )
        )
    );

-- Skill assignments: managers+ manage, or own agent-scoped
CREATE POLICY skill_assign_read ON skill_assignments
    FOR SELECT TO authenticated USING (
        assignee_id = auth.uid()
        OR ((SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager'))))
    );

CREATE POLICY skill_assign_write ON skill_assignments
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

CREATE POLICY skill_assign_update ON skill_assignments
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

-- ----- Audit Log -----

CREATE POLICY audit_read ON memory_audit_log
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

-- ----- Ingestion Log -----

CREATE POLICY ingestion_read ON ingestion_log
    FOR SELECT TO authenticated USING (
        (SELECT has_role('owner')) OR (SELECT has_role('manager'))
    );

CREATE POLICY ingestion_insert ON ingestion_log
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT has_role('service_ingestion'))
    );

CREATE POLICY ingestion_update ON ingestion_log
    FOR UPDATE TO authenticated USING (
        (SELECT has_role('service_ingestion'))
    );


-- ============================================================
-- 13. AUDIT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION log_memory_change()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO memory_audit_log (table_name, record_id, action, actor_id, actor_type, old_value, new_value)
    VALUES (
        TG_TABLE_NAME,
        coalesce(NEW.id, OLD.id),
        lower(TG_OP),
        auth.uid(),
        coalesce(current_setting('request.jwt.claims', true)::jsonb->>'actor_type', 'system'),
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
    );
    RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_agent_memories   AFTER INSERT OR UPDATE OR DELETE ON agent_memories   FOR EACH ROW EXECUTE FUNCTION log_memory_change();
CREATE TRIGGER audit_user_memories    AFTER INSERT OR UPDATE OR DELETE ON user_memories    FOR EACH ROW EXECUTE FUNCTION log_memory_change();
CREATE TRIGGER audit_role_memories    AFTER INSERT OR UPDATE OR DELETE ON role_memories    FOR EACH ROW EXECUTE FUNCTION log_memory_change();
CREATE TRIGGER audit_company_memories AFTER INSERT OR UPDATE OR DELETE ON company_memories FOR EACH ROW EXECUTE FUNCTION log_memory_change();


-- ============================================================
-- 14. BACKGROUND JOB FUNCTIONS
-- ============================================================

-- Flag stale agent memories for review
CREATE OR REPLACE FUNCTION flag_stale_agent_memories()
RETURNS TABLE (agent_id uuid, agent_name text, memory_count bigint) AS $$
BEGIN
    RETURN QUERY
    SELECT am.agent_id, a.name, count(*)
    FROM agent_memories am JOIN agents a ON a.id = am.agent_id
    WHERE am.review_by < now() AND am.status = 'active'
        AND am.confidence < 0.5 AND am.access_count < 3
        AND (am.last_accessed IS NULL OR am.last_accessed < am.review_by)
    GROUP BY am.agent_id, a.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Expire unreviewed promotions
CREATE OR REPLACE FUNCTION expire_stale_promotions()
RETURNS integer AS $$
DECLARE
    expired_count integer;
BEGIN
    UPDATE memory_promotions
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < now();
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 15. SEED DATA
-- ============================================================

INSERT INTO roles (id, display_name, description, is_service_role) VALUES
    ('owner',             'Owner',                    'Full administrative access',                        false),
    ('manager',           'Manager',                  'Client data access, can approve promotions',        false),
    ('technician',        'Technician',               'Assigned client data for ticket resolution',        false),
    ('client_viewer',     'Client Portal User',       'Read-only access to own organization',              false),
    ('service_ingestion', 'Ingestion Service',        'Background data sync and embedding pipeline',       true),
    ('service_agent',     'Autonomous Agent Service', 'AI agent running scheduled tasks',                  true);

-- Owner permissions
INSERT INTO permissions (role_id, resource, operation, scope) VALUES
    ('owner', 'knowledge_chunks',  'select', 'all'),
    ('owner', 'knowledge_chunks',  'insert', 'all'),
    ('owner', 'knowledge_chunks',  'update', 'all'),
    ('owner', 'knowledge_chunks',  'delete', 'all'),
    ('owner', 'user_memories',     'select', 'own'),
    ('owner', 'user_memories',     'insert', 'own'),
    ('owner', 'user_memories',     'update', 'own'),
    ('owner', 'user_memories',     'delete', 'own'),
    ('owner', 'role_memories',     'select', 'all'),
    ('owner', 'role_memories',     'insert', 'all'),
    ('owner', 'role_memories',     'update', 'all'),
    ('owner', 'role_memories',     'delete', 'all'),
    ('owner', 'company_memories',  'select', 'all'),
    ('owner', 'company_memories',  'insert', 'all'),
    ('owner', 'company_memories',  'update', 'all'),
    ('owner', 'company_memories',  'delete', 'all'),
    ('owner', 'skills',            'select', 'all'),
    ('owner', 'skills',            'insert', 'all'),
    ('owner', 'skills',            'update', 'all'),
    ('owner', 'skills',            'delete', 'all'),
    ('owner', 'clients',           'select', 'all'),
    ('owner', 'clients',           'update', 'all'),
    ('owner', 'ingestion_log',     'select', 'all'),
    ('owner', 'memory_audit_log',  'select', 'all'),
    ('owner', 'users',             'select', 'all'),
    ('owner', 'users',             'update', 'all');

-- Manager permissions
INSERT INTO permissions (role_id, resource, operation, scope) VALUES
    ('manager', 'knowledge_chunks',  'select', 'all'),
    ('manager', 'user_memories',     'select', 'own'),
    ('manager', 'user_memories',     'insert', 'own'),
    ('manager', 'user_memories',     'update', 'own'),
    ('manager', 'user_memories',     'delete', 'own'),
    ('manager', 'role_memories',     'select', 'all'),
    ('manager', 'role_memories',     'insert', 'all'),
    ('manager', 'role_memories',     'update', 'all'),
    ('manager', 'company_memories',  'select', 'all'),
    ('manager', 'company_memories',  'insert', 'all'),
    ('manager', 'company_memories',  'update', 'all'),
    ('manager', 'skills',            'select', 'all'),
    ('manager', 'skills',            'insert', 'all'),
    ('manager', 'skills',            'update', 'all'),
    ('manager', 'clients',           'select', 'all'),
    ('manager', 'ingestion_log',     'select', 'all'),
    ('manager', 'memory_audit_log',  'select', 'all'),
    ('manager', 'users',             'select', 'all');

-- Technician permissions
INSERT INTO permissions (role_id, resource, operation, scope, conditions) VALUES
    ('technician', 'knowledge_chunks', 'select', 'assigned',
     '{"visibility": ["all_staff", "technician_assigned"], "data_type": ["ticket", "kb_article", "sop"]}'),
    ('technician', 'user_memories',    'select', 'own', NULL),
    ('technician', 'user_memories',    'insert', 'own', NULL),
    ('technician', 'user_memories',    'update', 'own', NULL),
    ('technician', 'user_memories',    'delete', 'own', NULL),
    ('technician', 'role_memories',    'select', 'assigned', NULL),
    ('technician', 'role_memories',    'insert', 'assigned', NULL),
    ('technician', 'skills',           'select', 'assigned', NULL),
    ('technician', 'clients',          'select', 'assigned', NULL);

-- Client viewer permissions
INSERT INTO permissions (role_id, resource, operation, scope, conditions) VALUES
    ('client_viewer', 'knowledge_chunks', 'select', 'assigned', '{"visibility": ["client_visible"]}'),
    ('client_viewer', 'clients',          'select', 'assigned', NULL);

-- Service ingestion permissions
INSERT INTO permissions (role_id, resource, operation, scope) VALUES
    ('service_ingestion', 'knowledge_chunks', 'select', 'all'),
    ('service_ingestion', 'knowledge_chunks', 'insert', 'all'),
    ('service_ingestion', 'knowledge_chunks', 'update', 'all'),
    ('service_ingestion', 'clients',          'select', 'all'),
    ('service_ingestion', 'ingestion_log',    'select', 'all'),
    ('service_ingestion', 'ingestion_log',    'insert', 'all'),
    ('service_ingestion', 'ingestion_log',    'update', 'all');

-- OAuth client registrations (one per service boundary)
INSERT INTO oauth_clients (client_id, display_name, allowed_resources, allowed_operations, max_scope) VALUES
    ('knowledge-mcp',
     'Knowledge Query MCP Server',
     ARRAY['knowledge_chunks', 'clients'],
     ARRAY['select'],
     'all'),
    ('memory-mcp',
     'Memory MCP Server',
     ARRAY['agent_memories', 'user_memories', 'user_agent_grants', 'role_memories', 'company_memories', 'memory_promotions'],
     ARRAY['select', 'insert', 'update', 'delete'],
     'all'),
    ('skills-mcp',
     'Skills MCP Server',
     ARRAY['skills', 'skill_versions', 'skill_assignments'],
     ARRAY['select', 'insert', 'update', 'delete'],
     'all'),
    ('web-dashboard',
     'Web Dashboard',
     ARRAY['knowledge_chunks', 'clients', 'user_memories', 'role_memories', 'company_memories',
            'skills', 'skill_versions', 'skill_assignments',
            'ingestion_log', 'memory_audit_log', 'agents', 'memory_promotions'],
     ARRAY['select', 'insert', 'update'],
     'all'),
    ('ingestion-svc',
     'Ingestion Pipeline',
     ARRAY['knowledge_chunks', 'clients', 'ingestion_log'],
     ARRAY['select', 'insert', 'update'],
     'all'),
    ('routing-mcp',
     'Query Routing MCP Server',
     ARRAY['knowledge_chunks', 'role_memories', 'company_memories', 'skills', 'skill_versions'],
     ARRAY['select'],
     'all');


-- ============================================================
-- End of Schema v0.4
-- ============================================================
