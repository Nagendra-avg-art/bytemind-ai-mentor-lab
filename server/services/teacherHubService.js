/**
 * server/services/teacherHubService.js
 * 
 * WHY THIS SERVICE IS NEEDED:
 * Implements dynamic, production-ready Teacher Hub storage and workflows for ByteMind:
 * 1. Clean, dynamic in-memory store for published artifacts and student submissions.
 *    ZERO fake/hardcoded seed data. Starts at 0 published and 0 submissions.
 * 2. Generates unique, URL-safe share codes dynamically in the format BM-XXXXXX (e.g., BM-X7K29P).
 * 3. Dynamic student submission handling storing:
 *    - submissionId, shareId, studentName, studentId, answers, submittedAt, status
 * 4. Assessment Mode AI Protection (Academic Test Integrity):
 *    - During active quiz/test: ByteMind will NOT provide direct answers or solutions.
 *      Enforces: "Assessment Mode Active — ByteMind will not provide direct answers during this assessment."
 *    - After assessment submission: Unlocks full learning explanations.
 * 5. Notes + RAG Integration:
 *    - For shared NOTES, connects to the existing RAG system (answerWithRAG) using the active provider architecture
 *      (Ollama dense vectors or Groq BM25 lexical) to ground student questions directly in the teacher's material.
 */

import crypto from 'crypto';
import { getActiveProvider, getActiveProviderName } from '../providers/index.js';
import { getOrCreateSession, getSessionHistory, recordTurn } from './sessionService.js';
import { storeDocumentChunks } from '../utils/embeddingService.js';
import { answerWithRAG } from './ragService.js';
import { getDocumentContent } from './documentStore.js';

// In-memory data store — starts 100% clean and dynamic (NO fake seeds)
const artifactsByShareId = new Map();
const artifactsById = new Map();
const submissions = [];

/**
 * Generates a clean, unique shareId in the format BM-XXXXXX (e.g., BM-X7K29P).
 * Omits easily confused characters (0, O, 1, I).
 * @returns {string}
 */
function generateShareId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BM-${code}`;
}

/**
 * Registers an artifact into memory maps and indexes virtual chunk text for RAG if needed.
 * @param {object} artifact
 */
function registerArtifact(artifact) {
  artifactsByShareId.set(artifact.shareId.toUpperCase(), artifact);
  artifactsByShareId.set(artifact.shareId.toLowerCase(), artifact);
  artifactsById.set(artifact.id, artifact);

  // If text notes were provided directly without a physical documentId, index chunks under virtualDocId
  if (artifact.content && !artifact.documentId) {
    const virtualDocId = `doc_shared_${artifact.shareId.toLowerCase()}`;
    artifact.virtualDocId = virtualDocId;
    const chunkText = `${artifact.title}\n\n${artifact.instructions || artifact.description}\n\n${artifact.content}`;
    storeDocumentChunks(virtualDocId, [
      {
        chunkId: `${virtualDocId}_c0`,
        documentId: virtualDocId,
        chunkIndex: 0,
        text: chunkText,
        filename: `${artifact.title}.txt`,
        pageNumber: 1
      }
    ]);
  }
}

/**
 * Creates and publishes a new learning artifact (NOTES, ASSIGNMENT, or QUIZ).
 * 
 * Artifact fields:
 * - id
 * - shareId (e.g. BM-X7K29P)
 * - type (NOTES | ASSIGNMENT | QUIZ)
 * - title
 * - description
 * - instructions
 * - content
 * - documentId
 * - questions
 * - createdAt
 * - status: 'published'
 * 
 * @param {object} params
 * @returns {object} The published artifact
 */
export function createArtifact({
  teacherId = 'tch_default',
  type = 'NOTES',
  title,
  description = '',
  instructions = '',
  content = '',
  documentId = null,
  questions = [],
  allowAiAssistance = true,
  customShareId = null
}) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new Error('Title is required to publish learning material.');
  }

  const normalizedType = (type || 'NOTES').toUpperCase();
  const validTypes = ['NOTES', 'ASSIGNMENT', 'QUIZ'];
  const artifactType = validTypes.includes(normalizedType) ? normalizedType : 'NOTES';

  const cleanTitle = title.trim();
  const id = `art_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const cleanTeacherId = (teacherId && typeof teacherId === 'string' && teacherId.trim())
    ? teacherId.trim()
    : 'tch_default';

  let shareId;
  if (customShareId && typeof customShareId === 'string' && customShareId.trim()) {
    shareId = customShareId.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  } else {
    // Generate unique BM-XXXXXX format
    do {
      shareId = generateShareId();
    } while (artifactsByShareId.has(shareId));
  }

  const cleanDesc = typeof description === 'string' ? description.trim() : '';
  const cleanInst = typeof instructions === 'string' && instructions.trim() ? instructions.trim() : cleanDesc;

  const artifact = {
    id,
    artifactId: id,
    teacherId: cleanTeacherId,
    shareId,
    type: artifactType,
    title: cleanTitle,
    description: cleanDesc,
    instructions: cleanInst,
    content: typeof content === 'string' ? content.trim() : '',
    documentId: documentId || null,
    questions: Array.isArray(questions) ? questions : [],
    allowAiAssistance: allowAiAssistance !== false,
    createdAt: new Date().toISOString(),
    status: 'published'
  };

  registerArtifact(artifact);
  return artifact;
}

