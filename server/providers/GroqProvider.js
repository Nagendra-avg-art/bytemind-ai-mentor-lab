/**
 * server/providers/GroqProvider.js
 * 
 * Cloud AI Provider implementing ByteMind's AIProvider interface via Groq.
 * Fast, ultra-low-latency Llama models for public cloud deployment (e.g. Render).
 * 
 * OpenAI-compatible HTTP REST API:
 * Endpoint: https://api.groq.com/openai/v1
 * Default Chat Model: openai/gpt-oss-20b (or configured via GROQ_CHAT_MODEL)
 * Default Vision Model: qwen/qwen3.8-27b (or configured via GROQ_VISION_MODEL)
 */

import { AIProvider } from './AIProvider.js';

export class GroqRateLimitError extends Error {
  constructor(message = 'AI is temporarily busy. Please try again shortly.', details = {}) {
    super(message);
    this.name = 'GroqRateLimitError';
    this.code = 'RATE_LIMIT_EXCEEDED';
    this.statusCode = 429;
    this.status = 429;
    this.provider = 'groq';
    this.details = details;
  }
}

/**
 * Sanitizes any raw API key string from error messages to prevent leakage.
 * @param {string} text 
 * @returns {string}
 */
function sanitizeErrorMessage(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]');
}

export class GroqProvider extends AIProvider {
  constructor(options = {}) {
    super('groq');
    this.apiKey = options.apiKey || process.env.GROQ_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
    this.model = options.model || process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b';
    this.visionModel = options.visionModel || process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';
  }

