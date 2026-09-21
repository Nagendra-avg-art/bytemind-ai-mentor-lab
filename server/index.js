/**
 * server/index.js
 * 
 * WHY THIS FILE IS NEEDED:
 * This is our secure Node.js backend server.
 * 
 * Key Responsibilities:
 * 1. Security: Loads `GEMINI_API_KEY` from the server-side `.env` file using dotenv.
 *    The API key is NEVER bundled or exposed to the client/browser.
 * 2. Official SDK: Communicates directly with Google's Gemini models using `@google/genai`.
 * 3. Robust Error Handling:
 *    - Validates incoming user questions (returns HTTP 400 if missing or empty).
 *    - Validates server API key configuration (returns HTTP 500 if unconfigured).
 *    - Catches upstream Gemini API errors (rate limits, quota, network issues) and returns
 *      clear, human-readable error messages to the frontend.
 * 4. API Endpoints:
 *    - POST /api/ask : Accepts { question } and returns { answer }.
 *    - GET /api/health : Reports server status and whether an API key is present.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import { BYTEMIND_MENTOR_SYSTEM_INSTRUCTION } from './prompts/mentorPrompt.js';
import { chunkDocument } from './utils/chunker.js';
import {
  embedChunks,
  storeDocumentChunks,
  getDocumentChunks,
  storeEmbeddedDocument,
  getEmbeddedDocument,
  getAllEmbeddedChunks,
  listAvailableDocuments,
  hasEmbeddedDocument,
} from './utils/embeddingService.js';
import { STARTER_DOCUMENTS } from './data/starterDocuments.js';
import { searchSimilarChunks } from './utils/similarity.js';
import { answerWithRAG } from './services/ragService.js';
import { askImageMentor } from './services/imageService.js';
import { runLearningAgent } from './agent/learningAgent.js';
import { runClassroomAgent } from './agent/classroomAgent.js';
import {
  getGeminiStatus,
  setGeminiStatus,
  isDailyQuotaExhausted,
  isTransientRateLimit,
} from './agent/agentGeminiClient.js';
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_TOP_K,
  MAX_TOP_K,
} from './config/ragConfig.js';
import {
  initDatabase,
  isDbConfigured,
  getStorageMode,
  saveDocumentAndChunks,
  searchVectorChunks,
} from './db/vectorStore.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors()); // Enables Cross-Origin Resource Sharing for API requests
app.use(express.json()); // Parses incoming JSON request bodies

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

// Serve static frontend assets from Vite build if dist directory exists
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Configure multer memory storage: keeps the uploaded PDF in RAM Buffer (no permanent disk storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfExt = file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdfMime || isPdfExt) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF documents (.pdf) are supported.'));
    }
  },
});

// Configure multer memory storage for images (Step 6: Multimodal Image Understanding)
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const isImageMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    const hasValidExt = /\.(jpe?g|png|webp)$/i.test(file.originalname);
    if (isImageMime || hasValidExt) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image type. Only JPEG, PNG, and WebP images are supported.'));
    }
  },
});

/**
 * Health check endpoint.
 * Allows quick verification that the server is alive and reports if an API key is set.
 */
app.get('/api/health', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey.trim().length > 0 && !apiKey.includes('your_gemini_api_key_here'));
  const dbConfigured = isDbConfigured();
  const storageMode = getStorageMode();
  const geminiStatus = getGeminiStatus();

  res.json({
    status: 'ok',
    apiKeyConfigured: isConfigured,
    dbConfigured,
    storageMode,
    geminiStatus,
    message: isConfigured
      ? `Backend is running. Storage mode: ${storageMode === 'pgvector' ? 'PostgreSQL (pgvector)' : 'In-Memory Fallback'}. Gemini status: ${geminiStatus}.`
      : 'Backend is running, but GEMINI_API_KEY is not configured in .env.',
  });
});

/**
 * Document Ingestion Endpoint (Step 5: RAG Learning Experiment)
 * 
 * WHY THIS ENDPOINT IS NEEDED:
 * This endpoint allows students to upload a PDF study document and extracts
 * its raw text directly on the server.
 * 
 * DESIGN CONSTRAINTS (Step 5 Experiment):
 * - Zero persistence: Keeps file in RAM via multer.memoryStorage(), zero disk writes.
 * - No Gemini calls: Extraction is performed 100% locally via pdf-parse.
 * - No embeddings/vector DB yet: Returns basic document statistics and text preview.
 * 
 * Accepts: multipart/form-data with a PDF file in field 'document' or 'file'
 * Returns: {
 *   success: true,
 *   filename: string,
 *   pages: number,
 *   textLength: number,
 *   textPreview: string
 * }
 */
