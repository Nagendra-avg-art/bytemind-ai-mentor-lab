/**
 * src/components/TeacherHub.tsx
 * 
 * ByteMind Teacher Hub: "Help me create and distribute learning."
 * 
 * Enables teachers and educators to:
 * 1. Create and publish 3 artifact types: Notes, Assignments, and Quizzes/Tests.
 * 2. Generate instant QR codes and short share links (/share/<shareId>).
 * 3. Inspect published materials and view student submissions.
 * 
 * Designed mobile-first for comfortable use on physical phone screens (e.g. iQOO).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  PublishedArtifact,
  SubmissionRecord,
  QuestionItem,
  fetchPublishedArtifacts,
  createPublishedArtifact,
  fetchSubmissions,
  getOrCreateTeacherId,
} from '../services/teacherService';
import { StudyMaterial } from './StudentHome';
import { QRCodeDisplay } from './QRCodeDisplay';

export interface TeacherHubProps {
  availableDocuments: StudyMaterial[];
  activeDocumentId: string | null;
  onSelectDocument: (docId: string) => void;
  onOpenUploadModal: () => void;
  onExitToStudent?: () => void;
}

type TabMode = 'create' | 'published' | 'submissions';
type ArtifactType = 'notes' | 'assignment' | 'quiz';

export const TeacherHub: React.FC<TeacherHubProps> = ({
  availableDocuments,
  activeDocumentId,
  onSelectDocument,
  onOpenUploadModal,
  onExitToStudent,
}) => {
  const teacherId = getOrCreateTeacherId();
  const [activeTab, setActiveTab] = useState<TabMode>('create');

  // Form states for Create Material
  const [selectedType, setSelectedType] = useState<ArtifactType>('quiz');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string>(activeDocumentId || '');
  const [customShareId, setCustomShareId] = useState<string>('');
  const [allowAiAssistance, setAllowAiAssistance] = useState<boolean>(true);

  // Dynamic question list for quizzes and assignments
  const [questions, setQuestions] = useState<QuestionItem[]>([
    {
      id: 'q1',
      prompt: '',
      type: 'multiple_choice',
      options: ['', '', '', ''],
      correctAnswer: '',
    },
  ]);

  // Server state
  const [publishedList, setPublishedList] = useState<PublishedArtifact[]>([]);
  const [submissionsList, setSubmissionsList] = useState<SubmissionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // QR Modal and Published Card action states
  const [activeQrArtifact, setActiveQrArtifact] = useState<PublishedArtifact | null>(null);
  const [isNewlyPublished, setIsNewlyPublished] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sync selected document when prop changes
  useEffect(() => {
    if (activeDocumentId) {
      setSelectedDocId(activeDocumentId);
    }
  }, [activeDocumentId]);

  // Load published artifacts and submissions
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [artifacts, subs] = await Promise.all([
        fetchPublishedArtifacts(),
        fetchSubmissions(),
      ]);
      setPublishedList(artifacts);
      setSubmissionsList(subs);
    } catch (err) {
      console.warn('Teacher Hub data load warning:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load teacher data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Question builder helpers
  const handleAddQuestion = () => {
    const nextId = `q${questions.length + 1}`;
    setQuestions([
      ...questions,
      {
        id: nextId,
        prompt: '',
        type: 'multiple_choice',
        options: ['', '', '', ''],
        correctAnswer: '',
      },
    ]);
  };

  const handleUpdateQuestion = (index: number, field: keyof QuestionItem, value: any) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], [field]: value };
    setQuestions(updated);
  };

  const handleUpdateOption = (qIndex: number, optIndex: number, value: string) => {
    const updated = [...questions];
    const opts = [...(updated[qIndex].options || ['', '', '', ''])];
    opts[optIndex] = value;
    updated[qIndex].options = opts;
    setQuestions(updated);
  };

  const handleRemoveQuestion = (index: number) => {
    if (questions.length <= 1) return;
    setQuestions(questions.filter((_, i) => i !== index));
  };

  // Publish material
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage('Please enter a title for the learning material.');
      return;
    }

    setIsPublishing(true);
    setErrorMessage(null);

    try {
      // Filter out blank questions
      const cleanedQuestions =
        selectedType === 'notes'
          ? []
          : questions.filter((q) => q.prompt && q.prompt.trim().length > 0);

      const created = await createPublishedArtifact({
        type: selectedType,
        title: title.trim(),
        description: description.trim(),
        instructions: description.trim(),
        content: content.trim(),
        documentId: selectedDocId || null,
        questions: cleanedQuestions,
        allowAiAssistance,
        customShareId: customShareId.trim() || undefined,
      });

      // Show QR display immediately with success confirmation
      setIsNewlyPublished(true);
      setActiveQrArtifact(created);

      // Refresh published list
      await loadData();

      // Reset form fields
      setTitle('');
      setDescription('');
      setContent('');
      setCustomShareId('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to publish material');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="teacher-hub-container">
      {/* Teacher Hub Hero & Banner */}
      <div className="teacher-hub-header">
        <div className="teacher-hub-header-top">
          <div className="teacher-hub-badge">
            <span>👨‍🏫</span>
            <span>ByteMind Teacher Hub • ID: {teacherId}</span>
          </div>
          {onExitToStudent && (
            <button
              type="button"
              className="teacher-return-student-btn"
              onClick={onExitToStudent}
              title="Return to Student Mode"
            >
              🎓 Student Mode
            </button>
          )}
        </div>
        <h2 className="teacher-hub-title">Create & Distribute Learning</h2>
        <p className="teacher-hub-subtitle">
          Publish notes, assignments, and quizzes. Distribute via lightweight QR codes for phone scanning.
        </p>

        {/* 3 Navigation Tabs */}
        <div className="teacher-nav-tabs" role="tablist">
          <button
            type="button"
            className={`teacher-nav-tab ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
            role="tab"
            aria-selected={activeTab === 'create'}
          >
            ➕ Create Material
          </button>
          <button
            type="button"
            className={`teacher-nav-tab ${activeTab === 'published' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('published');
              loadData();
            }}
            role="tab"
            aria-selected={activeTab === 'published'}
          >
            📂 Published ({publishedList.length})
          </button>
          <button
            type="button"
            className={`teacher-nav-tab ${activeTab === 'submissions' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('submissions');
              loadData();
            }}
            role="tab"
            aria-selected={activeTab === 'submissions'}
          >
            📥 Submissions ({submissionsList.length})
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="teacher-error-banner" role="alert">
          <span>⚠️</span>
          <span>{errorMessage}</span>
          <button
            type="button"
            className="error-dismiss-btn"
            onClick={() => setErrorMessage(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ================================================================
          TAB 1: CREATE LEARNING MATERIAL
          ================================================================ */}
      {activeTab === 'create' && (
        <div className="teacher-create-section">
          {/* 1. Select Artifact Type Cards */}
          <div className="artifact-type-selector">
            <span className="section-step-label">1. Choose Artifact Type</span>
            <div className="artifact-type-grid">
              <button
                type="button"
                className={`artifact-type-card ${selectedType === 'notes' ? 'active' : ''}`}
                onClick={() => setSelectedType('notes')}
              >
                <div className="artifact-card-icon">📘</div>
                <div className="artifact-card-info">
                  <div className="artifact-card-title">Notes</div>
                  <div className="artifact-card-desc">Syllabus notes, formulas, and concept explanations</div>
                </div>
              </button>

              <button
                type="button"
                className={`artifact-type-card ${selectedType === 'assignment' ? 'active' : ''}`}
                onClick={() => setSelectedType('assignment')}
              >
                <div className="artifact-card-icon">📝</div>
                <div className="artifact-card-info">
                  <div className="artifact-card-title">Assignment</div>
                  <div className="artifact-card-desc">Problem sets & exercises with grounded AI hints</div>
                </div>
              </button>

              <button
                type="button"
                className={`artifact-type-card ${selectedType === 'quiz' ? 'active' : ''}`}
                onClick={() => setSelectedType('quiz')}
              >
                <div className="artifact-card-icon">🧠</div>
                <div className="artifact-card-info">
                  <div className="artifact-card-title">Quiz / Test</div>
                  <div className="artifact-card-desc">Assessments with Socratic test-integrity protections</div>
                </div>
              </button>
            </div>
          </div>

          {/* 2. Content & Details Form */}
          <form className="teacher-create-form" onSubmit={handlePublish}>
            <span className="section-step-label">2. Material Details</span>

            {/* Title */}
            <div className="form-group">
              <label htmlFor="material-title" className="teacher-field-label">
                Material Title <span className="required-star">*</span>
              </label>
              <input
                id="material-title"
                type="text"
                className="teacher-input-text"
                placeholder={
                  selectedType === 'quiz'
                    ? 'e.g., DBMS Normalization Diagnostic Quiz'
                    : selectedType === 'assignment'
                    ? 'e.g., Machine Learning Optimization Homework'
                    : 'e.g., Operating Systems Concurrency Cheat Sheet'
                }
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            {/* Reference Study Document */}
            <div className="form-group">
              <div className="doc-select-header">
                <label htmlFor="doc-reference" className="teacher-field-label">
                  Link to Study Material (Optional)
                </label>
                <button
                  type="button"
                  className="upload-link-btn"
                  onClick={onOpenUploadModal}
                >
                  + Upload PDF
                </button>
              </div>
              <select
                id="doc-reference"
                className="teacher-select"
                value={selectedDocId}
                onChange={(e) => {
                  setSelectedDocId(e.target.value);
                  onSelectDocument(e.target.value);
                }}
              >
                <option value="">No linked PDF (use text notes below)</option>
                {availableDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    📄 {doc.title || doc.id}
                  </option>
                ))}
              </select>
            </div>

            {/* Description / Instructions */}
            <div className="form-group">
              <label htmlFor="material-instructions" className="teacher-field-label">
                Instructions / Description
              </label>
              <input
                id="material-instructions"
                type="text"
                className="teacher-input-text"
                placeholder="Brief summary or guidelines for students"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Content Textarea (for Notes or general content) */}
            <div className="form-group">
              <label htmlFor="material-content" className="teacher-field-label">
                {selectedType === 'notes' ? 'Notes / Lecture Content' : 'Reference Content / Problem Context'}
              </label>
              <textarea
                id="material-content"
                className="teacher-textarea"
                rows={4}
                placeholder="Enter or paste key definitions, formulas, or reference content..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            {/* 3. Question Builder (for Quiz and Assignment) */}
            {(selectedType === 'quiz' || selectedType === 'assignment') && (
              <div className="questions-builder-section">
                <div className="questions-header-row">
                  <span className="section-step-label">
                    3. {selectedType === 'quiz' ? 'Quiz Questions' : 'Assignment Questions'} ({questions.length})
                  </span>
                  <button
                    type="button"
                    className="add-question-btn"
                    onClick={handleAddQuestion}
                  >
                    + Add Question
                  </button>
                </div>

                {questions.map((q, qIndex) => (
                  <div key={q.id} className="question-edit-card">
                    <div className="question-card-top">
                      <span className="question-number-badge">Q{qIndex + 1}</span>
                      {questions.length > 1 && (
                        <button
                          type="button"
                          className="remove-q-btn"
                          onClick={() => handleRemoveQuestion(qIndex)}
                          title="Remove question"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="form-group">
                      <input
                        type="text"
                        className="teacher-input-text question-prompt-input"
                        placeholder="Enter the question prompt..."
                        value={q.prompt}
                        onChange={(e) => handleUpdateQuestion(qIndex, 'prompt', e.target.value)}
                        required
                      />
                    </div>

                    {/* Options if Quiz */}
                    {selectedType === 'quiz' && (
                      <div className="options-grid">
                        {(q.options || ['', '', '', '']).map((opt, optIndex) => (
                          <div key={optIndex} className="option-row">
                            <span className="option-letter">
                              {String.fromCharCode(65 + optIndex)}.
                            </span>
                            <input
                              type="text"
                              className="teacher-input-text option-input"
                              placeholder={`Option ${String.fromCharCode(65 + optIndex)}`}
                              value={opt}
                              onChange={(e) => handleUpdateOption(qIndex, optIndex, e.target.value)}
                              required
                            />
                            <label className="correct-radio-label">
                              <input
                                type="radio"
                                name={`correct-${q.id}`}
                                checked={q.correctAnswer === opt && opt !== ''}
                                onChange={() => handleUpdateQuestion(qIndex, 'correctAnswer', opt)}
                              />
                              <span>Correct</span>
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Custom Share ID (Optional) */}
            <div className="form-group">
              <label htmlFor="custom-share-id" className="teacher-field-label">
                Custom Share Code (Optional)
              </label>
              <input
                id="custom-share-id"
                type="text"
                className="teacher-input-text"
                placeholder="e.g., BM-X7K29P (leave blank to auto-generate)"
                value={customShareId}
                onChange={(e) => setCustomShareId(e.target.value)}
              />
            </div>

            {/* AI Policy */}
            <div className="ai-policy-toggle-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={allowAiAssistance}
                  onChange={(e) => setAllowAiAssistance(e.target.checked)}
                />
                <span>Allow Grounded AI Learning Assistance</span>
              </label>
              <span className="policy-note">
                {selectedType === 'quiz'
                  ? '🔒 Test Integrity: ByteMind explains concepts/instructions, but will refuse direct solutions.'
                  : '💡 Grounded in teacher material'}
              </span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="publish-submit-btn"
              disabled={isPublishing}
            >
              {isPublishing ? (
                <>
                  <span className="btn-spinner" aria-hidden="true" />
                  <span>Publishing & Generating QR...</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>Publish & Generate QR</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* ================================================================
          TAB 2: PUBLISHED MATERIALS
          ================================================================ */}
      {activeTab === 'published' && (
        <div className="teacher-published-section">
          {isLoading ? (
            <div className="loading-state-card">
              <div className="spinner-dots">
                <span /><span /><span />
              </div>
              <p>Loading published materials...</p>
            </div>
          ) : publishedList.length === 0 ? (
            <div className="empty-state-card">
              <span className="empty-icon">📂</span>
              <h3>No published materials yet</h3>
              <p>Create your first note, assignment, or quiz.</p>
              <button
                type="button"
                className="create-shortcut-btn"
                onClick={() => setActiveTab('create')}
              >
                + Create Learning Material
              </button>
            </div>
          ) : (
            <div className="published-cards-list">
              {publishedList.map((item) => {
                const normType = (item.type || '').toLowerCase();
                const icon = normType === 'quiz' ? '🧠' : normType === 'assignment' ? '📝' : '📘';
                const typeName = normType === 'quiz' ? 'Quiz / Test' : normType === 'assignment' ? 'Assignment' : 'Notes';

                return (
                  <div key={item.id} className="published-item-card">
                    <div className="item-card-top">
                      <div className="item-badge">
                        <span>{icon}</span>
                        <span>{typeName}</span>
                      </div>
                      <span className="item-date">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <h4 className="item-title">{item.title}</h4>
                    {item.description && (
                      <p className="item-desc">{item.description}</p>
                    )}

                    <div className="item-code-bar">
                      <span className="code-label">Share Code:</span>
                      <code className="code-value">{item.shareId}</code>
                    </div>

                    <div className="item-actions">
                      <button
                        type="button"
                        className="item-btn btn-show-qr"
                        onClick={() => {
                          setIsNewlyPublished(false);
                          setActiveQrArtifact(item);
                        }}
                      >
                        📷 Show QR
                      </button>
                      <button
                        type="button"
                        className="item-btn btn-copy-link"
                        onClick={async () => {
                          const url = `https://bytemind-ai-mentor-lab.onrender.com/share/${item.shareId}`;
                          try {
                            if (navigator.clipboard) {
                              await navigator.clipboard.writeText(url);
                            } else {
                              const input = document.createElement('input');
                              input.value = url;
                              document.body.appendChild(input);
                              input.select();
                              document.execCommand('copy');
                              document.body.removeChild(input);
                            }
                            setCopiedId(item.shareId);
                            setTimeout(() => setCopiedId(null), 2000);
                          } catch (e) {
                            console.warn('Copy failed', e);
                          }
                        }}
                      >
                        {copiedId === item.shareId ? '✓ Copied!' : '📋 Copy Link'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================================================================
          TAB 3: STUDENT SUBMISSIONS
          ================================================================ */}
      {activeTab === 'submissions' && (
        <div className="teacher-submissions-section">
          {isLoading ? (
            <div className="loading-state-card">
              <div className="spinner-dots">
                <span /><span /><span />
              </div>
              <p>Loading student submissions...</p>
            </div>
          ) : submissionsList.length === 0 ? (
            <div className="empty-state-card">
              <span className="empty-icon">📥</span>
              <h3>No submissions yet</h3>
              <p>Student submissions will appear here after students submit.</p>
            </div>
          ) : (
            <div className="submissions-list">
              {submissionsList.map((sub) => (
                <div key={sub.submissionId} className="submission-card">
                  <div className="submission-card-header">
                    <div className="submission-title-group">
                      <span className="sub-type-badge">
                        {(sub.artifactType || '').toLowerCase() === 'quiz' ? '🧠 Quiz' : '📝 Assignment'}
                      </span>
                      <h4 className="sub-artifact-title">{sub.artifactTitle}</h4>
                    </div>
                    <span className="sub-time">
                      {new Date(sub.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="sub-student-row">
                    <span className="sub-label">Student:</span>
                    <strong className="sub-student-name">
                      {sub.studentName} {sub.studentId ? `(ID: ${sub.studentId})` : ''}
                    </strong>
                    <span className="sub-status-pill">✓ {sub.status}</span>
                  </div>

                  {/* Submitted answers preview */}
                  <div className="sub-answers-box">
                    <span className="answers-header-label">Submitted Answers:</span>
                    <div className="answers-grid">
                      {Object.entries(sub.answers || {}).map(([key, val]) => (
                        <div key={key} className="answer-item">
                          <span className="answer-key">{key}:</span>
                          <span className="answer-val">{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* QR Code Modal Display */}
      {activeQrArtifact && (
        <div className="qr-modal-backdrop" onClick={() => setActiveQrArtifact(null)}>
          <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
            <QRCodeDisplay
              shareId={activeQrArtifact.shareId}
              title={activeQrArtifact.title}
              type={activeQrArtifact.type}
              isNewlyPublished={isNewlyPublished}
              onClose={() => setActiveQrArtifact(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
