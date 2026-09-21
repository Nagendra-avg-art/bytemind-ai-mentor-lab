/**
 * server/db/vectorStore.js
 * 
 * WHY THIS MODULE IS NEEDED:
 * Step 5.6 of ByteMind RAG: Persistent Vector Storage with PostgreSQL and pgvector.
 * 
 * Architectural Highlights:
 * 1. Dual Storage Engine:
 *    - Primary: PostgreSQL with pgvector (supports Supabase PostgreSQL or self-hosted Postgres).
 *    - Development Fallback: In-memory JavaScript Map (zero configuration, works out-of-the-box).
 * 2. Strict Dimensionality:
 *    - Validates that all vectors match exactly 768 dimensions (from gemini-embedding-2).
 * 3. Safe Degradation:
 *    - If DB connection fails or environment variables are missing, it logs a helpful warning
 *      and falls back seamlessly to memory without crashing the server.
 * 4. Security:
 *    - Keeps all connection strings server-side.
 *    - Never returns raw vector embeddings to the frontend.
 */

import pg from 'pg';
import {
  storeEmbeddedDocument,
  getEmbeddedDocument,
  getAllEmbeddedChunks,
} from '../utils/embeddingService.js';
import { cosineSimilarity } from '../utils/similarity.js';

const { Pool } = pg;

export const EXPECTED_VECTOR_DIMENSIONS = 768;

// Pool instance and connection health state
let pool = null;
let isDbAvailable = false;
let hasInitialized = false;

/**
 * Checks whether database connection environment variables are defined.
 * Supports standard PostgreSQL variables and Supabase connection strings.
 * 
 * @returns {boolean}
 */
export function isDbConfigured() {
  const env = process.env;
  return Boolean(
    env.DATABASE_URL ||
    env.SUPABASE_DB_URL ||
    env.POSTGRES_URL ||
    (env.PGHOST && env.PGDATABASE && env.PGUSER)
  );
}

/**
 * Returns current storage mode: 'pgvector' or 'memory' (fallback).
 * @returns {'pgvector' | 'memory'}
 */
export function getStorageMode() {
  return isDbConfigured() && isDbAvailable ? 'pgvector' : 'memory';
}

/**
 * Initializes the PostgreSQL connection pool and validates pgvector availability.
 * @returns {Promise<boolean>} Whether database connection and pgvector extension are operational.
 */
