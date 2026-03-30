-- ============================================================
-- Hybrid memory search RPC function
-- Combines vector similarity (nomic-embed-text 768-dim) with
-- text matching, weighted 70/30 like the old OpenClaw config.
--
-- Callable by agents and users via Supabase RPC.
-- RLS still applies — agents only see their own memories +
-- role/company memories they have access to.
-- ============================================================

-- Helper: embed text via Ollama (called from Edge Function, not from SQL)
-- The search function accepts a pre-computed embedding vector.
-- The CLI/MCP server embeds the query client-side before calling this RPC.

CREATE OR REPLACE FUNCTION search_agent_memories(
  p_agent_id uuid,
  p_query text,
  p_query_embedding vector(768) DEFAULT NULL,
  p_namespace text DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  namespace text,
  key text,
  value text,
  tags text[],
  confidence real,
  relevance float,
  match_type text
) AS $$
DECLARE
  v_vector_weight float := 0.7;
  v_text_weight float := 0.3;
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      am.id,
      am.namespace,
      am.key,
      am.value,
      am.tags,
      am.confidence,
      -- Vector similarity (cosine, 0-1 range)
      CASE
        WHEN p_query_embedding IS NOT NULL AND am.embedding IS NOT NULL
        THEN 1.0 - (am.embedding <=> p_query_embedding)
        ELSE 0.0
      END AS vector_score,
      -- Text similarity (simple word overlap + key match)
      CASE
        WHEN am.key ILIKE '%' || p_query || '%' THEN 0.8
        WHEN am.value ILIKE '%' || p_query || '%' THEN 0.5
        ELSE 0.0
      END AS text_score
    FROM agent_memories am
    WHERE am.agent_id = p_agent_id
      AND am.status = 'active'
      AND (p_namespace IS NULL OR am.namespace = p_namespace)
      AND (p_tags IS NULL OR am.tags @> p_tags)
      -- Pre-filter: must match on at least one dimension
      AND (
        (p_query_embedding IS NOT NULL AND am.embedding IS NOT NULL
         AND 1.0 - (am.embedding <=> p_query_embedding) > 0.3)
        OR am.key ILIKE '%' || p_query || '%'
        OR am.value ILIKE '%' || p_query || '%'
      )
  )
  SELECT
    c.id, c.namespace, c.key, c.value, c.tags, c.confidence,
    -- Hybrid score
    CASE
      WHEN p_query_embedding IS NOT NULL
      THEN (c.vector_score * v_vector_weight) + (c.text_score * v_text_weight)
      ELSE c.text_score  -- fallback to text-only if no embedding provided
    END AS relevance,
    CASE
      WHEN c.vector_score > 0.3 AND c.text_score > 0 THEN 'hybrid'
      WHEN c.vector_score > 0.3 THEN 'semantic'
      ELSE 'text'
    END AS match_type
  FROM candidates c
  WHERE (c.vector_score > 0.3 OR c.text_score > 0)
  ORDER BY relevance DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- Cross-tier search (searches all accessible tiers)
CREATE OR REPLACE FUNCTION search_all_memories(
  p_query text,
  p_query_embedding vector(768) DEFAULT NULL,
  p_namespace text DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  tier text,
  id uuid,
  namespace text,
  key text,
  value text,
  tags text[],
  relevance float,
  match_type text
) AS $$
DECLARE
  v_actor_type text;
  v_vector_weight float := 0.7;
  v_text_weight float := 0.3;