app.post('/api/documents', (req, res) => {
  upload.fields([{ name: 'document', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, async (err) => {
    // 1. Handle multer errors (e.g., file size limit, filter rejections)
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'File size exceeds the 10 MB limit. Please upload a smaller PDF document.',
        });
      }
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        error: err.message || 'Failed to process the uploaded file.',
      });
    }

    // 2. Extract uploaded file from either 'document' or 'file' field
    const uploadedFile = (req.files && (req.files['document']?.[0] || req.files['file']?.[0])) || req.file;

    if (!uploadedFile) {
      return res.status(400).json({
        error: 'No PDF file was provided. Please select a .pdf file and try again.',
      });
    }

    // 3. Validate PDF magic bytes: standard PDFs must begin with "%PDF-"
    const buffer = uploadedFile.buffer;
    if (!buffer || buffer.length < 5 || !buffer.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      return res.status(400).json({
        error: 'The uploaded file is not a valid PDF document (missing %PDF header signature).',
      });
    }

    let parser;
    const ingestStartTime = performance.now();
    try {
      // 4. Initialize PDFParse instance with in-memory buffer
      parser = new PDFParse({ data: buffer });
      const extractStart = performance.now();
      const result = await parser.getText();
      const extractionMs = Math.round(performance.now() - extractStart);
      console.log(`[RAG] extraction: ${extractionMs}ms`);

      const totalPages = result.total || (result.pages && result.pages.length) || 1;
      const rawText = result.text || '';
      const textLength = rawText.length;

      // Validate non-empty extracted text (strip automated pdf-parse page markers like "-- 1 of 1 --")
      const textWithoutPageMarkers = rawText.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').trim();
      if (!textWithoutPageMarkers) {
        return res.status(400).json({
          error:
            'The uploaded PDF contains no readable text (it may be a scanned image or protected document). Cannot generate chunks from an empty document.',
        });
      }

      // Step 5.2: Chunk the extracted document text
      const chunkStart = performance.now();
      const chunks = chunkDocument(rawText, uploadedFile.originalname);
      const chunkingMs = Math.round(performance.now() - chunkStart);
      console.log(`[RAG] chunking: ${chunkingMs}ms`);

      const totalIngestMs = Math.round(performance.now() - ingestStartTime);
      console.log(`[RAG] total: ${totalIngestMs}ms`);

      // Cache raw chunks in server RAM under both filename and cleaned documentId
      const cleanDocId = (uploadedFile.originalname || 'document').replace(/[^\w.-]/g, '_');
      storeDocumentChunks(uploadedFile.originalname, chunks);
      storeDocumentChunks(cleanDocId, chunks);

      // Extract a clean, readable text preview of the entire document (first 300 characters)
      const cleanedText = rawText.replace(/\s+/g, ' ').trim();
      const textPreview = cleanedText.length > 300
        ? cleanedText.slice(0, 300) + '...'
        : cleanedText || '(No readable text)';

      // Prepare lightweight chunk previews for the frontend (avoids massive payload)
      const chunkPreviews = chunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        chunkIndex: c.chunkIndex,
        wordCount: c.wordCount,
        charCount: c.charCount,
        preview: c.text.length > 250 ? c.text.slice(0, 250) + '...' : c.text,
      }));

      return res.json({
        success: true,
        filename: uploadedFile.originalname,
        pages: totalPages,
        textLength: textLength,
        textPreview: textPreview,
        totalChunks: chunks.length,
        chunks: chunkPreviews,
      });
    } catch (extractionError) {
      console.error('PDF text extraction error:', extractionError);
      return res.status(422).json({
        error: `Failed to extract text from PDF: ${extractionError.message || 'Corrupted or unreadable PDF structure.'}`,
      });
    } finally {
      // 5. Always clean up parser resources
      if (parser && typeof parser.destroy === 'function') {
        await parser.destroy().catch(() => {});
      }
    }
  });
});

/**
 * Embedding Generation Endpoint (Step 5.3: Document Chunk Embeddings)
 * 
 * WHY THIS ENDPOINT IS NEEDED:
 * Converts document text chunks into 768-dimensional numerical vectors
 * using the official @google/genai SDK with gemini-embedding-2.
 * 
 * DESIGN CONSTRAINTS:
 * - Keeps embeddings in server RAM (Map) and PostgreSQL/pgvector.
 * - Server-side only: Gemini API keys are never exposed to the client.
 * - Protects network performance: returns metadata & sample preview rather than full 768-float arrays.
 * 
 * Accepts: { documentId: string, chunks?: Array<{ chunkId: string, documentId: string, chunkIndex: number, text?: string, preview?: string }> }
 * Returns: {
 *   success: true,
 *   documentId: string,
 *   chunksProcessed: number,
 *   embeddingDimensions: number,
 *   sample: {
 *     chunkId: string,
 *     textPreview: string,
 *     embeddingPreview: number[]
 *   }
 * }
 */
