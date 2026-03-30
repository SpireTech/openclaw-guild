-- RPC function for semantic search over knowledge_chunks using pgvector cosine distance
CREATE OR REPLACE FUNCTION search_knowledge_chunks(
    query_embedding vector(1536),
    filter_client_id uuid DEFAULT NULL,
    filter_data_type text DEFAULT NULL,
    filter_category text DEFAULT NULL,
    filter_product_name text DEFAULT NULL,
    filter_error_code text DEFAULT NULL,
    filter_tags text[] DEFAULT NULL,
    similarity_min float DEFAULT 0.7,
    result_limit int DEFAULT 10
)
RETURNS TABLE (
    id uuid,
    content text,
    summary text,
    similarity float,
    source_system text,
    source_url text,
    client_id uuid,
    data_type text,
    category text,
    product_name text,
    error_code text,
    tags text[],
    source_updated_at timestamptz
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        kc.id,
        kc.content,
        kc.summary,
        (1 - (kc.embedding <=> query_embedding))::float AS similarity,
        kc.source_system,
        kc.source_url,
        kc.client_id,
        kc.data_type,
        kc.category,
        kc.product_name,
        kc.error_code,
        kc.tags,
        kc.source_updated_at
    FROM knowledge_chunks kc
    WHERE kc.status = 'active'
      AND (filter_client_id IS NULL OR kc.client_id = filter_client_id)
      AND (filter_data_type IS NULL OR kc.data_type = filter_data_type)
      AND (filter_category IS NULL OR kc.category = filter_category)
      AND (filter_product_name IS NULL OR kc.product_name = filter_product_name)
      AND (filter_error_code IS NULL OR kc.error_code = filter_error_code)
      AND (filter_tags IS NULL OR kc.tags @> filter_tags)
      AND (1 - (kc.embedding <=> query_embedding)) >= similarity_min
    ORDER BY kc.embedding <=> query_embedding
    LIMIT result_limit;
$$;

COMMENT ON FUNCTION search_knowledge_chunks IS 'Semantic similarity search over knowledge_chunks using pgvector cosine distance. Respects RLS via SECURITY INVOKER.';
