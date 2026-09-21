/**
 * server/utils/chunker.js
 * 
 * WHY THIS UTILITY IS NEEDED:
 * In Step 5.2 of ByteMind RAG, we break raw extracted document text into
 * semantically meaningful "chunks" (800-1200 words each) with overlap (100-150 words).
 * 
 * In upcoming steps, each chunk will be converted into an embedding vector
 * and stored in a vector database for semantic similarity search.
 */

const DEFAULT_TARGET_WORDS = 1000; // Educational target: 800 - 1200 words
const DEFAULT_OVERLAP_WORDS = 120;  // Context overlap: 100 - 150 words

/**
 * Counts the number of words in a given string.
 * @param {string} str
 * @returns {number}
 */
export function countWords(str) {
  if (!str || typeof str !== 'string') return 0;
  const matches = str.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Breaks a block of text into individual sentences.
 * Respects sentence-ending punctuation (. ! ?) followed by whitespace.
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  if (!text) return [];
  // Match sentence followed by terminal punctuation, or remainder
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s+|$)|$)/g);
  return sentences ? sentences.map((s) => s.trim()).filter(Boolean) : [text.trim()];
}

/**
 * Breaks raw document text into natural semantic units (paragraphs & sentences).
 * Ensures no single unit is larger than maxUnitWords so chunk boundary decisions
 * can happen at natural breaks.
 * 
 * @param {string} text
 * @param {number} maxUnitWords
 * @returns {Array<{ text: string, words: number }>}
 */
function getSemanticUnits(text, maxUnitWords = 300) {
  // 1. Normalize line breaks
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];

  // 2. Split by paragraphs
  const rawParagraphs = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const units = [];

  for (const para of rawParagraphs) {
    const paraWords = countWords(para);
    if (paraWords <= maxUnitWords) {
      units.push({ text: para, words: paraWords });
    } else {
      // Paragraph is large; break it down into sentences
      const sentences = splitIntoSentences(para);
      let currentSentenceGroup = '';
      let currentGroupWords = 0;

      for (const sentence of sentences) {
        const sentenceWords = countWords(sentence);
        if (currentGroupWords + sentenceWords > maxUnitWords && currentSentenceGroup) {
          units.push({ text: currentSentenceGroup.trim(), words: currentGroupWords });
          currentSentenceGroup = sentence;
          currentGroupWords = sentenceWords;
        } else {
          currentSentenceGroup = currentSentenceGroup ? `${currentSentenceGroup} ${sentence}` : sentence;
          currentGroupWords += sentenceWords;
        }
      }

      if (currentSentenceGroup) {
        units.push({ text: currentSentenceGroup.trim(), words: currentGroupWords });
      }
    }
  }

  return units;
}

/**
 * Chunks document text into overlapping segments at natural boundaries.
 * 
 * @param {string} text - The raw extracted text from the PDF document
 * @param {string} documentId - Document identifier (e.g. filename)
 * @param {Object} [options] - Configuration options
 * @param {number} [options.targetWords=1000] - Desired word count per chunk (800-1200 range)
 * @param {number} [options.overlapWords=120] - Number of words to overlap between chunks (100-150 range)
 * @returns {Array<{ chunkId: string, documentId: string, chunkIndex: number, wordCount: number, charCount: number, text: string }>}
 */
export function chunkDocument(text, documentId, options = {}) {
  const targetWords = options.targetWords || DEFAULT_TARGET_WORDS;
  const overlapWords = options.overlapWords || DEFAULT_OVERLAP_WORDS;

  if (!text || typeof text !== 'string' || !text.trim()) {
    return [];
  }

  const cleanDocId = (documentId || 'document').replace(/[^\w.-]/g, '_');
  const units = getSemanticUnits(text);

  if (units.length === 0) {
    return [];
  }

  const totalWords = units.reduce((sum, u) => sum + u.words, 0);

  // If the entire document is smaller than the target chunk size, return a single chunk
  if (totalWords <= targetWords) {
    const fullText = units.map((u) => u.text).join('\n\n');
    return [
      {
        chunkId: `${cleanDocId}_chunk_1`,
        documentId: cleanDocId,
        chunkIndex: 1,
        wordCount: totalWords,
        charCount: fullText.length,
        text: fullText,
      },
    ];
  }

  const chunks = [];
  let startIndex = 0;
  let chunkIndex = 1;

  while (startIndex < units.length) {
    let accumulatedWords = 0;
    const chunkUnits = [];
    let endIndex = startIndex;

    // Accumulate units until we reach targetWords or run out of units
    while (endIndex < units.length) {
      const unit = units[endIndex];
      chunkUnits.push(unit);
      accumulatedWords += unit.words;
      endIndex++;

      // If we have met or exceeded targetWords, stop accumulating
      if (accumulatedWords >= targetWords) {
        break;
      }
    }

    // If the remaining units after this chunk have very few words (< 120 words),
    // merge them directly into the current chunk to avoid an orphan micro-chunk
    const remainingUnits = units.slice(endIndex);
    const remainingWords = remainingUnits.reduce((sum, u) => sum + u.words, 0);
    if (remainingWords > 0 && remainingWords < 120 && accumulatedWords + remainingWords <= targetWords * 1.35) {
      chunkUnits.push(...remainingUnits);
      accumulatedWords += remainingWords;
      endIndex = units.length;
    }

    const chunkText = chunkUnits.map((u) => u.text).join('\n\n');
    chunks.push({
      chunkId: `${cleanDocId}_chunk_${chunkIndex}`,
      documentId: cleanDocId,
      chunkIndex,
      wordCount: accumulatedWords,
      charCount: chunkText.length,
      text: chunkText,
    });

    // If we've reached the end of the units, we are done
    if (endIndex >= units.length) {
      break;
    }

    // Compute overlap for the next chunk:
    // Count backwards from endIndex to find where the overlap begins
    let overlapCount = 0;
    let nextStartIndex = endIndex;

    for (let i = endIndex - 1; i >= startIndex; i--) {
      overlapCount += units[i].words;
      nextStartIndex = i;
      if (overlapCount >= overlapWords) {
        break;
      }
    }

    // Safety: ensure forward progression to prevent infinite loop
    if (nextStartIndex <= startIndex) {
      nextStartIndex = startIndex + 1;
    }

    startIndex = nextStartIndex;
    chunkIndex++;
  }

  return chunks;
}
