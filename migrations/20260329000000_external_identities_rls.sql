-- ============================================================
-- RLS policies for external_identities table
-- ============================================================

ALTER TABLE external_identities ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Fix: grants_agent_read must use get_agent_id() not auth.uid()
-- The agent_id in user_agent_grants is the platform UUID from
-- agents.id, not the Supabase auth user UUID from auth.uid().
-- get_agent_id() reads app_metadata.agent_id from the JWT.
-- ============================================================
DROP POLICY IF EXISTS grants_agent_read ON user_agent_grants;
CREATE POLICY grants_agent_read ON user_agent_grants
    FOR SELECT TO authenticated
    USING (
        (SELECT get_actor_type()) = 'agent'
        AND agent_id = get_agent_id()
    );

-- Users can read/manage their own external identities
CREATE POLICY ext_id_owner ON external_identities
    FOR ALL TO authenticated
    USING (
        user_id = auth.uid()
        AND (SELECT get_actor_type()) = 'user'
    )
    WITH CHECK (
        user_id = auth.uid()
        AND (SELECT get_actor_type()) = 'user'
    );

-- Agents can read external identities for users who granted them access
CREATE POLICY ext_id_agent_read ON external_identities
    FOR SELECT TO authenticated
    USING (
        (SELECT get_actor_type()) = 'agent'
        AND EXISTS (
            SELECT 1 FROM user_agent_grants g
            WHERE g.user_id = external_identities.user_id
              AND g.agent_id = get_agent_id()
              AND g.can_read
        )
    );

-- Service role bypasses RLS (for admin operations via service key)
-- Note: service_role already bypasses RLS by default in Supabase,
-- but we add an explicit policy for clarity.
CREATE POLICY ext_id_service ON external_identities
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