app.post('/api/documents/embed', async (req, res) => {
  const embedStartTime = performance.now();
  try {
    const { documentId, chunks } = req.body;

    // 1. Validate document identifier
    if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
      return res.status(400).json({
        error: 'Please provide a valid documentId in the request body.',
      });
    }

    const cleanDocId = documentId.trim();
    const sanitizedDocId = cleanDocId.replace(/[^\w.-]/g, '_');

    // 2. Resolve chunks: Prioritize server RAM store (holds full text), fall back to request body
    let chunksToEmbed = getDocumentChunks(cleanDocId) || getDocumentChunks(sanitizedDocId);
    if (!chunksToEmbed || !Array.isArray(chunksToEmbed) || chunksToEmbed.length === 0) {
      chunksToEmbed = chunks;
    }

    if (!chunksToEmbed || !Array.isArray(chunksToEmbed) || chunksToEmbed.length === 0) {
      return res.status(400).json({
        error: `No chunks found for document "${cleanDocId}". Please upload and chunk the document first.`,
      });
    }

    // 3. Step 3 Development logging: inspect exact chunk contract before embedChunks()
    const firstChunk = chunksToEmbed[0] || {};
    const firstChunkText = firstChunk.text ?? firstChunk.content ?? firstChunk.preview ?? '';
    console.log('[RAG dev] Chunks to embed count:', chunksToEmbed.length);
    console.log('[RAG dev] First chunk keys:', Object.keys(firstChunk));
    console.log('[RAG dev] First chunk ID:', firstChunk.chunkId || 'unknown');
    console.log('[RAG dev] First chunk text length:', typeof firstChunkText === 'string' ? firstChunkText.length : 0);
    console.log('[RAG dev] First 100 characters of first chunk text:', typeof firstChunkText === 'string' ? firstChunkText.slice(0, 100) : '');

    // 4. Generate embeddings for all chunks via gemini-embedding-2 (768 dimensions)
    const embedStart = performance.now();
    const embeddedChunks = await embedChunks(chunksToEmbed, cleanDocId);
    const embeddingMs = Math.round(performance.now() - embedStart);
    console.log(`[RAG] embedding: ${embeddingMs}ms`);

    // 5. Persist to PostgreSQL with pgvector (with automatic in-memory fallback)
    const storeStart = performance.now();
    const saveResult = await saveDocumentAndChunks({
      filename: cleanDocId,
      pageCount: chunksToEmbed.length > 0 ? (chunksToEmbed[0].pageCount || 1) : 1,
      textLength: chunksToEmbed.reduce((sum, c) => sum + (c.charCount || c.text?.length || c.content?.length || 0), 0),
      chunksWithEmbeddings: embeddedChunks,
    });
    const storageMs = Math.round(performance.now() - storeStart);
    console.log(`[RAG] storage: ${storageMs}ms`);

    const totalEmbedMs = Math.round(performance.now() - embedStartTime);
    console.log(`[RAG] total: ${totalEmbedMs}ms`);

    // 6. Construct lightweight response with metadata & sample vector preview
    const firstEmbedded = embeddedChunks[0];
    const textPreview = firstEmbedded.text.length > 150
      ? firstEmbedded.text.slice(0, 150) + '...'
      : firstEmbedded.text;

    return res.json({
      success: true,
      documentId: saveResult.documentId || cleanDocId,
      filename: cleanDocId,
      storageMode: saveResult.storageMode || getStorageMode(),
      chunksProcessed: embeddedChunks.length,
      embeddingDimensions: firstEmbedded.embedding.length,
      sample: {
        chunkId: firstEmbedded.chunkId,
        textPreview: textPreview.replace(/\s+/g, ' ').trim(),
        embeddingPreview: firstEmbedded.embedding.slice(0, 5), // First 5 float values as proof of embedding
      },
    });
  } catch (error) {
    console.error('Error in /api/documents/embed endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown embedding error';

    if (errorMessage.includes('GEMINI_API_KEY')) {
      return res.status(500).json({ error: errorMessage });
    }

    if (errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
      return res.status(429).json({ error: errorMessage });
    }

    return res.status(500).json({
      error: `Embedding Error: ${errorMessage}`,
    });
  }
});

/**
 * Available Documents Endpoint
 * Returns a list of all documents currently indexed and available in the shared vector store.
 */
app.get('/api/documents', (req, res) => {
  try {
    const documents = listAvailableDocuments();
    return res.json({
      success: true,
      documents,
      count: documents.length,
    });
  } catch (error) {
    console.error('Error fetching available documents:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve documents list',
    });
  }
});

/**
 * Semantic Search Endpoint (Step 5.4: Semantic Search over Embedded Document Chunks)
 * 
 * WHY THIS ENDPOINT IS NEEDED:
 * Accepts a student's question, generates its 768-D embedding via gemini-embedding-2,
 * compares it against all chunk embeddings stored in server memory using cosine similarity,
 * and returns the top-K highest-scoring chunks.
 * 
 * DESIGN CONSTRAINTS (Step 5.4 Learning Step):
 * - In-memory vector comparison (no vector database yet).
 * - No Gemini text generation calls (only query embedding is created).
 * - Configurable topK (default = 3).
 * - Returns text preview and similarity score, NOT full vectors.
 * 
 * Accepts: { query: string, topK?: number, documentId?: string }
 * Returns: {
 *   success: true,
 *   query: string,
 *   topK: number,
 *   results: Array<{
 *     chunkId: string,
 *     documentId: string,
 *     chunkIndex: number,
 *     similarity: number,
 *     textPreview: string
 *   }>
 * }
 */
