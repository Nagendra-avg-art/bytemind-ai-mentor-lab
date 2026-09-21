/**
 * server/services/localAiClassifier.js
 * 
 * STEP 15: LOCAL AI FEASIBILITY LAB
 * 
 * Purpose:
 * Implements a lightweight, local, open-source intent classification engine for ByteMind.
 * Classifies student learning goals into the 7 canonical ByteMind intents:
 *   - EXPLAIN
 *   - SUMMARY
 *   - STUDY_PLAN
 *   - REVISION_PLAN
 *   - PRACTICE
 *   - QUIZ
 *   - TOPIC_IDENTIFICATION
 * 
 * Product Principles:
 * 1. 100% Local Inference: Runs on-device/host CPU via ONNX Runtime / Transformers.js.
 * 2. ZERO Gemini Calls: Never consumes Gemini quota for intent classification.
 * 3. ZERO External APIs: Does not send student input text to any external third-party API.
 * 4. Lightweight: Uses Xenova/all-MiniLM-L6-v2 (~23MB quantized ONNX model).
 * 5. Strictly Optional & Fallback Guaranteed: If LOCAL_AI_EXPERIMENT=false or model fails to load,
 *    ByteMind seamlessly uses deterministic rule-based routing (`detectIntent`).
 * 6. Honest Technical Disclosures: Explicitly labeled as Host CPU inference (NOT yet Snapdragon NPU).
 */

import { detectIntent } from '../agent/learningAgent.js';

// Configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const RUNTIME_NAME = 'ONNX Runtime / Transformers.js (Host CPU Local Inference)';

// Feature flag helper
export function isLocalAiEnabled() {
  return process.env.LOCAL_AI_EXPERIMENT === 'true';
}

// Canonical Intent Semantic Anchors (Representative phrases for cosine similarity matching)
const INTENT_ANCHORS = {
  EXPLAIN: [
    'Explain 3NF',
    'Explain this concept in detail',
    'Can you explain how this works',
    'Explain the principles and definitions',
    'Concept deep dive explanation overview tutorial architecture',
  ],
  SUMMARY: [
    'Summarize this topic',
    'Summarize this document and provide key takeaways',
    'Executive summary overview TLDR bulleted takeaways and recap',
    'Briefly summarize the main points',
  ],
  STUDY_PLAN: [
    'Create a study plan for preparing',
    'Structured study roadmap and schedule for preparing for exam',
    'Study schedule syllabus learning path exam preparation curriculum roadmap',
    'How should I study this subject over the next few weeks',
  ],
  REVISION_PLAN: [
    'Create a revision plan for DBMS',
    'Revision plan for rapid review and exam revision',
    'Revise notes quick revision checklist high-yield cramming review plan',
    'Fast revision guide and exam memory checkup',
  ],
  PRACTICE: [
    'Practice exercises problems problem set and drills',
    'Give me practice questions on this topic to solve',
    'Coding practice exercises and problem solving worksheets',
    'Practice problems on normalization',
  ],
  QUIZ: [
    'Quiz me on normalization',
    'Quiz me on this topic test my knowledge with questions',
    'Diagnostic quiz multiple choice questions test me MCQ trivia',
    'Self-test my understanding with a short quiz',
  ],
  TOPIC_IDENTIFICATION: [
    'Identify important topics in this syllabus',
    'List the topics syllabus outline concept hierarchy and breakdown',
    'What are the core topics and subtopics covered here',
    'Extract concepts list and table of contents',
  ],
};

// Singleton pipeline & precomputed anchor embeddings cache
let featureExtractor = null;
let anchorEmbeddingsCache = null;
let initializationPromise = null;
let modelStatus = 'Uninitialized'; // 'Uninitialized' | 'Loading' | 'Ready' | 'Unavailable'
let lastError = null;

/**
 * Calculates dot product between two normalized vectors (cosine similarity).
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

/**
 * Computes Softmax probabilities over an array of scores with temperature scaling.
 */
function softmax(scores, temperature = 0.25) {
  const scaled = scores.map((s) => s / temperature);
  const maxVal = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - maxVal));
  const sum = exps.reduce((acc, val) => acc + val, 0);
  return exps.map((val) => val / sum);
}

/**
 * Initializes the Transformers.js feature extraction pipeline.
 * Loads the quantized ONNX model locally.
 */
