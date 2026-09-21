/**
 * server/agent/tools/summaryTool.js
 * 
 * Tool: SUMMARY
 * Purpose: Summarize relevant study material.
 * 
 * Input:
 * {
 *   topic: string,
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

export async function executeSummary({
  topic,
  goal,
  context,
  interactionId,
  relevantDocument,
  hasDocument,
}) {
  const targetTopic = (topic || goal || '').trim();
  if (!targetTopic) {
    throw new Error('SUMMARY tool requires a valid topic or study goal.');
  }

  let contextBlock = '';
  if (hasDocument && context) {
    contextBlock = `
=== RETRIEVED STUDY MATERIAL (From: ${relevantDocument || 'Uploaded Notes'}) ===
${context}
================================================================================
GROUNDING INSTRUCTIONS:
- Ground your summary in the retrieved study material above.
- Extract foundational principles, formulas, rules, and relationships from these notes.
- If information is missing from the notes, summarize the foundational CS theory while noting it is general knowledge.
`;
  } else {
    contextBlock = `
=== GENERAL COMPUTER SCIENCE CONTEXT ===
No uploaded notes matched this summary request directly. Summarize based on established computer science standards.
========================================
`;
  }

  const prompt = `
[LEARNING AGENT TOOL: SUMMARY]
Topic / Scope: "${targetTopic}"

ROLE: Academic Summarizer.
GOAL: Provide a clean, high-retention summary of the material.
RULES:
1. Provide a 2-paragraph executive overview of the core principles.
2. Follow with a structured bulleted list of Essential Takeaways.
3. Highlight key definitions, formulas, or algorithmic complexities.
4. Keep the summary scannable, dense with insight, and easy to review before an exam.

${contextBlock}

Respond in markdown format using clear headings and bullet points.
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

export const SUMMARY = {
  name: 'SUMMARY',
  description: 'Summarize relevant study material with executive overview and key takeaways.',
  execute: executeSummary,
};
