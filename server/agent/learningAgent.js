/**
 * server/agent/learningAgent.js
 * 
 * WHY THIS MODULE IS NEEDED:
 * Implements Step 8.2 of ByteMind: Learning Agent Tool Selection.
 * 
 * Product Principle:
 * The Learning Agent is a controlled orchestrator that accepts a student's explicit learning
 * goal, determines their intent, selects a single appropriate capability from the server-side
 * Tool Registry (`learningTools`), and coordinates document grounding (via RAG_SEARCH)
 * and pedagogical response generation.
 * 
 * Controlled Agent Rules:
 * 1. ZERO autonomous loops or recursion.
 * 2. ZERO background agents.
 * 3. Never repeatedly call Gemini.
 * 4. Only invokes RAG_SEARCH when study material is available.
 * 5. PRACTICE and QUIZ require explicit student intent. Never auto-quiz after explanation.
 * 6. Deterministic tool selection for minimal latency and zero wasted quota.
 * 7. Preserves conversation memory (Interactions API), source citations, Student & Dev modes.
 */

import {
  learningTools,
  AVAILABLE_TOOLS,
  isDocumentStorageAvailable,
} from './tools/index.js';

export const SUPPORTED_INTENTS = [
  'EXPLAIN',
  'STUDY_PLAN',
  'REVISION_PLAN',
  'PRACTICE',
  'QUIZ',
  'SUMMARY',
  'TOPIC_IDENTIFICATION',
];

/**
 * Deterministically classifies student's goal into one of the supported intents.
 * Fast, predictable, and consumes ZERO Gemini API quota.
 * 
 * @param {string} goal
 * @returns {'EXPLAIN' | 'STUDY_PLAN' | 'REVISION_PLAN' | 'PRACTICE' | 'QUIZ' | 'SUMMARY' | 'TOPIC_IDENTIFICATION'}
 */
export function detectIntent(goal) {
  if (!goal || typeof goal !== 'string') return 'EXPLAIN';
  const clean = goal.toLowerCase().trim();

  // 1. QUIZ (Explicit quiz request only - Rule 6 & 7)
  if (/\b(quiz|test me|mcq|multiple choice|trivia|self-test|test my knowledge)\b/.test(clean)) {
    return 'QUIZ';
  }

  // 2. PRACTICE (Explicit practice problems request only - Rule 6 & 9)
  if (/\b(practice|exercises|problems|problem set|drills|coding practice|solve questions|worksheets)\b/.test(clean)) {
    return 'PRACTICE';
  }

  // 3. REVISION PLAN (Explicit revision workflow - Rule 8)
  if (/\b(revision plan|revision|revise|quick review|cram|cramming|review plan|revising|rapid review)\b/.test(clean)) {
    return 'REVISION_PLAN';
  }

  // 4. STUDY PLAN (Roadmap / schedule / exam preparation - Rule 8)
  if (/\b(study plan|study schedule|learning path|roadmap|how (do|should|can) i study|prepare for|exam prep|preparation|learning plan|syllabus plan|study guide)\b/.test(clean)) {
    return 'STUDY_PLAN';
  }

  // 5. SUMMARY (Summarize content)
  if (/\b(summarize|summary|tldr|key takeaways|recap|overview|briefly summarize|executive summary)\b/.test(clean)) {
    return 'SUMMARY';
  }

  // 6. TOPIC_IDENTIFICATION (Identify/extract topics or syllabus breakdown)
  if (/\b(identify (important )?topics|topics|syllabus|outline|what is covered|list (the )?topics|subtopics|concepts list|table of contents)\b/.test(clean)) {
    return 'TOPIC_IDENTIFICATION';
  }

  // 7. EXPLAIN (Default learning exploration)
  return 'EXPLAIN';
}

/**
 * Selects an appropriate tool from the tool registry based on the detected intent.
 * Deterministic mapping to prevent unnecessary model calls.
 * 
 * @param {string} intent
 * @returns {'EXPLAIN' | 'STUDY_PLAN' | 'REVISION_PLAN' | 'PRACTICE' | 'QUIZ' | 'SUMMARY' | 'TOPIC_IDENTIFICATION'}
 */
