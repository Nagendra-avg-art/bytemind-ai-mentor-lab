/**
 * src/components/ClassroomAssistant.tsx
 * 
 * WHY THIS COMPONENT IS NEEDED:
 * Pre-Hackathon Experiment: Classroom Assistant.
 * 
 * Enables teachers and educators to turn lecture material into structured learning resources:
 * - Summarize Lecture
 * - Identify Topics
 * - Create Assignment
 * - Create Assessment (with private Teacher Answer Key)
 * 
 * DESIGN PRINCIPLES:
 * 1. Dark premium ByteMind visual identity (cyan/purple accents, rounded cards, mobile-first).
 * 2. Reuses existing RAG pipeline and document upload infrastructure.
 * 3. Explicit action execution (never automatically runs all four).
 * 4. Technical telemetry (chunks, vectors, timing) strictly confined to Developer Mode.
 * 5. Clear disclaimer: prototype classroom assistance workflow, not a full LMS.
 */

import React, { useState } from 'react';
import { ClassroomActionResponse, ClassroomIntent } from '../types';
import { sendClassroomAction, fetchAvailableDocuments } from '../services/aiService';
import { StudyMaterial } from './StudentHome';

export interface ClassroomAssistantProps {
  availableDocuments: StudyMaterial[];
  activeDocumentId: string | null;
  onSelectDocument: (docId: string) => void;
  onOpenUploadModal: () => void;
  isDevMode?: boolean;
}

