/**
 * server/agent/tools/index.js
 * 
 * WHY THIS MODULE IS NEEDED:
 * Step 8.2 of ByteMind: Learning Agent Tool Selection.
 * 
 * Central Tool Registry for the Learning Agent.
 * Exposes a controlled set of 8 discrete, single-purpose tools.
 * 
 * DESIGN PRINCIPLES:
 * 1. Zero autonomous loops or recursive chains.
 * 2. No background workers or continuous polling.
 * 3. Strict single-hop tool execution per user query (optionally preceded by RAG_SEARCH).
 * 4. Zero eager Gemini API calls on registration/import.
 */

import { RAG_SEARCH, executeRagSearch, isDocumentStorageAvailable } from './ragSearchTool.js';
import { EXPLAIN, executeExplain } from './explainTool.js';
import { SUMMARY, executeSummary } from './summaryTool.js';
import { STUDY_PLAN, executeStudyPlan } from './studyPlanTool.js';
import { REVISION_PLAN, executeRevisionPlan } from './revisionPlanTool.js';
import { PRACTICE, executePractice } from './practiceTool.js';
import { QUIZ, executeQuiz } from './quizTool.js';
import { TOPIC_IDENTIFICATION, executeTopicIdentification } from './topicIdentificationTool.js';

export {
  RAG_SEARCH,
  EXPLAIN,
  SUMMARY,
  STUDY_PLAN,
  REVISION_PLAN,
  PRACTICE,
  QUIZ,
  TOPIC_IDENTIFICATION,
  executeRagSearch,
  executeExplain,
  executeSummary,
  executeStudyPlan,
  executeRevisionPlan,
  executePractice,
  executeQuiz,
  executeTopicIdentification,
  isDocumentStorageAvailable,
};

/**
 * Central registry of all internal ByteMind capabilities exposed to the Learning Agent.
 */
export const learningTools = {
  RAG_SEARCH,
  EXPLAIN,
  SUMMARY,
  STUDY_PLAN,
  REVISION_PLAN,
  PRACTICE,
  QUIZ,
  TOPIC_IDENTIFICATION,
};

/**
 * List of available tool names for validation and inspection.
 */
export const AVAILABLE_TOOLS = Object.keys(learningTools);