export function selectTool(intent) {
  switch (intent) {
    case 'QUIZ':
      return 'QUIZ';
    case 'PRACTICE':
      return 'PRACTICE';
    case 'REVISION_PLAN':
      return 'REVISION_PLAN';
    case 'STUDY_PLAN':
      return 'STUDY_PLAN';
    case 'SUMMARY':
      return 'SUMMARY';
    case 'TOPIC_IDENTIFICATION':
    case 'TOPICS':
      return 'TOPIC_IDENTIFICATION';
    case 'EXPLAIN':
    default:
      return 'EXPLAIN';
  }
}

/**
 * Generates structured learning workflow milestones for the selected tool.
 * 
 * @param {string} toolName
 * @param {boolean} hasDocument
 * @returns {string[]}
 */
export function getWorkflowSteps(toolName, hasDocument) {
  const docContext = hasDocument ? 'from uploaded study notes' : 'using core CS foundations';

  switch (toolName) {
    case 'STUDY_PLAN':
      return [
        `Assess curriculum scope & milestones (${docContext})`,
        'Sequence core concepts into focused study phases',
        'Establish active checkpoints & practice milestones',
      ];
    case 'REVISION_PLAN':
      return [
        `Identify high-yield exam concepts (${docContext})`,
        'Active recall checklist & memory checkups',
        'High-probability problem patterns & exam tactics',
      ];
    case 'PRACTICE':
      return [
        `Curate targeted problem scenarios (${docContext})`,
        'Step-by-step problem-solving breakdown',
        'Self-check criteria and solution hints',
      ];
    case 'QUIZ':
      return [
        `Generate diagnostic quiz questions (${docContext})`,
        'Concept verification format (multiple choice / short answer)',
        'Detailed answer key with reasoning',
      ];
    case 'SUMMARY':
      return [
        `Extract foundational core principles (${docContext})`,
        'Key architectures, rules, and formulas',
        'Concise bulleted takeaways',
      ];
    case 'TOPIC_IDENTIFICATION':
    case 'TOPICS':
      return [
        `Deconstruct knowledge domain (${docContext})`,
        'Prerequisites & concept dependencies',
        'Core vs. advanced topic hierarchy',
      ];
    case 'EXPLAIN':
    default:
      return [
        `Analyze core concept definition (${docContext})`,
        'Pedagogical intuition & architectural mechanics',
        'Real-world software example & next learning steps',
      ];
  }
}

/**
 * Executes the Controlled Learning Agent workflow.
 * 
 * Flow:
 * Student goal -> Intent detection -> Tool selection ->
 * [Optional RAG_SEARCH if doc available] -> Execute Selected Tool -> Structured Response
 * 
 * @param {object} params
 * @param {string} params.goal - Student's learning goal (e.g. "Help me prepare for DBMS exam").
 * @param {string} [params.documentId] - Optional document filter.
 * @param {string} [params.interactionId] - Optional conversation memory ID.
 * 
 * @returns {Promise<{
 *   success: boolean,
 *   intent: string,
 *   selectedTool: string,
 *   documentUsed: string | null,
 *   relevantDocument: string | null,
 *   workflow: string[],
 *   response: string,
 *   interactionId: string,
 *   sources: Array<any>,
 *   executionMs: number,
 *   goal: string
 * }>}
 */
