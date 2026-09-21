/**
 * server/providers/OllamaProvider.js
 * 
 * Local AI Provider implementing ByteMind's AIProvider interface via Ollama.
 * 
 * Target: Ollama HTTP API (http://localhost:11434)
 * Default Model: qwen3:4b
 * 
 * Key Characteristics:
 * - Completely local, zero cloud dependencies or external API keys needed.
 * - Single request per turn: 1 backend request -> 1 Ollama request -> 1 response.
 * - Uses native Node http/https client to eliminate undici headersTimeout issues on CPU inference.
 * - Robust error handling: maps connection drops to LOCAL_AI_UNAVAILABLE.
 * - Normalized response format matching the ByteMind AI contract.
 */

import http from 'http';
import https from 'https';
import { AIProvider } from './AIProvider.js';

export class LocalAiUnavailableError extends Error {
  constructor(message = "ByteMind's local AI is currently unavailable. Please start the local AI service and try again.", details = null) {
    super(message);
    this.name = 'LocalAiUnavailableError';
    this.code = 'LOCAL_AI_UNAVAILABLE';
    this.details = details;
  }
}

export class LocalAiTimeoutError extends Error {
  constructor(message = "ByteMind local AI took too long to respond.", details = null) {
    super(message);
    this.name = 'LocalAiTimeoutError';
    this.code = 'LOCAL_AI_TIMEOUT';
    this.details = details;
  }
}

/**
 * Standard HTTP JSON request helper using native http/https to avoid undici timeouts.
 */
function httpRequestJson({ url, method = 'GET', headers = {}, body = null, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const finalHeaders = { ...headers };
    if (payload) {
      finalHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = client.request(
      parsedUrl,
      {
        method,
        headers: finalHeaders,
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data, raw });
          } catch {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: null, raw });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new LocalAiTimeoutError("ByteMind local AI took too long to respond.", { timeoutMs, url }));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

export class OllamaProvider extends AIProvider {
  constructor(options = {}) {
    super('ollama');
    this.baseUrl = options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = options.model || process.env.OLLAMA_CHAT_MODEL || 'qwen3:4b';
    this.visionModel = options.visionModel || process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:4b';
    this.embedModel = options.embedModel || process.env.OLLAMA_EMBED_MODEL || 'qwen3-embedding:0.6b';
  }

