/**
 * server/agent/tools/ragSearchTool.js
 * 
 * Tool: RAG_SEARCH
 * Purpose: Retrieve relevant information from the student's uploaded study material.
 * 
 * Input:
 * {
 *   query: string,
 *   documentId?: string,
 *   topK?: number,
 *   threshold?: number
 * }
 * 
 * Output:
 * {
 *   sources: Array<RAGSource>,
 *   chunks: Array<DocumentChunk>,
 *   contextText: string,
 *   relevantDocument: string | null,
 *   hasDocument: boolean,
 *   ragRequired: boolean,
 *   topSimilarity: number | null,
 *   threshold: number,
 *   retrievedChunksCount: number,
 *   similarityResult: string
 * }
 * 
 * REUSES the existing semantic search implementation.
 * Does NOT regenerate document embeddings.
 */

import {
  generateEmbedding,
  hasEmbeddedChunks,
  getEmbeddedDocument,
  getDocumentChunks,
  getAllRawChunks,
} from '../../utils/embeddingService.js';
import { searchVectorChunks, isDbConfigured } from '../../db/vectorStore.js';
import { DEFAULT_SIMILARITY_THRESHOLD } from '../../config/ragConfig.js';
import { assembleRAGContext } from '../../utils/contextAssembly.js';
import { searchLexicalBM25 } from '../../utils/lexicalSearch.js';
import { getActiveProviderName } from '../../providers/index.js';

/**
 * Checks whether any study material documents currently exist in storage.
 * @returns {boolean}
 */
export function isDocumentStorageAvailable() {
  const activeProviderName = getActiveProviderName();
  return isDbConfigured() || hasEmbeddedChunks(activeProviderName);
}

/**
 * Executes the RAG_SEARCH tool with similarity threshold gating and relevance telemetry.
 * 
 * @param {object} input
 * @param {string} input.query - Search query or student's goal.
 * @param {string} [input.documentId] - Optional specific document identifier.
 * @param {number} [input.topK=4] - Maximum number of chunks to retrieve.
 * @param {number} [input.threshold] - Optional similarity threshold override.
 * 
 * @returns {Promise<{
 *   sources: Array<{
 *     documentId: string,
 *     filename: string,
 *     chunkId: string,
 *     chunkIndex: number,
 *     page: number | null,
 *     similarity: number,
 *     textPreview: string
 *   }>,
 *   chunks: Array<any>,
 *   contextText: string,
 *   relevantDocument: string | null,
 *   hasDocument: boolean,
 *   ragRequired: boolean,
 *   topSimilarity: number | null,
 *   threshold: number,
 *   retrievedChunksCount: number,
 *   similarityResult: string
 * }>}
 */