app.post('/api/search', async (req, res) => {
  try {
    const { query, topK, documentId } = req.body;

    // 1. Validate query string
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        error: 'Please provide a valid, non-empty search query in the request body.',
      });
    }

    const trimmedQuery = query.trim();

    // 2. Validate topK parameter (configurable, default 3)
    let parsedTopK = 3;
    if (topK !== undefined) {
      const num = Number(topK);
      if (!Number.isInteger(num) || num < 1 || num > 50) {
        return res.status(400).json({
          error: 'topK must be a positive integer between 1 and 50.',
        });
      }
      parsedTopK = num;
    }

    // 3. Resolve target chunks from server RAM
    let chunksToSearch;
    if (documentId && typeof documentId === 'string' && documentId.trim()) {
      chunksToSearch = getEmbeddedDocument(documentId.trim());
    } else {
      chunksToSearch = getAllEmbeddedChunks();
    }

    // 4. Validate that document chunks have been embedded
    if (!chunksToSearch || !Array.isArray(chunksToSearch) || chunksToSearch.length === 0) {
      return res.status(400).json({
        error:
          'No embedded document chunks found in server memory. Please upload a PDF and generate embeddings before performing semantic search.',
      });
    }

    // 5. Execute semantic search (computes cosine similarity & ranks top K)
    const rankedResults = await searchSimilarChunks(trimmedQuery, chunksToSearch, parsedTopK);

    // 6. Format lightweight response (avoids sending massive vectors)
    const formattedResults = rankedResults.map((item) => ({
      chunkId: item.chunkId,
      documentId: item.documentId,
      chunkIndex: item.chunkIndex,
      similarity: item.similarity,
      textPreview: item.text.length > 250 ? item.text.slice(0, 250) + '...' : item.text,
    }));

    return res.json({
      success: true,
      query: trimmedQuery,
      topK: parsedTopK,
      results: formattedResults,
    });
  } catch (error) {
    console.error('Error in /api/search endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown search error occurred';

    if (errorMessage.includes('GEMINI_API_KEY')) {
      return res.status(500).json({ error: errorMessage });
    }

    if (errorMessage.includes('quota') || errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      return res.status(429).json({
        error: 'Gemini embedding API rate limit exceeded. Please wait a moment and try again.',
      });
    }

    return res.status(500).json({
      error: `Semantic Search Error: ${errorMessage}`,
    });
  }
});

/**
 * RAG AI Query endpoint (Step 5.5: Connect RAG Retrieval to Gemini Generation)
 * 
 * WHY THIS ENDPOINT IS NEEDED:
 * Connects semantic vector retrieval with Gemini LLM generation.
 * When a student asks a question about an uploaded study document:
 * 1. Embeds the question and retrieves top-K most relevant chunks using cosine similarity.
 * 2. Augments the prompt with strictly structured "STUDENT MATERIAL" context chunks.
 * 3. Instructs Gemini to use the provided material as the primary source of truth.
 * 4. Preserves multi-turn conversation memory using previous_interaction_id.
 * 5. Returns grounded answer + sources metadata (documentId, filename, chunkIndex, similarity, textPreview).
 * 
 * Receives: {
 *   question: string,
 *   documentId?: string,
 *   interactionId?: string,
 *   topK?: number
 * }
 * Returns: {
 *   success: true,
 *   answer: string,
 *   interactionId: string,
 *   sources: Array<{
 *     documentId: string,
 *     filename: string,
 *     chunkId: string,
 *     chunkIndex: number,
 *     similarity: number,
 *     textPreview: string
 *   }>
 * }
 */
app.post('/api/rag/ask', async (req, res) => {
  try {
    const { question, documentId, interactionId, topK, threshold } = req.body;

    // 1. Validate question
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        error: 'Please provide a valid, non-empty question in the request body.',
      });
    }

    // 2. Validate topK parameter
    let parsedTopK = DEFAULT_TOP_K;
    if (topK !== undefined) {
      const num = Number(topK);
      if (!Number.isInteger(num) || num < 1 || num > MAX_TOP_K) {
        return res.status(400).json({
          error: `topK must be an integer between 1 and ${MAX_TOP_K}.`,
        });
      }
      parsedTopK = num;
    }

    // 3. Validate threshold parameter
    let parsedThreshold = DEFAULT_SIMILARITY_THRESHOLD;
    if (threshold !== undefined) {
      const th = Number(threshold);
      if (isNaN(th) || th < 0 || th > 1) {
        return res.status(400).json({
          error: 'threshold must be a valid number between 0.0 and 1.0.',
        });
      }
      parsedThreshold = th;
    }

    // 4. Call RAG retrieval + generation service
    const result = await answerWithRAG(question, {
      documentId,
      topK: parsedTopK,
      threshold: parsedThreshold,
      interactionId,
    });

    return res.json(result);
  } catch (error) {
    console.error('Error in /api/rag/ask endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown RAG error occurred';

    if (errorMessage.includes('GEMINI_API_KEY')) {
      return res.status(500).json({ error: errorMessage });
    }

    // 1. Daily Quota Exhaustion (RPD)
    if (
      error?.code === 'QUOTA_EXHAUSTED' ||
      error?.statusCategory === 'QUOTA_EXHAUSTED' ||
      error?.isQuotaExhausted ||
      isDailyQuotaExhausted(error) ||
      errorMessage.includes('daily quota') ||
      errorMessage.includes('quota has been reached') ||
      errorMessage.includes('requests per day')
    ) {
      setGeminiStatus('QUOTA_EXHAUSTED');
      return res.status(429).json({
        success: false,
        error: 'Gemini daily quota has been reached. AI generation is temporarily unavailable. Please try again after the quota resets.',
        code: 'QUOTA_EXHAUSTED',
        geminiStatus: 'QUOTA_EXHAUSTED',
      });
    }

    // 2. Short-term transient rate limit (RPM)
    const is429 =
      error?.statusCode === 429 ||
      error?.status === 429 ||
      error?.code === 'RATE_LIMIT_EXCEEDED' ||
      isTransientRateLimit(error) ||
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('429') ||
      errorMessage.includes('RESOURCE_EXHAUSTED');

    if (is429) {
      setGeminiStatus('TEMPORARY_RATE_LIMIT');
      return res.status(429).json({
        success: false,
        error:
          error?.code === 'RATE_LIMIT_EXCEEDED'
            ? errorMessage
            : 'Gemini API rate limit or quota reached. Please wait a moment before asking another question.',
        code: 'RATE_LIMIT_EXCEEDED',
        geminiStatus: 'TEMPORARY_RATE_LIMIT',
      });
    }

    // Handle invalid or expired session
    const requestedInteractionId = req.body?.interactionId;
    const isInteractionSessionError =
      Boolean(requestedInteractionId) &&
      (errorMessage.toLowerCase().includes('previous_interaction_id') ||
        errorMessage.toLowerCase().includes('invalid argument') ||
        errorMessage.toLowerCase().includes('invalid_request') ||
        errorMessage.toLowerCase().includes('not found') ||
        errorMessage.toLowerCase().includes('expired'));

    if (isInteractionSessionError) {
      return res.status(400).json({
        error:
          'Your previous conversation session has expired or is invalid. Please start a fresh conversation.',
      });
    }

    if (
      errorMessage.includes('No embedded document chunks found') ||
      errorMessage.includes('No embedded chunks found')
    ) {
      return res.status(400).json({
        error: errorMessage,
      });
    }

    return res.status(500).json({
      error: `RAG Error: ${errorMessage}`,
    });
  }
});