  /**
   * Generates a conversational chat response using Ollama's /api/chat.
   * 
   * @param {object} params
   * @param {string} params.prompt - Current user question
   * @param {string} [params.systemInstruction] - System prompt / persona
   * @param {Array<{role: string, content: string}>} [params.history] - Prior messages in this conversation
   * @param {object} [params.options] - Optional overrides
   * @returns {Promise<{
   *   text: string,
   *   provider: 'ollama',
   *   model: string,
   *   usage: { promptTokens: number, completionTokens: number, totalTokens: number },
   *   metadata: { executionMs: number, localAi: true, ... }
   * }>}
   */
  async chat({ prompt, systemInstruction, history = [], options = {} }) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Prompt is required for chat generation');
    }

    // Build the messages array for Ollama
    const messages = [];

    // 1. Prepend system instruction if supplied
    if (systemInstruction && typeof systemInstruction === 'string' && systemInstruction.trim()) {
      let instruction = systemInstruction.trim();
      // Add brief thinking optimization note for reasoning models
      instruction += '\n\nNote: Keep internal reasoning brief and directly deliver clear, educational explanations to the student.';
      messages.push({
        role: 'system',
        content: instruction,
      });
    }

    // 2. Append prior conversation history (preserving role and clean content)
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

    // 3. Append current user prompt
    messages.push({
      role: 'user',
      content: prompt.trim(),
    });

    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/api/chat`;
    const requestPayload = {
      model: options.model || this.model,
      messages,
      stream: false,
      think: false,
      options: {
        num_predict: options.num_predict || 1024,
        ...(options.options || {}),
      },
    };

    let result;
    const startTime = Date.now();

    try {
      result = await httpRequestJson({
        url: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        timeoutMs: 240000, // 240 seconds timeout for local CPU inference
      });
    } catch (networkError) {
      if (
        networkError instanceof LocalAiTimeoutError ||
        networkError.code === 'LOCAL_AI_TIMEOUT' ||
        networkError.message?.toLowerCase().includes('timed out') ||
        networkError.message?.toLowerCase().includes('timeout')
      ) {
        throw new LocalAiTimeoutError("ByteMind local AI took too long to respond.", { endpoint, timeoutMs: 240000 });
      }
      const cause = networkError.cause?.code || networkError.code || networkError.message;
      console.error(`[OllamaProvider] Failed to connect to Ollama at ${endpoint}:`, cause);
      throw new LocalAiUnavailableError(
        "ByteMind's local AI is currently unavailable. Please start the local AI service and try again.",
        { endpoint, cause }
      );
    }

    if (!result.ok) {
      const status = result.status;
      const errorBody = result.raw || '';
      console.error(`[OllamaProvider] Ollama returned HTTP ${status}:`, errorBody);

      if (status === 404) {
        throw new Error(
          `Local model '${requestPayload.model}' not found in Ollama. Please ensure it is installed using 'ollama pull ${requestPayload.model}'.`
        );
      }

      throw new Error(`Ollama chat request failed with HTTP status ${status}: ${errorBody}`);
    }

    const data = result.data || {};
    const fallbackElapsedMs = Date.now() - startTime;

    // Requirement 4 & 5: Correctly extract Ollama response: response.message.content
    // Ensure internal thinking tokens are NEVER exposed to Student Mode
    let text = '';
    if (data?.message && typeof data.message.content === 'string' && data.message.content.trim()) {
      text = data.message.content;
    } else if (typeof data?.response === 'string' && data.response.trim()) {
      text = data.response;
    } else if (data?.message && typeof data.message.thinking === 'string' && data.message.thinking.trim()) {
      text = data.message.thinking;
    }

    // Strip internal chain-of-thought </think> if model embedded thinking in content string
    if (text.includes('</think>')) {
      text = text.split('</think>').pop().trim();
    } else if (text.includes('\u003c/think\u003e')) {
      text = text.split('\u003c/think\u003e').pop().trim();
    }

    if (!text) {
      throw new Error('Ollama model responded but did not return any message content.');
    }

    const totalDurationMs = data.total_duration
      ? Math.round(data.total_duration / 1e6)
      : fallbackElapsedMs;

    return {
      text,
      provider: 'ollama',
      model: data.model || requestPayload.model,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      metadata: {
        totalDurationMs,
        evalDurationMs: data.eval_duration ? Math.round(data.eval_duration / 1e6) : undefined,
        promptEvalDurationMs: data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : undefined,
        executionMs: totalDurationMs,
        localAi: true,
        doneReason: data.done_reason || 'stop',
      },
    };
  }

  /**
   * Multimodal image reasoning via Ollama vision model (qwen3-vl:4b).
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
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Prompt is required for image query');
    }
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('Valid imageBuffer is required for multimodal vision query');
    }

    const messages = [];

    if (systemInstruction && typeof systemInstruction === 'string' && systemInstruction.trim()) {
      messages.push({
        role: 'system',
        content: systemInstruction.trim() + '\n\nNote: Keep internal reasoning brief and explain clearly.',
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

    // Attach image as base64 string
    const base64Image = imageBuffer.toString('base64');
    messages.push({
      role: 'user',
      content: prompt.trim(),
      images: [base64Image],
    });

    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/api/chat`;
    const targetModel = options.model || this.visionModel;
    const requestPayload = {
      model: targetModel,
      messages,
      stream: false,
    };

    const startTime = Date.now();
    let result;
    try {
      result = await httpRequestJson({
        url: endpoint,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        timeoutMs: 600000,
      });
    } catch (networkError) {
      const cause = networkError.cause?.code || networkError.code || networkError.message;
      throw new LocalAiUnavailableError(
        "ByteMind's local vision AI is currently unavailable.",
        { endpoint, cause, model: targetModel }
      );
    }

    if (!result.ok) {
      throw new Error(`Ollama vision request failed with HTTP ${result.status}: ${result.raw || ''}`);
    }

    const data = result.data || {};
    let text = data?.message?.content || '';
    if (text.includes('<think>') && text.includes('</think>')) {
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }
    if (!text && data?.message?.thinking) {
      text = String(data.message.thinking).trim();
    }

    const totalDurationMs = data.total_duration ? Math.round(data.total_duration / 1e6) : (Date.now() - startTime);

    return {
      text,
      provider: 'ollama',
      model: data.model || targetModel,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      metadata: {
        executionMs: totalDurationMs,
        localAi: true,
      },
    };
  }

  /**
   * Generates dense vector embeddings using Ollama embedding model (qwen3-embedding:0.6b).
   * 
   * @param {object} params
   * @param {string|string[]} params.input - Single text or array of texts
   * @param {object} [params.options]
   * @returns {Promise<{ embeddings: number[][], provider: 'ollama', model: string, dimensions: number }>}
   */
  async embed({ input, options = {} }) {
    if (!input || (Array.isArray(input) && input.length === 0)) {
      throw new Error('Input text is required for embedding generation');
    }

    const targetModel = options.model || this.embedModel;
    const isSingle = typeof input === 'string';
    const texts = isSingle ? [input] : input;

    // Use Ollama /api/embed (modern batch endpoint)
    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/api/embed`;
    let result;
    try {
      result = await httpRequestJson({
        url: endpoint,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          input: texts,
        }),
        timeoutMs: 120000,
      });
    } catch (networkError) {
      const cause = networkError.cause?.code || networkError.code || networkError.message;
      throw new LocalAiUnavailableError(
        "ByteMind's local embedding AI is currently unavailable.",
        { endpoint, cause, model: targetModel }
      );
    }

    if (result.ok && Array.isArray(result.data?.embeddings)) {
      const embeddings = result.data.embeddings;
      return {
        embeddings,
        provider: 'ollama',
        model: targetModel,
        dimensions: embeddings[0]?.length || 0,
      };
    }

    // Fallback: If /api/embed returned 404, try legacy /api/embeddings per text
    const legacyEndpoint = `${this.baseUrl.replace(/\/+$/, '')}/api/embeddings`;
    const fallbackEmbeddings = [];
    for (const text of texts) {
      const singleRes = await httpRequestJson({
        url: legacyEndpoint,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: targetModel, prompt: text }),
        timeoutMs: 60000,
      });
      if (!singleRes.ok || !Array.isArray(singleRes.data?.embedding)) {
        throw new Error(`Ollama embeddings request failed with HTTP ${singleRes.status}: ${singleRes.raw || ''}`);
      }
      fallbackEmbeddings.push(singleRes.data.embedding);
    }

    return {
      embeddings: fallbackEmbeddings,
      provider: 'ollama',
      model: targetModel,
      dimensions: fallbackEmbeddings[0]?.length || 0,
    };
  }

  /**
   * Health check for Ollama.
   * Calls GET /api/tags and verifies that the configured model is installed.
   * Does NOT generate tokens.
   */
  async healthCheck() {
    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/api/tags`;
    try {
      const result = await httpRequestJson({
        url: endpoint,
        method: 'GET',
        timeoutMs: 4000,
      });

      if (!result.ok) {
        return {
          status: 'error',
          provider: 'ollama',
          available: false,
          model: this.model,
          error: `Ollama service returned HTTP ${result.status}`,
        };
      }

      const data = result.data || {};
      const models = Array.isArray(data?.models) ? data.models : [];
      const targetModel = this.model.toLowerCase();
      const targetPrefix = targetModel.split(':')[0];

      const modelFound = models.some((m) => {
        const name = (m.name || m.model || '').toLowerCase();
        return name === targetModel || name.startsWith(`${targetPrefix}:`) || name === targetPrefix;
      });

      return {
        status: modelFound ? 'ok' : 'degraded',
        provider: 'ollama',
        available: true,
        model: this.model,
        modelFound,
        message: modelFound
          ? `Ollama is running and model '${this.model}' is ready.`
          : `Ollama is running, but model '${this.model}' was not found in installed models.`,
      };
    } catch (networkError) {
      const cause = networkError.cause?.code || networkError.code || networkError.message;
      return {
        status: 'unavailable',
        provider: 'ollama',
        available: false,
        model: this.model,
        error: `Cannot reach Ollama at ${this.baseUrl}: ${cause}`,
      };
    }
  }
}
