/**
 * server/agent/agentGeminiClient.js
 * 
 * WHY THIS MODULE IS NEEDED:
 * Provides safe, quota-protected GoogleGenAI client initialization and interaction
 * execution for agent tools.
 * 
 * Key Principles:
 * 1. Zero eager calls on import or registration.
 * 2. Uncontrolled SDK retries disabled (attempts: 1 and maxRetries: 0).
 * 3. At most ONE transient retry for 429 / 5xx errors with small exponential backoff.
 * 4. Immediate failure for daily/long-term quota exhaustion without retrying.
 * 5. Developer Mode status logging: AVAILABLE / QUOTA_EXHAUSTED / TEMPORARY_RATE_LIMIT / ERROR.
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Developer Mode Gemini status tracker:
 * 'AVAILABLE' | 'QUOTA_EXHAUSTED' | 'TEMPORARY_RATE_LIMIT' | 'ERROR'
 */
let currentGeminiStatus = 'AVAILABLE';

export function getGeminiStatus() {
  return currentGeminiStatus;
}

export function setGeminiStatus(status) {
  currentGeminiStatus = status;
  console.log(`[Developer Mode] Gemini status: ${status}`);
}

/**
 * Validates and returns a GoogleGenAI SDK client with internal retries disabled.
 * @returns {GoogleGenAI}
 */
export function getAgentGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim() || apiKey.includes('your_gemini_api_key_here')) {
    setGeminiStatus('ERROR');
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please check your .env file.'
    );
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      retryOptions: {
        attempts: 1, // Disable uncontrolled internal SDK retries (1 attempt, 0 retries)
      },
    },
  });
}

/**
 * Extracts and normalizes all available text details from any error shape.
 * 
 * @param {any} error
 * @returns {string}
 */
export function extractErrorDetails(error) {
  if (!error) return '';
  const parts = [];

  if (typeof error === 'string') {
    return error.toLowerCase();
  }

  if (error.message) {
    parts.push(String(error.message));
  }
  if (error.name) {
    parts.push(String(error.name));
  }
  if (error.code) {
    parts.push(String(error.code));
  }
  if (error.status) {
    parts.push(String(error.status));
  }
  if (error.statusCode) {
    parts.push(String(error.statusCode));
  }
  if (error.statusText) {
    parts.push(String(error.statusText));
  }
  if (error.cause) {
    parts.push(typeof error.cause === 'object' ? JSON.stringify(error.cause) : String(error.cause));
  }
  if (error.body) {
    parts.push(typeof error.body === 'object' ? JSON.stringify(error.body) : String(error.body));
  }
  if (error.response) {
    parts.push(typeof error.response === 'object' ? JSON.stringify(error.response) : String(error.response));
  }
  if (error.details) {
    parts.push(typeof error.details === 'object' ? JSON.stringify(error.details) : String(error.details));
  }
  if (error.error) {
    parts.push(typeof error.error === 'object' ? JSON.stringify(error.error) : String(error.error));
  }
  if (typeof error.toString === 'function') {
    try {
      const str = error.toString();
      if (str && str !== '[object Object]') {
        parts.push(str);
      }
    } catch (_) {}
  }

  return parts.join(' ').toLowerCase();
}

/**
 * Detects if an error indicates permanent or long-term daily quota exhaustion (RPD).
 * Checks strictly BEFORE any retry-window parsing so daily quota limits are never misclassified as transient.
 * 
 * @param {any} error
 * @returns {boolean}
 */
export function isDailyQuotaExhausted(error) {
  if (error?.code === 'QUOTA_EXHAUSTED' || error?.statusCategory === 'QUOTA_EXHAUSTED' || error?.isQuotaExhausted) {
    return true;
  }

  const combined = extractErrorDetails(error);

  return (
    combined.includes('requests per day') ||
    combined.includes('per day') ||
    combined.includes('rpd') ||
    combined.includes('daily quota') ||
    combined.includes('daily_quota') ||
    combined.includes('daily limit') ||
    combined.includes('day limit') ||
    combined.includes('per-day') ||
    combined.includes('limit: 20 requests') ||
    combined.includes('quota limit: 0') ||
    combined.includes('billing account') ||
    combined.includes('reset tomorrow') ||
    combined.includes('quota_exceeded') ||
    combined.includes('quota exceeded') ||
    combined.includes('exceeded your current quota') ||
    combined.includes('check your plan and billing details') ||
    (combined.includes('free tier') && (
      combined.includes('day') ||
      combined.includes('daily') ||
      combined.includes('quota') ||
      combined.includes('limit') ||
      combined.includes('exhausted')
    ))
  );
}

/**
 * Detects if an error is a short-term transient rate limit (RPM) or transient 5xx server error.
 * Excludes daily quota exhaustion and non-retryable stream errors.
 * 
 * @param {any} error
 * @returns {boolean}
 */
export function isTransientRateLimit(error) {
  // Daily quota exhaustion is strictly NEVER transient
  if (isDailyQuotaExhausted(error)) {
    return false;
  }

  const status = error?.status || error?.statusCode;
  const combined = extractErrorDetails(error);

  // Short-term HTTP 429 / Rate limit indicators (RPM)
  if (
    status === 429 ||
    combined.includes('429') ||
    combined.includes('rate limit') ||
    combined.includes('rate_limit') ||
    combined.includes('too many requests') ||
    combined.includes('resource_exhausted') ||
    combined.includes('resource exhausted') ||
    combined.includes('requests per minute') ||
    combined.includes('per minute') ||
    combined.includes('rpm')
  ) {
    return true;
  }

  // Transient 5xx server errors
  if (
    (typeof status === 'number' && status >= 500 && status < 600) ||
    combined.includes('500') ||
    combined.includes('502') ||
    combined.includes('503') ||
    combined.includes('504') ||
    combined.includes('service unavailable') ||
    combined.includes('service_unavailable') ||
    combined.includes('unavailable') ||
    combined.includes('overloaded')
  ) {
    return true;
  }

  return false;
}