/**
 * Multimodal Image Query Endpoint (Step 6: Multimodal Image Understanding)
 * 
 * Accepts: multipart/form-data
 * - image (or file): binary image file (JPEG, PNG, WebP)
 * - question: string
 * - interactionId (optional): string
 * 
 * Returns: { success: true, answer: string, interactionId: string }
 */
app.post('/api/image/ask', (req, res) => {
  imageUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, async (err) => {
    // 1. Handle multer errors (size limit, mime type rejection)
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'Image exceeds maximum allowed size of 10 MB. Please choose a smaller image.',
        });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      // 2. Validate image existence
      const file = req.files?.image?.[0] || req.files?.file?.[0];
      if (!file) {
        return res.status(400).json({
          error: 'Please select or capture an image to ask about (field name "image" or "file").',
        });
      }

      // 3. Validate question
      const question = req.body?.question;
      if (!question || typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({
          error: 'Please provide a valid, non-empty question about the image.',
        });
      }

      const interactionId = req.body?.interactionId;

      // 4. Call multimodal Image Mentor service
      const result = await askImageMentor({
        imageBuffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname,
        question: question.trim(),
        interactionId: interactionId && typeof interactionId === 'string' ? interactionId.trim() : undefined,
      });

      return res.json(result);
    } catch (error) {
      console.error('Error in /api/image/ask endpoint:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown image mentor error';

      if (errorMessage.includes('GEMINI_API_KEY')) {
        return res.status(500).json({ error: errorMessage });
      }

      const is429 =
        error?.statusCode === 429 ||
        error?.status === 429 ||
        error?.code === 'RATE_LIMIT_EXCEEDED' ||
        errorMessage.includes('quota') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('429') ||
        errorMessage.includes('RESOURCE_EXHAUSTED');

      if (is429) {
        return res.status(429).json({
          success: false,
          error:
            error?.code === 'RATE_LIMIT_EXCEEDED' || errorMessage.includes('daily quota')
              ? errorMessage
              : 'Gemini API rate limit or quota reached. Please wait a moment before asking another question.',
          code: 'RATE_LIMIT_EXCEEDED',
        });
      }

      // Handle invalid or expired session
      const requestedInteractionId = req.body?.interactionId;
      const isInteractionSessionError =
        Boolean(requestedInteractionId) &&
        (errorMessage.toLowerCase().includes('previous_interaction_id') ||
          errorMessage.toLowerCase().includes('invalid argument') ||
          errorMessage.toLowerCase().includes('invalid_request') ||
          errorMessage.toLowerCase().includes('not found') ||
          errorMessage.toLowerCase().includes('expired'));

      if (isInteractionSessionError) {
        return res.status(400).json({
          error:
            'Your previous conversation session has expired or is invalid. Please start a fresh conversation.',
        });
      }

      return res.status(500).json({
        error: `Image Mentor Error: ${errorMessage}`,
      });
    }
  });
});

/**
 * Controlled Learning Agent Endpoint (Step 8.1: Learning Agent Core)
 * 
 * Receives: { goal: string, documentId?: string, interactionId?: string }
 * Returns: {
 *   success: true,
 *   intent: string,
 *   goal: string,
 *   relevantDocument: string | null,
 *   workflow: string[],
 *   response: string,
 *   interactionId: string,
 *   sources: Array<any>,
 *   executionMs: number
 * }
 */
