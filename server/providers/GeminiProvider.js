/**
 * server/providers/GeminiProvider.js
 * 
 * Cloud AI Provider implementing ByteMind's AIProvider interface via Google Gemini.
 * Wraps @google/genai client and the Gemini Interactions API.
 * 
 * Retained for backward compatibility and multi-provider choice.
 */

import { GoogleGenAI } from '@google/genai';
import { AIProvider } from './AIProvider.js';

export class GeminiProvider extends AIProvider {
  constructor(options = {}) {
    super('gemini');
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
    this.defaultModel = options.model || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  }

  /**
   * Generates a conversational response using Gemini Interactions API.
   * 
   * @param {object} params
   * @param {string} params.prompt - Current user question
   * @param {string} [params.systemInstruction] - System instruction / mentor persona
   * @param {string} [params.interactionId] - Existing Gemini interaction ID
   * @param {object} [params.options] - Optional overrides
   */
  async chat({ prompt, systemInstruction, interactionId, options = {} }) {
    const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
      throw new Error(
        'GEMINI_API_KEY is not configured on the server. Please add your Gemini API key from https://aistudio.google.com/apikey into the .env file.'
      );
    }

    const client = new GoogleGenAI({
      apiKey: apiKey.trim(),
      httpOptions: {
        retryOptions: {
          attempts: 1, // Disable uncontrolled internal retries
        },
      },
    });

    const modelName = options.model || this.defaultModel;
    const interactionParams = {
      model: modelName,
      input: prompt.trim(),
    };

    if (systemInstruction && typeof systemInstruction === 'string' && systemInstruction.trim()) {
      interactionParams.system_instruction = systemInstruction.trim();
    }

    if (interactionId && typeof interactionId === 'string' && interactionId.trim()) {
      interactionParams.previous_interaction_id = interactionId.trim();
    }

    const startTime = Date.now();
    const interaction = await client.interactions.create(interactionParams, { maxRetries: 0 });
    const executionMs = Date.now() - startTime;

    if (!interaction.output_text) {
      throw new Error('The Gemini model completed the request but did not return any text response.');
    }

    return {
      text: interaction.output_text,
      interactionId: interaction.id,
      provider: 'gemini',
      model: modelName,
      metadata: {
        interactionId: interaction.id,
        executionMs,
        localAi: false,
      },
    };
  }

  /**
   * Multimodal image reasoning using Gemini.
   */
  async chatWithImage({ prompt, imageBuffer, mimeType = 'image/jpeg', systemInstruction, interactionId, options = {} }) {
    const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
      throw new Error('GEMINI_API_KEY is not configured on the server.');
    }

    const client = new GoogleGenAI({ apiKey: apiKey.trim() });
    const modelName = options.model || this.defaultModel;

    const base64Data = imageBuffer.toString('base64');
    const contents = [
      {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: prompt },
        ],
      },
    ];

    const config = {};
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    const startTime = Date.now();
    const response = await client.models.generateContent({
      model: modelName,
      contents,
      config,
    });
    const executionMs = Date.now() - startTime;

    const text = response.text || '';
    return {
      text,
      provider: 'gemini',
      model: modelName,
      metadata: {
        executionMs,
        localAi: false,
      },
    };
  }

  /**
   * Generates dense vector embeddings using Gemini gemini-embedding-2.
   */
  async embed({ input, options = {} }) {
    const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
      throw new Error('GEMINI_API_KEY is not configured on the server.');
    }

    const client = new GoogleGenAI({ apiKey: apiKey.trim() });
    const modelName = options.model || 'gemini-embedding-2';
    const isSingle = typeof input === 'string';
    const texts = isSingle ? [input] : input;

    const contents = texts.map((t) => ({ parts: [{ text: t }] }));
    const response = await client.models.embedContent({
      model: modelName,
      contents,
      config: {
        outputDimensionality: options.dimensions || 768,
      },
    });

    const rawEmbeddings = response?.embeddings || (response?.embedding ? [response.embedding] : []);
    const embeddings = rawEmbeddings.map((e) => e.values || []);

    return {
      embeddings,
      provider: 'gemini',
      model: modelName,
      dimensions: embeddings[0]?.length || 768,
    };
  }

  /**
   * Health check for Gemini Provider.
   * Lightweight validation of API key configuration.
   * Does NOT make generative model calls.
   */
  async healthCheck() {
    const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
    const isConfigured = Boolean(apiKey && apiKey.trim().length > 0 && !apiKey.includes('your_gemini_api_key_here'));

    return {
      status: isConfigured ? 'ok' : 'unconfigured',
      provider: 'gemini',
      available: isConfigured,
      model: this.defaultModel,
      message: isConfigured
        ? `Gemini API key is configured (${this.defaultModel}).`
        : 'GEMINI_API_KEY is not configured in .env.',
    };
  }
}
