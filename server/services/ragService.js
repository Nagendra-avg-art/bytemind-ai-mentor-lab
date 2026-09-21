/**
 * server/services/ragService.js
 * 
 * WHY THIS SERVICE IS NEEDED:
 * Implements Step 5.7 of ByteMind RAG: Improved Retrieval Quality, Similarity Thresholds,
 * Grounding Safeguards, and Source Metadata.
 * 
 * Architectural Flow:
 * 1. Takes the student's question, optional documentId, topK, threshold, and interactionId.
 * 2. Checks storage availability (PostgreSQL or in-memory fallback).
 * 3. Generates 768-D query embedding using gemini-embedding-2.
 * 4. Retrieves top-K candidates via cosine similarity or pgvector HNSW index.
 * 5. SIMILARITY THRESHOLD GATING:
 *    - Compares top candidate similarity against RAG_SIMILARITY_THRESHOLD (default 0.45).
 *    - If similarity < threshold, immediately returns an educational "insufficient relevance"
 *      response WITHOUT calling Gemini. This saves API quota and prevents hallucinations.
 * 6. Filters and keeps only chunks >= threshold (up to topK).
 * 7. Enriches source metadata (documentId, filename, chunkId, chunkIndex, page, similarity).
 *    Never exposes raw vector arrays.
 * 8. Assembles clean context via assembleRAGContext.
 * 9. Queries Gemini (gemini-3.6-flash) with ByteMind Mentor system instructions (Section 11)
 *    and preserves conversation memory via previous_interaction_id.
 */

import { GoogleGenAI } from '@google/genai';
import { BYTEMIND_MENTOR_SYSTEM_INSTRUCTION, LOCAL_BYTEMIND_RAG_SYSTEM_INSTRUCTION } from '../prompts/mentorPrompt.js';
import {
  generateEmbedding,
  hasEmbeddedChunks,
  hasEmbeddedDocument,
  embedChunks,
  getDocumentChunks,
  getEmbeddedDocument,
  getAllRawChunks,
} from '../utils/embeddingService.js';
import { searchVectorChunks, isDbConfigured, saveDocumentAndChunks } from '../db/vectorStore.js';
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_TOP_K,
  MAX_TOP_K,
} from '../config/ragConfig.js';
import { assembleRAGContext } from '../utils/contextAssembly.js';
import { searchLexicalBM25 } from '../utils/lexicalSearch.js';
import { getActiveProvider, getActiveProviderName } from '../providers/index.js';
import { getOrCreateSession, getSessionHistory, recordTurn } from './sessionService.js';

/**
 * Initializes GoogleGenAI client with the server-side API key.
 * @returns {GoogleGenAI}
 */
/**
 * Initializes GoogleGenAI client with the server-side API key.
 * Disables uncontrolled SDK internal retries so we can manage transient errors
 * and prevent quota exhaustion / stream clone crashes explicitly.
 * @returns {GoogleGenAI}
 */
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please check your .env file.'
    );
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      retryOptions: {
        attempts: 1, // Disable uncontrolled internal retries; handled explicitly with at most 1 transient retry
      },
    },
  });
}

/**
 * Detects if an error indicates permanent or long-term quota exhaustion (e.g. daily quota reached).
 * When true, the system will NOT retry.
 */
function isLongTermQuotaError(error) {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const cause = error?.cause ? String(error.cause).toLowerCase() : '';
  const combined = `${msg} ${cause}`;

  return (
    combined.includes('per day') ||
    combined.includes('daily') ||
    combined.includes('quota exhausted') ||
    combined.includes('resource_exhausted: quota') ||
    combined.includes('quota limit: 0') ||
    combined.includes('billing')
  );
}

/**
 * Detects if an error is a transient rate limit (short-term 429) or transient 5xx server error.
 */
function isTransientError(error) {
  if (isLongTermQuotaError(error)) {
    return false;
  }

  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const cause = error?.cause ? String(error.cause).toLowerCase() : '';
  const status = error?.status || error?.statusCode;
  const combined = `${msg} ${cause}`;

  // 429 / rate limit / transient quota / node stream retry artifact
  if (
    status === 429 ||
    combined.includes('429') ||
    combined.includes('rate limit') ||
    combined.includes('quota') ||
    combined.includes('too many requests') ||
    combined.includes('resource_exhausted') ||
    combined.includes('unusable')
  ) {
    return true;
  }

  // 5xx transient server error
  if (
    (typeof status === 'number' && status >= 500 && status < 600) ||
    combined.includes('500') ||
    combined.includes('503') ||
    combined.includes('504') ||
    combined.includes('service unavailable') ||
    combined.includes('unavailable') ||
    combined.includes('overloaded')
  ) {
    return true;
  }

  return false;
}