app.post('/api/agent/learn', async (req, res) => {
  try {
    const { goal, documentId, interactionId } = req.body;

    // 1. Validate goal parameter
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      return res.status(400).json({
        error: 'Please provide a valid learning goal in the request body.',
      });
    }

    // 2. Validate Gemini API key configuration
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
      return res.status(500).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Please add your Gemini API key from https://aistudio.google.com/apikey into the .env file in the project root and restart the server.',
      });
    }

    // 3. Execute controlled Learning Agent
    const result = await runLearningAgent({
      goal: goal.trim(),
      documentId: documentId && typeof documentId === 'string' ? documentId.trim() : undefined,
      interactionId: interactionId && typeof interactionId === 'string' ? interactionId.trim() : undefined,
    });

    return res.json(result);
  } catch (error) {
    console.error('Error in /api/agent/learn endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown Learning Agent error';

    // 1. Daily Quota Exhaustion (RPD)
    if (
      error?.code === 'QUOTA_EXHAUSTED' ||
      error?.statusCategory === 'QUOTA_EXHAUSTED' ||
      error?.isQuotaExhausted ||
      isDailyQuotaExhausted(error) ||
      errorMessage.includes('daily quota') ||
      errorMessage.includes('quota has been reached') ||
      errorMessage.includes('requests per day')
    ) {
      setGeminiStatus('QUOTA_EXHAUSTED');
      return res.status(429).json({
        success: false,
        error: 'Gemini daily quota has been reached. AI generation is temporarily unavailable. Please try again after the quota resets.',
        code: 'QUOTA_EXHAUSTED',
        geminiStatus: 'QUOTA_EXHAUSTED',
      });
    }

    // 2. Short-term transient rate limit (RPM)
    const is429 =
      error?.statusCode === 429 ||
      error?.status === 429 ||
      error?.code === 'RATE_LIMIT_EXCEEDED' ||
      isTransientRateLimit(error) ||
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('429') ||
      errorMessage.includes('RESOURCE_EXHAUSTED');

    if (is429) {
      setGeminiStatus('TEMPORARY_RATE_LIMIT');
      return res.status(429).json({
        success: false,
        error:
          error?.code === 'RATE_LIMIT_EXCEEDED'
            ? errorMessage
            : 'Gemini API rate limit or quota reached. Please wait a moment before asking another question.',
        code: 'RATE_LIMIT_EXCEEDED',
        geminiStatus: 'TEMPORARY_RATE_LIMIT',
      });
    }

    // Handle invalid or expired session
    const requestedInteractionId = req.body?.interactionId;
    const isInteractionSessionError =
      Boolean(requestedInteractionId) &&
      (errorMessage.toLowerCase().includes('previous_interaction_id') ||
        errorMessage.toLowerCase().includes('invalid argument') ||
        errorMessage.toLowerCase().includes('invalid_request') ||
        errorMessage.toLowerCase().includes('not found') ||
        errorMessage.toLowerCase().includes('expired'));

    if (isInteractionSessionError) {
      return res.status(400).json({
        error:
          'Your previous conversation session has expired or is invalid. Please start a fresh learning goal.',
      });
    }

    return res.status(500).json({
      error: `Learning Agent Error: ${errorMessage}`,
    });
  }
});

/**
 * Step 15: Local AI Feasibility Lab Endpoints
 * 
 * GET /api/local-ai/status
 * Reports feature flag state, model name, runtime, and readiness.
 * 
 * POST /api/local-ai/classify
 * Classifies learning intent locally using ONNX Runtime / Transformers.js without calling Gemini.
 */
app.get('/api/local-ai/status', async (req, res) => {
  try {
    const { getLocalAiStatus } = await import('./services/localAiClassifier.js');
    return res.json(getLocalAiStatus());
  } catch (error) {
    return res.json({
      enabled: process.env.LOCAL_AI_EXPERIMENT === 'true',
      model: 'None',
      runtime: 'Regex / Rule-Based',
      status: 'Unavailable',
      error: error.message,
    });
  }
});

app.post('/api/local-ai/classify', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Please provide text in the request body.' });
    }

    const { classifyLearningIntent } = await import('./services/localAiClassifier.js');
    const result = await classifyLearningIntent(text.trim());
    return res.json(result);
  } catch (error) {
    console.error('Error in /api/local-ai/classify:', error);
    return res.status(500).json({
      error: `Local AI classification error: ${error.message}`,
    });
  }
});

/**
 * Pre-Hackathon Experiment: Classroom Assistant Endpoint
 * 
 * Supports transforming uploaded lecture PDFs into structured learning resources:
 * - CLASSROOM_SUMMARY
 * - TOPIC_IDENTIFICATION
 * - ASSIGNMENT_GENERATION
 * - ASSESSMENT_GENERATION
 * 
 * Accepts: { action?: string, intent?: string, documentId: string, interactionId?: string }
 * Returns: {
 *   success: boolean,
 *   intent: string,
 *   action: string,
 *   documentId: string,
 *   documentUsed: string,
 *   retrievedChunks: number,
 *   sources: Array<any>,
 *   output: string,
 *   response: string,
 *   executionMs: number,
 *   interactionId: string
 * }
 */
