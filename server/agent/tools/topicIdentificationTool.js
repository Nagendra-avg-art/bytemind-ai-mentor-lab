/**
 * server/agent/tools/topicIdentificationTool.js
 * 
 * Tool: TOPIC_IDENTIFICATION
 * Purpose: Identify and deconstruct important topics from the student's study material.
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

export async function executeTopicIdentification({
  goal,
  topic,
  context,
  interactionId,
  relevantDocument,
  hasDocument,
}) {
  const queryScope = (goal || topic || '').trim();
  if (!queryScope) {
    throw new Error('TOPIC_IDENTIFICATION tool requires a valid topic or study context.');
  }

  let contextBlock = '';
  if (hasDocument && context) {
    contextBlock = `
=== RETRIEVED STUDY MATERIAL (From: ${relevantDocument || 'Uploaded Notes'}) ===
${context}
================================================================================
GROUNDING INSTRUCTIONS:
- Analyze the headings, sections, and concept clusters directly from the study material above.
- Extract the core modules, themes, and subtopics present in these notes.
`;
  } else {
    contextBlock = `
=== GENERAL COMPUTER SCIENCE CURRICULUM CONTEXT ===
No uploaded notes matched this query directly. Identify canonical syllabus topics and core themes according to computer science standards.
===================================================
`;
  }

  const prompt = `
[LEARNING AGENT TOOL: TOPIC_IDENTIFICATION]
Target Scope: "${queryScope}"

ROLE: Curriculum & Topic Analyst.
GOAL: Decompose and identify the primary topics, prerequisites, and learning priorities.
RULES:
1. List all primary modules or major topic clusters.
2. For each module, outline 2 to 3 essential subtopics or mechanical principles.
3. Classify topics into:
   - Foundational / Prerequisites (must know first)
   - Core Mechanisms (the main engine/theory)
   - Advanced / Applications (extensions and edge cases)
4. Highlight the Top 3 "High-Yield Topics" that carry the most weight in understanding or exams.

${contextBlock}

Respond in markdown format with clear hierarchical bullet points and badges.
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

export const TOPIC_IDENTIFICATION = {
  name: 'TOPIC_IDENTIFICATION',
  description: 'Identify and deconstruct essential syllabus topics, core modules, and prerequisite hierarchies from study notes.',
  execute: executeTopicIdentification,
};
