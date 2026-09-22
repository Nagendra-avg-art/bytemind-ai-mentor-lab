/**
 * server/services/assessmentService.js
 * 
 * WHY THIS SERVICE IS NEEDED:
 * Implements strict, product-level Assessment Mode for all teacher-published:
 * - ASSIGNMENT
 * - QUIZ
 * - TEST
 * - EXAM
 * 
 * CORE RULES:
 * 1. When assessment starts: AI assistance is completely disabled and blocked.
 * 2. Backend Protection:
 *    Any incoming request to /api/ask, /api/rag/ask, /api/image/ask, or /api/agent/learn
 *    originating from an active assessment session is immediately rejected with:
 *    {
 *      "error": "ASSESSMENT_MODE_ACTIVE",
 *      "message": "AI assistance is disabled during this assessment."
 *    }
 * 3. Zero LLM calls: Does NOT call Groq, Ollama, or Gemini when assessment is active.
 * 4. Submission & Exit: Submitting answers or returning to student mode clears assessment mode,
 *    restoring normal AI functionality.
 * 5. Notes Are Different: Teacher-published NOTES are exempt and always allow normal AI assistance.
 */

// In-memory active assessment sessions
// Map<sessionId, { sessionId: string, shareId: string, artifactType: string, artifactTitle: string, clientIp: string, startedAt: number }>
const activeAssessments = new Map();

// Valid assessment artifact types that strictly enforce Assessment Mode
const ASSESSMENT_TYPES = new Set(['ASSIGNMENT', 'QUIZ', 'TEST', 'EXAM']);

/**
 * Checks whether a given artifact type is an assessment.
 * @param {string} type
 * @returns {boolean}
 */
export function isAssessmentType(type) {
  if (!type || typeof type !== 'string') return false;
  return ASSESSMENT_TYPES.has(type.trim().toUpperCase());
}

/**
 * Starts a strict assessment session for a student.
 * 
 * @param {object} params
 * @param {string} params.sessionId - Client session identifier
 * @param {string} params.shareId - Published artifact share code
 * @param {string} params.artifactType - ASSIGNMENT | QUIZ | TEST | EXAM
 * @param {string} [params.artifactTitle] - Title of the assessment
 * @param {string} [params.clientIp] - Client IP address
 * @returns {object} Session record
 */
export function startAssessmentSession({
  sessionId,
  shareId,
  artifactType,
  artifactTitle = '',
  clientIp = '',
}) {
  const normType = (artifactType || '').trim().toUpperCase();
  if (!isAssessmentType(normType)) {
    // Non-assessment materials (e.g. NOTES) do not activate assessment mode
    return { active: false, artifactType: normType };
  }

  const cleanSessionId = sessionId && typeof sessionId === 'string' && sessionId.trim()
    ? sessionId.trim()
    : `asm_${Date.now()}`;

  const cleanShareId = (shareId || '').trim().toUpperCase();

  const record = {
    sessionId: cleanSessionId,
    shareId: cleanShareId,
    artifactType: normType,
    artifactTitle: artifactTitle || 'Assessment',
    clientIp: clientIp || '',
    startedAt: Date.now(),
  };

  activeAssessments.set(cleanSessionId, record);
  if (cleanShareId) {
    // Also track under shareId + IP combination for resilient lookup
    activeAssessments.set(`share_${cleanShareId}_${cleanSessionId}`, record);
    if (clientIp) {
      activeAssessments.set(`ip_${clientIp}`, record);
    }
  }

  console.log(`[Assessment Mode] ACTIVATED for session: ${cleanSessionId} (Share: ${cleanShareId}, Type: ${normType})`);
  return {
    active: true,
    sessionId: cleanSessionId,
    shareId: cleanShareId,
    artifactType: normType,
    artifactTitle: record.artifactTitle,
  };
}

/**
 * Ends an active assessment session (e.g., upon submission or explicit exit).
 * 
 * @param {object} params
 * @param {string} [params.sessionId]
 * @param {string} [params.shareId]
 * @param {string} [params.clientIp]
 */
export function endAssessmentSession({ sessionId, shareId, clientIp } = {}) {
  let cleared = false;

  if (sessionId) {
    const cleanSessionId = sessionId.trim();
    if (activeAssessments.has(cleanSessionId)) {
      activeAssessments.delete(cleanSessionId);
      cleared = true;
    }
    for (const [key, record] of activeAssessments.entries()) {
      if (record.sessionId === cleanSessionId) {
        activeAssessments.delete(key);
        cleared = true;
      }
    }
  }

  if (shareId) {
    const cleanShare = shareId.trim().toUpperCase();
    for (const [key, record] of activeAssessments.entries()) {
      if (record.shareId === cleanShare) {
        activeAssessments.delete(key);
        cleared = true;
      }
    }
  }

  if (clientIp) {
    if (activeAssessments.has(`ip_${clientIp}`)) {
      activeAssessments.delete(`ip_${clientIp}`);
      cleared = true;
    }
  }

  if (cleared) {
    console.log(`[Assessment Mode] DEACTIVATED session: ${sessionId || shareId || clientIp}`);
  }

  return { active: false, cleared };
}

/**
 * Checks if a request originates from an active assessment session.
 * 
 * Inspects:
 * 1. Header: 'x-assessment-active' === 'true'
 * 2. Header: 'x-assessment-session'
 * 3. Body: req.body.assessmentSessionId or req.body.interactionId or req.body.sessionId
 * 4. Client IP lookup in active assessments map (with 4-hour max safety TTL)
 * 
 * @param {object} req - Express request
 * @returns {boolean} True if assessment mode is actively enforced
 */
export function isAssessmentActive(req) {
  if (!req) return false;

  // 1. Explicit header flags
  const headerActive = req.headers?.['x-assessment-active'];
  if (headerActive === 'true' || headerActive === true) {
    return true;
  }

  const headerSession = req.headers?.['x-assessment-session'];
  if (headerSession && activeAssessments.has(String(headerSession).trim())) {
    return true;
  }

  // 2. Request body session markers
  const bodySession =
    req.body?.assessmentSessionId ||
    req.body?.assessmentSession ||
    req.body?.interactionId ||
    req.body?.sessionId;

  if (bodySession && typeof bodySession === 'string') {
    const clean = bodySession.trim();
    if (activeAssessments.has(clean)) {
      return true;
    }
    for (const record of activeAssessments.values()) {
      if (record.sessionId === clean) {
        return true;
      }
    }
  }

  // 3. Client IP check (auto-expires after 4 hours)
  const clientIp = req.ip || req.connection?.remoteAddress || '';
  if (clientIp && activeAssessments.has(`ip_${clientIp}`)) {
    const record = activeAssessments.get(`ip_${clientIp}`);
    if (Date.now() - record.startedAt < 4 * 60 * 60 * 1000) {
      return true;
    }
    activeAssessments.delete(`ip_${clientIp}`);
  }

  return false;
}

/**
 * Express middleware to guard protected AI endpoints during active assessment.
 */
export function assessmentGuard(req, res, next) {
  if (isAssessmentActive(req)) {
    console.warn(`[Assessment Guard] Blocked AI request on ${req.originalUrl || req.url} during active assessment.`);
    return res.status(403).json({
      error: 'ASSESSMENT_MODE_ACTIVE',
      message: 'AI assistance is disabled during this assessment.',
    });
  }
  next();
}