  /**
   * Generates a conversational response using Groq Chat Completions.
   * 
   * @param {object} params
   * @param {string} params.prompt - Current user question
   * @param {string} [params.systemInstruction] - System prompt / persona
   * @param {Array<{role: string, content: string}>} [params.history] - Prior messages in this conversation
   * @param {object} [params.options] - Optional overrides
   */
  async chat({ prompt, systemInstruction, history = [], options = {} }) {
    const apiKey = this.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_groq_api_key_here')) {
      throw new Error(
        'GROQ_API_KEY is not configured on the server. Please add your Groq API key to your environment variables.'
      );
    }

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Prompt is required for chat generation');
    }

    const messages = [];

    if (systemInstruction && typeof systemInstruction === 'string' && systemInstruction.trim()) {
      messages.push({
        role: 'system',
        content: systemInstruction.trim(),
      });
    }

    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        if (msg && msg.role && msg.content) {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content).trim(),
          });
        }
      }
    }

    messages.push({
      role: 'user',
      content: prompt.trim(),
    });

    const targetModel = options.model || this.model;
    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const startTime = Date.now();

    let response;
    let sanitized = '';

    // Up to 2 attempts to gracefully smooth transient TPM spikes
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages,
          temperature: options.temperature ?? 0.6,
          max_tokens: options.max_tokens ?? 2048,
        }),
      });

      if (response.ok) break;

      const rawError = await response.text().catch(() => '');
      sanitized = sanitizeErrorMessage(rawError);

      const isRateLimit =
        response.status === 429 ||
        sanitized.toLowerCase().includes('rate limit') ||
        sanitized.toLowerCase().includes('rate_limit') ||
        sanitized.toLowerCase().includes('quota');

      if (isRateLimit && attempt < 2) {
        // Extract wait time from Groq error message if present (e.g. "try again in 11.6s")
        const match = sanitized.match(/try again in ([0-9.]+)s/i);
        const waitSec = match ? parseFloat(match[1]) : 3;
        const waitMs = Math.min(15000, Math.ceil(waitSec * 1000) + 500);
        console.warn(`[GroqProvider] Rate limit hit (attempt ${attempt + 1}). Smoothing TPM: waiting ${waitMs}ms before retry...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (isRateLimit) {
        throw new GroqRateLimitError('AI is temporarily busy. Please try again shortly.', {
          status: response.status,
          model: targetModel,
          provider: 'groq',
          cause: sanitized,
        });
      }

      throw new Error(`Groq API error (HTTP ${response.status}): ${sanitized}`);
    }

    const data = await response.json();
    const executionMs = Date.now() - startTime;
    const text = data?.choices?.[0]?.message?.content || '';

    if (!text) {
      throw new Error('Groq returned a response but message content was empty.');
    }

    return {
      text,
      provider: 'groq',
      model: data?.model || targetModel,
      usage: {
        promptTokens: data?.usage?.prompt_tokens || 0,
        completionTokens: data?.usage?.completion_tokens || 0,
        totalTokens: data?.usage?.total_tokens || 0,
      },
      metadata: {
        executionMs,
        localAi: false,
      },
    };
  }

  /**
   * Multimodal image reasoning via Groq Vision (e.g. qwen/qwen3.8-27b).
   * 
   * @param {object} params
   * @param {string} params.prompt
   * @param {Buffer} params.imageBuffer
   * @param {string} [params.mimeType]
   * @param {string} [params.systemInstruction]
   * @param {Array<{role: string, content: string}>} [params.history]
   * @param {object} [params.options]
   */
  async chatWithImage({ prompt, imageBuffer, mimeType = 'image/jpeg', systemInstruction, history = [], options = {} }) {
    const apiKey = this.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey || !apiKey.trim() || apiKey.includes('your_groq_api_key_here')) {
      throw new Error('GROQ_API_KEY is not configured on the server.');
    }

    const targetModel = options.model || this.visionModel;
    const messages = [];

    if (systemInstruction) {
      messages.push({
        role: 'system',
        content: systemInstruction.trim(),
      });
    }

    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        if (msg && msg.role && msg.content) {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content).trim(),
          });
        }
      }
    }

    const base64Data = imageBuffer.toString('base64');
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt.trim() },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Data}`,
          },
        },
      ],
    });

    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const startTime = Date.now();
    let response;
    let sanitized = '';

    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages,
          max_tokens: 2048,
        }),
      });

      if (response.ok) break;

      const rawError = await response.text().catch(() => '');
      sanitized = sanitizeErrorMessage(rawError);

      const isRateLimit =
        response.status === 429 ||
        sanitized.toLowerCase().includes('rate limit') ||
        sanitized.toLowerCase().includes('rate_limit') ||
        sanitized.toLowerCase().includes('quota');

      if (isRateLimit && attempt < 2) {
        const match = sanitized.match(/try again in ([0-9.]+)s/i);
        const waitSec = match ? parseFloat(match[1]) : 3;
        const waitMs = Math.min(15000, Math.ceil(waitSec * 1000) + 500);
        console.warn(`[GroqProvider] Vision rate limit hit (attempt ${attempt + 1}). Smoothing TPM: waiting ${waitMs}ms before retry...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (isRateLimit) {
        throw new GroqRateLimitError('AI is temporarily busy. Please try again shortly.', {
          status: response.status,
          model: targetModel,
          provider: 'groq',
          cause: sanitized,
        });
      }

      throw new Error(`Groq Vision API error (HTTP ${response.status}): ${sanitized}`);
    }

    const data = await response.json();
    const executionMs = Date.now() - startTime;
    const text = data?.choices?.[0]?.message?.content || '';

    return {
      text,
      provider: 'groq',
      model: data?.model || targetModel,
      metadata: {
        executionMs,
        localAi: false,
      },
    };
  }


  /**
   * Health check for Groq Provider.
   * Validates API key configuration without making billable generative calls.
   */
  async healthCheck() {
    const apiKey = this.apiKey || process.env.GROQ_API_KEY;
    const isConfigured = Boolean(apiKey && apiKey.trim().length > 0 && !apiKey.includes('your_groq_api_key_here'));

    return {
      status: isConfigured ? 'ok' : 'unconfigured',
      provider: 'groq',
      available: isConfigured,
      model: this.model,
      message: isConfigured
        ? `Groq API key is configured (${this.model}).`
        : 'GROQ_API_KEY is not configured in environment variables.',
    };
  }
}
