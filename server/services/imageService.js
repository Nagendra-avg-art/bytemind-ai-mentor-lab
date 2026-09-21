/**
 * server/services/imageService.js
 * 
 * WHY THIS SERVICE IS NEEDED:
 * Implements Step 6 of ByteMind: Multimodal Image Understanding using Google Gemini.
 * 
 * Architectural Flow:
 * 1. Takes the student's question and image buffer (JPEG, PNG, or WebP).
 * 2. Uploads the image to Google Gemini using the Files API (`ai.files.upload`).
 * 3. Builds a multimodal input array for the Gemini Interactions API:
 *    [
 *      { type: "text", text: question },
 *      { type: "image", uri: uploadedFile.uri, mime_type: uploadedFile.mimeType }
 *    ]
 * 4. Passes the ByteMind AI Mentor system instruction (with Section 12 multimodal rules).
 * 5. Supports multi-turn conversation memory via `previous_interaction_id`.
 * 6. Returns the educational answer and the new interactionId.
 * 7. Security: GEMINI_API_KEY and uploaded file URIs never leak to the client.
 */

import { GoogleGenAI } from '@google/genai';
import { BYTEMIND_MENTOR_SYSTEM_INSTRUCTION } from '../prompts/mentorPrompt.js';
import { getActiveProvider, getActiveProviderName } from '../providers/index.js';
import { getOrCreateSession, getSessionHistory, recordTurn } from './sessionService.js';
import { generateEmbedding, hasEmbeddedChunks } from '../utils/embeddingService.js';
import { searchVectorChunks } from '../db/vectorStore.js';

// Supported MIME types for multimodal study images
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Validates and initializes the GoogleGenAI client with the server-side API key for Gemini fallback.
 * @returns {GoogleGenAI}
 */
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please add your key to .env file.'
    );
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

/**
 * Handles multimodal image query using the active AI Provider (Ollama Qwen3-VL or Gemini).
 * 
 * @param {object} params
 * @param {Buffer} params.imageBuffer - Raw image data from multer memory storage
 * @param {string} params.mimeType - MIME type of the uploaded image
 * @param {string} [params.filename] - Original file name
 * @param {string} params.question - Student question about the image
 * @param {string} [params.interactionId] - Optional interactionId to continue conversation memory
 * 
 * @returns {Promise<{ success: boolean, answer: string, interactionId: string, provider?: string, model?: string }>}
 */
export async function askImageMentor({
  imageBuffer,
  mimeType,
  filename,
  question,
  interactionId,
}) {
  // 1. Validate question
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('Please provide a valid, non-empty question about the image.');
  }

  // 2. Validate image buffer
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('Please select or capture a valid image to ask about.');
  }

  // 3. Validate MIME type
  const normalizedMime = (mimeType || '').toLowerCase().trim();
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(normalizedMime)) {
    throw new Error(
      `Unsupported image type "${mimeType}". Supported types are: JPEG, PNG, WebP.`
    );
  }

  const activeProvider = getActiveProvider();

  // 4. Local Ollama & Cloud Groq Vision Flow
  if (activeProvider.name === 'ollama' || activeProvider.name === 'groq') {
    const session = getOrCreateSession(interactionId);
    const history = getSessionHistory(session.id);

    let combinedPrompt = question.trim();

    // Check if relevant study materials exist in RAG to enrich context
    try {
      if (hasEmbeddedChunks()) {
        const queryEmbedding = await generateEmbedding(question.trim()).catch(() => null);
        if (queryEmbedding) {
          const matchedChunks = await searchVectorChunks({
            queryEmbedding,
            topK: 2,
            threshold: 0.45,
          });
          if (matchedChunks.length > 0) {
            const contextText = matchedChunks.map((c) => c.content || c.text).join('\n\n');
            combinedPrompt = `${question.trim()}\n\n[RELEVANT STUDY MATERIAL FROM UPLOADED NOTES]:\n${contextText}\n\nGround your explanation using both the visual details in the image and the relevant study material above.`;
          }
        }
      }
    } catch (ragErr) {
      console.warn('[ImageService] RAG retrieval skipped for image:', ragErr.message);
    }

    const result = await activeProvider.chatWithImage({
      prompt: combinedPrompt,
      imageBuffer,
      mimeType: normalizedMime,
      systemInstruction: BYTEMIND_MENTOR_SYSTEM_INSTRUCTION,
      history,
    });

    recordTurn(session.id, question.trim(), result.text);

    return {
      success: true,
      answer: result.text,
      interactionId: session.id,
      provider: activeProvider.name,
      model: result.model,
      executionMs: result.metadata?.executionMs,
      localAI: activeProvider.name === 'ollama',
    };
  }

  // 5. Cloud Gemini Vision Flow (Fallback)
  const ai = getGenAIClient();
  let uploadedFile = null;

  try {
    const blob = new Blob([imageBuffer], { type: normalizedMime });
    uploadedFile = await ai.files.upload({
      file: blob,
      config: {
        mimeType: normalizedMime,
        displayName: filename || 'student-study-image',
      },
    });

    if (!uploadedFile || !uploadedFile.uri) {
      throw new Error('Gemini Files API upload completed but no file URI was returned.');
    }

    const multimodalInput = [
      {
        type: 'text',
        text: question.trim(),
      },
      {
        type: 'image',
        uri: uploadedFile.uri,
        mime_type: uploadedFile.mimeType || normalizedMime,
      },
    ];

    const interactionParams = {
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      input: multimodalInput,
      system_instruction: BYTEMIND_MENTOR_SYSTEM_INSTRUCTION,
    };

    if (interactionId && typeof interactionId === 'string' && interactionId.trim()) {
      interactionParams.previous_interaction_id = interactionId.trim();
    }

    const interaction = await ai.interactions.create(interactionParams);

    if (!interaction.output_text) {
      throw new Error('Gemini processed the image but returned an empty text response.');
    }

    return {
      success: true,
      answer: interaction.output_text,
      interactionId: interaction.id,
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      localAI: false,
    };
  } catch (error) {
    console.error('Error in askImageMentor service:', error);
    throw error;
  }
}
