/**
 * server/agent/tools/studyPlanTool.js
 * 
 * Tool: STUDY_PLAN
 * Purpose: Create a structured learning plan / roadmap.
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

export async function executeStudyPlan({
  goal,
  topics,
  context,
  interactionId,
  relevantDocument,
  hasDocument,
}) {
  const learningGoal = (goal || '').trim();
  if (!learningGoal) {
    throw new Error('STUDY_PLAN tool requires a valid student goal.');
  }

  let contextBlock = '';
  if (hasDocument && context) {
    contextBlock = `
=== RETRIEVED STUDY MATERIAL (From: ${relevantDocument || 'Uploaded Notes'}) ===
${context}
================================================================================
GROUNDING INSTRUCTIONS:
- Tailor the study phases and topics around the syllabus/notes provided above.
- Identify prerequisite concepts and sequence topics logically based on this material.
`;
  } else {
    contextBlock = `
=== GENERAL CURRICULUM CONTEXT ===
No uploaded notes matched this study plan request directly. Design a comprehensive curriculum path using standard Computer Science benchmarks.
==================================
`;
  }

  const topicsListStr =
    Array.isArray(topics) && topics.length > 0
      ? `Specific Topics to Cover: ${topics.join(', ')}\n`
      : '';

  const prompt = `
[LEARNING AGENT TOOL: STUDY_PLAN]
Student Learning Goal: "${learningGoal}"
${topicsListStr}
ROLE: Structured Study Planner.
GOAL: Create an actionable, phased learning plan.
RULES:
1. Do NOT dump an entire textbook lecture or teach every concept immediately.
2. Organize the roadmap into logical, time-bounded phases:
   - Phase 1: Core Foundations & Mental Models
   - Phase 2: Key Mechanisms & Architecture
   - Phase 3: Applied Problem Solving & System Design
3. Specify estimated hours/days for each phase.
4. Highlight the Top 3 High-Yield Topics to prioritize first.
5. Provide a clear "What to study first today" starting recommendation.

${contextBlock}

Respond in clean markdown format with progress indicators and checklists.
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

export const STUDY_PLAN = {
  name: 'STUDY_PLAN',
  description: 'Create a structured, phased learning roadmap with time estimates and milestone checklists.',
  execute: executeStudyPlan,
};
