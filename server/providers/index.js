/**
 * server/providers/index.js
 * 
 * Provider Factory for ByteMind AI Providers.
 * 
 * Default for local development: 'ollama'
 * Configurable via AI_PROVIDER environment variable:
 * - AI_PROVIDER=ollama (default) -> OllamaProvider (qwen3:4b via http://localhost:11434)
 * - AI_PROVIDER=gemini           -> GeminiProvider (Google Gemini API)
 */

import { OllamaProvider } from './OllamaProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { GroqProvider } from './GroqProvider.js';

const providerInstances = new Map();

/**
 * Returns the requested provider instance, creating and caching it if not already present.
 * 
 * @param {string} [name] - 'ollama' | 'groq' | 'gemini'
 * @returns {import('./AIProvider.js').AIProvider}
 */
export function getProvider(name) {
  const providerName = (name || process.env.AI_PROVIDER || 'ollama').toLowerCase().trim();

  if (providerInstances.has(providerName)) {
    return providerInstances.get(providerName);
  }

  let provider;
  switch (providerName) {
    case 'ollama':
      provider = new OllamaProvider();
      break;
    case 'groq':
      provider = new GroqProvider();
      break;
    case 'gemini':
      provider = new GeminiProvider();
      break;
    default:
      console.warn(`[AIProviderFactory] Unknown AI_PROVIDER '${providerName}', falling back to 'ollama'`);
      provider = new OllamaProvider();
      break;
  }

  providerInstances.set(providerName, provider);
  return provider;
}

/**
 * Gets the active default AI provider based on environment configuration.
 * 
 * @returns {import('./AIProvider.js').AIProvider}
 */
export function getActiveProvider() {
  const name = process.env.AI_PROVIDER || 'ollama';
  return getProvider(name);
}

/**
 * Gets the active provider name.
 * 
 * @returns {string}
 */
export function getActiveProviderName() {
  return (process.env.AI_PROVIDER || 'ollama').toLowerCase().trim();
}

export { AIProvider } from './AIProvider.js';
export { OllamaProvider, LocalAiUnavailableError, LocalAiTimeoutError } from './OllamaProvider.js';
export { GeminiProvider } from './GeminiProvider.js';
export { GroqProvider, GroqRateLimitError } from './GroqProvider.js';
