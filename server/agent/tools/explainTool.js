/**
 * server/agent/tools/explainTool.js
 * 
 * Tool: EXPLAIN
 * Purpose: Explain a concept clearly using pedagogical guidance.
 * 
 * Input:
 * {
 *   question: string,
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

export async function executeExplain({
  question,
  goal,
  context,
  interactionId,
  relevantDocument,
  hasDocument,
}) {
  const queryText = (question || goal || '').trim();
  if (!queryText) {
    throw new Error('EXPLAIN tool requires a valid concept or question.');
  }

  let contextBlock = '';
  if (hasDocument && context) {
    contextBlock = `
=== RETRIEVED STUDY MATERIAL (From: ${relevantDocument || 'Uploaded Notes'}) ===
${context}
================================================================================
GROUNDING INSTRUCTIONS:
- Ground your explanation in the retrieved material above.
- Cite specific sections or concepts from this material when applicable.
- If details are not covered in the notes, use standard computer science fundamentals while noting it is general knowledge.
`;
  } else {
    contextBlock = `
=== GENERAL COMPUTER SCIENCE MENTOR CONTEXT ===
No uploaded notes matched this concept directly. Apply core computer science foundations, intuitive analogies, and architectural best practices.
==============================================
`;
  }

  const prompt = `
[LEARNING AGENT TOOL: EXPLAIN]
Student Query: "${queryText}"

ROLE: ByteMind Concept Mentor.
GOAL: Deliver a clear, pedagogically grounded explanation.
RULES:
1. Start with an intuitive definition without excessive jargon.
2. Explain the core underlying mechanics, algorithms, or architecture.
3. Provide a concrete example (code snippet, visual diagram, or real-world analogy).
4. Summarize common edge cases or pitfalls.
5. Do NOT generate a quiz or practice set unless the student explicitly asked for one.

${contextBlock}

Respond clearly and concisely in markdown format. Use bullet points and code blocks for readability.
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

export const EXPLAIN = {
  name: 'EXPLAIN',
  description: 'Explain a computer science concept clearly with pedagogical intuition, architecture, and examples.',
  execute: executeExplain,
};
