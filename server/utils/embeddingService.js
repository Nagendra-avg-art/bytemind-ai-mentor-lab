/**
 * server/utils/embeddingService.js
 * 
 * WHY THIS MODULE IS NEEDED:
 * Step 5.3 of ByteMind RAG: Optimized Vector Embeddings for Document Chunks.
 * 
 * Key Responsibilities:
 * 1. Interfaces with Google Gemini's `gemini-embedding-2` model using the official `@google/genai` SDK.
 * 2. Compresses semantic meaning of text into 768-dimensional numerical vectors.
 * 3. Efficient Batch Embedding:
 *    - Uses official @google/genai batching via ai.models.embedContent({ contents: [...] }).
 *    - Executes multiple chunk embeddings in a single HTTP request instead of slow serial calls.
 * 4. Resilient Error & Data Contract Handling:
 *    - Normalizes chunk data contract (safely resolves text from chunk.text, chunk.content, or chunk.preview).
 *    - Validates that trimmed chunk text is non-empty before calling Gemini.
 *    - Retries transient API errors (HTTP 429, 503, network timeouts) with exponential backoff (max 2 retries).
 * 5. In-Memory Caching:
 *    - Reuses previously computed document embeddings (documentId -> embeddedChunks) to avoid redundant API calls.
 * 6. Keeps GEMINI_API_KEY secure strictly on the server.
 */

import { GoogleGenAI } from '@google/genai';
import { getActiveProvider, getActiveProviderName } from '../providers/index.js';

const EMBEDDING_MODEL = 'gemini-embedding-2';
const EMBEDDING_DIMENSIONS = 768;
const MAX_BATCH_SIZE = 50; // Maximum chunk count per single Gemini batch embedContent call

// In-memory caches for the active session (keeps vectors in server RAM)
const rawChunksStore = new Map();
const embeddedDocumentsStore = new Map();

/**
 * Validates and initializes the GoogleGenAI SDK client for Gemini provider fallback.
 * @returns {GoogleGenAI}
 */
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please verify your .env configuration.'
    );
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

/**
 * Normalizes an arbitrary chunk input into the canonical internal chunk contract:
 * {
 *   chunkId: string,
 *   documentId: string,
 *   chunkIndex: number,
 *   text: string,
 *   wordCount?: number,
 *   charCount?: number
 * }
 * 
 * Safely supports property names used across the codebase:
 * - chunk.text (primary from chunker.js)
 * - chunk.content (from vectorStore.js)
 * - chunk.preview (from lightweight client payloads)
 * 
 * @param {any} chunk - Raw chunk object or string
 * @param {number} index - Array index for error reporting
 * @param {string} [fallbackDocId] - Document ID if missing from chunk
 * @returns {{ chunkId: string, documentId: string, chunkIndex: number, text: string, wordCount: number, charCount: number }}
 */
export function normalizeChunk(chunk, index, fallbackDocId = 'document') {
  if (!chunk) {
    throw new Error(`Chunk at index ${index} is null or undefined.`);
  }

  // 1. Resolve raw text from known property names
  const rawText = typeof chunk === 'string'
    ? chunk
    : (chunk.text ?? chunk.content ?? chunk.preview ?? '');

  // 2. Trim whitespace before validation
  const trimmedText = typeof rawText === 'string' ? rawText.trim() : '';

  // 3. Resolve metadata identifiers
  const documentId = chunk.documentId || fallbackDocId || 'document';
  const chunkIndex = typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : (index + 1);
  const chunkId = chunk.chunkId || `${documentId}_chunk_${chunkIndex}`;

  // 4. Strict validation: If genuinely empty after trimming, report clear error
  if (!trimmedText) {
    throw new Error(`Chunk at index ${index} (${chunkId}) contains empty text.`);
  }

  return {
    chunkId,
    documentId,
    chunkIndex,
    text: trimmedText, // Valid chunk text retained
    wordCount: chunk.wordCount || (trimmedText.match(/\S+/g)?.length || 0),
    charCount: trimmedText.length,
  };
}

/**
 * Generates a 768-dimensional embedding vector for a single string of text (e.g. user question).
 * Includes transient retry handling (max 2 retries) with exponential backoff.
 * 
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} - 768-element floating point array
 */