app.post('/api/agent/classroom', async (req, res) => {
  try {
    const { action, intent, documentId, interactionId } = req.body;

    const chosenAction = action || intent;
    if (!chosenAction || typeof chosenAction !== 'string' || !chosenAction.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid classroom action/intent (e.g. CLASSROOM_SUMMARY, TOPIC_IDENTIFICATION, ASSIGNMENT_GENERATION, ASSESSMENT_GENERATION).',
        code: 'INVALID_ACTION',
        geminiStatus: getGeminiStatus(),
      });
    }

    if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please provide the documentId of the lecture PDF to ground the classroom action.',
        code: 'INVALID_DOCUMENT',
        geminiStatus: getGeminiStatus(),
      });
    }

    // Validate Gemini API key configuration
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
      setGeminiStatus('ERROR');
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please check your .env file.',
        code: 'CONFIG_ERROR',
        geminiStatus: 'ERROR',
      });
    }

    const result = await runClassroomAgent({
      action: chosenAction.trim(),
      intent: chosenAction.trim(),
      documentId: documentId.trim(),
      interactionId: interactionId && typeof interactionId === 'string' ? interactionId.trim() : undefined,
    });

    return res.json(result);
  } catch (error) {
    console.error('[CLASSROOM ENDPOINT ERROR]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown Classroom Assistant error';

    // 1. Daily Quota Exhaustion (RPD) - HTTP 429 with clean message and no retry
    if (
      error?.code === 'QUOTA_EXHAUSTED' ||
      error?.statusCategory === 'QUOTA_EXHAUSTED' ||
      error?.isQuotaExhausted ||
      isDailyQuotaExhausted(error) ||
      errorMessage.includes('daily quota') ||
      errorMessage.includes('quota has been reached') ||
      errorMessage.includes('requests per day')
    ) {
      setGeminiStatus('QUOTA_EXHAUSTED');
      return res.status(429).json({
        success: false,
        error: 'Gemini daily quota has been reached. AI generation is temporarily unavailable. Please try again after the quota resets.',
        code: 'QUOTA_EXHAUSTED',
        geminiStatus: 'QUOTA_EXHAUSTED',
      });
    }

    // 2. Short-Term Transient Rate Limit (RPM) / 429
    const is429 =
      error?.statusCode === 429 ||
      error?.status === 429 ||
      error?.code === 'RATE_LIMIT_EXCEEDED' ||
      isTransientRateLimit(error) ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('429') ||
      errorMessage.includes('RESOURCE_EXHAUSTED');

    if (is429) {
      setGeminiStatus('TEMPORARY_RATE_LIMIT');
      return res.status(429).json({
        success: false,
        error: errorMessage.includes('cooling period') || errorMessage.includes('wait a moment')
          ? errorMessage
          : 'Gemini API temporary rate limit reached. Please wait a moment before trying again.',
        code: 'RATE_LIMIT_EXCEEDED',
        geminiStatus: 'TEMPORARY_RATE_LIMIT',
      });
    }

    // 3. Timeout error (504)
    if (
      error?.code === 'TIMEOUT' ||
      error?.statusCode === 504 ||
      errorMessage.includes('timed out') ||
      errorMessage.includes('timeout')
    ) {
      setGeminiStatus('ERROR');
      return res.status(504).json({
        success: false,
        error: 'Classroom Assistant request timed out. Please try again.',
        code: 'TIMEOUT',
        geminiStatus: 'ERROR',
      });
    }

    // 4. Missing document or bad input (400)
    if (errorMessage.includes('Please upload') || errorMessage.includes('not found in study storage')) {
      return res.status(400).json({
        success: false,
        error: errorMessage,
        code: 'DOCUMENT_NOT_FOUND',
        geminiStatus: getGeminiStatus(),
      });
    }

    // 5. Generic server error (500)
    setGeminiStatus('ERROR');
    return res.status(500).json({
      success: false,
      error: `Classroom Assistant Error: ${errorMessage}`,
      code: 'SERVER_ERROR',
      geminiStatus: 'ERROR',
    });
  }
});

/**
 * Main AI Query endpoint.
 * Receives: { question: string, interactionId?: string }
 * Returns: { answer: string, interactionId: string }
 */
