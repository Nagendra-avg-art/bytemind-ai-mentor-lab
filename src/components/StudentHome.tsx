import React from 'react';
import { ChatMessage } from '../types';

export interface StudyMaterial {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  isCustom?: boolean;
  tags?: string[];
}

export interface StudentHomeProps {
  onTriggerCamera: () => void;
  onTriggerVoice: () => void;
  voiceState: 'idle' | 'listening' | 'processing' | 'ready';
  isListening: boolean;
  activeDocumentId: string | null;
  onSelectStudyMaterial: (docId: string) => void;
  onClearDocumentFilter: () => void;
  onOpenUploadNotes: () => void;
  onSelectCoachAction: (actionType: 'Explain' | 'Revise' | 'Practice' | 'Quiz') => void;
  messages: ChatMessage[];
  onNewConversation: () => void;
  customDocuments?: StudyMaterial[];
  onAskQuestionText?: (sampleQuestion: string) => void;
}

// Built-in starter study materials
export const DEFAULT_STUDY_MATERIALS: StudyMaterial[] = [
  {
    id: 'dbms-normalization.pdf',
    title: 'DBMS Notes',
    subtitle: 'Normalization (1NF–3NF), BCNF, Relational Algebra & Keys',
    icon: '🗄️',
    tags: ['Database', 'Exams'],
  },
  {
    id: 'machine-learning-foundations.pdf',
    title: 'Machine Learning Notes',
    subtitle: 'Supervised Learning, Loss Functions, Gradient Descent & Neural Nets',
    icon: '🤖',
    tags: ['AI/ML', 'Core'],
  },
];