export async function runLearningAgent({ goal, documentId, interactionId }) {
  if (!goal || typeof goal !== 'string' || !goal.trim()) {
    throw new Error('Please provide a valid learning goal.');
  }

  const totalStart = performance.now();
  const trimmedGoal = goal.trim();

  // 1. Intent Detection (Local ONNX Model if enabled, with Deterministic Fallback)
  let intent = detectIntent(trimmedGoal);
  let localAI = null;

  if (process.env.LOCAL_AI_EXPERIMENT === 'true') {
    try {
      const { classifyLearningIntent } = await import('../services/localAiClassifier.js');
      const localResult = await classifyLearningIntent(trimmedGoal);
      if (localResult && localResult.predictedIntent) {
        intent = localResult.predictedIntent;
      }
      localAI = {
        model: localResult.model,
        runtime: localResult.runtime,
        status: localResult.status,
        input: localResult.input,
        predictedIntent: localResult.predictedIntent,
        confidence: localResult.confidence,
        executionMs: localResult.executionMs,
        isFallback: localResult.isFallback,
        disclaimer: localResult.disclaimer,
      };
    } catch (localErr) {
      console.warn('[AGENT] Local AI classification error, used deterministic intent:', localErr.message);
    }
  }

  // 2. Deterministic Tool Selection (Requirement 16)
  const selectedTool = selectTool(intent);

  if (!learningTools[selectedTool]) {
    throw new Error(`Selected tool "${selectedTool}" is not registered in learningTools.`);
  }

  // 3. Intelligent Conditional RAG Search (Step 8.3)
  // Check if a document is selected or study notes exist in storage
  let documentUsed = null;
  let contextText = '';
  let sources = [];
  let hasDocument = false;
  let ragRequired = false;
  let retrievedChunks = 0;
  let similarityResult = 'No document selected';

  const storageAvailable = isDocumentStorageAvailable();
  const shouldSearchDocument = Boolean(documentId) || storageAvailable;

  if (shouldSearchDocument) {
    try {
      const ragResult = await learningTools.RAG_SEARCH.execute({
        query: trimmedGoal,
        documentId: documentId ? documentId.trim() : undefined,
        topK: 4,
      });

      similarityResult = ragResult.similarityResult || '';

      // Relevance Decision: only use document context if similarity is sufficient
      if (ragResult.hasDocument && ragResult.ragRequired) {
        hasDocument = true;
        ragRequired = true;
        documentUsed = ragResult.relevantDocument;
        sources = ragResult.sources || [];
        contextText = ragResult.contextText || '';
        retrievedChunks = ragResult.retrievedChunksCount || sources.length;
      } else {
        // Document exists or was targeted, but content is irrelevant to the goal
        hasDocument = false;
        ragRequired = false;
        retrievedChunks = 0;
        documentUsed = null;
        sources = [];
        contextText = '';
      }
    } catch (searchError) {
      console.warn('[AGENT] RAG_SEARCH failed, falling back to General Mentor:', searchError.message);
      similarityResult = `Search error: ${searchError.message}`;
    }
  }

  // 4. Execute Selected Tool (Single-hop execution, zero recursion, zero autonomous chaining)
  const toolExecutionStart = performance.now();
  const tool = learningTools[selectedTool];

  let toolResult;
  try {
    toolResult = await tool.execute({
      goal: trimmedGoal,
      question: trimmedGoal,
      topic: trimmedGoal,
      context: contextText,
      sources,
      interactionId: interactionId && typeof interactionId === 'string' ? interactionId.trim() : undefined,
      relevantDocument: documentUsed,
      hasDocument,
    });
  } catch (error) {
    console.error(`[AGENT] Execution failed for tool "${selectedTool}":`, error?.message || error);
    throw error;
  }

  const toolExecutionMs = Math.round(performance.now() - toolExecutionStart);
  const totalMs = Math.round(performance.now() - totalStart);

  // 5. Structured Workflow Milestones
  const workflow = getWorkflowSteps(selectedTool, hasDocument);

  // 6. Server Logs (Requirement 18 - Exact format without logging private document text)
  const loggedDoc = documentUsed || (documentId ? `${documentId} (unrelated - general CS used)` : 'None (General Mentor)');
  console.log(`[AGENT] Goal: "${trimmedGoal.slice(0, 80)}${trimmedGoal.length > 80 ? '...' : ''}"`);
  console.log(`[AGENT] Intent: ${intent}`);
  console.log(`[AGENT] Document: ${loggedDoc}`);
  console.log(`[AGENT] RAG required: ${ragRequired}`);
  console.log(`[AGENT] Retrieved chunks: ${retrievedChunks}`);
  console.log(`[AGENT] Selected tool: ${selectedTool}`);
  console.log(`[AGENT] Total: ${totalMs}ms`);

  // 7. Return Structured Metadata (Requirement 13 & 14)
  return {
    success: true,
    intent,
    selectedTool,
    documentUsed: documentUsed || null,
    relevantDocument: documentUsed || null, // preserves backward compatibility
    ragRequired,
    retrievedChunks,
    similarityResult,
    workflow,
    response: toolResult.response,
    interactionId: toolResult.interactionId || interactionId || '',
    sources,
    executionMs: totalMs,
    goal: trimmedGoal,
    localAI,
  };
}