/**
 * Invokes Gemini Interactions API with at most ONE retry for transient errors.
 * Never retries if quota is exhausted for a longer period (e.g. daily quota).
 */
async function callGeminiWithTransientRetry(client, interactionParams) {
  try {
    return await client.interactions.create(interactionParams);
  } catch (firstError) {
    // 1. Long-term quota exhaustion: do not retry
    if (isLongTermQuotaError(firstError)) {
      console.warn('[RAG] Gemini API daily quota exhausted. Skipping retry.');
      const err = new Error(
        'Gemini API daily quota has been reached for this model. Please check your Gemini API quota or try again later.'
      );
      err.statusCode = 429;
      err.code = 'RATE_LIMIT_EXCEEDED';
      throw err;
    }

    // 2. Transient 429 / 5xx error: attempt at most ONE retry after short delay (1500ms)
    if (isTransientError(firstError)) {
      console.warn(
        '[RAG] Transient error (429/5xx) from Gemini API. Attempting single retry in 1500ms...'
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));

      try {
        // AT MOST ONE RETRY
        return await client.interactions.create(interactionParams);
      } catch (retryError) {
        console.error('[RAG] Single retry failed:', retryError?.message || retryError);

        const msg = (retryError instanceof Error ? retryError.message : String(retryError)).toLowerCase();
        const cause = retryError?.cause ? String(retryError.cause).toLowerCase() : '';
        const combined = `${msg} ${cause}`;

        const isRateLimit =
          retryError?.status === 429 ||
          combined.includes('429') ||
          combined.includes('rate limit') ||
          combined.includes('quota') ||
          combined.includes('resource_exhausted') ||
          combined.includes('unusable');

        if (isRateLimit) {
          const rateErr = new Error(
            'Gemini API rate limit or quota reached. Please wait a moment before asking another question.'
          );
          rateErr.statusCode = 429;
          rateErr.code = 'RATE_LIMIT_EXCEEDED';
          throw rateErr;
        }

        throw retryError;
      }
    }

    // 3. Any other 429/quota error: format clean error
    const msg = (firstError instanceof Error ? firstError.message : String(firstError)).toLowerCase();
    const cause = firstError?.cause ? String(firstError.cause).toLowerCase() : '';
    const combined = `${msg} ${cause}`;
    if (
      firstError?.status === 429 ||
      combined.includes('429') ||
      combined.includes('rate limit') ||
      combined.includes('quota') ||
      combined.includes('resource_exhausted')
    ) {
      const rateErr = new Error(
        'Gemini API rate limit or quota reached. Please wait a moment before asking another question.'
      );
      rateErr.statusCode = 429;
      rateErr.code = 'RATE_LIMIT_EXCEEDED';
      throw rateErr;
    }

    throw firstError;
  }
}

/**
 * Executes a full RAG retrieval & generation cycle with quality controls.
 * 
 * @param {string} question - The student's question.
 * @param {object} [options]
 * @param {string} [options.documentId] - Optional document filter. If omitted, searches all loaded documents.
 * @param {number} [options.topK=3] - Number of top chunks to retrieve (1 - 10).
 * @param {number} [options.threshold] - Minimum similarity threshold (e.g. 0.45).
 * @param {string} [options.interactionId] - Optional session ID to continue multi-turn conversation memory.
 * 
 * @returns {Promise<{
 *   success: boolean,
 *   answer: string,
 *   interactionId: string,
 *   sources: Array<{
 *     documentId: string,
 *     filename: string,
 *     chunkId: string,
 *     chunkIndex: number,
 *     page: number | null,
 *     similarity: number,
 *     textPreview: string
 *   }>
 * }>}
 */