export async function generateEmbedding(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('Cannot generate embedding for empty or missing text.');
  }

  const trimmedText = text.trim();
  const provider = getActiveProvider();
  const activeProviderName = getActiveProviderName();

  // 1. If local Ollama provider is active, strictly use Ollama embeddings (never call Gemini)
  if (activeProviderName === 'ollama') {
    if (!provider || typeof provider.embed !== 'function') {
      throw new Error('OllamaProvider is active but embed() is not implemented.');
    }
    const result = await provider.embed({ input: trimmedText });
    if (result && Array.isArray(result.embeddings) && result.embeddings[0]) {
      return result.embeddings[0];
    }
    throw new Error('Ollama embedding service responded but returned no vector.');
  }

  // 2. If cloud Groq provider is active, Groq does not generate vector embeddings (never call Gemini)
  if (activeProviderName === 'groq') {
    throw new Error('AI_PROVIDER=groq uses lexical BM25 retrieval over text chunks and does not generate vector embeddings.');
  }

  // 3. Gemini Provider (optional fallback / explicit AI_PROVIDER=gemini)
  const ai = getGenAIClient();
  let attempt = 0;
  const maxRetries = 3;

  while (attempt <= maxRetries) {
    try {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: trimmedText,
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
        },
      });

      const values = response?.embedding?.values || response?.embeddings?.[0]?.values;
      if (!values || !Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Gemini embedding model returned invalid vector dimensions: expected ${EMBEDDING_DIMENSIONS}, received ${values?.length || 0}`
        );
      }

      return values;
    } catch (error) {
      attempt++;
      const msg = error instanceof Error ? error.message : 'Unknown embedding error';
      const isTransient =
        msg.includes('429') ||
        msg.toLowerCase().includes('quota') ||
        msg.toLowerCase().includes('rate limit') ||
        msg.includes('503') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT');

      if (isTransient && attempt <= maxRetries) {
        const delay = attempt * 2000;
        console.warn(`[RAG] Transient error during query embedding (attempt ${attempt}/${maxRetries}): Rate limit or temporary issue. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error('Error generating embedding with gemini-embedding-2:', error);
        throw new Error(`Embedding generation failed: ${msg}`);
      }
    }
  }
}

/**
 * Calls Gemini batch embedding API for a sub-slice of texts with transient retry logic.
 * 
 * Uses the official @google/genai SDK pattern:
 * contents: subBatch.map(text => ({ parts: [{ text }] }))
 * which maps to models/gemini-embedding-2:batchEmbedContents.
 * 
 * @param {GoogleGenAI} ai
 * @param {string[]} texts
 * @param {number} [maxRetries=2]
 * @returns {Promise<number[][]>}
 */
async function embedTextBatchWithRetry(ai, texts, maxRetries = 3) {
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: texts.map((t) => ({ parts: [{ text: t }] })),
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
        },
      });

      const embeddings = response?.embeddings;
      if (!embeddings || !Array.isArray(embeddings) || embeddings.length !== texts.length) {
        throw new Error(
          `Gemini batch embedding returned ${embeddings?.length || 0} vectors for ${texts.length} input texts.`
        );
      }

      return embeddings.map((e, idx) => {
        if (!e.values || !Array.isArray(e.values) || e.values.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding at index ${idx} did not return ${EMBEDDING_DIMENSIONS} dimensions (received ${e.values?.length || 0}).`
          );
        }
        return e.values;
      });
    } catch (error) {
      attempt++;
      const msg = error instanceof Error ? error.message : 'Unknown batch embedding error';
      const isTransient =
        msg.includes('429') ||
        msg.toLowerCase().includes('quota') ||
        msg.toLowerCase().includes('rate limit') ||
        msg.includes('503') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT');

      if (isTransient && attempt <= maxRetries) {
        const delay = attempt * 2000;
        console.warn(`[RAG] Transient batch embedding error (attempt ${attempt}/${maxRetries}): Rate limit or temporary issue. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error('Batch embedding failed:', error);
        throw new Error(`Gemini batch embedding failed: ${msg}`);
      }
    }
  }
}

/**
 * Generates embeddings for an array of document chunks.
 * 
 * Features:
 * 1. Normalizes all chunk objects and validates non-empty text.
 * 2. In-memory cache check: if documentId is already embedded, reuses stored vectors immediately.
 * 3. Batching: Uses Gemini batchEmbedContents to embed all chunks in 1 (or few) network requests.
 * 4. 1:1 mapping: Guarantees embedding[i] corresponds to normalizedChunks[i].
 * 
 * @param {Array<any>} rawChunks - Chunks to embed
 * @param {string} [documentId] - Optional document identifier for caching
 * @returns {Promise<Array<{ chunkId: string, documentId: string, chunkIndex: number, text: string, wordCount: number, charCount: number, embedding: number[] }>>}
 */