async function initLocalModel() {
  if (modelStatus === 'Ready' && featureExtractor && anchorEmbeddingsCache) {
    return true;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      modelStatus = 'Loading';
      console.log(`[Local AI Lab] Loading ${MODEL_NAME} via Transformers.js...`);

      // Dynamically import @xenova/transformers
      const { pipeline, env } = await import('@xenova/transformers');

      // Configure local cache directory
      env.allowLocalModels = true;
      env.useBrowserCache = false;

      featureExtractor = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true,
      });

      // Precompute normalized embedding vectors for all intent anchors
      anchorEmbeddingsCache = {};
      for (const [intent, anchors] of Object.entries(INTENT_ANCHORS)) {
        anchorEmbeddingsCache[intent] = [];
        for (const anchorText of anchors) {
          const output = await featureExtractor(anchorText, {
            pooling: 'mean',
            normalize: true,
          });
          anchorEmbeddingsCache[intent].push(Array.from(output.data));
        }
      }

      modelStatus = 'Ready';
      lastError = null;
      console.log(`[Local AI Lab] ✓ Model ${MODEL_NAME} is Ready on local CPU.`);
      return true;
    } catch (err) {
      modelStatus = 'Unavailable';
      lastError = err.message;
      console.warn(`[Local AI Lab] ⚠️ Failed to initialize local model (${err.message}). Using deterministic fallback.`);
      return false;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * Returns current status and telemetry of the Local AI Lab.
 */
export function getLocalAiStatus() {
  const enabled = isLocalAiEnabled();
  return {
    enabled,
    model: enabled ? MODEL_NAME : 'None (Feature Flag Disabled)',
    runtime: RUNTIME_NAME,
    status: !enabled ? 'Disabled' : modelStatus,
    disclaimer: 'Host CPU ONNX inference experiment. Not yet native Snapdragon NPU acceleration.',
    lastError: lastError,
  };
}

/**
 * Classifies learning intent using the local model if enabled and ready,
 * or safely falls back to the deterministic rule-based router.
 * 
 * @param {string} text - User's input goal or prompt.
 * @returns {Promise<{
 *   model: string,
 *   runtime: string,
 *   status: 'Ready' | 'Unavailable' | 'Disabled',
 *   input: string,
 *   predictedIntent: string,
 *   confidence: number,
 *   scores: Record<string, number>,
 *   executionMs: number,
 *   isFallback: boolean,
 *   disclaimer: string
 * }>}
 */
export async function classifyLearningIntent(text) {
  const startTime = performance.now();
  const rawInput = (text || '').trim();

  // If feature flag is disabled, immediately use deterministic router
  if (!isLocalAiEnabled()) {
    const fallbackIntent = detectIntent(rawInput);
    const duration = Math.round((performance.now() - startTime) * 100) / 100;
    return {
      model: 'Deterministic Rule Router',
      runtime: 'Regex / Rule-Based',
      status: 'Disabled',
      input: rawInput,
      predictedIntent: fallbackIntent,
      confidence: 1.0,
      scores: { [fallbackIntent]: 1.0 },
      executionMs: duration,
      isFallback: true,
      disclaimer: 'Local AI experiment flag is OFF. Using standard deterministic routing.',
    };
  }

  // Attempt to load model if not yet loaded
  const isReady = await initLocalModel();

  if (!isReady || !featureExtractor || !anchorEmbeddingsCache) {
    // Model failed or unavailable: Safe deterministic fallback
    const fallbackIntent = detectIntent(rawInput);
    const duration = Math.round((performance.now() - startTime) * 100) / 100;
    return {
      model: MODEL_NAME,
      runtime: RUNTIME_NAME,
      status: 'Unavailable',
      input: rawInput,
      predictedIntent: fallbackIntent,
      confidence: 0.85,
      scores: { [fallbackIntent]: 0.85 },
      executionMs: duration,
      isFallback: true,
      disclaimer: `Local model unavailable (${lastError || 'Init failed'}). Safely routed via deterministic fallback.`,
    };
  }

  // Perform Local ONNX Inference
  try {
    const inputOutput = await featureExtractor(rawInput, {
      pooling: 'mean',
      normalize: true,
    });
    const inputVector = Array.from(inputOutput.data);

    // Compute maximum similarity for each intent category
    const intentRawScores = {};
    const intentList = Object.keys(anchorEmbeddingsCache);

    for (const intent of intentList) {
      const anchors = anchorEmbeddingsCache[intent];
      let maxSim = -1;
      for (const anchorVec of anchors) {
        const sim = cosineSimilarity(inputVector, anchorVec);
        if (sim > maxSim) maxSim = sim;
      }
      intentRawScores[intent] = maxSim;
    }

    // Convert raw similarities into normalized probability distribution using Softmax
    const rawScoresArray = intentList.map((intent) => intentRawScores[intent]);
    const probabilities = softmax(rawScoresArray, 0.2);

    const intentProbabilities = {};
    let bestIntent = 'EXPLAIN';
    let bestScore = -1;

    intentList.forEach((intent, idx) => {
      const prob = Math.round(probabilities[idx] * 1000) / 1000;
      intentProbabilities[intent] = prob;
      if (prob > bestScore) {
        bestScore = prob;
        bestIntent = intent;
      }
    });

    const duration = Math.round((performance.now() - startTime) * 100) / 100;

    return {
      model: MODEL_NAME,
      runtime: RUNTIME_NAME,
      status: 'Ready',
      input: rawInput,
      predictedIntent: bestIntent,
      confidence: bestScore,
      scores: intentProbabilities,
      executionMs: duration,
      isFallback: false,
      disclaimer: 'Host CPU ONNX inference experiment. Not yet native Snapdragon NPU acceleration.',
    };
  } catch (inferenceErr) {
    console.warn('[Local AI Lab] Inference error, falling back to deterministic:', inferenceErr.message);
    const fallbackIntent = detectIntent(rawInput);
    const duration = Math.round((performance.now() - startTime) * 100) / 100;
    return {
      model: MODEL_NAME,
      runtime: RUNTIME_NAME,
      status: 'Unavailable',
      input: rawInput,
      predictedIntent: fallbackIntent,
      confidence: 0.85,
      scores: { [fallbackIntent]: 0.85 },
      executionMs: duration,
      isFallback: true,
      disclaimer: `Inference failed (${inferenceErr.message}). Safely routed via deterministic fallback.`,
    };
  }
}