export async function executeRagSearch({ query, documentId, topK = 4, threshold }) {
  const activeProviderName = getActiveProviderName();
  const effectiveThreshold =
    threshold !== undefined && !isNaN(Number(threshold))
      ? Number(threshold)
      : activeProviderName === 'groq'
      ? 0.12
      : DEFAULT_SIMILARITY_THRESHOLD;

  if (!query || typeof query !== 'string' || !query.trim()) {
    return {
      sources: [],
      chunks: [],
      contextText: '',
      relevantDocument: null,
      hasDocument: false,
      ragRequired: false,
      topSimilarity: null,
      threshold: effectiveThreshold,
      retrievedChunksCount: 0,
      similarityResult: 'Empty query provided',
    };
  }

  const trimmedQuery = query.trim();

  // If storage is not configured or empty, return immediately without error
  if (!isDocumentStorageAvailable()) {
    return {
      sources: [],
      chunks: [],
      contextText: '',
      relevantDocument: null,
      hasDocument: false,
      ragRequired: false,
      topSimilarity: null,
      threshold: effectiveThreshold,
      retrievedChunksCount: 0,
      similarityResult: 'No study documents in storage',
    };
  }

  try {
    let rankedChunks = [];

    // Dual strategy:
    // If Groq: BM25 lexical keyword retrieval over extracted chunks (zero Gemini embedding quota)
    // If Ollama: dense vector search with qwen3-embedding:0.6b
    if (activeProviderName === 'groq') {
      let candidateChunks = [];
      if (documentId && typeof documentId === 'string' && documentId.trim()) {
        const cleanId = documentId.trim();
        candidateChunks =
          getDocumentChunks(cleanId) ||
          getDocumentChunks(cleanId.replace(/\.pdf$/, '')) ||
          getDocumentChunks(`${cleanId}.pdf`) ||
          [];
      }
      if (!candidateChunks || candidateChunks.length === 0) {
        candidateChunks = getAllRawChunks();
      }

      rankedChunks = searchLexicalBM25({
        query: trimmedQuery,
        chunks: candidateChunks,
        topK: Math.max(1, Math.min(topK, 10)),
        threshold: 0.0,
      });
    } else {
      // 1. Generate query embedding for search (Ollama or Gemini)
      const queryEmbedding = await generateEmbedding(trimmedQuery);

      // 2. Perform vector search (via pgvector or in-memory fallback)
      rankedChunks = await searchVectorChunks({
        queryEmbedding,
        topK: Math.max(1, Math.min(topK, 10)),
        documentId: documentId ? documentId.trim() : undefined,
        threshold: 0.0,
      });
    }

    if (!rankedChunks || rankedChunks.length === 0) {
      return {
        sources: [],
        chunks: [],
        contextText: '',
        relevantDocument: null,
        hasDocument: false,
        ragRequired: false,
        topSimilarity: null,
        threshold: effectiveThreshold,
        retrievedChunksCount: 0,
        similarityResult: 'No matching chunks found in storage',
      };
    }

    const topMatch = rankedChunks[0];
    const topScore = Number(topMatch.similarity.toFixed(4));
    const topPercentage = (topScore * 100).toFixed(1);
    const thresholdPercentage = (effectiveThreshold * 100).toFixed(0);

    // Check if the best match meets similarity threshold (Relevance Decision Gating)
    if (topMatch.similarity < effectiveThreshold) {
      return {
        sources: [],
        chunks: [],
        contextText: '',
        relevantDocument: null,
        hasDocument: false,
        ragRequired: false,
        topSimilarity: topScore,
        threshold: effectiveThreshold,
        retrievedChunksCount: 0,
        similarityResult: `Below threshold: ${topPercentage}% < ${thresholdPercentage}% threshold`,
      };
    }

    // Filter relevant chunks meeting threshold
    const matchingChunks = rankedChunks.filter((c) => c.similarity >= effectiveThreshold);
    const relevantDocument = topMatch.filename || topMatch.documentId || documentId || 'uploaded_document';

    // Format source citations without exposing raw vectors
    const sources = matchingChunks.map((chunk) => {
      const rawContent = chunk.content || chunk.text || '';
      const preview =
        rawContent.length > 250 ? rawContent.slice(0, 250) + '...' : rawContent;

      return {
        documentId: chunk.documentId,
        filename: chunk.filename || chunk.documentId,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        page: chunk.page !== undefined ? chunk.page : null,
        similarity: Number(chunk.similarity.toFixed(4)),
        textPreview: preview.replace(/\s+/g, ' ').trim(),
      };
    });

    // Assemble clean context for prompt injection
    const contextText = assembleRAGContext(matchingChunks, trimmedQuery);

    return {
      sources,
      chunks: matchingChunks,
      contextText,
      relevantDocument,
      hasDocument: true,
      ragRequired: true,
      topSimilarity: topScore,
      threshold: effectiveThreshold,
      retrievedChunksCount: matchingChunks.length,
      similarityResult: `${topPercentage}% (threshold: ${thresholdPercentage}%)`,
    };
  } catch (error) {
    console.warn('[RAG_SEARCH] Semantic search retrieval failed:', error.message);
    return {
      sources: [],
      chunks: [],
      contextText: '',
      relevantDocument: null,
      hasDocument: false,
      ragRequired: false,
      topSimilarity: null,
      threshold: effectiveThreshold,
      retrievedChunksCount: 0,
      similarityResult: `Search error: ${error.message}`,
    };
  }
}

export const RAG_SEARCH = {
  name: 'RAG_SEARCH',
  description: 'Retrieve relevant information from the student\'s uploaded study material.',
  execute: executeRagSearch,
};
