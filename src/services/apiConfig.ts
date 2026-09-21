/**
 * src/services/apiConfig.ts
 * 
 * WHY THIS FILE IS NEEDED:
 * Configurable API Client Configuration & Network Error Handling for Phone-First Access.
 * 
 * Key Principles:
 * 1. Configurable Base URL:
 *    - In local desktop & mobile LAN development, defaults to '' (relative URLs e.g. '/api/ask').
 *    - When ByteMind is accessed from a phone on the same Wi-Fi via http://<laptop-ip>:5173,
 *      Vite's reverse proxy automatically forwards /api requests to http://localhost:3001.
 *    - If VITE_API_BASE_URL is explicitly set (e.g. VITE_API_BASE_URL=http://192.168.0.123:3001),
 *      requests will target that custom endpoint directly.
 * 2. Never Exposes Secrets:
 *    - GEMINI_API_KEY remains strictly server-side.
 * 3. Mobile-First Error Handling:
 *    - If the phone cannot reach the backend server (e.g. Wi-Fi disconnect, laptop sleep),
 *      standardizes on the user-friendly message:
 *      "ByteMind can't reach the learning server. Check that the phone and laptop are connected to the same network."
 *    - Strips stack traces from student view.
 */

export const API_BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

export const NETWORK_ERROR_MESSAGE =
  "ByteMind can't reach the learning server. Check that the phone and laptop are connected to the same network.";

/**
 * Returns the fully qualified URL for an API endpoint.
 * Defaults to relative paths (e.g. '/api/ask') for zero-config Vite proxy support.
 */
export function getApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE_URL}${cleanEndpoint}`;
}

/**
 * Determines whether an error is caused by a network connectivity failure.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // Chrome: "Failed to fetch"
    // Firefox: "NetworkError when attempting to fetch resource."
    // Safari/iOS: "Load failed"
    return true;
  }
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NetworkError')) {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('load failed') ||
      msg.includes('econnrefused') ||
      msg.includes('connection refused')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Normalizes an API catch error into a user-friendly message.
 */
export function handleApiFetchError(error: unknown): never {
  if (isNetworkError(error)) {
    throw new Error(NETWORK_ERROR_MESSAGE);
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new Error('An unexpected network or server error occurred.');
}