/**
 * Wraps a promise with a hard timeout to ensure requests never hang indefinitely.
 */
function withTimeout(promise, ms = 25000, timeoutMessage = 'Gemini API request timed out after 25 seconds.') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(timeoutMessage);
      err.statusCode = 504;
      err.code = 'TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ]);
}

export const DEFAULT_AGENT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

/**
 * Invokes Gemini Interactions API with strict quota awareness, timeout protection,
 * and at most 1 short transient retry.
 * 
 * @param {object} interactionParams
 * @returns {Promise<{ output_text: string, id: string }>}
 */
export async function callAgentGemini(interactionParams, customClient = null) {
  const client = customClient || getAgentGenAIClient();
  const maxRetries = 1; // Maximum 1 retry for development/test environment
  let attempt = 0;

  const targetModel =
    !interactionParams.model || interactionParams.model === 'gemini-3.6-flash'
      ? DEFAULT_AGENT_MODEL
      : interactionParams.model;

  const effectiveParams = {
    ...interactionParams,
    model: targetModel,
  };

  while (attempt <= maxRetries) {
    try {
      console.log(`[Developer Mode] Calling Gemini API (${targetModel}), attempt ${attempt + 1}/${maxRetries + 1}...`);
      
      // Pass { maxRetries: 0 } to disable Speakeasy client internal retries
      const result = await withTimeout(
        client.interactions.create(effectiveParams, { maxRetries: 0 }),
        25000,
        'Gemini API request timed out after 25 seconds.'
      );
      
      setGeminiStatus('AVAILABLE');
      return result;
    } catch (error) {
      console.error('[AGENT dev] Error caught:', error?.message || error);

      // 1. Permanent / Daily Quota Exhaustion (RPD): NEVER retry automatically
      if (isDailyQuotaExhausted(error)) {
        setGeminiStatus('QUOTA_EXHAUSTED');
        console.warn('[Developer Mode] Gemini status: QUOTA_EXHAUSTED (Daily quota reached). Skipping retry.');
        const quotaErr = new Error(
          'Gemini daily quota has been reached. AI generation is temporarily unavailable. Please try again after the quota resets.'
        );
        quotaErr.statusCode = 429;
        quotaErr.code = 'QUOTA_EXCEEDED';
        quotaErr.statusCategory = 'QUOTA_EXHAUSTED';
        quotaErr.isQuotaExhausted = true;
        throw quotaErr;
      }

      // 2. Check for "retry in Xs" delay
      const msg = extractErrorDetails(error);
      const match = msg.match(/retry in (\d+(?:\.\d+)?)s/);
      const retrySeconds = match && match[1] ? parseFloat(match[1]) : null;

      // If cooling delay is more than 5s, do not block the active HTTP request for minutes
      if (retrySeconds !== null && retrySeconds > 5) {
        setGeminiStatus('TEMPORARY_RATE_LIMIT');
        console.warn(`[Developer Mode] Gemini status: TEMPORARY_RATE_LIMIT (Cooling period: ${retrySeconds}s > 5s). Skipping in-flight retry.`);
        const rateErr = new Error(
          `Gemini temporary rate limit reached (cooling period: ${Math.ceil(retrySeconds)}s). Please wait a moment before trying again.`
        );
        rateErr.statusCode = 429;
        rateErr.code = 'RATE_LIMIT_EXCEEDED';
        rateErr.statusCategory = 'TEMPORARY_RATE_LIMIT';
        throw rateErr;
      }

      // 3. Transient short-term 429 / 5xx error: at most 1 retry with small exponential backoff (<= 2000ms)
      if (isTransientRateLimit(error) && attempt < maxRetries) {
        attempt++;
        setGeminiStatus('TEMPORARY_RATE_LIMIT');
        const delayMs = retrySeconds
          ? Math.min(Math.ceil(retrySeconds * 1000), 2000)
          : Math.min(Math.round(1000 * Math.pow(1.5, attempt)), 2000);
        console.warn(
          `[Developer Mode] Gemini status: TEMPORARY_RATE_LIMIT. Waiting ${delayMs}ms before single retry attempt ${attempt}/${maxRetries}...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // 4. Rate limit reached after single retry or non-retryable 429
      if (isTransientRateLimit(error)) {
        setGeminiStatus('TEMPORARY_RATE_LIMIT');
        console.warn('[Developer Mode] Gemini status: TEMPORARY_RATE_LIMIT (Retry limit reached).');
        const rateErr = new Error(
          'Gemini temporary rate limit reached. Please wait a moment before trying again.'
        );
        rateErr.statusCode = 429;
        rateErr.code = 'RATE_LIMIT_EXCEEDED';
        rateErr.statusCategory = 'TEMPORARY_RATE_LIMIT';
        throw rateErr;
      }

      // 5. Timeout error (504)
      if (error?.code === 'TIMEOUT' || error?.statusCode === 504) {
        setGeminiStatus('ERROR');
        console.warn('[Developer Mode] Gemini status: ERROR (Request timed out).');
        throw error;
      }

      // 6. Generic / other error
      setGeminiStatus('ERROR');
      console.warn('[Developer Mode] Gemini status: ERROR (General failure).');
      throw error;
    }
  }
}

