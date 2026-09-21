-- ============================================================================
-- ByteMind Step 5.6: Persistent Vector Storage Schema
-- Target: PostgreSQL with pgvector (supports Supabase PostgreSQL)
-- Vector Dimensionality: 768 (matching Google Gemini's gemini-embedding-2)
-- ============================================================================

-- 1. Enable the pgvector extension for high-dimensional vector math
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create the documents table for persistent document metadata
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  page_count INTEGER DEFAULT 0,
  text_length INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on filename for fast lookup by document title
CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);

-- 3. Create the document_chunks table with 768-D vector embeddings
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Composite index on document_id and chunk_index for sequential retrieval
CREATE INDEX IF NOT EXISTS idx_chunks_document_chunk_idx 
ON document_chunks(document_id, chunk_index);

-- 4. Create an Approximate Nearest Neighbor (ANN) HNSW index for ultra-fast cosine similarity search
-- HNSW (Hierarchical Navigable Small World) provides sub-10ms logarithmic search across large datasets
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw 
ON document_chunks 
USING hnsw (embedding vector_cosine_ops);

-- 5. Stored function for database-level vector similarity search
-- Calculates cosine similarity: 1 - (embedding <=> query_embedding)
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.0,
  match_count int DEFAULT 3,
  filter_document_id uuid DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  filename text,
  chunk_index int,
  content text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id AS chunk_id,
    dc.document_id,
    d.filename,
    dc.chunk_index,
    dc.content,
    (1 - (dc.embedding <=> query_embedding))::float AS similarity
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE (filter_document_id IS NULL OR dc.document_id = filter_document_id)
    AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;
