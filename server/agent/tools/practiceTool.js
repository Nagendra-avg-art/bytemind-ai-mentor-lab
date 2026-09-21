/**
 * server/agent/tools/practiceTool.js
 * 
 * Tool: PRACTICE
 * Purpose: Generate targeted practice questions.
 * 
 * IMPORTANT:
 * Only use this tool when the student explicitly requests practice exercises.
 * Never automatically invoke practice without explicit intent.
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

export async function executePractice({
  goal,
  question,
  context,
  interactionId,
  relevantDocument,
  hasDocument,
}) {
  const targetTopic = (goal || question || '').trim();
  if (!targetTopic) {
    throw new Error('PRACTICE tool requires a valid topic or practice target.');
  }

  let contextBlock = '';
  if (hasDocument && context) {
    contextBlock = `
=== RETRIEVED STUDY MATERIAL (From: ${relevantDocument || 'Uploaded Notes'}) ===
${context}
================================================================================
GROUNDING INSTRUCTIONS:
- Craft practice problems that test concepts, algorithms, or examples found in the material above.
- Ensure difficulty matches the curriculum level shown in the notes.
`;
  } else {
    contextBlock = `
=== GENERAL COMPUTER SCIENCE EXERCISE CONTEXT ===
No uploaded notes matched this practice request directly. Generate standard, rigorous computer science exercises.
================================================
`;
  }

  const prompt = `
[LEARNING AGENT TOOL: PRACTICE]
Practice Goal / Topic: "${targetTopic}"

ROLE: Practice Exercise Coach.
GOAL: Provide targeted practice problems because the student explicitly requested practice.
RULES:
1. Provide 3 to 4 progressive practice problems:
   - Problem 1: Foundational / Conceptual verification
   - Problem 2: Core Mechanical / Algorithmic implementation
   - Problem 3: Edge Case / Optimization challenge
2. For each problem, include:
   - Problem Statement: Clear input/output specification and scenario.
   - Key Insight / Approach Hint: Pedagogical tip without giving away the full answer.
   - Expected Output / Verification: Sample test case or verification criteria.
3. Do NOT provide the full step-by-step solution immediately—give the student room to solve it actively!
4. Encourage the student to share their attempt for review.

${contextBlock}

Respond in markdown format with clear numbered problem sections.
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

export const PRACTICE = {
  name: 'PRACTICE',
  description: 'Generate progressive practice problems with approach hints and verification criteria. (Explicit student request only)',
  execute: executePractice,
};
