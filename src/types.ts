/**
 * types.ts
 * 
 * WHY THIS FILE IS NEEDED:
 * In TypeScript, defining types/interfaces ensures predictable data structures throughout your application.
 * In Step 4 (Multi-turn Conversation Memory), we track individual chat messages and interaction IDs
 * returned by the server-side Gemini Interactions API.
 */

/**
 * Represents the status of the AI request
 */
export type RequestStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * A single message in the multi-turn conversation thread
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  sources?: RAGSource[];
  isRag?: boolean;
  isImage?: boolean;
  imageUrl?: string;
  imageName?: string;
  isAgent?: boolean;
  intent?: string;
  selectedTool?: string;
  documentUsed?: string | null;
  ragRequired?: boolean;
  retrievedChunks?: number;
  similarityResult?: string;
  workflow?: string[];
  relevantDocument?: string | null;
  executionMs?: number;
  localAI?: LocalAiMetadata;
}

/**
 * API response structure from POST /api/ask
 */
export interface AskAIResponse {
  answer: string;
  interactionId: string;
}

/**
 * Represents overall AI state
 */
export interface AIResponseState {
  status: RequestStatus;
  errorMessage?: string;
}

/**
 * Represents a single chunk of a document (Step 5.2: Document Chunking)
 */
export interface DocumentChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  wordCount: number;
  charCount: number;
  preview: string;
  text?: string;
  content?: string;
}

/**
 * Result structure returned by POST /api/documents in Step 5 (RAG Document Pipeline)
 */
export interface DocumentUploadResult {
  success: boolean;
  filename: string;
  pages: number;
  textLength: number;
  textPreview: string;
  totalChunks: number;
  chunks: DocumentChunk[];
}

/**
 * Sample preview of an embedding vector returned by POST /api/documents/embed
 */
export interface EmbeddingSample {
  chunkId: string;
  textPreview: string;
  embeddingPreview: number[];
}

/**
 * Result structure returned by POST /api/documents/embed in Step 5.3
 */
export interface EmbeddingResult {
  success: boolean;
  documentId: string;
  storageMode?: 'pgvector' | 'memory';
  chunksProcessed: number;
  embeddingDimensions: number;
  sample: EmbeddingSample;
}

/**
 * A single retrieved chunk from semantic search (Step 5.4)
 */
export interface SearchResultItem {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  similarity: number;
  textPreview: string;
}

/**
 * Result structure returned by POST /api/search in Step 5.4
 */
export interface SearchResponse {
  success: boolean;
  query: string;
  topK: number;
  results: SearchResultItem[];
}

/**
 * A single source citation returned by RAG in Step 5.5
 */
export interface RAGSource {
  documentId: string;
  filename: string;
  chunkId: string;
  chunkIndex: number;
  page?: number | null;
  similarity: number;
  textPreview: string;
}

/**
 * Result structure returned by POST /api/rag/ask in Step 5.5
 */
export interface RAGAskResponse {
  success: boolean;
  answer: string;
  interactionId: string;
  sources: RAGSource[];
}

/**
 * Result structure returned by POST /api/image/ask in Step 6 (Multimodal Image Understanding)
 */
export interface ImageAskResponse {
  success: boolean;
  answer: string;
  interactionId: string;
}

/**
 * Result structure returned by POST /api/agent/learn in Step 8.3 (Intelligent Learning Agent + RAG)
 */
export interface AgentResponse {
  success: boolean;
  intent: string;
  selectedTool?: string;
  documentUsed?: string | null;
  ragRequired?: boolean;
  retrievedChunks?: number;
  similarityResult?: string;
  goal: string;
  relevantDocument: string | null;
  workflow: string[];
  response: string;
  interactionId: string;
  sources?: RAGSource[];
  executionMs?: number;
  localAI?: LocalAiMetadata;
}

/**
 * Supported Classroom Assistant Intents / Actions
 */
export type ClassroomIntent =
  | 'CLASSROOM_SUMMARY'
  | 'TOPIC_IDENTIFICATION'
  | 'ASSIGNMENT_GENERATION'
  | 'ASSESSMENT_GENERATION';

/**
 * Request payload for POST /api/agent/classroom
 */
export interface ClassroomActionRequest {
  action?: ClassroomIntent | string;
  intent?: ClassroomIntent | string;
  documentId: string;
  interactionId?: string;
}

/**
 * Result structure returned by POST /api/agent/classroom
 */
export interface ClassroomActionResponse {
  success: boolean;
  intent: ClassroomIntent | string;
  action: ClassroomIntent | string;
  documentId: string;
  documentUsed: string;
  retrievedChunks: number;
  sources: RAGSource[];
  output: string;
  response: string;
  executionMs: number;
  interactionId: string;
  geminiStatus?: 'AVAILABLE' | 'QUOTA_EXHAUSTED' | 'TEMPORARY_RATE_LIMIT' | 'ERROR' | string;
  code?: string;
  error?: string;
}

/**
 * Step 15: Local AI Feasibility Lab Interfaces
 */
export interface LocalAiMetadata {
  model: string;
  runtime: string;
  status: 'Ready' | 'Unavailable' | 'Disabled' | string;
  input: string;
  predictedIntent: string;
  confidence: number;
  scores?: Record<string, number>;
  executionMs?: number;
  isFallback?: boolean;
  disclaimer?: string;
}

export interface LocalAiStatusResponse {
  enabled: boolean;
  model: string;
  runtime: string;
  status: string;
  disclaimer: string;
  lastError?: string | null;
}


