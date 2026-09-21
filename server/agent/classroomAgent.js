/**
 * server/agent/classroomAgent.js
 * 
 * WHY THIS MODULE IS NEEDED:
 * Pre-Hackathon Experiment: Classroom Assistant.
 * 
 * Demonstrates how ByteMind can turn uploaded class material (lecture PDFs)
 * into structured academic resources for teachers and students:
 * 1. CLASSROOM_SUMMARY: High-yield summary with Topic, Key Concepts, and Takeaways.
 * 2. TOPIC_IDENTIFICATION: Core topics covered directly from the lecture notes.
 * 3. ASSIGNMENT_GENERATION: 3-4 concise, targeted student assignment problems.
 * 4. ASSESSMENT_GENERATION: 5-question assessment (MCQ + Short Answer) with separable Teacher Answer Key.
 * 
 * REUSES:
 * - Existing RAG pipeline (searchVectorChunks, RAG_SEARCH, embedding storage).
 * - Official Google GenAI SDK with gemini-3.6-flash.
 * - Single-hop controlled execution (zero recursion, zero autonomous loops).
 */

import { learningTools } from './tools/index.js';
import { callAgentGemini, getGeminiStatus } from './agentGeminiClient.js';
import { isDocumentStorageAvailable } from './tools/ragSearchTool.js';
import { getEmbeddedDocument, getAllEmbeddedChunks, hasEmbeddedDocument } from '../utils/embeddingService.js';
import { isDbConfigured } from '../db/vectorStore.js';

export const SUPPORTED_CLASSROOM_INTENTS = [
  'CLASSROOM_SUMMARY',
  'TOPIC_IDENTIFICATION',
  'ASSIGNMENT_GENERATION',
  'ASSESSMENT_GENERATION',
];

export const CLASSROOM_ASSISTANT_SYSTEM_INSTRUCTION = `
You are the ByteMind Classroom Assistant, an academic AI teaching partner designed to help instructors and educators transform lecture material into structured, pedagogically sound educational resources.

ROLE AND CORE PRINCIPLES:
1. STRICT FACTUAL GROUNDING: You MUST base all summaries, topics, assignments, and assessments EXCLUSIVELY on the provided lecture material. Do NOT extrapolate or introduce external curriculum concepts that are not mentioned in the source text.
2. PEDAGOGICAL CLARITY: Present information in clear, structured, readable markdown. Avoid academic fluff. Focus on core concepts, definitions, mechanisms, and student learning outcomes.
3. ACCURACY & RETENTION: Ensure questions and topics directly evaluate what the lecture actually taught.
4. ASSESSMENT INTEGRITY: In assessments, always provide student questions first, followed by a clearly separated "Teacher Answer Key & Explanations" section containing exact solutions and grading criteria.
5. PROTOTYPE SCOPE: You are an academic instructional resource generator. Do not claim to manage attendance, student grading, or full LMS records.
`.trim();

/**
 * Normalizes input action/intent to one of the 4 supported classroom intents.
 * 
 * @param {string} action
 * @returns {'CLASSROOM_SUMMARY' | 'TOPIC_IDENTIFICATION' | 'ASSIGNMENT_GENERATION' | 'ASSESSMENT_GENERATION'}
 */
export function normalizeClassroomIntent(action) {
  if (!action || typeof action !== 'string') return 'CLASSROOM_SUMMARY';
  const clean = action.toUpperCase().trim();

  if (clean.includes('SUMMARY') || clean.includes('SUMMARIZE')) {
    return 'CLASSROOM_SUMMARY';
  }
  if (clean.includes('TOPIC') || clean.includes('SYLLABUS')) {
    return 'TOPIC_IDENTIFICATION';
  }
  if (clean.includes('ASSIGNMENT') || clean.includes('EXERCISE') || clean.includes('HOMEWORK')) {
    return 'ASSIGNMENT_GENERATION';
  }
  if (clean.includes('ASSESSMENT') || clean.includes('QUIZ') || clean.includes('TEST') || clean.includes('EXAM')) {
    return 'ASSESSMENT_GENERATION';
  }

  return 'CLASSROOM_SUMMARY';
}

