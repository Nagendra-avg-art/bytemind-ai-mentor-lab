/**
 * src/components/CoachActionModal.tsx
 * 
 * Interactive configuration modal/sheet for ByteMind's Learning Coach workflows.
 * Replaces instant artificial question dispatch with user-guided workflow setup:
 * - Explain: Topic, concept depth, analogy preferences.
 * - Revise: Timeline, high-yield checklists, exam schedules.
 * - Practice: Difficulty, problem count, topic focus.
 * - Quiz: Question count, diagnostic focus, exam simulation.
 */

import React, { useState, useEffect } from 'react';

export type CoachActionType = 'Explain' | 'Revise' | 'Practice' | 'Quiz';

export interface CoachActionModalProps {
  isOpen: boolean;
  initialAction: CoachActionType;
  activeDocumentId: string | null;
  currentDraftQuestion?: string;
  isExecuting?: boolean;
  onClose: () => void;
  onStartWorkflow: (action: CoachActionType, goalPrompt: string) => Promise<void> | void;
}

export const CoachActionModal: React.FC<CoachActionModalProps> = ({
  isOpen,
  initialAction,
  activeDocumentId,
  currentDraftQuestion = '',
  isExecuting = false,
  onClose,
  onStartWorkflow,
}) => {
  const [selectedAction, setSelectedAction] = useState<CoachActionType>(initialAction);

  // General topic / focus state
  const [topic, setTopic] = useState<string>('');

  // Explain-specific configuration
  const [explainDepth, setExplainDepth] = useState<'foundational' | 'deep' | 'exam'>('foundational');

  // Revise-specific configuration
  const [revisionDuration, setRevisionDuration] = useState<'quick' | '1day' | '3day'>('1day');

  // Practice-specific configuration
  const [practiceDifficulty, setPracticeDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [practiceCount, setPracticeCount] = useState<number>(3);

  // Quiz-specific configuration
  const [quizCount, setQuizCount] = useState<number>(3);
  const [quizType, setQuizType] = useState<'diagnostic' | 'exam' | 'challenge'>('diagnostic');

  // Sync action when opened
  useEffect(() => {
    if (isOpen) {
      setSelectedAction(initialAction);
      if (currentDraftQuestion.trim()) {
        setTopic(currentDraftQuestion.trim());
      } else if (activeDocumentId) {
        setTopic(activeDocumentId.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
      } else {
        setTopic('');
      }
    }
  }, [isOpen, initialAction, activeDocumentId, currentDraftQuestion]);

  if (!isOpen) return null;

  // Build the synthesized goal prompt based on user configurations
  const buildGoalPrompt = (): string => {
    const docContext = activeDocumentId ? ` strictly based on my study notes (${activeDocumentId})` : '';
    const cleanTopic = topic.trim();

    switch (selectedAction) {
      case 'Explain': {
        const target = cleanTopic || (activeDocumentId ? 'the core concepts in these notes' : 'Database Normalization');
        const depthDesc =
          explainDepth === 'foundational'
            ? 'using clear step-by-step intuition and simple real-world analogies'
            : explainDepth === 'deep'
            ? 'with full technical mechanics, underlying algorithms, and architectural trade-offs'
            : 'focusing on high-yield university exam definitions, formulas, and common pitfalls';
        return `Explain ${target} clearly ${depthDesc}${docContext}.`;
      }

      case 'Revise': {
        const target = cleanTopic || (activeDocumentId ? 'these study notes' : 'Database Management Systems');
        const durationDesc =
          revisionDuration === 'quick'
            ? 'a 15-minute quick revision sprint and high-yield formula checklist'
            : revisionDuration === '1day'
            ? 'a 1-day comprehensive exam revision schedule with core definitions and key takeaways'
            : 'a structured 3-day spaced revision plan with daily milestones and self-check questions';
        return `Create ${durationDesc} for ${target}${docContext}.`;
      }

      case 'Practice': {
        const target = cleanTopic || (activeDocumentId ? 'the key problem areas in these notes' : 'Binary Search Trees & SQL Queries');
        return `Give me ${practiceCount} targeted ${practiceDifficulty}-level practice exercises on ${target}${docContext}. Include step-by-step solutions with detailed reasoning.`;
      }

      case 'Quiz': {
        const target = cleanTopic || (activeDocumentId ? 'the concepts in these notes' : 'Computer Science Fundamentals');
        const quizDesc =
          quizType === 'diagnostic'
            ? 'diagnostic concept-check'
            : quizType === 'exam'
            ? 'rigorous exam-style'
            : 'challenging tricky edge-case';
        return `Quiz me with ${quizCount} ${quizDesc} multiple-choice questions on ${target}${docContext}. Provide clear explanations after answering.`;
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalPrompt = buildGoalPrompt();
    onStartWorkflow(selectedAction, finalPrompt);
  };

  const actionMeta: Record<CoachActionType, { icon: string; title: string; subtitle: string }> = {
    Explain: {
      icon: '💡',
      title: 'Deep Concept Explanation',
      subtitle: 'Break down complex topics into clear, intuitive step-by-step explanations.',
    },
    Revise: {
      icon: '🔄',
      title: 'Exam Revision Plan',
      subtitle: 'Generate structured revision schedules, formula sheets, and key checklists.',
    },
    Practice: {
      icon: '🎯',
      title: 'Targeted Practice Problems',
      subtitle: 'Solve hands-on exercises calibrated to your desired difficulty level.',
    },
    Quiz: {
      icon: '🧠',
      title: 'Interactive Quiz & Knowledge Check',
      subtitle: 'Test your understanding with diagnostic multiple-choice questions.',
    },
  };

  return (
    <div className="upload-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="upload-modal-card coach-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="coach-modal-title-group">
            <span className="coach-header-icon">{actionMeta[selectedAction].icon}</span>
            <div>
              <h3 className="modal-title">{actionMeta[selectedAction].title}</h3>
              <p className="modal-subtitle">{actionMeta[selectedAction].subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            title="Close"
            disabled={isExecuting}
          >
            ✕
          </button>
        </div>

        {/* Action Type Selector Tabs */}
        <div className="coach-tabs-row" role="tablist">
          {(['Explain', 'Revise', 'Practice', 'Quiz'] as CoachActionType[]).map((action) => (
            <button
              key={action}
              type="button"
              className={`coach-tab-btn ${selectedAction === action ? 'active' : ''}`}
              onClick={() => setSelectedAction(action)}
              disabled={isExecuting}
              role="tab"
              aria-selected={selectedAction === action}
            >
              <span>{action === 'Explain' ? '💡' : action === 'Revise' ? '🔄' : action === 'Practice' ? '🎯' : '🧠'}</span>
              <span>{action}</span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="coach-form">
          {/* Active Context Banner */}
          {activeDocumentId && (
            <div className="coach-context-pill">
              <span className="context-icon">📄</span>
              <span>Grounding in your material: <strong>{activeDocumentId}</strong></span>
            </div>
          )}

          {/* Topic / Target Input */}
          <div className="form-group">
            <label htmlFor="coach-topic-input" className="coach-label">
              Topic or Focus Concept:
            </label>
            <input
              id="coach-topic-input"
              type="text"
              className="teacher-input-text coach-input"
              placeholder={
                selectedAction === 'Explain'
                  ? 'e.g. 3NF Normalization, B+ Trees, Paging vs Segmentation'
                  : selectedAction === 'Revise'
                  ? 'e.g. DBMS Midterm Prep, Concurrency Control'
                  : selectedAction === 'Practice'
                  ? 'e.g. SQL Subqueries, Red-Black Trees'
                  : 'e.g. Database Transactions, Indexing'
              }
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isExecuting}
            />
          </div>

          {/* Workflow Specific Configurations */}
          {selectedAction === 'Explain' && (
            <div className="form-group">
              <label className="coach-label">Explanation Depth & Style:</label>
              <div className="coach-options-grid">
                <button
                  type="button"
                  className={`coach-option-card ${explainDepth === 'foundational' ? 'selected' : ''}`}
                  onClick={() => setExplainDepth('foundational')}
                >
                  <strong>🌱 Foundational</strong>
                  <span>Simple analogies, intuitive steps, easy language</span>
                </button>
                <button
                  type="button"
                  className={`coach-option-card ${explainDepth === 'deep' ? 'selected' : ''}`}
                  onClick={() => setExplainDepth('deep')}
                >
                  <strong>🔬 Deep Dive</strong>
                  <span>Full technical rigor, trade-offs & mechanics</span>
                </button>
                <button
                  type="button"
                  className={`coach-option-card ${explainDepth === 'exam' ? 'selected' : ''}`}
                  onClick={() => setExplainDepth('exam')}
                >
                  <strong>🎯 Exam High-Yield</strong>
                  <span>Must-know definitions, formulas & key pitfalls</span>
                </button>
              </div>
            </div>
          )}

          {selectedAction === 'Revise' && (
            <div className="form-group">
              <label className="coach-label">Revision Schedule / Duration:</label>
              <div className="coach-options-grid">
                <button
                  type="button"
                  className={`coach-option-card ${revisionDuration === 'quick' ? 'selected' : ''}`}
                  onClick={() => setRevisionDuration('quick')}
                >
                  <strong>⚡ 15-Minute Sprint</strong>
                  <span>Rapid bullet checklist & key formulas</span>
                </button>
                <button
                  type="button"
                  className={`coach-option-card ${revisionDuration === '1day' ? 'selected' : ''}`}
                  onClick={() => setRevisionDuration('1day')}
                >
                  <strong>📅 1-Day Intensive</strong>
                  <span>Comprehensive topic-by-topic review</span>
                </button>
                <button
                  type="button"
                  className={`coach-option-card ${revisionDuration === '3day' ? 'selected' : ''}`}
                  onClick={() => setRevisionDuration('3day')}
                >
                  <strong>🗓️ 3-Day Spaced Plan</strong>
                  <span>Detailed multi-day study milestones</span>
                </button>
              </div>
            </div>
          )}

          {selectedAction === 'Practice' && (
            <>
              <div className="form-group">
                <label className="coach-label">Difficulty Level:</label>
                <div className="coach-options-grid">
                  <button
                    type="button"
                    className={`coach-option-card ${practiceDifficulty === 'beginner' ? 'selected' : ''}`}
                    onClick={() => setPracticeDifficulty('beginner')}
                  >
                    <strong>🟢 Beginner</strong>
                    <span>Direct concept checks</span>
                  </button>
                  <button
                    type="button"
                    className={`coach-option-card ${practiceDifficulty === 'intermediate' ? 'selected' : ''}`}
                    onClick={() => setPracticeDifficulty('intermediate')}
                  >
                    <strong>🟡 Intermediate</strong>
                    <span>Standard exam problems</span>
                  </button>
                  <button
                    type="button"
                    className={`coach-option-card ${practiceDifficulty === 'advanced' ? 'selected' : ''}`}
                    onClick={() => setPracticeDifficulty('advanced')}
                  >
                    <strong>🔴 Advanced</strong>
                    <span>Complex edge cases</span>
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="coach-label">Problem Count: {practiceCount} Exercises</label>
                <div className="coach-pill-selector">
                  {[1, 2, 3, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      className={`coach-count-pill ${practiceCount === cnt ? 'active' : ''}`}
                      onClick={() => setPracticeCount(cnt)}
                    >
                      {cnt} {cnt === 1 ? 'Problem' : 'Problems'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {selectedAction === 'Quiz' && (
            <>
              <div className="form-group">
                <label className="coach-label">Diagnostic Scope:</label>
                <div className="coach-options-grid">
                  <button
                    type="button"
                    className={`coach-option-card ${quizType === 'diagnostic' ? 'selected' : ''}`}
                    onClick={() => setQuizType('diagnostic')}
                  >
                    <strong>🩺 Concept Diagnostic</strong>
                    <span>Spot knowledge gaps quickly</span>
                  </button>
                  <button
                    type="button"
                    className={`coach-option-card ${quizType === 'exam' ? 'selected' : ''}`}
                    onClick={() => setQuizType('exam')}
                  >
                    <strong>📝 Exam Simulator</strong>
                    <span>Standard multiple choice</span>
                  </button>
                  <button
                    type="button"
                    className={`coach-option-card ${quizType === 'challenge' ? 'selected' : ''}`}
                    onClick={() => setQuizType('challenge')}
                  >
                    <strong>🔥 Master Challenge</strong>
                    <span>Tricky multi-step questions</span>
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="coach-label">Number of Questions: {quizCount} Questions</label>
                <div className="coach-pill-selector">
                  {[3, 5, 8].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      className={`coach-count-pill ${quizCount === cnt ? 'active' : ''}`}
                      onClick={() => setQuizCount(cnt)}
                    >
                      {cnt} Questions
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Prompt Preview Box */}
          <div className="coach-preview-box">
            <span className="preview-label">Coach Action Preview:</span>
            <p className="preview-text">"{buildGoalPrompt()}"</p>
          </div>

          {/* Action Footer */}
          <div className="coach-actions-footer">
            <button
              type="button"
              className="btn btn-secondary coach-cancel-btn"
              onClick={onClose}
              disabled={isExecuting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary coach-launch-btn"
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <span className="spinner-sm" aria-hidden="true" />
                  <span>Preparing Coach Workflow...</span>
                </>
              ) : (
                `🚀 Start ${selectedAction}`
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