export async function answerWithRAG(question, options = {}) {
  const { documentId, interactionId } = options;

  // 1. Validate input question
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('Please provide a valid, non-empty question.');
  }

  const trimmedQuestion = question.trim();

  // 2. Validate topK parameter (default 3, clamped between 1 and MAX_TOP_K)
  let parsedTopK = DEFAULT_TOP_K;
  if (options.topK !== undefined) {
    const rawK = Number(options.topK);
    if (Number.isInteger(rawK) && rawK >= 1 && rawK <= MAX_TOP_K) {
      parsedTopK = rawK;
    }
  }

  // 3. Determine similarity threshold (centralized default with optional override)
  const activeProvider = getActiveProvider();
  const activeProviderName = getActiveProviderName();

  // Threshold: allow override; defaults to 0.40 for vector, 0.20 for lexical BM25
  const threshold =
    options.threshold !== undefined && !isNaN(Number(options.threshold))
      ? Number(options.threshold)
      : activeProviderName === 'groq'
      ? 0.20
      : DEFAULT_SIMILARITY_THRESHOLD;

  // If specific document was requested, ensure it is indexed for activeProvider (vector providers only)
  if (activeProviderName !== 'groq' && documentId && typeof documentId === 'string' && documentId.trim()) {
    const cleanId = documentId.trim();
    if (!hasEmbeddedDocument(cleanId, activeProviderName)) {
      const rawChunks = getDocumentChunks(cleanId);
      if (Array.isArray(rawChunks) && rawChunks.length > 0) {
        console.log(`[RAG] Document "${cleanId}" exists in raw chunks but not indexed for ${activeProviderName}. Indexing with ${activeProviderName}...`);
        const reIndexed = await embedChunks(rawChunks, cleanId);
        await saveDocumentAndChunks({
          filename: cleanId,
          pageCount: rawChunks[0]?.pageCount || 1,
          textLength: rawChunks.reduce((sum, c) => sum + (c.charCount || c.text?.length || 0), 0),
          chunksWithEmbeddings: reIndexed,
        });
      }
    }
  }

  // 4. Pre-check: Ensure study documents exist in storage for active provider
  if (activeProviderName === 'groq') {
    if (!hasEmbeddedChunks('groq')) {
      return {
        success: true,
        answer:
          'No study documents were found in memory. Please upload a study document (PDF) first before asking questions in Document Grounded mode.',
        interactionId: interactionId || '',
        sources: [],
      };
    }
  } else if (!isDbConfigured() && !hasEmbeddedChunks(activeProviderName)) {
    return {
      success: true,
      answer:
        'No embedded study documents were found in memory. Please upload and embed a study document (PDF) first before asking questions in Document Grounded mode.',
      interactionId: interactionId || '',
      sources: [],
    };
  }

  const totalStart = performance.now();
  let rankedChunks = [];
  let retrievalStrategy = 'dense_vector';

  // 5. Dual Retrieval Strategy:
  // - Local Ollama: qwen3-embedding:0.6b dense vector similarity
  // - Groq / Render: provider-independent lexical / BM25 keyword retrieval over extracted chunks
  if (activeProviderName === 'groq') {
    retrievalStrategy = 'lexical_bm25';
    const lexicalStart = performance.now();

    let candidateChunks = [];
    if (documentId && typeof documentId === 'string' && documentId.trim()) {
      const cleanId = documentId.trim();
      candidateChunks =
        getDocumentChunks(cleanId) ||
        getDocumentChunks(cleanId.replace(/\.pdf$/, '')) ||
        getDocumentChunks(`${cleanId}.pdf`) ||
        [];
    } else {
      candidateChunks = getAllRawChunks();
    }

    rankedChunks = searchLexicalBM25({
      query: trimmedQuestion,
      chunks: candidateChunks,
      topK: parsedTopK,
      threshold: 0.0, // retrieve top candidates to evaluate top similarity
    });

    const lexicalMs = Math.round(performance.now() - lexicalStart);
    console.log(`[RAG] lexical BM25 retrieval (${candidateChunks.length} chunks searched): ${lexicalMs}ms`);
  } else {
    // Dense Vector Search (Ollama or Gemini)
    const queryEmbedStart = performance.now();
    const queryEmbedding = await generateEmbedding(trimmedQuestion);
    const queryEmbeddingMs = Math.round(performance.now() - queryEmbedStart);
    console.log(`[RAG] query embedding (${activeProviderName}, ${queryEmbedding.length}D): ${queryEmbeddingMs}ms`);

    const searchStart = performance.now();
    rankedChunks = await searchVectorChunks({
      queryEmbedding,
      topK: parsedTopK,
      documentId: documentId ? documentId.trim() : undefined,
      threshold: 0.0,
    });
    const searchMs = Math.round(performance.now() - searchStart);
    console.log(`[RAG] semantic search: ${searchMs}ms`);
  }

  // Handle case: no chunks matched the documentId filter or empty storage
  if (!rankedChunks || rankedChunks.length === 0) {
    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[RAG] total: ${totalMs}ms`);
    const targetMsg = documentId
      ? `for document identifier "${documentId}"`
      : 'in your uploaded study notes';

    return {
      success: true,
      answer:
        `I searched ${targetMsg}, but could not find any stored sections. Please verify that this document has been uploaded and embedded.`,
      interactionId: interactionId || '',
      sources: [],
    };
  }

  // 7. SIMILARITY THRESHOLD CHECK (Irrelevant Question Gating)
  const topMatch = rankedChunks[0];
  const topSimilarity = topMatch.similarity;

  if (topSimilarity < threshold) {
    // Insufficient relevance: DO NOT CALL AI MODEL to save quota/time and eliminate hallucinations
    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[RAG] total: ${totalMs}ms (below similarity threshold ${(topSimilarity * 100).toFixed(1)}% < ${(threshold * 100).toFixed(1)}%)`);
    const docName = topMatch.filename || documentId || 'your uploaded notes';
    return {
      success: true,
      answer:
        `I searched your uploaded document material (${docName}), but could not find sections with sufficient relevance to answer your question.\n\n` +
        `• Highest similarity match: ${(topSimilarity * 100).toFixed(1)}%\n` +
        `• Minimum relevance threshold required: ${(threshold * 100).toFixed(1)}%\n\n` +
        `According to ByteMind grounding rules, I will not guess or fabricate information not supported by your document.\n\n` +
        `💡 Tip: You can rephrase your question to match your notes, or switch to "General CS Mentor" mode to discuss this topic using general computer science knowledge.`,
      interactionId: interactionId || '',
      sources: [],
    };
  }

  // 8. Filter chunks meeting the similarity threshold
  const relevantChunks = rankedChunks.filter((chunk) => chunk.similarity >= threshold);

  // 9. Format structured source metadata (no raw embeddings exposed)
  const sources = relevantChunks.map((chunk) => {
    const rawContent = chunk.content || chunk.text || '';
    const preview = rawContent.length > 250
      ? rawContent.slice(0, 250) + '...'
      : rawContent;

    return {
      documentId: chunk.documentId,
      filename: chunk.filename || chunk.documentId,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      page: chunk.page !== undefined ? chunk.page : null,
      similarity: Number(chunk.similarity.toFixed(4)),
      embeddingProvider: activeProviderName === 'groq' ? null : (chunk.embeddingProvider || activeProviderName),
      embeddingModel: activeProviderName === 'groq' ? null : (chunk.embeddingModel || (activeProviderName === 'ollama' ? (process.env.OLLAMA_EMBED_MODEL || 'qwen3-embedding:0.6b') : undefined)),
      retrievalStrategy,
    };
  });

  // 10. Assemble standardized, grounded context for AI model
  const augmentedPrompt = assembleRAGContext(relevantChunks, trimmedQuestion);

  // 11. Query AI Provider (Ollama qwen3:4b by default, Groq on Render, Gemini as optional fallback)
  if (activeProviderName !== 'gemini') {
    const session = getOrCreateSession(interactionId);
    const history = getSessionHistory(session.id);

    const systemInstruction = activeProvider.name === 'ollama'
      ? LOCAL_BYTEMIND_RAG_SYSTEM_INSTRUCTION
      : BYTEMIND_MENTOR_SYSTEM_INSTRUCTION;

    const result = await activeProvider.chat({
      prompt: augmentedPrompt,
      systemInstruction,
      history,
    });

    recordTurn(session.id, trimmedQuestion, result.text);

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[RAG] ${activeProvider.name} generation finished in ${totalMs}ms`);

    return {
      success: true,
      answer: result.text,
      interactionId: session.id,
      sources,
      provider: activeProvider.name,
      model: result.model,
      executionMs: result.metadata?.executionMs ?? totalMs,
      localAI: activeProvider.name === 'ollama',
      retrievalStrategy,
      embeddingProvider: activeProviderName === 'groq' ? null : activeProviderName,
      embeddingModel: activeProviderName === 'groq' ? null : (process.env.OLLAMA_EMBED_MODEL || 'qwen3-embedding:0.6b'),
    };
  }

  // Gemini Provider Flow
  const client = getGenAIClient();
  const interactionParams = {
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    input: augmentedPrompt,
    system_instruction: BYTEMIND_MENTOR_SYSTEM_INSTRUCTION,
  };

  if (interactionId && typeof interactionId === 'string' && interactionId.trim()) {
    interactionParams.previous_interaction_id = interactionId.trim();
  }

  const geminiStart = performance.now();
  const interaction = await callGeminiWithTransientRetry(client, interactionParams);
  const geminiMs = Math.round(performance.now() - geminiStart);
  console.log(`[RAG] Gemini generation: ${geminiMs}ms`);

  if (!interaction.output_text) {
    throw new Error('The Gemini model completed the request but did not return any text response.');
  }

  const totalMs = Math.round(performance.now() - totalStart);
  console.log(`[RAG] total: ${totalMs}ms`);

  return {
    success: true,
    answer: interaction.output_text,
    interactionId: interaction.id,
    sources: sources,
    provider: 'gemini',
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    executionMs: totalMs,
    localAI: false,
  };
}