/**
 * Builds the search query for RAG based on the classroom intent.
 */
function getRAGQueryForIntent(intent, documentId) {
  switch (intent) {
    case 'CLASSROOM_SUMMARY':
      return `core concepts overview key takeaways definitions summary from ${documentId || 'lecture'}`;
    case 'TOPIC_IDENTIFICATION':
      return `lecture topics core concepts modules syllabus outline units from ${documentId || 'lecture'}`;
    case 'ASSIGNMENT_GENERATION':
      return `problems exercises applications practice questions concepts from ${documentId || 'lecture'}`;
    case 'ASSESSMENT_GENERATION':
      return `assessment multiple choice questions concept checks evaluations definitions from ${documentId || 'lecture'}`;
    default:
      return `key lecture content concepts from ${documentId || 'lecture'}`;
  }
}

/**
 * Builds the grounded prompt for Gemini based on intent and retrieved context.
 */
function buildClassroomPrompt(intent, documentId, contextText) {
  switch (intent) {
    case 'CLASSROOM_SUMMARY':
      return `
[CLASSROOM ASSISTANT ACTION: SUMMARIZE LECTURE]
Document: "${documentId || 'Uploaded Lecture Material'}"

TASK: Generate a structured academic Lecture Summary based strictly on the lecture material below.

REQUIRED FORMAT:
# LECTURE SUMMARY

### Topic:
[Specific Lecture Topic & Domain from the notes]

### Key Concepts:
• [Concept 1 with concise 1-line definition]
• [Concept 2 with concise 1-line definition]
• [Concept 3 with concise 1-line definition]
• [Concept 4 with concise 1-line definition]

### Important Takeaways:
[Structured, high-yield takeaways summarizing the core mechanisms, theoretical principles, and operational rules taught in the lecture]

RULES:
- Do NOT invent concepts not supported by the lecture chunks.
- Keep output structured, scannable, and directly usable by students and educators.

=== LECTURE MATERIAL CHUNKS ===
${contextText}
===============================
`.trim();

    case 'TOPIC_IDENTIFICATION':
      return `
[CLASSROOM ASSISTANT ACTION: IDENTIFY TOPICS]
Document: "${documentId || 'Uploaded Lecture Material'}"

TASK: Extract and organize the canonical topics covered in the lecture material below.

REQUIRED FORMAT:
# TOPICS COVERED

1. [Topic 1]
2. [Topic 2]
3. [Topic 3]
4. [Topic 4]
(List all major topics explicitly present in the document)

### Core Focus Areas & Hierarchy:
- **Foundational Concepts**: [List prerequisites / entry principles directly from notes]
- **Core Mechanics**: [List the primary engines / formulas / mechanisms directly from notes]
- **Applications & Practical Work**: [List practical contexts or implementations from notes]

RULES:
- Do NOT invent topics that are not supported by the document.
- Number each main topic clearly.

=== LECTURE MATERIAL CHUNKS ===
${contextText}
===============================
`.trim();

    case 'ASSIGNMENT_GENERATION':
      return `
[CLASSROOM ASSISTANT ACTION: CREATE ASSIGNMENT]
Document: "${documentId || 'Uploaded Lecture Material'}"

TASK: Generate a small, focused student assignment based ONLY on the lecture material below.

REQUIRED FORMAT:
# ASSIGNMENT

1. [Targeted question / task requiring explanation or conceptual definition]
2. [Comparative or differentiation question, e.g. Differentiate X and Y based on notes]
3. [Analytical or application question, e.g. Describe how Z is evaluated or computed]
4. [Scenario or problem-solving prompt based directly on the notes]

### Student Guidelines:
- Answer each question in 3-5 sentences using the concepts from the lecture.
- Clearly define all terms used.

RULES:
- Base questions ONLY on the provided lecture notes.
- Keep it concise (3-4 questions). Do not make it excessively long.

=== LECTURE MATERIAL CHUNKS ===
${contextText}
===============================
`.trim();

    case 'ASSESSMENT_GENERATION':
      return `
[CLASSROOM ASSISTANT ACTION: CREATE ASSESSMENT]
Document: "${documentId || 'Uploaded Lecture Material'}"

TASK: Generate a 5-question classroom assessment based ONLY on the lecture material below.

REQUIREMENTS:
1. Exactly 5 questions.
2. A mixture of Multiple Choice Questions (MCQs with 4 options: A, B, C, D) and Short-Answer questions.
3. Include a clearly designated "Teacher Answer Key & Explanations" section at the end with answers and brief grading rationales.

REQUIRED FORMAT:
# CLASSROOM ASSESSMENT

### Questions for Students:

**Question 1 (Multiple Choice):**
[Question prompt]
A) [Option]
B) [Option]
C) [Option]
D) [Option]

**Question 2 (Multiple Choice):**
[Question prompt]
A) [Option]
B) [Option]
C) [Option]
D) [Option]

**Question 3 (Multiple Choice):**
[Question prompt]
A) [Option]
B) [Option]
C) [Option]
D) [Option]

**Question 4 (Short Answer):**
[Question prompt requiring 2-3 sentence student explanation]

**Question 5 (Short Answer):**
[Question prompt requiring 2-3 sentence student explanation]

---

### Teacher Answer Key & Explanations
*(Keep confidential — for educator grading only)*

- **Question 1 Answer:** [Correct Option] — [Brief explanation based on lecture notes]
- **Question 2 Answer:** [Correct Option] — [Brief explanation based on lecture notes]
- **Question 3 Answer:** [Correct Option] — [Brief explanation based on lecture notes]
- **Question 4 Sample Solution & Key Points:** [Model answer and criteria for full credit]
- **Question 5 Sample Solution & Key Points:** [Model answer and criteria for full credit]

RULES:
- Base questions and answers ONLY on the uploaded lecture material below.

=== LECTURE MATERIAL CHUNKS ===
${contextText}
===============================
`.trim();

    default:
      return `Summarize the lecture material based on:\n\n${contextText}`;
  }
}