export async function initDatabase() {
  if (!isDbConfigured()) {
    console.log('ℹ️  No database credentials found in .env. Using in-memory vector storage fallback.');
    isDbAvailable = false;
    hasInitialized = true;
    return false;
  }

  try {
    const connectionConfig = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL
      ? {
          connectionString:
            process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL,
          ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('supabase')
            ? { rejectUnauthorized: false }
            : false,
        }
      : {
          host: process.env.PGHOST || 'localhost',
          port: Number(process.env.PGPORT) || 5432,
          database: process.env.PGDATABASE,
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
        };

    pool = new Pool({
      ...connectionConfig,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test connectivity
    const client = await pool.connect();
    try {
      // 1. Check/Enable pgvector extension
      await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

      // 2. Ensure schema tables exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          filename TEXT NOT NULL,
          page_count INTEGER DEFAULT 0,
          text_length INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS document_chunks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          embedding vector(${EXPECTED_VECTOR_DIMENSIONS}) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw 
        ON document_chunks USING hnsw (embedding vector_cosine_ops);
      `);

      isDbAvailable = true;
      console.log('🐘 PostgreSQL + pgvector connected successfully. Persistent vector storage active.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(
      `⚠️  Could not connect to PostgreSQL (${err.message}). Falling back to in-memory vector storage.`
    );
    isDbAvailable = false;
  }

  hasInitialized = true;
  return isDbAvailable;
}

/**
 * Saves an uploaded document and its embedded chunks.
 * Uses PostgreSQL if available; otherwise saves to in-memory store.
 * 
 * @param {object} params
 * @param {string} params.filename - Original PDF filename
 * @param {number} [params.pageCount=1] - Number of pages
 * @param {number} [params.textLength=0] - Total text character length
 * @param {Array<{ chunkId: string, documentId: string, chunkIndex: number, text: string, embedding: number[] }>} params.chunksWithEmbeddings
 * 
 * @returns {Promise<{
 *   success: boolean,
 *   documentId: string,
 *   storageMode: 'pgvector' | 'memory',
 *   chunksCount: number
 * }>}
 */
export async function saveDocumentAndChunks({
  filename,
  pageCount = 1,
  textLength = 0,
  chunksWithEmbeddings,
}) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Valid filename is required.');
  }

  if (!Array.isArray(chunksWithEmbeddings) || chunksWithEmbeddings.length === 0) {
    throw new Error('No chunks with embeddings provided to save.');
  }

  // Strict validation of vector dimensions (768)
  for (let i = 0; i < chunksWithEmbeddings.length; i++) {
    const c = chunksWithEmbeddings[i];
    if (!c.embedding || !Array.isArray(c.embedding) || c.embedding.length !== EXPECTED_VECTOR_DIMENSIONS) {
      throw new Error(
        `Invalid embedding dimension at chunk ${i} (${c.chunkId || 'unknown'}). Expected ${EXPECTED_VECTOR_DIMENSIONS}, received ${c.embedding?.length || 0}.`
      );
    }
  }

  // Always keep in-memory cache synchronized as a warm fallback
  storeEmbeddedDocument(filename, chunksWithEmbeddings);

  // If database is configured and available, persist to PostgreSQL
  if (isDbConfigured() && isDbAvailable && pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert document row
      const docInsertRes = await client.query(
        `INSERT INTO documents (filename, page_count, text_length)
         VALUES ($1, $2, $3)
         RETURNING id;`,
        [filename, pageCount, textLength]
      );
      const dbDocId = docInsertRes.rows[0].id;

      // 2. Batch insert chunks with vector formatting
      for (const chunk of chunksWithEmbeddings) {
        // Format vector for pgvector input: '[0.0123, -0.0456, ...]'
        const vectorString = `[${chunk.embedding.join(',')}]`;

        await client.query(
          `INSERT INTO document_chunks (document_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4::vector);`,
          [dbDocId, chunk.chunkIndex, chunk.text, vectorString]
        );
      }

      await client.query('COMMIT');

      return {
        success: true,
        documentId: dbDocId,
        filename,
        storageMode: 'pgvector',
        chunksCount: chunksWithEmbeddings.length,
      };
    } catch (dbError) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database insert error, falling back to memory:', dbError.message);
      // Seamlessly fall back to in-memory result
      return {
        success: true,
        documentId: filename,
        filename,
        storageMode: 'memory',
        chunksCount: chunksWithEmbeddings.length,
      };
    } finally {
      client.release();
    }
  }

  // In-memory fallback return
  return {
    success: true,
    documentId: filename,
    filename,
    storageMode: 'memory',
    chunksCount: chunksWithEmbeddings.length,
  };
}

/**
 * Searches for top-K similar chunks given a 768-D query embedding.
 * Uses pgvector cosine distance if available; otherwise uses in-memory cosine similarity.
 * 
 * @param {object} params
 * @param {number[]} params.queryEmbedding - 768-element numerical vector
 * @param {number} [params.topK=3] - Max chunks to return
 * @param {string} [params.documentId] - Optional document filter (matches filename or UUID)
 * @param {number} [params.threshold=0.0] - Minimum similarity threshold
 * 
 * @returns {Promise<Array<{
 *   chunkId: string,
 *   documentId: string,
 *   filename: string,
 *   chunkIndex: number,
 *   content: string,
 *   similarity: number
 * }>>}
 */
export async function searchVectorChunks({
  queryEmbedding,
  topK = 3,
  documentId,
  threshold = 0.0,
}) {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== EXPECTED_VECTOR_DIMENSIONS) {
    throw new Error(
      `Invalid query embedding dimension. Expected ${EXPECTED_VECTOR_DIMENSIONS}, received ${queryEmbedding?.length || 0}.`
    );
  }

  const sanitizedTopK = Math.max(1, Number.isInteger(topK) ? topK : 3);

  // Persistent PostgreSQL / pgvector search
  if (isDbConfigured() && isDbAvailable && pool) {
    try {
      const vectorString = `[${queryEmbedding.join(',')}]`;
      const queryParams = [vectorString, threshold, sanitizedTopK];

      let filterClause = '';
      if (documentId && typeof documentId === 'string' && documentId.trim()) {
        const cleanDocId = documentId.trim();
        queryParams.push(cleanDocId);
        filterClause = `AND (d.filename = $4 OR dc.document_id::text = $4)`;
      }

      const sql = `
        SELECT
          dc.id AS "chunkId",
          dc.document_id AS "documentId",
          d.filename,
          dc.chunk_index AS "chunkIndex",
          dc.content,
          (1 - (dc.embedding <=> $1::vector))::float AS similarity
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE (1 - (dc.embedding <=> $1::vector)) >= $2
          ${filterClause}
        ORDER BY dc.embedding <=> $1::vector ASC
        LIMIT $3;
      `;

      const result = await pool.query(sql, queryParams);

      if (result.rows && result.rows.length > 0) {
        return result.rows.map((r) => ({
          chunkId: r.chunkId,
          documentId: r.documentId,
          filename: r.filename,
          chunkIndex: r.chunkIndex,
          page: null,
          content: r.content,
          similarity: Number(r.similarity.toFixed(4)),
        }));
      }
    } catch (sqlError) {
      console.warn('Vector query failed in PostgreSQL, falling back to memory search:', sqlError.message);
    }
  }

  // In-memory fallback similarity search
  let targetChunks;
  if (documentId && typeof documentId === 'string' && documentId.trim()) {
    targetChunks = getEmbeddedDocument(documentId.trim());
  } else {
    targetChunks = getAllEmbeddedChunks();
  }

  if (!targetChunks || !Array.isArray(targetChunks) || targetChunks.length === 0) {
    return [];
  }

  const scored = [];
  for (const chunk of targetChunks) {
    if (!chunk.embedding || !Array.isArray(chunk.embedding)) continue;
    const sim = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (sim >= threshold) {
      scored.push({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        filename: chunk.filename || chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        page: chunk.page || null,
        content: chunk.text,
        similarity: Number(sim.toFixed(4)),
      });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, sanitizedTopK);
}