export async function embedChunks(rawChunks, documentId) {
  if (!Array.isArray(rawChunks) || rawChunks.length === 0) {
    throw new Error('No chunks provided to embed.');
  }

  const cleanDocId = documentId || rawChunks[0]?.documentId || 'document';
  const provider = getActiveProvider();
  const activeProviderName = getActiveProviderName();
  const activeModel = activeProviderName === 'ollama'
    ? (process.env.OLLAMA_EMBED_MODEL || 'qwen3-embedding:0.6b')
    : activeProviderName === 'groq'
    ? (process.env.GROQ_EMBED_MODEL || 'groq-embedding')
    : EMBEDDING_MODEL;

  // 1. Check in-memory cache: if already embedded, verify provider matches to prevent mixing
  if (cleanDocId && embeddedDocumentsStore.has(cleanDocId)) {
    const cached = embeddedDocumentsStore.get(cleanDocId);
    if (Array.isArray(cached) && cached.length > 0) {
      const cachedProvider = cached[0]?.embeddingProvider || 'gemini';
      if (cachedProvider === activeProviderName) {
        console.log(`[RAG] Embedding reused from cache for document "${cleanDocId}" (${cached.length} chunks, provider: ${cachedProvider}).`);
        return cached;
      } else {
        console.log(`[RAG] Invalidating cache for "${cleanDocId}" due to provider switch (${cachedProvider} -> ${activeProviderName}).`);
        embeddedDocumentsStore.delete(cleanDocId);
      }
    }
  }

  // 2. Normalize each chunk into canonical contract: { chunkId, documentId, chunkIndex, text, wordCount, charCount }
  const normalizedChunks = rawChunks.map((chunk, index) =>
    normalizeChunk(chunk, index, cleanDocId)
  );

  const allVectors = [];

  // 3. Process with active provider
  if (activeProviderName === 'ollama' && provider && typeof provider.embed === 'function') {
    const allTexts = normalizedChunks.map((c) => c.text);
    for (let i = 0; i < allTexts.length; i += 20) {
      const slice = allTexts.slice(i, i + 20);
      const res = await provider.embed({ input: slice });
      if (!res.embeddings || res.embeddings.length !== slice.length) {
        throw new Error(`Ollama embed returned ${res.embeddings?.length || 0} vectors for ${slice.length} chunks`);
      }
      allVectors.push(...res.embeddings);
    }
  } else if (activeProviderName === 'groq') {
    throw new Error('AI_PROVIDER=groq uses lexical BM25 retrieval over text chunks and does not generate vector embeddings. Use storeDocumentChunks() instead.');
  } else {
    const ai = getGenAIClient();
    for (let i = 0; i < normalizedChunks.length; i += MAX_BATCH_SIZE) {
      const slice = normalizedChunks.slice(i, i + MAX_BATCH_SIZE);
      const sliceTexts = slice.map((c) => c.text);
      const vectors = await embedTextBatchWithRetry(ai, sliceTexts);
      allVectors.push(...vectors);
    }
  }

  // 4. Verify 1:1 mapping
  if (allVectors.length !== normalizedChunks.length) {
    throw new Error(
      `Embedding count mismatch: expected ${normalizedChunks.length} vectors, generated ${allVectors.length}.`
    );
  }

  // 5. Assemble stored chunk structures with embedding metadata (Requirement 3)
  const embeddedChunks = normalizedChunks.map((chunk, idx) => ({
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    wordCount: chunk.wordCount,
    charCount: chunk.charCount,
    embedding: allVectors[idx],
    embeddingProvider: activeProviderName,
    embeddingModel: activeModel,
    embeddingDimension: allVectors[idx]?.length || EMBEDDING_DIMENSIONS,
  }));

  // 6. Cache in memory store
  storeEmbeddedDocument(cleanDocId, embeddedChunks);

  return embeddedChunks;
}

/**
 * Cache raw chunks in server RAM for retrieval by documentId
 */
export function storeDocumentChunks(documentId, chunks) {
  if (documentId && chunks) {
    rawChunksStore.set(documentId, chunks);
  }
}

/**
 * Retrieve cached raw chunks from server RAM
 */
export function getDocumentChunks(documentId) {
  return rawChunksStore.get(documentId);
}

/**
 * Cache embedded chunks in server RAM for retrieval by documentId
 */