/**
 * Runs the Classroom Assistant agent workflow.
 * 
 * Flow:
 * Validate documentId -> Detect Intent -> RAG Search -> Assemble Context -> Gemini 3.6 Flash -> Structured Output
 * 
 * @param {object} params
 * @param {string} [params.action] - Action or intent name.
 * @param {string} [params.intent] - Alternative action/intent name.
 * @param {string} params.documentId - Document ID / filename of uploaded lecture material.
 * @param {string} [params.interactionId] - Optional conversation memory ID.
 * 
 * @returns {Promise<{
 *   success: boolean,
 *   intent: string,
 *   action: string,
 *   documentId: string,
 *   documentUsed: string,
 *   retrievedChunks: number,
 *   sources: Array<any>,
 *   output: string,
 *   response: string,
 *   executionMs: number,
 *   interactionId: string
 * }>}
 */
export async function runClassroomAgent({ action, intent, documentId, interactionId }) {
  const startTime = performance.now();

  const chosenAction = action || intent;
  if (!chosenAction || typeof chosenAction !== 'string') {
    throw new Error('Please specify an action (e.g. CLASSROOM_SUMMARY, TOPIC_IDENTIFICATION, ASSIGNMENT_GENERATION, ASSESSMENT_GENERATION).');
  }

  const normalizedIntent = normalizeClassroomIntent(chosenAction);

  if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
    throw new Error('Please upload or select a lecture PDF document before running classroom actions.');
  }

  const cleanDocId = documentId.trim();

  // 1. Telemetry Log 1: request received
  console.log(`[CLASSROOM LOG 1/7] Request received: action="${chosenAction}" (normalized: ${normalizedIntent}), documentId="${cleanDocId}"`);

  // 2. Telemetry Log 2: selected documentId
  console.log(`[CLASSROOM LOG 2/7] Selected documentId: "${cleanDocId}"`);

  // 3. Verify document availability in the shared storage
  const isAvailable = hasEmbeddedDocument(cleanDocId) || hasEmbeddedDocument(cleanDocId.replace(/\.pdf$/, ''));
  // Telemetry Log 3: document found/not found
  console.log(`[CLASSROOM LOG 3/7] Document ${isAvailable ? 'FOUND' : 'NOT FOUND'} in shared RAG storage (docId: "${cleanDocId}")`);

  if (!isAvailable && !isDbConfigured()) {
    throw new Error(`Document "${cleanDocId}" is not found in study storage. Please upload this lecture material before generating classroom resources.`);
  }

  // 4. Perform RAG Search using existing semantic retrieval
  const ragQuery = getRAGQueryForIntent(normalizedIntent, cleanDocId);
  let contextText = '';
  let sources = [];
  let retrievedChunksCount = 0;

  try {
    const ragResult = await learningTools.RAG_SEARCH.execute({
      query: ragQuery,
      documentId: cleanDocId,
      topK: 6,
      threshold: 0.15,
    });

    if (ragResult.sources && ragResult.sources.length > 0) {
      sources = ragResult.sources;
      contextText = ragResult.contextText || '';
      retrievedChunksCount = ragResult.retrievedChunksCount || sources.length;
    }
  } catch (searchError) {
    console.warn('[CLASSROOM] Semantic RAG_SEARCH warning:', searchError.message);
  }

  // 5. Fallback: If threshold was too strict or no query match, fetch document chunks directly from memory/storage
  if (!contextText || contextText.trim().length === 0) {
    const docChunks = getEmbeddedDocument(cleanDocId) || getEmbeddedDocument(cleanDocId.replace(/\.pdf$/, ''));
    if (docChunks && Array.isArray(docChunks) && docChunks.length > 0) {
      const selected = docChunks.slice(0, 6);
      contextText = selected.map((c, i) => `[Lecture Chunk ${i + 1} - ${cleanDocId}]\n${c.text}`).join('\n\n');
      sources = selected.map((c, i) => ({
        documentId: cleanDocId,
        filename: cleanDocId,
        chunkId: c.chunkId || `chunk-${i}`,
        chunkIndex: c.chunkIndex || i,
        similarity: 1.0,
        textPreview: (c.text || '').slice(0, 200) + '...',
      }));
      retrievedChunksCount = selected.length;
    }
  }

  // Telemetry Log 4: retrieved chunks count
  console.log(`[CLASSROOM LOG 4/7] Retrieved chunks count: ${retrievedChunksCount} (context length: ${contextText.length} chars)`);

  if (!contextText || contextText.trim().length === 0) {
    throw new Error('Please upload this lecture material before generating classroom resources.');
  }

  // 6. Build prompt and call Gemini with single-hop execution
  const prompt = buildClassroomPrompt(normalizedIntent, cleanDocId, contextText);

  const interactionParams = {
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    input: prompt,
    system_instruction: CLASSROOM_ASSISTANT_SYSTEM_INSTRUCTION,
  };

  if (interactionId && typeof interactionId === 'string' && interactionId.trim()) {
    interactionParams.previous_interaction_id = interactionId.trim();
  }

  // Telemetry Log 5: Gemini request started
  const geminiStart = performance.now();
  console.log(`[CLASSROOM LOG 5/7] Gemini request started: model=${interactionParams.model}, promptLength=${prompt.length}`);

  const result = await callAgentGemini(interactionParams);
  const geminiDuration = Math.round(performance.now() - geminiStart);

  // Telemetry Log 6: Gemini response received
  console.log(`[CLASSROOM LOG 6/7] Gemini response received in ${geminiDuration}ms (output length: ${result?.output_text?.length || 0} chars)`);

  const executionMs = Math.round(performance.now() - startTime);

  // Telemetry Log 7: final response returned
  console.log(`[CLASSROOM LOG 7/7] Final response returned: action=${normalizedIntent}, executionMs=${executionMs}ms`);

  const outputText = result.output_text || '';

  return {
    success: true,
    intent: normalizedIntent,
    action: normalizedIntent,
    documentId: cleanDocId,
    documentUsed: cleanDocId,
    retrievedChunks: retrievedChunksCount,
    sources,
    output: outputText,
    response: outputText, // compatibility with ResponseDisplay/Chat formats
    executionMs,
    interactionId: result.id || interactionId || '',
    geminiStatus: getGeminiStatus(),
  };
}
