/**
 * server/utils/lexicalSearch.js
 * 
 * Lightweight BM25 Lexical / Keyword Search for ByteMind RAG on Render.
 * Enables provider-independent document grounding over extracted chunks
 * without requiring dense vector embeddings or external API quota.
 */

// Common English stop words to filter out during tokenization
const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as',
  'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'can\'t',
  'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down',
  'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t',
  'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it',
  'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such',
  'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s',
  'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were',
  'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s',
  'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re',
  'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
  // Educational conversational stop words
  'according', 'notes', 'tell', 'show', 'please', 'material', 'document', 'mention', 'say'
]);

/**
 * Lightweight word stemmer for common English suffixes.
 * @param {string} word
 * @returns {string}
 */
export function stem(word) {
  if (!word || typeof word !== 'string' || word.length <= 3) return word;
  return word
    .replace(/(?:ing|edly|ingly|ed|es|s)$/, '')
    .replace(/(?:tion|tional|ment|ments)$/, '');
}

/**
 * Tokenizes text into lowercase alphanumeric words, filtering punctuation and stop words.
 * 
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/[\s-]+/)
    .map(w => w.trim())
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  
  // If all tokens were filtered out (e.g. query was purely stop words), fall back to raw words
  if (words.length === 0) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 0);
  }

  return words;
}

/**
 * Computes BM25 ranking across document chunks.
 * 
 * Parameters:
 * - k1: controls term frequency saturation (default 1.5)
 * - b: controls degree of document length normalization (default 0.75)
 * 
 * @param {object} params
 * @param {string} params.query - Search query
 * @param {Array<any>} params.chunks - Candidate chunks to rank
 * @param {number} [params.topK=3] - Max chunks to return
 * @param {number} [params.threshold=0.0] - Minimum similarity threshold
 * @param {number} [params.k1=1.5]
 * @param {number} [params.b=0.75]
 * @returns {Array<{
 *   chunkId: string,
 *   documentId: string,
 *   filename: string,
 *   chunkIndex: number,
 *   page: number|null,
 *   content: string,
 *   text: string,
 *   similarity: number,
 *   rawScore: number,
 *   retrievalStrategy: 'lexical_bm25'
 * }>}
 */
export function searchLexicalBM25({
  query,
  chunks = [],
  topK = 3,
  threshold = 0.0,
  k1 = 1.5,
  b = 0.75,
}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return [];
  }
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  const N = chunks.length;

  // 1. Precompute term frequencies and document lengths
  const chunkTokenFreqs = [];
  const chunkLengths = [];
  let totalLength = 0;

  for (let i = 0; i < N; i++) {
    const chunk = chunks[i];
    const rawContent = chunk.content ?? chunk.text ?? chunk.preview ?? '';
    const tokens = tokenize(rawContent);
    const freqMap = new Map();

    for (const token of tokens) {
      freqMap.set(token, (freqMap.get(token) || 0) + 1);
      const st = stem(token);
      if (st && st !== token) {
        freqMap.set(st, (freqMap.get(st) || 0) + 1);
      }
    }

    chunkTokenFreqs.push(freqMap);
    const len = Math.max(1, tokens.length);
    chunkLengths.push(len);
    totalLength += len;
  }

  const avgdl = totalLength / N || 1;

  // 2. Compute document frequency (df) and inverse document frequency (IDF) for query tokens
  const idfMap = new Map();
  for (const qTerm of queryTokens) {
    if (idfMap.has(qTerm)) continue;
    const qStem = stem(qTerm);
    let df = 0;
    for (let i = 0; i < N; i++) {
      if (chunkTokenFreqs[i].has(qTerm) || (qStem && chunkTokenFreqs[i].has(qStem))) {
        df++;
      }
    }

    // Standard Robertson-Spärck Jones BM25 IDF formula with +1 floor
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    idfMap.set(qTerm, Math.max(0.1, idf));
  }

  // 3. Compute theoretical maximum score for normalization
  let maxTheoreticalScore = 0;
  for (const qTerm of queryTokens) {
    const idf = idfMap.get(qTerm) || 0.1;
    maxTheoreticalScore += idf * (k1 + 1);
  }
  if (maxTheoreticalScore <= 0) maxTheoreticalScore = 1.0;

  // 4. Score each chunk
  const normalizedQuery = query.toLowerCase().trim();
  const scored = [];

  for (let i = 0; i < N; i++) {
    const chunk = chunks[i];
    const freqMap = chunkTokenFreqs[i];
    const docLen = chunkLengths[i];
    let score = 0;
    let matchedTerms = 0;

    for (const qTerm of queryTokens) {
      const qStem = stem(qTerm);
      const tf = freqMap.get(qTerm) || (qStem ? freqMap.get(qStem) : 0) || 0;
      if (tf > 0) {
        matchedTerms++;
        const idf = idfMap.get(qTerm) || 0.1;
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLen / avgdl));
        score += idf * (numerator / denominator);
      }
    }

    // Exact phrase / substring bonus
    const rawContent = (chunk.content ?? chunk.text ?? '').toLowerCase();
    if (rawContent.includes(normalizedQuery)) {
      score += maxTheoreticalScore * 0.35; // 35% exact phrase bonus
    }

    // Normalize score into [0.0, 1.0] range
    // Give weight to term coverage (ratio of query terms present)
    const coverage = matchedTerms / queryTokens.length;
    let similarity = Math.min(1.0, (score / maxTheoreticalScore) * 0.7 + coverage * 0.3);

    if (score > 0 && similarity >= threshold) {
      scored.push({
        chunkId: chunk.chunkId || `chunk-${i}`,
        documentId: chunk.documentId || 'document',
        filename: chunk.filename || chunk.documentId || 'document',
        chunkIndex: chunk.chunkIndex ?? i,
        page: chunk.page !== undefined ? chunk.page : null,
        content: chunk.text || chunk.content || '',
        text: chunk.text || chunk.content || '',
        similarity: Number(similarity.toFixed(4)),
        rawScore: Number(score.toFixed(2)),
        retrievalStrategy: 'lexical_bm25',
      });
    }
  }

  // 5. Sort descending by similarity
  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, Math.max(1, topK));
}