/**
 * Returns all published learning materials (newest first), filtered by teacherId if specified.
 * @param {string|null} [teacherId] - optional teacher ID filter
 * @param {boolean} [includeAnswers] - whether to include teacher answers
 * @returns {object[]}
 */
export function getAllArtifacts(teacherId = null, includeAnswers = true) {
  const seenIds = new Set();
  const list = [];
  const cleanTeacherId = teacherId && typeof teacherId === 'string' ? teacherId.trim() : null;

  for (const artifact of artifactsByShareId.values()) {
    if (!seenIds.has(artifact.id)) {
      seenIds.add(artifact.id);
      if (!cleanTeacherId || artifact.teacherId === cleanTeacherId) {
        list.push(includeAnswers ? artifact : sanitizeForStudent(artifact));
      }
    }
  }

  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Retrieves a published artifact by its shareId (case-insensitive).
 * @param {string} shareId
 * @param {boolean} isTeacher
 * @returns {object|null}
 */
export function getArtifactByShareId(shareId, isTeacher = false) {
  if (!shareId) return null;
  const clean = shareId.trim();
  const artifact =
    artifactsByShareId.get(clean.toUpperCase()) ||
    artifactsByShareId.get(clean.toLowerCase()) ||
    artifactsByShareId.get(clean);

  if (!artifact) return null;
  return isTeacher ? artifact : sanitizeForStudent(artifact);
}

/**
 * Strips correct answers from quiz questions for student view.
 */
function sanitizeForStudent(artifact) {
  const { virtualDocId, ...restArtifact } = artifact;
  const isVirtual = typeof artifact.documentId === 'string' && artifact.documentId.startsWith('doc_shared_');
  return {
    ...restArtifact,
    documentId: isVirtual ? null : (artifact.documentId || null),
    questions: (artifact.questions || []).map((q) => {
      const { correctAnswer, ...rest } = q;
      return rest;
    })
  };
}

/**
 * Records a student submission for a published assignment or quiz.
 * 
 * Fields stored:
 * - submissionId
 * - teacherId
 * - artifactId
 * - shareId
 * - studentName
 * - studentId
 * - studentIdentifier
 * - answers
 * - submittedAt
 * - status: 'submitted'
 * 
 * @param {object} params
 * @returns {{ success: boolean, submissionId: string, submittedAt: string, submission: object }}
 */
export function submitAnswers({ shareId, studentName, studentId, studentIdentifier, answers }) {
  if (!shareId) {
    throw new Error('Share ID is required to submit answers.');
  }

  const artifact = getArtifactByShareId(shareId, true);
  if (!artifact) {
    throw new Error(`Shared material not found for code: "${shareId}"`);
  }

  const cleanName =
    (studentName && typeof studentName === 'string' && studentName.trim()) ||
    (studentIdentifier && typeof studentIdentifier === 'string' && studentIdentifier.trim()) ||
    'Anonymous Student';
  const cleanId = (studentId && typeof studentId === 'string' && studentId.trim()) || '';

  const submissionId = `sub_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const submittedAt = new Date().toISOString();

  const submission = {
    submissionId,
    teacherId: artifact.teacherId || 'tch_default',
    artifactId: artifact.artifactId || artifact.id,
    shareId: artifact.shareId,
    artifactTitle: artifact.title,
    artifactType: artifact.type,
    studentName: cleanName,
    studentId: cleanId,
    studentIdentifier: cleanId ? `${cleanName} (${cleanId})` : cleanName,
    answers: answers || {},
    submittedAt,
    status: 'submitted'
  };

  submissions.unshift(submission);

  return {
    success: true,
    submissionId,
    submittedAt,
    submission
  };
}

/**
 * Retrieves submissions, filtered by teacherId and optionally shareId.
 * @param {string|null} [teacherId]
 * @param {string|null} [shareId]
 * @returns {object[]}
 */
export function getSubmissions(teacherId = null, shareId = null) {
  let list = [...submissions];

  if (teacherId && typeof teacherId === 'string' && teacherId.trim()) {
    const cleanTeacher = teacherId.trim();
    list = list.filter((s) => s.teacherId === cleanTeacher);
  }

  if (shareId && typeof shareId === 'string' && shareId.trim()) {
    const cleanShare = shareId.trim().toUpperCase();
    list = list.filter((s) => s.shareId.toUpperCase() === cleanShare);
  }

  return list;
}

/**
 * Answers a student learning question about a shared artifact using the active AI provider.
 * Implements:
 * 1. Notes + RAG: Queries answerWithRAG using active provider architecture.
 * 2. Assessment Mode Protection: Refuses direct answers during active Quiz / Test.
 * 
 * @param {object} params
 * @param {string} params.shareId
 * @param {string} params.question
 * @param {string} [params.interactionId]
 * @param {boolean} [params.isSubmitted]
 * @returns {Promise<{ answer: string, interactionId: string, provider: string, sources?: any[] }>}
 */
export async function askQuestionAboutArtifact({ shareId, question, interactionId, isSubmitted = false }) {
  if (!shareId || !question || !question.trim()) {
    throw new Error('Share ID and question are required.');
  }

  const artifact = getArtifactByShareId(shareId, true);
  if (!artifact) {
    throw new Error(`Shared material with code "${shareId}" was not found.`);
  }

  const userMessage = question.trim();
  const session = getOrCreateSession(interactionId);
  const activeProvider = getActiveProvider();
  const activeProviderName = getActiveProviderName();
  const artifactType = (artifact.type || 'NOTES').toUpperCase();

  // =========================================================================
  // 1. NOTES + RAG: Connect to existing RAG system where possible
  // =========================================================================
  if (artifactType === 'NOTES' && artifact.documentId) {
    try {
      const ragResult = await answerWithRAG(userMessage, {
        documentId: artifact.documentId,
        interactionId: session.id,
        threshold: 0.15,
        topK: 3
      });

      if (
        ragResult &&
        ragResult.answer &&
        !ragResult.answer.includes('could not find any stored sections')
      ) {
        const returnedSources =
          Array.isArray(ragResult.sources) && ragResult.sources.length > 0
            ? ragResult.sources
            : artifact.documentId
            ? [{ filename: artifact.documentId, documentId: artifact.documentId }]
            : [];

        return {
          answer: ragResult.answer,
          interactionId: ragResult.interactionId || session.id,
          provider: ragResult.provider || activeProviderName,
          artifactType: artifact.type,
          artifactTitle: artifact.title,
          sources: returnedSources,
        };
      }
    } catch (ragErr) {
      console.warn('[TeacherHub] RAG retrieval fallback to grounded chat:', ragErr.message);
    }
  }

  // =========================================================================
  // 2. QUIZ / TEST: Assessment Mode AI Protection
  // =========================================================================
  let systemPrompt = '';
  let fallbackSources = [];

  if (artifactType === 'QUIZ') {
    if (!isSubmitted) {
      systemPrompt = `You are ByteMind AI Mentor assisting a student who is currently taking an active assessment titled "${artifact.title}".

CRITICAL TEST INTEGRITY RULES (ASSESSMENT MODE ACTIVE):
1. Under NO circumstances are you allowed to give direct answers, solve the test questions, or tell the student which option (A, B, C, D) is correct.
2. If the student asks for the answer to a test question (e.g., "What is the answer to question 2?", "Solve this question", "Which option is correct?"), you MUST refuse direct answers:
"Assessment Mode Active — ByteMind will not provide direct answers during this assessment. However, I can explain the general underlying concepts or clarify what the question is asking."
3. You MAY explain underlying concepts, definitions, mathematical principles, or clarify instructions in general, neutral terms.
4. Keep your responses educational, Socratic, and concise.

Test Context:
Title: ${artifact.title}
Instructions: ${artifact.instructions || artifact.description}
${artifact.content ? `Reference Material:\n${artifact.content.slice(0, 1500)}` : ''}`;
    } else {
      systemPrompt = `You are ByteMind AI Mentor. The student has COMPLETED and submitted their assessment titled "${artifact.title}".
Assessment Mode is complete. You may now provide full, thorough educational explanations, walk through why answers are correct or incorrect, and help the student master the concepts.

Material Context:
Title: ${artifact.title}
${artifact.content ? `Reference Notes:\n${artifact.content.slice(0, 2000)}` : ''}`;
    }
  } else if (artifactType === 'ASSIGNMENT') {
    systemPrompt = `You are ByteMind AI Mentor assisting a student working on an ASSIGNMENT titled "${artifact.title}".

GUIDANCE RULES:
1. Guide the student using Socratic hints and step-by-step reasoning.
2. Ground your explanations in the teacher's problem instructions and material.
3. Help the student arrive at the solution on their own rather than writing the entire assignment for them.

Assignment Context:
Title: ${artifact.title}
Instructions: ${artifact.instructions || artifact.description}
${artifact.content ? `Problem Material:\n${artifact.content.slice(0, 2000)}` : ''}`;
  } else {
    // NOTES mode fallback
    let docContext = '';
    if (artifact.documentId) {
      const doc = getDocumentContent(artifact.documentId);
      if (doc && doc.text) {
        docContext = `\nTeacher Attached Material (${doc.filename}):\n${doc.text.slice(0, 3500)}`;
        fallbackSources = [{ filename: doc.filename, documentId: artifact.documentId }];
      } else {
        fallbackSources = [{ filename: artifact.documentId, documentId: artifact.documentId }];
      }
    }

    systemPrompt = `You are ByteMind AI Mentor. The student is reviewing teacher-published NOTES titled "${artifact.title}".

TEACHING RULES:
1. Ground your explanations, definitions, and analogies directly in the teacher's notes below.
2. When asked to explain a topic, break it down clearly with simple real-world analogies.
3. If the student asks about something outside the notes, clearly distinguish general CS knowledge from the teacher's notes.

Teacher Notes:
Title: ${artifact.title}
Summary/Instructions: ${artifact.instructions || artifact.description}
Content:
${artifact.content || ''}${docContext || (artifact.documentId ? `\n(Reference document: ${artifact.documentId})` : '')}`;
  }

  const response = await activeProvider.chat({
    prompt: userMessage,
    systemInstruction: systemPrompt,
    history: getSessionHistory(session.id).slice(-4)
  });

  const responseText = typeof response === 'string' ? response : (response.text || response.response || '');
  recordTurn(session.id, userMessage, responseText);

  return {
    answer: responseText,
    interactionId: session.id,
    provider: activeProviderName,
    artifactType: artifact.type,
    artifactTitle: artifact.title,
    sources: fallbackSources
  };
}