export function storeEmbeddedDocument(documentId, embeddedChunks) {
  if (documentId && embeddedChunks) {
    embeddedDocumentsStore.set(documentId, embeddedChunks);
  }
}

/**
 * Retrieve cached embedded chunks from server RAM with flexible lookup.
 * Supports exact match, sanitized keys, with/without .pdf extension,
 * case-insensitive matching, and chunk-level metadata matching.
 * 
 * @param {string} documentId
 * @returns {Array<{ chunkId: string, documentId: string, chunkIndex: number, text: string, embedding: number[] }> | undefined}
 */
/**
 * Retrieve cached embedded chunks from server RAM with flexible lookup.
 * Supports exact match, sanitized keys, with/without .pdf extension,
 * case-insensitive matching, and chunk-level metadata matching.
 * Validates that chunks belong to requiredProvider (defaults to active provider).
 * 
 * @param {string} documentId
 * @param {string} [requiredProvider] - e.g. 'ollama' or 'gemini'
 * @returns {Array<{ chunkId: string, documentId: string, chunkIndex: number, text: string, embedding: number[], embeddingProvider?: string, embeddingModel?: string, embeddingDimension?: number }> | undefined}
 */
export function getEmbeddedDocument(documentId, requiredProvider) {
  if (!documentId || typeof documentId !== 'string') return undefined;
  const raw = documentId.trim();
  const targetProvider = requiredProvider || getActiveProviderName();

  let chunks;
  // 1. Exact key match
  if (embeddedDocumentsStore.has(raw)) {
    chunks = embeddedDocumentsStore.get(raw);
  } else {
    // 2. Sanitized key match (e.g. spaces/special chars converted to _)
    const sanitized = raw.replace(/[^\w.-]/g, '_');
    if (embeddedDocumentsStore.has(sanitized)) {
      chunks = embeddedDocumentsStore.get(sanitized);
    } else {
      // 3. Match with or without .pdf extension
      const withoutExt = raw.toLowerCase().endsWith('.pdf') ? raw.slice(0, -4) : raw;
      const withExt = raw.toLowerCase().endsWith('.pdf') ? raw : `${raw}.pdf`;

      if (embeddedDocumentsStore.has(withoutExt)) chunks = embeddedDocumentsStore.get(withoutExt);
      else if (embeddedDocumentsStore.has(withExt)) chunks = embeddedDocumentsStore.get(withExt);
      else {
        // 4. Case-insensitive key match
        const lowerRaw = raw.toLowerCase();
        for (const [key, val] of embeddedDocumentsStore.entries()) {
          const lowerKey = key.toLowerCase();
          if (
            lowerKey === lowerRaw ||
            lowerKey === withoutExt.toLowerCase() ||
            lowerKey === withExt.toLowerCase()
          ) {
            chunks = val;
            break;
          }
        }

        // 5. Inspect chunk metadata in stored documents
        if (!chunks) {
          for (const val of embeddedDocumentsStore.values()) {
            if (Array.isArray(val) && val.length > 0) {
              const first = val[0];
              const chunkDocId = (first.documentId || '').toLowerCase();
              const chunkFilename = (first.filename || '').toLowerCase();
              if (
                chunkDocId === lowerRaw ||
                chunkFilename === lowerRaw ||
                chunkDocId === withoutExt.toLowerCase() ||
                chunkFilename === withoutExt.toLowerCase()
              ) {
                chunks = val;
                break;
              }
            }
          }
        }
      }
    }
  }

  if (Array.isArray(chunks) && chunks.length > 0) {
    const chunkProvider = chunks[0]?.embeddingProvider || 'gemini';
    if (targetProvider && targetProvider !== 'groq' && chunkProvider !== targetProvider) {
      // Different embedding provider/model vectors cannot be mixed in cosine similarity
      return undefined;
    }
    return chunks;
  }

  return undefined;
}

/**
 * Retrieve all raw/extracted document chunks currently cached in server RAM.
 * Useful for provider-independent lexical / BM25 search.
 * @returns {Array<any>}
 */
export function getAllRawChunks() {
  const allChunks = [];
  const visitedArrays = new Set();

  for (const chunks of rawChunksStore.values()) {
    if (Array.isArray(chunks) && !visitedArrays.has(chunks)) {
      visitedArrays.add(chunks);
      allChunks.push(...chunks);
    }
  }

  // Also include chunks from embeddedDocumentsStore if rawChunksStore has fewer
  for (const chunks of embeddedDocumentsStore.values()) {
    if (Array.isArray(chunks) && !visitedArrays.has(chunks)) {
      visitedArrays.add(chunks);
      allChunks.push(...chunks);
    }
  }

  return allChunks;
}

