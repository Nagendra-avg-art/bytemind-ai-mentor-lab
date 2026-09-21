/**
 * server/utils/similarity.js
 * 
 * WHY THIS UTILITY IS NEEDED:
 * Step 5.4 of ByteMind RAG: Semantic Search Engine.
 * 
 * Mathematical Foundation:
 * 1. Computes Cosine Similarity between high-dimensional vector embeddings.
 * 2. Implements semantic search to rank document chunks based on how close
 *    their meaning aligns with a student's question.
 */

import { generateEmbedding } from './embeddingService.js';

const DEFAULT_TOP_K = 3;

/**
 * Calculates the cosine similarity between two numerical vectors:
 * 
 * Cosine Similarity = (A · B) / (||A|| * ||B||)
 * 
 * Robust Error Handling:
 * - Returns 0 if either vector is missing, empty, or not an array.
 * - Returns 0 if vector dimensions do not match.
 * - Returns 0 if either vector has zero magnitude (prevents division by zero).
 * 
 * @param {number[]} vecA - First numerical vector
 * @param {number[]} vecB - Second numerical vector
 * @returns {number} - Similarity score between -1.0 and 1.0 (typically 0.0 to 1.0 for text embeddings)
 */
export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
    return 0;
  }

  if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let magASq = 0;
  let magBSq = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];

    if (typeof a !== 'number' || typeof b !== 'number' || isNaN(a) || isNaN(b)) {
      return 0;
    }

    dotProduct += a * b;
    magASq += a * a;
    magBSq += b * b;
  }

  const magnitudeProduct = Math.sqrt(magASq) * Math.sqrt(magBSq);

  // Avoid division by zero
  if (magnitudeProduct === 0) {
    return 0;
  }

  return dotProduct / magnitudeProduct;
}

/**
 * Searches and ranks document chunks based on semantic similarity to a query.
 * 
 * Process:
 * 1. Converts queryText into a 768-D embedding via generateEmbedding(queryText).
 * 2. Compares the query embedding with each chunk's embedding using cosine similarity.
 * 3. Sorts all chunks by similarity score in descending order.
 * 4. Returns the top K highest-scoring chunks.
 * 
 * @param {string} queryText - The student's question or search query
 * @param {Array<{ chunkId: string, documentId: string, chunkIndex: number, text: string, embedding: number[] }>} chunks - Stored chunks with embeddings
 * @param {number} [topK=3] - Number of top relevant chunks to return
 * @returns {Promise<Array<{ chunkId: string, documentId: string, chunkIndex: number, text: string, similarity: number }>>}
 */
export async function searchSimilarChunks(queryText, chunks, topK = DEFAULT_TOP_K) {
  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    throw new Error('Please provide a non-empty query string for semantic search.');
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('No embedded document chunks available to search.');
  }

  const sanitizedTopK = Math.max(1, Number.isInteger(topK) && topK > 0 ? topK : DEFAULT_TOP_K);

  // 1. Generate 768-D embedding for the student's query
  const queryVector = await generateEmbedding(queryText.trim());

  // 2. Compute cosine similarity for each chunk
  const scoredChunks = [];

  for (const chunk of chunks) {
    if (!chunk.embedding || !Array.isArray(chunk.embedding)) {
      continue;
    }

    const rawSimilarity = cosineSimilarity(queryVector, chunk.embedding);
    // Clean to 4 decimal places
    const similarity = Number(rawSimilarity.toFixed(4));

    scoredChunks.push({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      similarity,
    });
  }

  // 3. Sort chunks descending by similarity score
  scoredChunks.sort((a, b) => b.similarity - a.similarity);

  // 4. Return the top K results
  return scoredChunks.slice(0, sanitizedTopK);
}
