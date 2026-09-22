/**
 * src/components/SharedArtifactViewer.tsx
 * 
 * Student view for materials accessed via QR code scan or shared link (/share/<shareId>).
 * 
 * Supports all three published artifact types:
 * 1. Notes: Student reads teacher material and asks grounded AI questions.
 * 2. Assignment: Student completes questions/exercises, requests AI guidance, and submits answers.
 * 3. Quiz / Test: Student completes assessment questions under test-integrity rules and submits answers.
 */

import React, { useState, useEffect } from 'react';
import {
  PublishedArtifact,
  fetchSharedArtifact,
  submitSharedAnswers,
  askAboutSharedArtifact,
  getDocumentFileUrl,
  fetchDocumentContent,
  isAssessmentModeType,
  startAssessmentSessionApi,
  endAssessmentSessionApi,
} from '../services/teacherService';

export interface SharedArtifactViewerProps {
  shareId: string;
  onBackToStudent: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  sourceDoc?: string;
}

export const SharedArtifactViewer: React.FC<SharedArtifactViewerProps> = ({
  shareId,
  onBackToStudent,
}) => {
  const [artifact, setArtifact] = useState<PublishedArtifact | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Student answer state
  const [studentName, setStudentName] = useState<string>('');
  const [studentId, setStudentId] = useState<string>('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  // Embedded AI chat state
  const [chatQuestion, setChatQuestion] = useState<string>('');
  const [isAskingAi, setIsAskingAi] = useState<boolean>(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [interactionId, setInteractionId] = useState<string>('');

  // Mobile-friendly Notes reader state
  const [showNotesReader, setShowNotesReader] = useState<boolean>(false);
  const [readerText, setReaderText] = useState<string>('');
  const [isLoadingReader, setIsLoadingReader] = useState<boolean>(false);
  const [readerSearchTerm, setReaderSearchTerm] = useState<string>('');
  const [readerViewMode, setReaderViewMode] = useState<'text' | 'pdf'>('text');

  // Load the shared artifact
  useEffect(() => {
    let isMounted = true;
    async function loadArtifact() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await fetchSharedArtifact(shareId);
        if (isMounted) {
          setArtifact(data);
          if (data.documentText) {
            setReaderText(data.documentText);
          }
          // Pre-populate answers dictionary
          const initialAnswers: Record<string, string> = {};
          (data.questions || []).forEach((q) => {
            initialAnswers[q.id] = '';
          });
          setAnswers(initialAnswers);

          // Activate assessment session on backend and client storage if this is an assessment artifact
          if (isAssessmentModeType(data.type)) {
            startAssessmentSessionApi({
              shareId: data.shareId,
              artifactType: data.type,
              artifactTitle: data.title,
            });
          }
        }
      } catch (err) {
        if (isMounted) {
          setErrorMessage(err instanceof Error ? err.message : `Failed to load material for code "${shareId}"`);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadArtifact();
    return () => {
      isMounted = false;
      endAssessmentSessionApi({ shareId });
    };
  }, [shareId]);

  // Handle radio selection for quiz
  const handleSelectOption = (questionId: string, option: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: option,
    }));
  };

  // Handle text input for short answers
  const handleTextAnswer = (questionId: string, text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: text,
    }));
  };

  // Explicitly return to Student Mode and end assessment session
  const handleExitToStudent = async () => {
    await endAssessmentSessionApi({ shareId });
    onBackToStudent();
  };

  // Submit student answers
  const handleSubmitAnswers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim()) {
      alert('Please enter your full name before submitting.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitSharedAnswers(shareId, {
        studentName: studentName.trim(),
        studentId: studentId.trim() || undefined,
        answers,
      });
      setIsSubmitted(true);
      setSubmissionId(res.submissionId);
      // End active assessment session and restore normal AI capabilities
      await endAssessmentSessionApi({ shareId });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to submit answers.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Ask grounded AI question
  const handleAskAi = async (questionText?: string) => {
    const q = (questionText || chatQuestion).trim();
    if (!q || isAskingAi) return;

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatHistory((prev) => [...prev, userMsg]);
    setChatQuestion('');
    setIsAskingAi(true);

    try {
      const res = await askAboutSharedArtifact(shareId, q, interactionId || undefined, isSubmitted);
      if (res.interactionId) {
        setInteractionId(res.interactionId);
      }

      const detectedSourceDoc =
        (Array.isArray(res.sources) && res.sources.length > 0 && (res.sources[0]?.filename || res.sources[0]?.documentId)) ||
        artifact?.documentFilename ||
        artifact?.documentId ||
        undefined;

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        text: res.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sourceDoc: detectedSourceDoc,
      };
      setChatHistory((prev) => [...prev, aiMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        text: err instanceof Error ? err.message : 'Unable to answer at the moment. Please try again.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatHistory((prev) => [...prev, errorMsg]);
    } finally {
      setIsAskingAi(false);
    }
  };

  // Open mobile document viewer / reader
  const handleOpenNotesReader = async () => {
    setShowNotesReader(true);
    if (readerText) return;
    if (artifact?.documentText) {
      setReaderText(artifact.documentText);
      return;
    }
    if (artifact?.documentId) {
      setIsLoadingReader(true);
      try {
        const contentData = await fetchDocumentContent(artifact.documentId);
        setReaderText(contentData.text || '');
      } catch (err) {
        console.error('Failed to fetch document content:', err);
        setReaderText(artifact.content || 'Unable to load text preview.');
      } finally {
        setIsLoadingReader(false);
      }
    } else if (artifact?.content) {
      setReaderText(artifact.content);
    }
  };

  // Filter sections for mobile text reader
  const rawContentToRead = readerText || artifact?.documentText || artifact?.content || '';
  const readerSections = rawContentToRead
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const filteredSections = readerSearchTerm.trim()
    ? readerSections.filter((s) => s.toLowerCase().includes(readerSearchTerm.toLowerCase()))
    : readerSections;

  if (isLoading) {
    return (
      <div className="shared-viewer-container">
        <div className="shared-loading-card">
          <div className="spinner-dots">
            <span /><span /><span />
          </div>
          <p>Loading teacher shared material...</p>
        </div>
      </div>
    );
  }

  if (errorMessage || !artifact) {
    return (
      <div className="shared-viewer-container">
        <div className="shared-error-card">
          <span className="error-icon">⚠️</span>
          <h3>Material Not Found</h3>
          <p>{errorMessage || `No learning material found for share code: "${shareId}"`}</p>
          <button
            type="button"
            className="back-btn"
            onClick={onBackToStudent}
          >
            ← Back to Student Home
          </button>
        </div>
      </div>
    );
  }

  const normalizedType = (artifact.type || 'notes').toLowerCase();
  const isAssessment = isAssessmentModeType(artifact.type);
  const hasOptions = (artifact.questions || []).some((q) => q.options && q.options.length > 0);
  const isQuiz = (normalizedType === 'quiz' || normalizedType === 'test' || normalizedType === 'exam') && (hasOptions || normalizedType === 'quiz');
  const isAssignment = normalizedType === 'assignment' || ((normalizedType === 'test' || normalizedType === 'exam') && !hasOptions);
  const isNotes = normalizedType === 'notes';
  const typeIcon = isQuiz ? '🧪' : isAssignment ? '📝' : '📚';
  const typeLabel = isQuiz ? 'Quiz / Test' : isAssignment ? 'Assignment' : 'Lecture Notes';
  const hasAttachedDocument = Boolean(
    artifact.documentId &&
    !artifact.documentId.startsWith('doc_shared_') &&
    artifact.documentId.trim() !== ''
  );

  return (
    <div className="shared-viewer-container">
      {/* Top Bar Navigation */}
      <div className="shared-top-nav">
        <button
          type="button"
          className="shared-back-link-btn"
          onClick={handleExitToStudent}
        >
          ← Back to Student Mode
        </button>
        <span className="shared-mode-indicator">
          {isAssessment && !isSubmitted ? '🔒 Assessment Mode' : '📱 Teacher Shared Material'}
        </span>
      </div>

      {/* Artifact Header Banner */}
      <div className="shared-header-card">
        <div className="shared-badge-row">
          <span className="shared-type-pill">
            <span>{typeIcon}</span>
            <span>{typeLabel}</span>
          </span>
          <span className="shared-code-tag">Code: {artifact.shareId}</span>
        </div>
        <h2 className="shared-title">{artifact.title}</h2>
        {artifact.description && (
          <p className="shared-description">{artifact.description}</p>
        )}
      </div>

      {/* ================================================================
          1. NOTES VIEW: Read Notes & Ask Grounded AI Questions
          ================================================================ */}
      {isNotes && (
        <div className="shared-notes-flow">
          {/* Notes Specification Card */}
          <div className="teacher-notes-view-card">
            <div className="notes-view-header-row">
              <span className="notes-header-badge">📚 Teacher Notes</span>
            </div>

            <div className="notes-field-group">
              <span className="notes-field-label">Title:</span>
              <h3 className="notes-material-title">{artifact.title}</h3>
            </div>

            {hasAttachedDocument ? (
              <>
                <div className="notes-field-group">
                  <span className="notes-field-label">Material:</span>
                  <div className="notes-material-filename">
                    <span className="notes-file-icon">📄</span>
                    <span className="notes-file-name">{artifact.documentFilename || artifact.documentId}</span>
                    {artifact.documentPages && (
                      <span className="notes-pages-badge">{artifact.documentPages} {artifact.documentPages === 1 ? 'page' : 'pages'}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="notes-actions-group">
                  <button
                    type="button"
                    className="btn-view-notes"
                    onClick={handleOpenNotesReader}
                  >
                    📖 View Notes
                  </button>
                  <a
                    href={getDocumentFileUrl(artifact.documentId!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-download-notes"
                    download={artifact.documentFilename || artifact.documentId}
                  >
                    ⬇️ Open / Download
                  </a>
                </div>
              </>
            ) : (
              <div className="no-material-box">
                <p className="no-material-text">No teacher material was attached to this note.</p>
                {artifact.content && (
                  <div className="notes-content-preview">
                    {artifact.content.split('\n\n').map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Grounded AI Interactive Chat on Notes */}
          <div className="shared-ai-chat-section">
            <div className="ai-chat-header">
              <span>🧠 Ask ByteMind About These Notes</span>
              {hasAttachedDocument ? (
                <span className="grounded-badge">
                  <span className="grounded-dot">●</span> Grounded in: <strong>{artifact.documentFilename || artifact.documentId}</strong>
                </span>
              ) : (
                <span className="grounded-badge general">
                  <span>🧠 ByteMind Learning Assistant</span>
                </span>
              )}
            </div>

            {/* Quick Prompt Chips */}
            <div className="shared-prompt-chips">
              <button
                type="button"
                className="shared-prompt-chip"
                onClick={() => handleAskAi("Explain 2NF using my teacher's notes.")}
                disabled={isAskingAi}
              >
                💡 Explain 2NF
              </button>
              <button
                type="button"
                className="shared-prompt-chip"
                onClick={() => handleAskAi("Summarize the key takeaways from my teacher's notes.")}
                disabled={isAskingAi}
              >
                📋 Key takeaways
              </button>
              <button
                type="button"
                className="shared-prompt-chip"
                onClick={() => handleAskAi("What are the most important formulas or definitions in these notes?")}
                disabled={isAskingAi}
              >
                🔍 Key definitions
              </button>
            </div>

            {/* Conversation History */}
            {chatHistory.length > 0 && (
              <div className="shared-chat-messages">
                {chatHistory.map((msg) => (
                  <div key={msg.id} className={`shared-msg-bubble ${msg.role}`}>
                    <div className="msg-author">
                      {msg.role === 'user' ? '👤 You' : '🧠 ByteMind AI Mentor'}
                      <span className="msg-time">{msg.timestamp}</span>
                    </div>
                    <div className="msg-content">{msg.text}</div>
                    {msg.role === 'assistant' && (
                      <div className="msg-grounded-citation">
                        <span className="citation-label">Grounded in:</span>
                        <strong className="citation-target">
                          {msg.sourceDoc || artifact.documentFilename || artifact.documentId || 'Teacher Notes'}
                        </strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Input Box */}
            <form
              className="shared-ask-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleAskAi();
              }}
            >
              <input
                type="text"
                className="shared-ask-input"
                placeholder="Ask a question about these notes..."
                value={chatQuestion}
                onChange={(e) => setChatQuestion(e.target.value)}
                disabled={isAskingAi}
              />
              <button
                type="submit"
                className="shared-ask-submit"
                disabled={isAskingAi || !chatQuestion.trim()}
              >
                {isAskingAi ? 'Thinking...' : 'Ask AI'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* In-App Mobile-Friendly Document Viewer / Reader Modal */}
      {showNotesReader && (
        <div className="notes-reader-backdrop" onClick={() => setShowNotesReader(false)}>
          <div className="notes-reader-modal" onClick={(e) => e.stopPropagation()}>
            <div className="reader-header">
              <div className="reader-header-info">
                <span className="reader-header-icon">📖</span>
                <div>
                  <h3 className="reader-header-title">{artifact.title}</h3>
                  <div className="reader-header-sub">
                    <span className="reader-doc-name">{artifact.documentFilename || artifact.documentId || 'Teacher Notes'}</span>
                    {artifact.documentPages && (
                      <span className="reader-pages-tag">{artifact.documentPages} pages</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="reader-header-actions">
                {artifact.documentId && (
                  <a
                    href={getDocumentFileUrl(artifact.documentId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="reader-action-btn download"
                    download={artifact.documentFilename || artifact.documentId}
                    title="Open or Download original file"
                  >
                    ⬇️ Download
                  </a>
                )}
                <button
                  type="button"
                  className="reader-action-btn close"
                  onClick={() => setShowNotesReader(false)}
                  title="Close viewer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* If PDF available, show Reader mode switcher */}
            {artifact.hasFile && (
              <div className="reader-mode-switch">
                <button
                  type="button"
                  className={`reader-mode-tab ${readerViewMode === 'text' ? 'active' : ''}`}
                  onClick={() => setReaderViewMode('text')}
                >
                  📱 Mobile Reader
                </button>
                <button
                  type="button"
                  className={`reader-mode-tab ${readerViewMode === 'pdf' ? 'active' : ''}`}
                  onClick={() => setReaderViewMode('pdf')}
                >
                  📄 Document View
                </button>
              </div>
            )}

            {/* Search filter for notes */}
            {readerViewMode === 'text' && (
              <div className="reader-search-bar">
                <input
                  type="text"
                  className="reader-search-input"
                  placeholder="🔍 Search in teacher's notes..."
                  value={readerSearchTerm}
                  onChange={(e) => setReaderSearchTerm(e.target.value)}
                />
                {readerSearchTerm && (
                  <button
                    type="button"
                    className="reader-search-clear"
                    onClick={() => setReaderSearchTerm('')}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {/* Reader Content Body */}
            <div className="reader-body">
              {isLoadingReader ? (
                <div className="reader-loading-state">
                  <div className="spinner-dots"><span/><span/><span/></div>
                  <p>Loading teacher study material...</p>
                </div>
              ) : readerViewMode === 'pdf' && artifact.documentId ? (
                <div className="reader-pdf-container">
                  <iframe
                    src={getDocumentFileUrl(artifact.documentId)}
                    title="Teacher Document Viewer"
                    className="reader-pdf-iframe"
                  />
                </div>
              ) : (
                <div className="reader-text-container">
                  {filteredSections.length > 0 ? (
                    filteredSections.map((section, idx) => (
                      <div key={idx} className="reader-paragraph-block">
                        {section}
                      </div>
                    ))
                  ) : (
                    <div className="reader-empty-search">
                      <p>No sections matching &ldquo;{readerSearchTerm}&rdquo;</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Reader Footer Bar with quick AI question */}
            <div className="reader-footer-bar">
              <span className="reader-footer-text">💡 Got a question about these notes?</span>
              <button
                type="button"
                className="reader-footer-ask-btn"
                onClick={() => {
                  setShowNotesReader(false);
                  handleAskAi("Explain 2NF using my teacher's notes.");
                }}
              >
                Ask ByteMind AI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          2. ASSIGNMENT VIEW: Questions & Strict Assessment Submission
          ================================================================ */}
      {isAssignment && (
        <div className="shared-assignment-flow">
          {/* Strict Assessment Banner */}
          {!isSubmitted && (
            <div className="assessment-strict-banner">
              <span className="assessment-banner-icon">🔒</span>
              <div className="assessment-banner-content">
                <h3 className="assessment-banner-title">Assessment Mode</h3>
                <p className="assessment-banner-text">AI assistance is disabled while you complete this assessment.</p>
              </div>
            </div>
          )}

          {isSubmitted ? (
            <div className="assessment-submitted-card">
              <div className="submitted-check-circle">✓</div>
              <h3 className="submitted-heading">Assessment submitted successfully.</h3>
              <p className="submitted-subtext">
                Your response has been securely saved. Assessment session is now complete.
              </p>
              {submissionId && (
                <div className="submitted-ref-id">
                  <span>Submission Reference:</span> <code>{submissionId}</code>
                </div>
              )}
              <div className="submitted-actions">
                <button
                  type="button"
                  className="btn-return-to-student"
                  onClick={handleExitToStudent}
                >
                  Return to Student Mode
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Assignment Title & Instructions */}
              {(artifact.instructions || artifact.description) && (
                <div className="assignment-reference-card">
                  <span className="ref-header">📋 Instructions:</span>
                  <p className="ref-body">{artifact.instructions || artifact.description}</p>
                </div>
              )}

              {/* Reference Material if provided */}
              {artifact.content && (
                <div className="assignment-reference-card">
                  <span className="ref-header">📄 Reference Context:</span>
                  <p className="ref-body">{artifact.content}</p>
                </div>
              )}

              {/* Submission Form */}
              <form className="assignment-form" onSubmit={handleSubmitAnswers}>
                <div className="student-identity-group">
                  <div className="student-id-row">
                    <label htmlFor="student-name-input" className="field-label">
                      Student Name <span className="required-star">*</span>
                    </label>
                    <input
                      id="student-name-input"
                      type="text"
                      className="student-name-input"
                      placeholder="Enter your full name"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      required
                      disabled={isSubmitted}
                    />
                  </div>
                  <div className="student-id-row">
                    <label htmlFor="student-id-number" className="field-label">
                      Student ID <span className="optional-tag">(optional)</span>
                    </label>
                    <input
                      id="student-id-number"
                      type="text"
                      className="student-name-input"
                      placeholder="e.g., STU-2026-001"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      disabled={isSubmitted}
                    />
                  </div>
                </div>

                {/* Question list */}
                <div className="assignment-questions-list">
                  {(artifact.questions || []).map((q, idx) => (
                    <div key={q.id} className="assignment-q-card">
                      <span className="q-label">Problem {idx + 1}</span>
                      <p className="q-prompt">{q.prompt}</p>
                      <textarea
                        className="assignment-answer-textarea"
                        rows={3}
                        placeholder="Type your solution or explanation here..."
                        value={answers[q.id] || ''}
                        onChange={(e) => handleTextAnswer(q.id, e.target.value)}
                        required
                        disabled={isSubmitted}
                      />
                    </div>
                  ))}
                </div>

                <button
                  type="submit"
                  className="submit-assignment-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Submitting Assignment...' : '📤 Submit Assignment'}
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {/* ================================================================
          3. QUIZ / TEST VIEW: Assessment, Academic Integrity, & Submission
          ================================================================ */}
      {isQuiz && (
        <div className="shared-quiz-flow">
          {/* Strict Assessment Banner */}
          {!isSubmitted && (
            <div className="assessment-strict-banner">
              <span className="assessment-banner-icon">🔒</span>
              <div className="assessment-banner-content">
                <h3 className="assessment-banner-title">Assessment Mode</h3>
                <p className="assessment-banner-text">AI assistance is disabled while you complete this assessment.</p>
              </div>
            </div>
          )}

          {isSubmitted ? (
            <div className="assessment-submitted-card">
              <div className="submitted-check-circle">✓</div>
              <h3 className="submitted-heading">Assessment submitted successfully.</h3>
              <p className="submitted-subtext">
                Your response has been securely recorded. Assessment session is now complete.
              </p>
              {submissionId && (
                <div className="submitted-ref-id">
                  <span>Submission Reference:</span> <code>{submissionId}</code>
                </div>
              )}
              <div className="submitted-actions">
                <button
                  type="button"
                  className="btn-return-to-student"
                  onClick={handleExitToStudent}
                >
                  Return to Student Mode
                </button>
              </div>
            </div>
          ) : (
            <>
              {(artifact.instructions || artifact.description) && (
                <div className="assignment-reference-card">
                  <span className="ref-header">📋 Instructions:</span>
                  <p className="ref-body">{artifact.instructions || artifact.description}</p>
                </div>
              )}

              <form className="quiz-form" onSubmit={handleSubmitAnswers}>
                <div className="student-identity-group">
                  <div className="student-id-row">
                    <label htmlFor="student-name-quiz" className="field-label">
                      Student Name <span className="required-star">*</span>
                    </label>
                    <input
                      id="student-name-quiz"
                      type="text"
                      className="student-name-input"
                      placeholder="Enter your full name"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      required
                      disabled={isSubmitted}
                    />
                  </div>
                  <div className="student-id-row">
                    <label htmlFor="student-id-quiz-number" className="field-label">
                      Student ID <span className="optional-tag">(optional)</span>
                    </label>
                    <input
                      id="student-id-quiz-number"
                      type="text"
                      className="student-name-input"
                      placeholder="e.g., STU-2026-001"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      disabled={isSubmitted}
                    />
                  </div>
                </div>

                {/* Quiz Questions */}
                <div className="quiz-questions-list">
                  {(artifact.questions || []).map((q, qIndex) => (
                    <div key={q.id} className="quiz-q-card">
                      <div className="quiz-q-header">
                        <span className="quiz-q-num">Question {qIndex + 1}</span>
                      </div>
                      <p className="quiz-q-prompt">{q.prompt}</p>

                      <div className="quiz-options-list">
                        {(q.options || []).map((opt, optIndex) => (
                          <label
                            key={optIndex}
                            className={`quiz-option-label ${answers[q.id] === opt ? 'selected' : ''}`}
                          >
                            <input
                              type="radio"
                              name={`quiz-${q.id}`}
                              value={opt}
                              checked={answers[q.id] === opt}
                              onChange={() => handleSelectOption(q.id, opt)}
                              required
                              disabled={isSubmitted}
                            />
                            <span className="opt-letter">
                              {String.fromCharCode(65 + optIndex)}
                            </span>
                            <span className="opt-text">{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="submit"
                  className="submit-assignment-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Recording Quiz Submission...' : '📤 Submit Quiz'}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
};
