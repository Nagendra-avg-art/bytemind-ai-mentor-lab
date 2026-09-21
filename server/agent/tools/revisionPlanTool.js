/**
 * server/agent/tools/revisionPlanTool.js
 * 
 * Tool: REVISION_PLAN
 * Purpose: Create an active revision workflow.
 * 
 * Input:
 * {
 *   goal: string,
 *   topics?: string[],
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

export async function executeRevisionPlan({
  goal,
  topics,
  context,
  interactionId,
  relevantDocument,
  hasDocument,
}) {
  const revisionGoal = (goal || '').trim();
  if (!revisionGoal) {
    throw new Error('REVISION_PLAN tool requires a valid revision topic or exam target.');
  }

  let contextBlock = '';
  if (hasDocument && context) {
    contextBlock = `
=== RETRIEVED STUDY MATERIAL (From: ${relevantDocument || 'Uploaded Notes'}) ===
${context}
================================================================================
GROUNDING INSTRUCTIONS:
- Identify high-probability exam concepts and theorems directly from the notes above.
- Extract common pitfalls, corner cases, and definitions tested in this syllabus.
`;
  } else {
    contextBlock = `
=== GENERAL COMPUTER SCIENCE REVISION CONTEXT ===
No uploaded notes matched this revision request directly. Structure the review based on high-frequency academic examination patterns.
================================================
`;
  }

  const topicsListStr =
    Array.isArray(topics) && topics.length > 0
      ? `Revision Scope Topics: ${topics.join(', ')}\n`
      : '';

  const prompt = `
[LEARNING AGENT TOOL: REVISION_PLAN]
Revision Target: "${revisionGoal}"
${topicsListStr}
ROLE: Rapid Revision Coach.
GOAL: Create an active recall revision workflow optimized for retention and exams.
RULES:
1. Focus on high-yield, frequently examined concepts and theorems.
2. Provide a rapid Active Recall Checklist (core terms, formulas, rules that the student must be able to define from memory).
3. Outline common exam traps and pitfalls to avoid.
4. Structure a 1-day or 3-day rapid revision strategy (e.g. Morning: Concepts, Afternoon: Problem Patterns, Evening: Self-Test).

${contextBlock}

Respond in clean markdown format with checkboxes for the active recall checklist.
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

export const REVISION_PLAN = {
  name: 'REVISION_PLAN',
  description: 'Create an active recall revision workflow with high-yield exam concepts and quick checklists.',
  execute: executeRevisionPlan,
};
