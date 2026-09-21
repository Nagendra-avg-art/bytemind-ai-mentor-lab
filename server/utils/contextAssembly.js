/**
 * server/utils/contextAssembly.js
 * 
 * WHY THIS UTILITY IS NEEDED:
 * Step 5.7 of ByteMind RAG: Context Assembly for Gemini Generation.
 * 
 * Assembles retrieved document chunks into a structured, standardized prompt context:
 * - Clear boundaries (STUDENT MATERIAL ... END STUDENT MATERIAL)
 * - Explicit source labeling (Source 1, Source 2, Document name, Chunk index)
 * - Concise, clean content (no embeddings, no extraneous tokens)
 * - Grounding guidance to enforce document fidelity and prevent unsolicited quizzes
 */

/**
 * Builds the grounded prompt context for Gemini from retrieved chunks and the student's question.
 * 
 * @param {Array<{
 *   documentId?: string,
 *   filename?: string,
 *   chunkId?: string,
 *   chunkIndex?: number,
 *   content?: string,
 *   text?: string
 * }>} chunks - Array of retrieved relevant chunks
 * @param {string} question - The student's question
 * 
 * @returns {string} Formatted context string ready for Gemini
 */
export function assembleRAGContext(chunks, question) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('assembleRAGContext requires a non-empty array of chunks.');
  }

  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('assembleRAGContext requires a valid student question.');
  }

  let context = 'STUDENT MATERIAL\n\n';

  chunks.forEach((chunk, index) => {
    const docName = chunk.filename || chunk.documentId || 'Uploaded Document';
    const chunkNum = chunk.chunkIndex !== undefined ? chunk.chunkIndex : index + 1;
    const rawContent = (chunk.content || chunk.text || '').trim();

    context += `Source ${index + 1}:\n`;
    context += `Document: ${docName}\n`;
    context += `Chunk: ${chunkNum}\n\n`;
    context += `${rawContent}\n\n`;
  });

  context += 'END STUDENT MATERIAL\n\n';
  context += `STUDENT QUESTION:\n${question.trim()}\n\n`;
  context += 'GROUNDING INSTRUCTIONS:\n';
  context += '- Use the retrieved STUDENT MATERIAL above as your primary evidence.\n';
  context += '- Do not claim information came from the document unless supported by the context.\n';
  context += '- If the material does not contain enough information to answer completely, explicitly say so.\n';
  context += '- If general knowledge is used to add helpful explanation, clearly distinguish it from information found in the uploaded material.\n';
  context += '- Do not generate quizzes, practice questions, exercises, or tests unless explicitly requested by the student.';

  return context;
}