export const ClassroomAssistant: React.FC<ClassroomAssistantProps> = ({
  availableDocuments,
  activeDocumentId,
  onSelectDocument,
  onOpenUploadModal,
  isDevMode = false,
}) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(
    activeDocumentId || (availableDocuments.length > 0 ? availableDocuments[0].id : '')
  );
  const [activeAction, setActiveAction] = useState<ClassroomIntent | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatusText, setLoadingStatusText] = useState<string>('');
  const [result, setResult] = useState<ClassroomActionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devErrorStatus, setDevErrorStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [showTeacherKey, setShowTeacherKey] = useState<boolean>(false);
  const [backendIndexedDocIds, setBackendIndexedDocIds] = useState<Set<string>>(new Set());
  const [isVerifyingDocs, setIsVerifyingDocs] = useState<boolean>(true);
  const [serverReachable, setServerReachable] = useState<boolean>(true);

  // Poll available documents from backend to reflect true storage availability
  const checkBackendAvailability = React.useCallback(async () => {
    try {
      const docs = await fetchAvailableDocuments();
      const idSet = new Set<string>();
      docs.forEach((d) => {
        idSet.add(d.id.toLowerCase());
        idSet.add(d.filename.toLowerCase());
        idSet.add(d.id.toLowerCase().replace(/\.pdf$/, ''));
      });
      setBackendIndexedDocIds(idSet);
      setServerReachable(true);
    } catch (err) {
      console.warn('Backend document verification failed:', err);
      setServerReachable(false);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "ByteMind can't reach the learning server. Check that the phone and laptop are connected to the same network."
      );
    } finally {
      setIsVerifyingDocs(false);
    }
  }, []);

  React.useEffect(() => {
    checkBackendAvailability();
  }, [availableDocuments, checkBackendAvailability]);

  // Sync selected document when prop changes
  React.useEffect(() => {
    if (activeDocumentId && activeDocumentId !== selectedDocId) {
      setSelectedDocId(activeDocumentId);
    }
  }, [activeDocumentId]);

  const isDocReady = React.useMemo(() => {
    if (!selectedDocId) return false;
    const clean = selectedDocId.toLowerCase();
    const cleanNoExt = clean.replace(/\.pdf$/, '');
    return backendIndexedDocIds.has(clean) || backendIndexedDocIds.has(cleanNoExt);
  }, [selectedDocId, backendIndexedDocIds]);

  const handleDocChange = (docId: string) => {
    setSelectedDocId(docId);
    onSelectDocument(docId);
    setResult(null);
    setErrorMessage(null);
    setDevErrorStatus(null);
  };

  const handleRunAction = async (action: ClassroomIntent) => {
    if (!serverReachable) {
      setErrorMessage("ByteMind can't reach the learning server. Check that the phone and laptop are connected to the same network.");
      return;
    }

    if (!selectedDocId) {
      setErrorMessage('Please select or upload a lecture PDF document first.');
      return;
    }

    if (!isDocReady && !isVerifyingDocs) {
      setErrorMessage('Please upload this lecture material before generating classroom resources.');
      return;
    }

    setActiveAction(action);
    setIsLoading(true);
    setErrorMessage(null);
    setDevErrorStatus(null);
    setShowTeacherKey(false);

    let statusText = 'Processing lecture material...';
    if (action === 'CLASSROOM_SUMMARY') statusText = 'Generating structured lecture summary...';
    if (action === 'TOPIC_IDENTIFICATION') statusText = 'Extracting and deconstructing topics...';
    if (action === 'ASSIGNMENT_GENERATION') statusText = 'Curating targeted assignment problems...';
    if (action === 'ASSESSMENT_GENERATION') statusText = 'Creating 5-question assessment and answer key...';
    setLoadingStatusText(statusText);

    try {
      const response = await sendClassroomAction(selectedDocId, action);
      setResult(response);
      setDevErrorStatus(null);
      if (isDevMode) {
        console.log(`[Developer Mode] Gemini status: ${response.geminiStatus || 'AVAILABLE'}`);
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'An error occurred while running the classroom action.';
      const status = err?.geminiStatus || (msg.includes('quota') ? 'QUOTA_EXHAUSTED' : 'ERROR');
      setErrorMessage(msg);
      setDevErrorStatus(status);
      setResult(null);
      if (isDevMode) {
        console.log(`[Developer Mode] Gemini status: ${status}`);
      }
    } finally {
      setIsLoading(false);
      setLoadingStatusText('');
      setActiveAction(null);
    }
  };

  const handleCopyResource = () => {
    if (!result?.output) return;
    navigator.clipboard.writeText(result.output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  // Helper to split assessment into Student Questions and Teacher Answer Key
  const renderAssessmentContent = (content: string) => {
    const keySeparator = '### Teacher Answer Key & Explanations';
    const hasKey = content.includes(keySeparator);

    if (!hasKey) {
      return (
        <div className="classroom-markdown-content">
          <pre className="classroom-pre">{content}</pre>
        </div>
      );
    }

    const [questionsPart, keyPart] = content.split(keySeparator);

    return (
      <div className="assessment-structured-view">
        {/* Student Facing Questions */}
        <div className="student-questions-block">
          <div className="block-header-tag">Student Assessment View</div>
          <pre className="classroom-pre">{questionsPart.trim()}</pre>
        </div>

        {/* Separable / Collapsible Teacher Answer Key */}
        <div className="teacher-key-accordion">
          <button
            type="button"
            className={`teacher-key-toggle-btn ${showTeacherKey ? 'active' : ''}`}
            onClick={() => setShowTeacherKey((prev) => !prev)}
            aria-expanded={showTeacherKey}
          >
            <span className="key-icon" aria-hidden="true">{showTeacherKey ? '🔓' : '🔒'}</span>
            <span className="key-toggle-label">
              {showTeacherKey ? 'Hide Teacher Answer Key' : 'Show Teacher Answer Key (Educator Only)'}
            </span>
            <span className="key-toggle-chevron" aria-hidden="true">{showTeacherKey ? '▲' : '▼'}</span>
          </button>

          {showTeacherKey && (
            <div className="teacher-key-panel">
              <div className="teacher-confidential-banner">
                ⚠️ <strong>Confidential Teacher Section:</strong> Correct answers, grading rationales, and model criteria.
              </div>
              <pre className="classroom-pre">{`### Teacher Answer Key & Explanations\n\n${keyPart.trim()}`}</pre>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="classroom-assistant-container">
      {/* 1. Classroom Header */}
      <header className="classroom-hero-header">
        <div className="classroom-badge-row">
          <span className="classroom-badge">🏫 Classroom Assistant</span>
          <span className="prototype-pill">Experimental Lab Workflow</span>
        </div>
        <h1 className="classroom-title">CLASSROOM ASSISTANT</h1>
        <p className="classroom-subtitle">
          Turn class material into structured learning resources.
        </p>
        <p className="classroom-scope-note">
          Supports lecture summaries, topic identification, assignments, and assessments.
        </p>
      </header>

      {/* 2. Lecture Material Selector & Upload */}
      <section className="card classroom-document-card">
        <div className="section-header-row">
          <div className="section-title-wrap">
            <span className="section-bullet-icon" aria-hidden="true">📑</span>
            <h2 className="section-heading">Class Material</h2>
          </div>
          <button
            type="button"
            className="upload-notes-btn"
            onClick={onOpenUploadModal}
            title="Upload a new lecture PDF"
          >
            <span aria-hidden="true">+</span> Upload Lecture PDF
          </button>
        </div>
        <p className="section-description">
          Select or upload the lecture slides, textbook chapter, or course notes to ground all generated resources.
        </p>

        {availableDocuments.length > 0 ? (
          <div className="classroom-doc-picker">
            <label htmlFor="classroom-doc-select" className="classroom-select-label">
              Active Lecture Document:
            </label>
            <div className="doc-select-wrapper">
              <select
                id="classroom-doc-select"
                className="classroom-doc-dropdown"
                value={selectedDocId}
                onChange={(e) => handleDocChange(e.target.value)}
                disabled={isLoading}
              >
                {availableDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.icon} {doc.title} ({doc.id})
                  </option>
                ))}
              </select>
            </div>
            {selectedDocId && (
              <div className={`selected-doc-status ${isDocReady ? 'ready' : isVerifyingDocs ? 'checking' : 'not-ready'}`}>
                {isVerifyingDocs ? (
                  <>
                    <span className="status-dot pulsing" aria-hidden="true" />
                    <span>Verifying backend storage for <strong>{selectedDocId}</strong>...</span>
                  </>
                ) : isDocReady ? (
                  <>
                    <span className="status-dot green" aria-hidden="true" />
                    <span>Ready for classroom generation: <strong>{selectedDocId}</strong></span>
                  </>
                ) : (
                  <>
                    <span className="status-dot amber" aria-hidden="true" />
                    <span>Please upload this lecture material before generating classroom resources.</span>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="classroom-no-docs">
            <p>No documents uploaded yet.</p>
            <button
              type="button"
              className="primary-upload-cta"
              onClick={onOpenUploadModal}
            >
              📄 Upload Your First Lecture PDF
            </button>
          </div>
        )}
      </section>

      {/* 3. Explicit Classroom Actions Grid */}
      <section className="classroom-actions-section">
        <div className="section-title-wrap">
          <span className="section-bullet-icon" aria-hidden="true">⚡</span>
          <h2 className="section-heading">Classroom Operations</h2>
        </div>
        <p className="section-description">
          Choose an explicit action to generate instructional resources grounded in the selected lecture material:
        </p>

        <div className="classroom-actions-grid">
          {/* Action 1: Summarize Lecture */}
          <button
            type="button"
            className={`classroom-action-card action-summary ${activeAction === 'CLASSROOM_SUMMARY' && isLoading ? 'loading' : ''}`}
            onClick={() => handleRunAction('CLASSROOM_SUMMARY')}
            disabled={isLoading || !selectedDocId || (!isDocReady && !isVerifyingDocs)}
            title="Generate structured lecture summary with topic, key concepts, and takeaways"
          >
            <div className="card-icon-pill icon-blue">
              <span aria-hidden="true">📄</span>
            </div>
            <div className="card-text-block">
              <strong className="card-action-title">Summarize Lecture</strong>
              <span className="card-action-desc">Executive topic summary, key concepts & takeaways</span>
            </div>
            <span className="card-action-arrow" aria-hidden="true">→</span>
          </button>

          {/* Action 2: Identify Topics */}
          <button
            type="button"
            className={`classroom-action-card action-topics ${activeAction === 'TOPIC_IDENTIFICATION' && isLoading ? 'loading' : ''}`}
            onClick={() => handleRunAction('TOPIC_IDENTIFICATION')}
            disabled={isLoading || !selectedDocId || (!isDocReady && !isVerifyingDocs)}
            title="Extract and organize canonical syllabus topics directly from notes"
          >
            <div className="card-icon-pill icon-purple">
              <span aria-hidden="true">🏷️</span>
            </div>
            <div className="card-text-block">
              <strong className="card-action-title">Identify Topics</strong>
              <span className="card-action-desc">Extracted lecture topics & prerequisite hierarchy</span>
            </div>
            <span className="card-action-arrow" aria-hidden="true">→</span>
          </button>

          {/* Action 3: Create Assignment */}
          <button
            type="button"
            className={`classroom-action-card action-assignment ${activeAction === 'ASSIGNMENT_GENERATION' && isLoading ? 'loading' : ''}`}
            onClick={() => handleRunAction('ASSIGNMENT_GENERATION')}
            disabled={isLoading || !selectedDocId || (!isDocReady && !isVerifyingDocs)}
            title="Generate 3-4 focused student assignment problems"
          >
            <div className="card-icon-pill icon-amber">
              <span aria-hidden="true">📝</span>
            </div>
            <div className="card-text-block">
              <strong className="card-action-title">Create Assignment</strong>
              <span className="card-action-desc">Focused student assignment tasks grounded in notes</span>
            </div>
            <span className="card-action-arrow" aria-hidden="true">→</span>
          </button>

          {/* Action 4: Create Assessment */}
          <button
            type="button"
            className={`classroom-action-card action-assessment ${activeAction === 'ASSESSMENT_GENERATION' && isLoading ? 'loading' : ''}`}
            onClick={() => handleRunAction('ASSESSMENT_GENERATION')}
            disabled={isLoading || !selectedDocId || (!isDocReady && !isVerifyingDocs)}
            title="Generate 5-question assessment with private Teacher Answer Key"
          >
            <div className="card-icon-pill icon-emerald">
              <span aria-hidden="true">🎯</span>
            </div>
            <div className="card-text-block">
              <strong className="card-action-title">Create Assessment</strong>
              <span className="card-action-desc">5 questions (MCQ + Short Answer) + Teacher Answer Key</span>
            </div>
            <span className="card-action-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      {/* Loading Indicator */}
      {isLoading && (
        <div className="classroom-loading-card">
          <div className="classroom-spinner" aria-hidden="true" />
          <div className="loading-copy">
            <strong>ByteMind Classroom Agent in progress...</strong>
            <span>{loadingStatusText || 'Retrieving lecture chunks & generating resource...'}</span>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="classroom-error-banner" role="alert">
          <span className="error-icon" aria-hidden="true">⚠️</span>
          <div className="error-text">
            <strong>Error:</strong> {errorMessage}
            {isDevMode && devErrorStatus && (
              <div className="classroom-dev-error-status" style={{ marginTop: '0.4rem', fontSize: '0.78rem', opacity: 0.9 }}>
                <code>[Developer Mode] Gemini status: {devErrorStatus}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Generated Resource Result */}
      {result && !isLoading && (
        <section className="card classroom-result-card">
          <div className="result-header-bar">
            <div className="result-title-group">
              <span className="result-icon-pill">
                {result.intent === 'CLASSROOM_SUMMARY' && '📄'}
                {result.intent === 'TOPIC_IDENTIFICATION' && '🏷️'}
                {result.intent === 'ASSIGNMENT_GENERATION' && '📝'}
                {result.intent === 'ASSESSMENT_GENERATION' && '🎯'}
              </span>
              <div>
                <h3 className="result-action-heading">
                  {result.intent === 'CLASSROOM_SUMMARY' && 'Lecture Summary'}
                  {result.intent === 'TOPIC_IDENTIFICATION' && 'Topics Covered'}
                  {result.intent === 'ASSIGNMENT_GENERATION' && 'Student Assignment'}
                  {result.intent === 'ASSESSMENT_GENERATION' && 'Classroom Assessment'}
                </h3>
                <span className="result-grounding-sub">
                  Grounded in: <strong>{result.documentUsed || result.documentId}</strong>
                </span>
              </div>
            </div>

            <button
              type="button"
              className="copy-resource-btn"
              onClick={handleCopyResource}
              title="Copy markdown to clipboard"
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>

          {/* Render content: special structured view for assessments */}
          <div className="result-content-body">
            {result.intent === 'ASSESSMENT_GENERATION'
              ? renderAssessmentContent(result.output)
              : (
                <div className="classroom-markdown-content">
                  <pre className="classroom-pre">{result.output}</pre>
                </div>
              )}
          </div>

          {/* 5. Developer Mode Telemetry (Only rendered in Developer Mode) */}
          {isDevMode && (
            <div className="classroom-dev-telemetry">
              <div className="telemetry-header">
                🛠️ <strong>Developer Mode Diagnostics</strong>
              </div>
              <div className="telemetry-grid">
                <div className="telemetry-item">
                  <span className="telemetry-label">Gemini Status:</span>
                  <code className="telemetry-value">{result.geminiStatus || 'AVAILABLE'}</code>
                </div>
                <div className="telemetry-item">
                  <span className="telemetry-label">Intent:</span>
                  <code className="telemetry-value">{result.intent}</code>
                </div>
                <div className="telemetry-item">
                  <span className="telemetry-label">Document Used:</span>
                  <code className="telemetry-value">{result.documentUsed}</code>
                </div>
                <div className="telemetry-item">
                  <span className="telemetry-label">Retrieved Chunks:</span>
                  <code className="telemetry-value">{result.retrievedChunks} chunks</code>
                </div>
                <div className="telemetry-item">
                  <span className="telemetry-label">Execution Time:</span>
                  <code className="telemetry-value">{result.executionMs}ms</code>
                </div>
              </div>
              {result.sources && result.sources.length > 0 && (
                <div className="telemetry-sources">
                  <span className="telemetry-label">Source Chunks:</span>
                  <div className="sources-list">
                    {result.sources.map((s, idx) => (
                      <div key={idx} className="source-item">
                        <span>Chunk #{s.chunkIndex ?? idx} ({s.documentId})</span>
                        {s.textPreview && <small>{s.textPreview.slice(0, 100)}...</small>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default ClassroomAssistant;
