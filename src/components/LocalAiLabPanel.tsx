import React, { useState, useEffect } from 'react';
import { fetchLocalAiStatus, classifyIntentLocally } from '../services/aiService';
import { LocalAiMetadata, LocalAiStatusResponse } from '../types';

/**
 * LocalAiLabPanel.tsx
 * 
 * STEP 15: LOCAL AI FEASIBILITY LAB
 * 
 * Purpose:
 * Developer Mode experimental workbench for on-device/host-side intent classification.
 * Strictly confined to Developer Mode. Student Mode never renders this panel.
 * 
 * Requirements:
 * 1. Shows exact required fields:
 *    - LOCAL AI EXPERIMENT
 *    - Model: <model>
 *    - Runtime: <runtime>
 *    - Status: Ready/Unavailable
 *    - Input: ...
 *    - Predicted intent: ...
 *    - Confidence: ...
 * 2. Mandatory quick-test prompts:
 *    - "Explain 3NF"
 *    - "Create a revision plan for DBMS"
 *    - "Quiz me on normalization"
 *    - "Summarize this topic"
 * 3. Disclaims clearly that this is Host CPU ONNX inference and NOT Snapdragon NPU.
 * 4. Zero Gemini API calls consumed.
 */

const QUICK_TEST_CASES = [
  'Explain 3NF',
  'Create a revision plan for DBMS',
  'Quiz me on normalization',
  'Summarize this topic',
];