export const StudentHome: React.FC<StudentHomeProps> = ({
  onTriggerCamera,
  onTriggerVoice,
  voiceState,
  isListening,
  activeDocumentId,
  onSelectStudyMaterial,
  onClearDocumentFilter,
  onOpenUploadNotes,
  onSelectCoachAction,
  messages,
  onNewConversation,
  customDocuments = [],
  onAskQuestionText,
}) => {
  // Combine custom uploaded docs with default materials
  const allMaterials = [...customDocuments, ...DEFAULT_STUDY_MATERIALS];

  // Active material object
  const selectedMaterial = allMaterials.find((m) => m.id === activeDocumentId);

  return (
    <div className="student-home-container">
      {/* 1. ByteMind Logo & 2. Tagline */}
      <div className="student-hero-brand">
        <div className="brand-logo-badge">
          <span className="brand-glow-spark" aria-hidden="true">✨</span>
          <span className="brand-icon-brain" aria-hidden="true">🧠</span>
        </div>
        <h1 className="student-app-name">
          ByteMind <span className="brand-accent-text">AI</span>
        </h1>
        <p className="student-tagline">See. Ask. Learn.</p>
        <p className="student-value-prop">
          Your personal AI learning mentor with camera vision, voice understanding, and course-note grounding.
        </p>
      </div>

      {/* Active Document Grounding Banner (if selected) */}
      {selectedMaterial && (
        <div className="active-doc-banner">
          <div className="active-doc-info">
            <span className="active-doc-icon">{selectedMaterial.icon}</span>
            <div>
              <span className="active-doc-label">Grounded in Study Material:</span>
              <strong className="active-doc-name">{selectedMaterial.title}</strong>
            </div>
          </div>
          <button
            type="button"
            className="clear-doc-btn"
            onClick={onClearDocumentFilter}
            title="Search across all notes"
            aria-label="Clear document filter"
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* Primary Actions Grid: 3. Camera ("Show me") & 4. Voice ("Ask ByteMind") */}
      <div className="primary-actions-grid">
        {/* 3. Primary camera action: "Show me" */}
        <button
          type="button"
          className="hero-action-card camera-action-card"
          onClick={onTriggerCamera}
          aria-label="Show me: Capture a question, note or diagram"
        >
          <div className="action-card-glow" aria-hidden="true" />
          <div className="action-card-header">
            <div className="action-icon-pill camera-pill">
              <span className="action-icon" aria-hidden="true">📷</span>
            </div>
            <span className="action-tag">Visual Vision</span>
          </div>
          <div className="action-card-body">
            <h2 className="action-title">Show me</h2>
            <p className="action-subtitle">Capture a question, note or diagram</p>
          </div>
          <div className="action-card-footer">
            <span className="action-cta-text">Open camera or gallery</span>
            <span className="action-arrow" aria-hidden="true">→</span>
          </div>
        </button>

        {/* 4. Voice action: "Ask ByteMind" with microphone icon */}
        <button
          type="button"
          className={`hero-action-card voice-action-card ${isListening ? 'listening-pulse' : ''}`}
          onClick={onTriggerVoice}
          aria-label="Ask ByteMind by voice"
        >
          <div className="action-card-glow voice-glow" aria-hidden="true" />
          <div className="action-card-header">
            <div className="action-icon-pill voice-pill">
              <span className="action-icon" aria-hidden="true">
                {isListening ? '⏹️' : '🎙️'}
              </span>
            </div>
            <span className={`action-tag ${isListening ? 'listening-tag' : ''}`}>
              {voiceState === 'listening'
                ? 'Listening...'
                : voiceState === 'processing'
                ? 'Processing...'
                : voiceState === 'ready'
                ? 'Ready ✓'
                : 'Voice Input'}
            </span>
          </div>
          <div className="action-card-body">
            <h2 className="action-title">Ask ByteMind</h2>
            <p className="action-subtitle">
              {isListening
                ? 'Speak clearly now... Tap to stop'
                : 'Ask any study question aloud'}
            </p>
          </div>
          <div className="action-card-footer">
            <span className="action-cta-text">
              {isListening ? 'Listening to speech...' : 'Tap microphone to speak'}
            </span>
            {isListening ? (
              <span className="voice-wave-animation" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
            ) : (
              <span className="action-arrow" aria-hidden="true">→</span>
            )}
          </div>
        </button>
      </div>

      {/* 5. Study Material Section */}
      <section className="student-section study-materials-section">
        <div className="section-header-row">
          <div className="section-title-wrap">
            <span className="section-bullet-icon" aria-hidden="true">📚</span>
            <h2 className="section-heading">Study Material</h2>
          </div>
          <button
            type="button"
            className="upload-notes-btn"
            onClick={onOpenUploadNotes}
            title="Upload your own course PDF notes"
          >
            <span aria-hidden="true">+</span> Upload Notes
          </button>
        </div>
        <p className="section-description">
          Ground ByteMind in your actual coursework. Tap a card to focus your mentor on that material.
        </p>

        <div className="material-cards-scroll">
          {allMaterials.map((mat) => {
            const isSelected = activeDocumentId === mat.id;
            return (
              <div
                key={mat.id}
                className={`material-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectStudyMaterial(mat.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectStudyMaterial(mat.id);
                  }
                }}
                aria-pressed={isSelected}
              >
                <div className="material-card-top">
                  <span className="material-icon">{mat.icon}</span>
                  {isSelected && <span className="material-active-badge">Active</span>}
                  {mat.isCustom && <span className="material-custom-badge">Uploaded</span>}
                </div>
                <h3 className="material-title">{mat.title}</h3>
                <p className="material-subtitle">{mat.subtitle}</p>
                <div className="material-card-footer">
                  <span className="material-action-text">
                    {isSelected ? '✓ Grounded' : 'Ask about these notes'}
                  </span>
                  <span className="material-chevron" aria-hidden="true">›</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 6. Learning Coach Section: Quick Actions (Explain, Revise, Practice, Quiz) */}
      <section className="student-section learning-coach-section">
        <div className="section-header-row">
          <div className="section-title-wrap">
            <span className="section-bullet-icon" aria-hidden="true">🧠</span>
            <h2 className="section-heading">Learning Coach</h2>
          </div>
          <span className="coach-pill-badge">Intelligent Workflow</span>
        </div>
        <p className="section-description">
          Tell ByteMind how you want to learn today. Select a quick action to start a structured workflow:
        </p>

        <div className="coach-quick-actions-grid">
          {/* Explain Action */}
          <button
            type="button"
            className="coach-action-btn action-explain"
            onClick={() => onSelectCoachAction('Explain')}
          >
            <div className="coach-btn-icon-wrap">
              <span className="coach-btn-icon" aria-hidden="true">💡</span>
            </div>
            <div className="coach-btn-text">
              <strong className="coach-btn-title">Explain</strong>
              <span className="coach-btn-sub">Concepts broken down simply</span>
            </div>
          </button>

          {/* Revise Action */}
          <button
            type="button"
            className="coach-action-btn action-revise"
            onClick={() => onSelectCoachAction('Revise')}
          >
            <div className="coach-btn-icon-wrap">
              <span className="coach-btn-icon" aria-hidden="true">🔄</span>
            </div>
            <div className="coach-btn-text">
              <strong className="coach-btn-title">Revise</strong>
              <span className="coach-btn-sub">High-yield revision checklist</span>
            </div>
          </button>

          {/* Practice Action */}
          <button
            type="button"
            className="coach-action-btn action-practice"
            onClick={() => onSelectCoachAction('Practice')}
          >
            <div className="coach-btn-icon-wrap">
              <span className="coach-btn-icon" aria-hidden="true">🛠️</span>
            </div>
            <div className="coach-btn-text">
              <strong className="coach-btn-title">Practice</strong>
              <span className="coach-btn-sub">Hands-on problems & coding</span>
            </div>
          </button>

          {/* Quiz Action */}
          <button
            type="button"
            className="coach-action-btn action-quiz"
            onClick={() => onSelectCoachAction('Quiz')}
          >
            <div className="coach-btn-icon-wrap">
              <span className="coach-btn-icon" aria-hidden="true">📝</span>
            </div>
            <div className="coach-btn-text">
              <strong className="coach-btn-title">Quiz</strong>
              <span className="coach-btn-sub">Diagnostic test & retention</span>
            </div>
          </button>
        </div>
      </section>

      {/* 7. Recent conversation section if conversation history already exists */}
      {messages && messages.length > 0 && (
        <section className="student-section recent-chat-section">
          <div className="section-header-row">
            <div className="section-title-wrap">
              <span className="section-bullet-icon" aria-hidden="true">💬</span>
              <h2 className="section-heading">Active Conversation</h2>
              <span className="chat-count-pill">{messages.length}</span>
            </div>
            <button
              type="button"
              className="new-chat-action-btn"
              onClick={onNewConversation}
              title="Start a fresh conversation"
            >
              ➕ New Chat
            </button>
          </div>

          <div className="recent-messages-preview">
            {messages.slice(-2).map((msg) => (
              <div
                key={msg.id}
                className={`preview-message-card ${msg.role === 'user' ? 'user-preview' : 'ai-preview'}`}
              >
                <div className="preview-message-header">
                  <span className="preview-sender">
                    {msg.role === 'user' ? '👤 You' : '🤖 ByteMind'}
                  </span>
                  {msg.timestamp && (
                    <span className="preview-timestamp">{msg.timestamp}</span>
                  )}
                </div>
                <p className="preview-text">
                  {msg.text.length > 140 ? msg.text.slice(0, 140) + '...' : msg.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Starter topic suggestions (Quick tap on phone) - Visually secondary */}
      {(!messages || messages.length === 0) && (
        <div className="starter-prompts-secondary">
          <span className="starter-secondary-label">💡 Try asking:</span>
          <div className="starter-chips-scroll">
            {[
              'Explain B-Trees vs BST',
              'What is ACID in databases?',
              'How does Gradient Descent work?',
              'Explain recursion with a diagram',
            ].map((promptText) => (
              <button
                key={promptText}
                type="button"
                className="starter-chip-subtle"
                onClick={() => onAskQuestionText?.(promptText)}
              >
                {promptText}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
