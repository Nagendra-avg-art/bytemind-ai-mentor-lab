/**
 * server/services/sessionService.js
 * 
 * Provider-neutral conversation memory manager.
 * 
 * Purpose:
 * Maintains multi-turn conversation context for local AI models (such as Ollama / Qwen3)
 * that require the application layer to pass prior messages, unlike Gemini's proprietary
 * server-side interaction IDs.
 * 
 * Features:
 * - Clean session generation (UUID / crypto random)
 * - Message history windowing (keeps recent turns to prevent context bloat and speed up local inference)
 * - Automatic session TTL cleanup (evicts sessions idle > 2 hours)
 */

import crypto from 'crypto';

// In-memory conversation session store
// Map<sessionId, { id: string, messages: Array<{ role: 'user' | 'assistant', content: string, timestamp: number }>, createdAt: number, lastAccessedAt: number }>
const sessions = new Map();

// Configuration
const MAX_HISTORY_MESSAGES = 12; // 6 user-assistant turns
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Periodically evicts expired sessions.
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
    }
  }
}

// Run cleanup every 15 minutes
setInterval(cleanupExpiredSessions, 15 * 60 * 1000).unref?.();

/**
 * Retrieves an existing session or creates a new one.
 * 
 * @param {string} [sessionId] - Optional existing session ID
 * @returns {{ id: string, messages: Array<{ role: string, content: string }>, isNew: boolean }}
 */
export function getOrCreateSession(sessionId) {
  const now = Date.now();

  if (sessionId && typeof sessionId === 'string' && sessions.has(sessionId.trim())) {
    const session = sessions.get(sessionId.trim());
    session.lastAccessedAt = now;
    return {
      id: session.id,
      messages: session.messages,
      isNew: false,
    };
  }

  // Create new session
  const newId = sessionId && typeof sessionId === 'string' && sessionId.trim()
    ? sessionId.trim()
    : `bm_sess_${crypto.randomUUID()}`;

  const session = {
    id: newId,
    messages: [],
    createdAt: now,
    lastAccessedAt: now,
  };

  sessions.set(newId, session);
  return {
    id: session.id,
    messages: session.messages,
    isNew: true,
  };
}

/**
 * Returns formatted prior history for prompt injection.
 * 
 * @param {string} sessionId
 * @returns {Array<{ role: string, content: string }>}
 */
export function getSessionHistory(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) {
    return [];
  }
  const session = sessions.get(sessionId);
  session.lastAccessedAt = Date.now();
  return session.messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * Records a completed conversation turn (user prompt + assistant response).
 * 
 * @param {string} sessionId
 * @param {string} userPrompt
 * @param {string} assistantAnswer
 */
export function recordTurn(sessionId, userPrompt, assistantAnswer) {
  const sessionData = getOrCreateSession(sessionId);
  const session = sessions.get(sessionData.id);
  const now = Date.now();

  session.lastAccessedAt = now;

  if (userPrompt && typeof userPrompt === 'string') {
    session.messages.push({
      role: 'user',
      content: userPrompt.trim(),
      timestamp: now,
    });
  }

  if (assistantAnswer && typeof assistantAnswer === 'string') {
    session.messages.push({
      role: 'assistant',
      content: assistantAnswer.trim(),
      timestamp: now,
    });
  }

  // Trim to maximum history window if needed
  if (session.messages.length > MAX_HISTORY_MESSAGES * 2) {
    session.messages = session.messages.slice(-MAX_HISTORY_MESSAGES);
  }
}

/**
 * Clears a conversation session.
 * 
 * @param {string} sessionId
 */
export function clearSession(sessionId) {
  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
  }
}

/**
 * Returns diagnostic stats about current active sessions.
 */
export function getSessionStats() {
  return {
    activeSessions: sessions.size,
    maxHistoryMessages: MAX_HISTORY_MESSAGES,
    sessionTtlMinutes: Math.round(SESSION_TTL_MS / 60000),
  };
}