/**
 * Checks whether a specific document has already been embedded/indexed in server RAM for the required provider.
 * @param {string} documentId
 * @param {string} [requiredProvider]
 * @returns {boolean}
 */
export function hasEmbeddedDocument(documentId, requiredProvider) {
  if (!documentId) return false;
  const targetProvider = requiredProvider || getActiveProviderName();
  if (targetProvider === 'groq') {
    return Boolean(getDocumentChunks(documentId) || getDocumentChunks(documentId.replace(/\.pdf$/, '')));
  }
  const chunks = getEmbeddedDocument(documentId, targetProvider);
  return Array.isArray(chunks) && chunks.length > 0;
}

/**
 * Retrieve all cached embedded chunks across all documents currently in server RAM for the required provider.
 * Never mixes vectors from different providers (e.g. Gemini 768-D vs Ollama 1024-D).
 * @param {string} [requiredProvider]
 * @returns {Array<{ chunkId: string, documentId: string, chunkIndex: number, text: string, embedding: number[], embeddingProvider?: string, embeddingModel?: string, embeddingDimension?: number }>}
 */
export function getAllEmbeddedChunks(requiredProvider) {
  const targetProvider = requiredProvider || getActiveProviderName();
  const allChunks = [];
  const visitedKeys = new Set();
  for (const [key, chunks] of embeddedDocumentsStore.entries()) {
    if (Array.isArray(chunks) && !visitedKeys.has(chunks)) {
      visitedKeys.add(chunks);
      if (chunks.length > 0 && targetProvider) {
        const chunkProvider = chunks[0]?.embeddingProvider || 'gemini';
        if (chunkProvider !== targetProvider) {
          continue; // Skip chunks embedded by another provider
        }
      }
      allChunks.push(...chunks);
    }
  }
  return allChunks;
}

/**
 * Checks whether any embedded/indexed document chunks currently exist in server RAM for the required provider.
 * @param {string} [requiredProvider]
 * @returns {boolean}
 */
export function hasEmbeddedChunks(requiredProvider) {
  const targetProvider = requiredProvider || getActiveProviderName();
  if (targetProvider === 'groq') {
    return rawChunksStore.size > 0;
  }
  return getAllEmbeddedChunks(requiredProvider).length > 0;
}

/**
 * Returns a list of all currently available documents in memory storage for the required provider.
 * @param {string} [requiredProvider]
 * @returns {Array<{ id: string, filename: string, chunksCount: number, ready: boolean, embeddingProvider?: string, embeddingModel?: string, embeddingDimension?: number, retrievalStrategy?: string }>}
 */
export function listAvailableDocuments(requiredProvider) {
  const targetProvider = requiredProvider || getActiveProviderName();
  const docsMap = new Map();
  const visitedArrays = new Set();

  if (targetProvider === 'groq') {
    for (const [key, chunks] of rawChunksStore.entries()) {
      if (!Array.isArray(chunks) || chunks.length === 0) continue;
      if (visitedArrays.has(chunks)) continue;
      visitedArrays.add(chunks);

      const first = chunks[0];
      const docId = first.documentId || key;
      const filename = first.filename || key;

      if (!docsMap.has(docId)) {
        docsMap.set(docId, {
          id: docId,
          filename: filename,
          chunksCount: chunks.length,
          ready: true,
          retrievalStrategy: 'lexical-bm25',
        });
      }
    }
    return Array.from(docsMap.values());
  }

  // 1. Check embeddedDocumentsStore for dense vector embeddings (Ollama or Gemini)
  for (const [key, chunks] of embeddedDocumentsStore.entries()) {
    if (!Array.isArray(chunks) || chunks.length === 0) continue;
    if (visitedArrays.has(chunks)) continue;
    visitedArrays.add(chunks);

    const first = chunks[0];
    const chunkProvider = first.embeddingProvider || 'gemini';
    if (targetProvider && chunkProvider !== targetProvider) {
      continue;
    }

    const docId = first.documentId || key;
    const filename = first.filename || key;

    docsMap.set(docId, {
      id: docId,
      filename: filename,
      chunksCount: chunks.length,
      ready: true,
      embeddingProvider: chunkProvider,
      embeddingModel: first.embeddingModel,
      embeddingDimension: first.embeddingDimension,
    });
  }

  return Array.from(docsMap.values());
}

