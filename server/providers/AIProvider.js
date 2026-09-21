/**
 * server/providers/AIProvider.js
 * 
 * Abstract Base Class for ByteMind AI Providers.
 * 
 * Defines standard contracts for:
 * - chat({ prompt, systemInstruction, history, interactionId, options })
 * - generateStructured({ prompt, schema, systemInstruction, options })
 * - chatWithImage({ prompt, imageBuffer, mimeType, systemInstruction, options })
 * - embed({ text, options })
 * - healthCheck()
 * 
 * Returns normalized responses across local (Ollama) and cloud (Gemini) backends.
 */

export class AIProvider {
  /**
   * @param {string} name - Provider identifier, e.g. 'ollama' | 'gemini'
   */
  constructor(name) {
    if (!name) {
      throw new Error('AIProvider requires a valid provider name');
    }
    this.name = name;
  }

  /**
   * Generates a conversational text response.
   * 
   * @param {object} params
   * @param {string} params.prompt - Current user message
   * @param {string} [params.systemInstruction] - System prompt / persona guidelines
   * @param {Array<{role: string, content: string}>} [params.history] - Prior messages in session
   * @param {string} [params.interactionId] - Existing session/interaction ID
   * @param {object} [params.options] - Provider-specific options
   * @returns {Promise<{
   *   text: string,
   *   provider: string,
   *   model: string,
   *   usage?: { promptTokens?: number, completionTokens?: number, totalTokens?: number },
   *   metadata?: Record<string, any>
   * }>}
   */
  async chat(_params) {
    throw new Error(`Method 'chat()' not implemented for provider '${this.name}'`);
  }

  /**
   * Generates structured data adhering to a JSON schema.
   * 
   * @param {object} _params
   */
  async generateStructured(_params) {
    throw new Error(`Method 'generateStructured()' not implemented for provider '${this.name}'`);
  }

  /**
   * Multimodal image reasoning.
   * 
   * @param {object} params
   * @param {string} params.prompt - Question/instruction about the image
   * @param {Buffer} params.imageBuffer - Image binary data
   * @param {string} params.mimeType - MIME type ('image/jpeg', 'image/png', 'image/webp')
   * @param {string} [params.systemInstruction] - System instruction
   * @param {Array<{role: string, content: string}>} [params.history] - Conversation history
   * @param {string} [params.interactionId] - Existing session ID
   * @param {object} [params.options] - Provider-specific options
   * @returns {Promise<{
   *   text: string,
   *   provider: string,
   *   model: string,
   *   usage?: Record<string, any>,
   *   metadata?: Record<string, any>
   * }>}
   */
  async chatWithImage(_params) {
    throw new Error(`Method 'chatWithImage()' not implemented for provider '${this.name}'`);
  }

  /**
   * Generates dense vector embeddings for one or more text strings.
   * 
   * @param {object} params
   * @param {string|string[]} params.input - Single text string or array of text chunks
   * @param {object} [params.options] - Provider-specific options
   * @returns {Promise<{
   *   embeddings: number[][],
   *   provider: string,
   *   model: string,
   *   dimensions: number
   * }>}
   */
  async embed(_params) {
    throw new Error(`Method 'embed()' not implemented for provider '${this.name}'`);
  }

  /**
   * Performs lightweight provider health and model availability check.
   * Must NOT generate tokens to perform the check.
   * 
   * @returns {Promise<{
   *   status: 'ok' | 'degraded' | 'unavailable' | 'error',
   *   provider: string,
   *   available: boolean,
   *   model?: string,
   *   modelFound?: boolean,
   *   message?: string,
   *   error?: string
   * }>}
   */
  async healthCheck() {
    throw new Error(`Method 'healthCheck()' not implemented for provider '${this.name}'`);
  }
}
