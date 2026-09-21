/**
 * server/config/ragConfig.js
 * 
 * WHY THIS CONFIGURATION MODULE IS NEEDED:
 * Step 5.7 of ByteMind RAG: Configurable retrieval quality controls.
 * 
 * By centralizing these retrieval parameters here:
 * 1. Thresholds and limits are never duplicated or hardcoded across multiple routes and services.
 * 2. Developers can easily tune the minimum cosine similarity threshold via .env
 *    (e.g., RAG_SIMILARITY_THRESHOLD=0.45).
 * 3. Safe fallback defaults ensure the application works reliably out-of-the-box.
 */

// Default minimum cosine similarity score required for a retrieved chunk to be considered relevant.
// Can be customized in .env via RAG_SIMILARITY_THRESHOLD (e.g. 0.45 - 0.60).
export const DEFAULT_SIMILARITY_THRESHOLD =
  process.env.RAG_SIMILARITY_THRESHOLD && !isNaN(Number(process.env.RAG_SIMILARITY_THRESHOLD))
    ? Number(process.env.RAG_SIMILARITY_THRESHOLD)
    : 0.40;

// Default number of chunks to retrieve for context assembly (concise context window)
export const DEFAULT_TOP_K = 3;

// Upper limit for topK to protect token usage and avoid overwhelming the model
export const MAX_TOP_K = 10;