export const LocalAiLabPanel: React.FC = () => {
  const [statusInfo, setStatusInfo] = useState<LocalAiStatusResponse | null>(null);
  const [inputText, setInputText] = useState<string>('Explain 3NF');
  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [result, setResult] = useState<LocalAiMetadata | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load status on mount
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const res = await fetchLocalAiStatus();
      setStatusInfo(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch status');
    }
  };

  const handleClassify = async (overrideText?: string) => {
    const textToClassify = (overrideText ?? inputText).trim();
    if (!textToClassify || isClassifying) return;

    setIsClassifying(true);
    setErrorMsg(null);

    try {
      const res = await classifyIntentLocally(textToClassify);
      setResult(res);
      // Also refresh status to reflect loaded state
      if (statusInfo && statusInfo.status !== 'Ready') {
        setStatusInfo((prev) => (prev ? { ...prev, status: res.status, model: res.model } : prev));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Classification failed');
    } finally {
      setIsClassifying(false);
    }
  };

  const getIntentBadgeColor = (intent: string) => {
    switch (intent) {
      case 'EXPLAIN': return 'badge-emerald';
      case 'SUMMARY': return 'badge-teal';
      case 'STUDY_PLAN': return 'badge-blue';
      case 'REVISION_PLAN': return 'badge-amber';
      case 'PRACTICE': return 'badge-green';
      case 'QUIZ': return 'badge-purple';
      case 'TOPIC_IDENTIFICATION': return 'badge-indigo';
      default: return 'badge-gray';
    }
  };

  return (
    <div className="local-ai-lab-panel">
      {/* Header Banner */}
      <div className="lab-header">
        <div className="lab-badge-row">
          <span className="lab-badge">🧪 STEP 15: LOCAL AI FEASIBILITY LAB</span>
          <span className="lab-status-pill ready">
            Status: {statusInfo?.status || (result ? result.status : 'Ready')}
          </span>
        </div>
        <h3 className="lab-title">Local Intent Routing Experiment</h3>
        <p className="lab-description">
          Evaluates local open-source models for student intent classification. Executes 100% locally
          on host CPU via ONNX Runtime without consuming Gemini API quota or sending text to external APIs.
        </p>
      </div>

      {/* Mandatory Technical Disclaimer */}
      <div className="lab-disclaimer-card">
        <span className="disclaimer-icon">⚠️</span>
        <div className="disclaimer-text">
          <strong>Architecture Notice:</strong> Host CPU ONNX inference experiment (Transformers.js).
          This is <em>not</em> native Snapdragon NPU acceleration. Device-native NPU integration is scheduled for future exploration.
        </div>
      </div>

      {/* Quick Test Prompt Chips */}
      <div className="lab-chips-section">
        <label className="lab-field-label">Mandatory Test Cases (Step 15 Requirements):</label>
        <div className="lab-chips-grid">
          {QUICK_TEST_CASES.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="lab-chip-btn"
              disabled={isClassifying}
              onClick={() => {
                setInputText(prompt);
                handleClassify(prompt);
              }}
            >
              ⚡ "{prompt}"
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Input Form */}
      <div className="lab-input-section">
        <label className="lab-field-label" htmlFor="local-ai-input">
          Custom Goal / Prompt:
        </label>
        <div className="lab-input-row">
          <input
            id="local-ai-input"
            type="text"
            className="lab-text-input"
            placeholder="e.g. Can you explain Boyce-Codd Normal Form?"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleClassify();
            }}
            disabled={isClassifying}
          />
          <button
            type="button"
            className="lab-run-btn"
            onClick={() => handleClassify()}
            disabled={isClassifying || !inputText.trim()}
          >
            {isClassifying ? 'Classifying...' : 'Classify Intent'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {errorMsg && (
        <div className="lab-error-banner">
          ⚠️ <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* Exact Experiment Output Display Required by Step 15 */}
      <div className="lab-experiment-card">
        <div className="experiment-card-header">
          <span className="experiment-title">LOCAL AI EXPERIMENT</span>
          {result && (
            <span className="experiment-latency">
              ⚡ {result.executionMs}ms
            </span>
          )}
        </div>

        <div className="experiment-grid">
          <div className="experiment-row">
            <span className="exp-label">Model:</span>
            <span className="exp-val mono">
              {result?.model || statusInfo?.model || 'Xenova/all-MiniLM-L6-v2 (23MB Quantized ONNX)'}
            </span>
          </div>

          <div className="experiment-row">
            <span className="exp-label">Runtime:</span>
            <span className="exp-val mono">
              {result?.runtime || statusInfo?.runtime || 'ONNX Runtime / Transformers.js (Host CPU Local Inference)'}
            </span>
          </div>

          <div className="experiment-row">
            <span className="exp-label">Status:</span>
            <span className={`exp-val status-val ${(result?.status || statusInfo?.status) === 'Ready' ? 'ready' : 'fallback'}`}>
              {result?.status || statusInfo?.status || 'Ready'}
            </span>
          </div>

          <div className="experiment-row">
            <span className="exp-label">Input:</span>
            <span className="exp-val text-val">
              {result?.input || (inputText ? `"${inputText}"` : 'No input tested yet')}
            </span>
          </div>

          <div className="experiment-row">
            <span className="exp-label">Predicted intent:</span>
            <span className="exp-val">
              {result ? (
                <span className={`intent-badge ${getIntentBadgeColor(result.predictedIntent)}`}>
                  {result.predictedIntent}
                </span>
              ) : (
                <span className="placeholder-dash">—</span>
              )}
            </span>
          </div>

          <div className="experiment-row">
            <span className="exp-label">Confidence:</span>
            <span className="exp-val confidence-val">
              {result ? (
                <>
                  <strong>{Math.round(result.confidence * 100)}%</strong>
                  <div className="confidence-meter-track">
                    <div
                      className="confidence-meter-fill"
                      style={{ width: `${Math.min(Math.max(result.confidence * 100, 10), 100)}%` }}
                    />
                  </div>
                </>
              ) : (
                <span className="placeholder-dash">—</span>
              )}
            </span>
          </div>
        </div>

        {/* Detailed Softmax Distribution (Developer Inspection) */}
        {result?.scores && (
          <div className="scores-breakdown">
            <div className="breakdown-title">Cosine Softmax Probability Distribution:</div>
            <div className="scores-bars">
              {Object.entries(result.scores).map(([intent, score]) => (
                <div key={intent} className="score-bar-item">
                  <span className="score-intent-name">{intent}</span>
                  <div className="score-bar-bg">
                    <div
                      className={`score-bar-bar ${intent === result.predictedIntent ? 'highest' : ''}`}
                      style={{ width: `${Math.round(score * 100)}%` }}
                    />
                  </div>
                  <span className="score-val-label">{Math.round(score * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
