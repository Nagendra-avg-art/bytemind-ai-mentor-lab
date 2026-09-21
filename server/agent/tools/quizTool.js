/**
 * server/agent/tools/quizTool.js
 * 
 * Tool: QUIZ
 * Purpose: Generate a diagnostic quiz.
 * 
 * IMPORTANT:
 * Only use this tool when the student explicitly requests a quiz.
 * Never automatically quiz after an explanation.
 * 
 * Input:
 * {
 *   goal: string,
 *   context?: string,
 *   interactionId?: string,
 *   relevantDocument?: string | null,
 *   hasDocument?: boolean
 * }
 * 
 * Output:
 * {
 *   response: string,
 *   interactionId: string
 * }
 */

import { BYTEMIND_MENTOR_SYSTEM_INSTRUCTION } from '../../prompts/mentorPrompt.js';
import { callAgentGemini } from '../agentGeminiClient.js';

export async function executeQuiz({
  goal,
  question,
  context,
  interactionId,
  relevantDocument,
  hasDocument,
}) {
  const quizTopic = (goal || question || '').trim();
  if (!quizTopic) {
    throw new Error('QUIZ tool requires a valid topic or quiz subject.');
  }

  let contextBlock = '';
  if (hasDocument && context) {
    contextBlock = `
=== RETRIEVED STUDY MATERIAL (From: ${relevantDocument || 'Uploaded Notes'}) ===
${context}
================================================================================
GROUNDING INSTRUCTIONS:
- Base quiz questions directly on the principles, definitions, and code patterns in the notes above.
- Ensure the questions evaluate true understanding rather than simple trivial memorization.
`;
  } else {
    contextBlock = `
=== GENERAL COMPUTER SCIENCE QUIZ CONTEXT ===
No uploaded notes matched this quiz request directly. Base questions on core computer science foundations.
============================================
`;
  }

  const prompt = `
[LEARNING AGENT TOOL: QUIZ]
Quiz Subject / Scope: "${quizTopic}"

ROLE: Interactive Examiner.
GOAL: Provide a diagnostic quiz because the student explicitly requested a quiz.
RULES:
1. Provide 3 to 5 clear, high-quality questions:
   - Mix of Multiple Choice (with plausible distractors A, B, C, D) and conceptual short-answer questions.
   - Address both foundational mechanics and realistic scenarios.
2. Below all questions, provide a clear "Answer Key & Explanations" section:
   - State the correct answer.
   - Provide a 1-2 sentence explanation of WHY that answer is correct and why the alternatives are incorrect.
3. Keep the tone encouraging and academic.

${contextBlock}

Respond in clean markdown format with questions clearly labeled Q1, Q2, etc.
`.trim();

  const interactionParams = {
    model: 'gemini-3.6-flash',
    input: prompt,
    system_instruction: BYTEMIND_MENTOR_SYSTEM_INSTRUCTION,
  };

  if (interactionId && typeof interactionId === 'string' && interactionId.trim()) {
    interactionParams.previous_interaction_id = interactionId.trim();
  }

  const result = await callAgentGemini(interactionParams);

  return {
    response: result.output_text || '',
    interactionId: result.id || interactionId || '',
  };
}

export const QUIZ = {
  name: 'QUIZ',
  description: 'Generate diagnostic concept quizzes with multiple-choice and conceptual verification questions. (Explicit student request only)',
  execute: executeQuiz,
};
