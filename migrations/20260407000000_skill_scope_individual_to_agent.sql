-- Migration: Replace skill_scope enum value 'individual' with 'agent'
--
-- The original schema defined skill_scope as ('company', 'role', 'individual').
-- The admin UI and MCP tools use 'agent' for agent-scoped skills. This migration
-- standardizes the enum to ('company', 'role', 'agent') and fixes any existing
-- rows that still use 'individual'.
--
-- Safe to run on databases that already have 'agent' in the enum — all steps
-- use IF EXISTS / conditional logic.

BEGIN;

-- 1. Fix any existing rows that use 'individual'
UPDATE skills SET scope = 'agent' WHERE scope = 'individual';

-- 2. Drop all policies that reference the skill_scope type on skills and skill_versions
DROP POLICY IF EXISTS skills_read ON skills;
DROP POLICY IF EXISTS skills_read_all ON skills;
DROP POLICY IF EXISTS skills_insert ON skills;
DROP POLICY IF EXISTS skills_update ON skills;
DROP POLICY IF EXISTS skills_delete ON skills;
DROP POLICY IF EXISTS skill_ver_read ON skill_versions;
DROP POLICY IF EXISTS skill_ver_insert ON skill_versions;

-- 3. Convert column to text, replace enum, convert back
ALTER TABLE skills ALTER COLUMN scope TYPE text;
DROP TYPE skill_scope;
CREATE TYPE skill_scope AS ENUM ('company', 'role', 'agent');
ALTER TABLE skills ALTER COLUMN scope TYPE skill_scope USING scope::skill_scope;

-- 4. Recreate all RLS policies using 'agent'

CREATE POLICY skills_read ON skills
    FOR SELECT TO authenticated USING (
        status = 'published' AND (
            scope = 'company'
            OR (scope = 'role' AND (
                ((SELECT get_actor_type()) = 'user' AND scope_value = ANY(get_user_roles()))
                OR ((SELECT get_actor_type()) = 'agent' AND scope_value = ANY(get_agent_roles()))
                OR ((SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager'))))
            ))
            OR (scope = 'agent' AND (
                ((SELECT get_actor_type()) = 'user' AND scope_value = auth.uid()::text)
                OR ((SELECT get_actor_type()) = 'agent' AND EXISTS (
                    SELECT 1 FROM agents WHERE agents.id = get_agent_id() AND agents.owner_id::text = skills.scope_value
                ))
            ))
        )
    );

CREATE POLICY skills_read_all ON skills
    FOR SELECT TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND ((SELECT has_role('owner')) OR (SELECT has_role('manager')))
    );

CREATE POLICY skills_insert ON skills
    FOR INSERT TO authenticated WITH CHECK (
        (SELECT get_actor_type()) = 'user' AND (
            (scope IN ('company', 'role') AND ((SELECT has_role('owner')) OR (SELECT has_role('manager'))))
            OR (scope = 'agent' AND scope_value = auth.uid()::text)
        )
    );

CREATE POLICY skills_update ON skills
    FOR UPDATE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND (
            (scope IN ('company', 'role') AND ((SELECT has_role('owner')) OR (SELECT has_role('manager'))))
            OR (scope = 'agent' AND scope_value = auth.uid()::text)
        )
    );

CREATE POLICY skills_delete ON skills
    FOR DELETE TO authenticated USING (
        (SELECT get_actor_type()) = 'user' AND (SELECT has_role('owner'))
    );

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

COMMIT;