app.post('/api/ask', async (req, res) => {
  try {
    const { question, interactionId } = req.body;

    // 1. Validate request body
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        error: 'Please provide a valid, non-empty question in the request body.',
      });
    }

    // 2. Validate API key configuration
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
      return res.status(500).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Please add your Gemini API key from https://aistudio.google.com/apikey into the .env file in the project root and restart the server.',
      });
    }

    // 3. Initialize GoogleGenAI SDK with the secure server-side key
    const client = new GoogleGenAI({
      apiKey: apiKey.trim(),
      httpOptions: {
        retryOptions: {
          attempts: 1, // Disable uncontrolled internal retries
        },
      },
    });

    // 4. Construct interaction parameters with the ByteMind AI Mentor persona
    // Note: system_instruction must be provided on every interaction.create call,
    // while conversation history is automatically linked via previous_interaction_id.
    const interactionParams = {
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      input: question.trim(),
      system_instruction: BYTEMIND_MENTOR_SYSTEM_INSTRUCTION,
    };

    if (interactionId && typeof interactionId === 'string' && interactionId.trim()) {
      interactionParams.previous_interaction_id = interactionId.trim();
    }

    // 5. Call the Gemini Interactions API with maxRetries: 0
    const interaction = await client.interactions.create(interactionParams, { maxRetries: 0 });

    if (!interaction.output_text) {
      return res.status(500).json({
        error: 'The Gemini model completed the request but did not return any text response.',
      });
    }

    setGeminiStatus('AVAILABLE');

    // 6. Return the generated answer and the new interactionId for the next turn
    return res.json({
      answer: interaction.output_text,
      interactionId: interaction.id,
    });
  } catch (error) {
    console.error('Error in /api/ask endpoint:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown server error occurred';

    // 1. Daily Quota Exhaustion (RPD)
    if (
      error?.code === 'QUOTA_EXHAUSTED' ||
      error?.statusCategory === 'QUOTA_EXHAUSTED' ||
      error?.isQuotaExhausted ||
      isDailyQuotaExhausted(error) ||
      errorMessage.includes('daily quota') ||
      errorMessage.includes('quota has been reached') ||
      errorMessage.includes('requests per day')
    ) {
      setGeminiStatus('QUOTA_EXHAUSTED');
      return res.status(429).json({
        success: false,
        error: 'Gemini daily quota has been reached. AI generation is temporarily unavailable. Please try again after the quota resets.',
        code: 'QUOTA_EXHAUSTED',
        geminiStatus: 'QUOTA_EXHAUSTED',
      });
    }

    // 2. Short-term transient rate limit (RPM)
    const is429 =
      error?.statusCode === 429 ||
      error?.status === 429 ||
      error?.code === 'RATE_LIMIT_EXCEEDED' ||
      isTransientRateLimit(error) ||
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('429') ||
      errorMessage.includes('RESOURCE_EXHAUSTED');

    if (is429) {
      setGeminiStatus('TEMPORARY_RATE_LIMIT');
      return res.status(429).json({
        success: false,
        error:
          error?.code === 'RATE_LIMIT_EXCEEDED'
            ? errorMessage
            : 'Gemini API rate limit or quota reached. Please wait a moment before asking another question.',
        code: 'RATE_LIMIT_EXCEEDED',
        geminiStatus: 'TEMPORARY_RATE_LIMIT',
      });
    }

    // Handle invalid or expired previous_interaction_id gracefully
    const requestedInteractionId = req.body?.interactionId;
    const isInteractionSessionError =
      Boolean(requestedInteractionId) &&
      (errorMessage.toLowerCase().includes('previous_interaction_id') ||
        errorMessage.toLowerCase().includes('invalid argument') ||
        errorMessage.toLowerCase().includes('invalid_request') ||
        errorMessage.toLowerCase().includes('not found') ||
        errorMessage.toLowerCase().includes('expired') ||
        (typeof error === 'object' && error !== null && ('status' in error || 'statusCode' in error) && ((error).status === 400 || (error).statusCode === 400)));

    if (isInteractionSessionError) {
      return res.status(400).json({
        error:
          'Your previous conversation session has expired or is invalid. Please click "New Conversation" to start a fresh chat.',
      });
    }

    return res.status(500).json({
      error: `Gemini API Error: ${errorMessage}`,
    });
  }
});

/**
 * Seeds canonical starter study documents into the shared document/vector store.
 * Reuses the exact same chunking (chunkDocument), embedding (embedChunks),
 * and storage (saveDocumentAndChunks) pipeline used by user-uploaded PDFs.
 */
async function seedStarterDocumentsIfEmpty() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
      console.log('ℹ️  Skipping starter document auto-embedding: GEMINI_API_KEY not configured yet.');
      return;
    }

    for (const doc of STARTER_DOCUMENTS) {
      if (hasEmbeddedDocument(doc.documentId) || hasEmbeddedDocument(doc.filename)) {
        continue;
      }

      console.log(`[RAG Seed] Chunking and embedding starter document: "${doc.filename}"...`);
      const chunks = chunkDocument(doc.text, doc.filename);

      // Store raw chunks in memory
      storeDocumentChunks(doc.filename, chunks);
      storeDocumentChunks(doc.documentId, chunks);

      // Embed chunks via gemini-embedding-2 using existing embedChunks()
      const embeddedChunks = await embedChunks(chunks, doc.documentId);

      // Persist to shared vector store (memory + PostgreSQL if configured)
      await saveDocumentAndChunks({
        filename: doc.filename,
        pageCount: doc.pageCount,
        textLength: doc.text.length,
        chunksWithEmbeddings: embeddedChunks,
      });

      console.log(`[RAG Seed] ✓ Successfully indexed "${doc.filename}" (${embeddedChunks.length} chunks) in shared storage.`);
    }
  } catch (err) {
    console.warn('⚠️  Warning during starter document seeding:', err.message);
  }
}

/**
 * SPA Fallback & Static Serving
 * In production, serves the React application for all non-API GET requests.
 * Unmatched /api/* routes receive a clean JSON 404 instead of index.html.
 */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('ByteMind frontend build not found. Please run "npm run build" first.');
  }
});

// Initialize database on server start and seed starter study materials
initDatabase()
  .then(() => seedStarterDocumentsIfEmpty())
  .catch((err) => {
    console.warn('Initial vector database / starter seeding warning:', err.message);
  });

// Start the server (bind to 0.0.0.0 to ensure public cloud & LAN access)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ByteMind server listening on http://0.0.0.0:${PORT}`);
  console.log(`🔑 GEMINI_API_KEY status: ${process.env.GEMINI_API_KEY ? 'Configured' : 'NOT configured (check .env)'}`);
  console.log(`🗄️ Vector Storage: ${isDbConfigured() ? 'PostgreSQL (pgvector)' : 'In-Memory Fallback'}`);
  console.log(`📦 Production Frontend: ${fs.existsSync(distPath) ? 'Enabled (dist/)' : 'Development (dist/ not built)'}`);
});