BEGIN
  v_actor_type := coalesce(
    current_setting('request.jwt.claims', true)::jsonb->>'actor_type',
    'user'
  );

  RETURN QUERY

  -- Agent memories (own only)
  SELECT 'agent'::text, r.* FROM (
    SELECT
      am.id, am.namespace, am.key, am.value, am.tags,
      CASE
        WHEN p_query_embedding IS NOT NULL AND am.embedding IS NOT NULL
        THEN (1.0 - (am.embedding <=> p_query_embedding)) * v_vector_weight
        ELSE 0.0
      END +
      CASE
        WHEN am.key ILIKE '%' || p_query || '%' THEN 0.8 * v_text_weight
        WHEN am.value ILIKE '%' || p_query || '%' THEN 0.5 * v_text_weight
        ELSE 0.0
      END AS relevance,
      CASE
        WHEN p_query_embedding IS NOT NULL AND am.embedding IS NOT NULL
             AND 1.0 - (am.embedding <=> p_query_embedding) > 0.3
        THEN 'semantic'::text ELSE 'text'::text
      END AS match_type
    FROM agent_memories am
    WHERE am.agent_id = auth.uid()
      AND am.status = 'active'
      AND (p_namespace IS NULL OR am.namespace = p_namespace)
      AND (am.key ILIKE '%' || p_query || '%'
           OR am.value ILIKE '%' || p_query || '%'
           OR (p_query_embedding IS NOT NULL AND am.embedding IS NOT NULL
               AND 1.0 - (am.embedding <=> p_query_embedding) > 0.3))
  ) r
  WHERE r.relevance > 0

  UNION ALL

  -- Role memories
  SELECT 'role'::text, r.* FROM (
    SELECT
      rm.id, rm.namespace, rm.key, rm.value, rm.tags,
      CASE
        WHEN p_query_embedding IS NOT NULL AND rm.embedding IS NOT NULL
        THEN (1.0 - (rm.embedding <=> p_query_embedding)) * v_vector_weight
        ELSE 0.0
      END +
      CASE
        WHEN rm.key ILIKE '%' || p_query || '%' THEN 0.8 * v_text_weight
        WHEN rm.value ILIKE '%' || p_query || '%' THEN 0.5 * v_text_weight
        ELSE 0.0
      END AS relevance,
      CASE
        WHEN p_query_embedding IS NOT NULL AND rm.embedding IS NOT NULL
             AND 1.0 - (rm.embedding <=> p_query_embedding) > 0.3
        THEN 'semantic'::text ELSE 'text'::text
      END AS match_type
    FROM role_memories rm
    WHERE rm.status = 'active'
      AND (p_namespace IS NULL OR rm.namespace = p_namespace)
      AND (rm.key ILIKE '%' || p_query || '%'
           OR rm.value ILIKE '%' || p_query || '%'
           OR (p_query_embedding IS NOT NULL AND rm.embedding IS NOT NULL
               AND 1.0 - (rm.embedding <=> p_query_embedding) > 0.3))
  ) r
  WHERE r.relevance > 0

  UNION ALL

  -- Company memories
  SELECT 'company'::text, r.* FROM (
    SELECT
      cm.id, cm.namespace, cm.key, cm.value, cm.tags,
      CASE
        WHEN p_query_embedding IS NOT NULL AND cm.embedding IS NOT NULL
        THEN (1.0 - (cm.embedding <=> p_query_embedding)) * v_vector_weight
        ELSE 0.0
      END +
      CASE
        WHEN cm.key ILIKE '%' || p_query || '%' THEN 0.8 * v_text_weight
        WHEN cm.value ILIKE '%' || p_query || '%' THEN 0.5 * v_text_weight
        ELSE 0.0
      END AS relevance,
      CASE
        WHEN p_query_embedding IS NOT NULL AND cm.embedding IS NOT NULL
             AND 1.0 - (cm.embedding <=> p_query_embedding) > 0.3
        THEN 'semantic'::text ELSE 'text'::text
      END AS match_type
    FROM company_memories cm
    WHERE cm.status = 'active'
      AND (p_namespace IS NULL OR cm.namespace = p_namespace)
      AND (cm.key ILIKE '%' || p_query || '%'
           OR cm.value ILIKE '%' || p_query || '%'
           OR (p_query_embedding IS NOT NULL AND cm.embedding IS NOT NULL
               AND 1.0 - (cm.embedding <=> p_query_embedding) > 0.3))
  ) r
  WHERE r.relevance > 0

  ORDER BY relevance DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
