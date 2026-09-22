import React, { useState } from 'react';
import { AgentResponse, RAGSource } from '../types';
import { QuestionInput } from './QuestionInput';

/**
 * LearningCoach.tsx
 * 
 * WHY THIS COMPONENT IS NEEDED:
 * Step 8.1: Controlled Learning Agent Core.
 * 
 * Product Principle:
 * Acts as an orchestrator that understands a student's learning goal and decides which
 * ByteMind capabilities (RAG, memory, practice, quiz, study plan, or revision plan) are relevant.
 * 
 * Key Features:
 * 1. Entry point: "What do you want to learn?"
 * 2. Mobile-first design with starter learning goal chips.
 * 3. Reuses QuestionInput for microphone/voice-to-text input (zero duplicated logic).
 * 4. Shows structured workflow milestones for the detected intent.
 * 5. Visual intent badges (Study Plan, Revision Plan, Practice, Quiz, Summary, Topics, Explain).
 * 6. Grounding badge (shows uploaded study material grounding vs general CS mentor).
 * 7. Developer Mode debug metadata (intent, document, timing) hidden in Student Mode.
 * 8. Never calls the agent automatically on load; only when the student explicitly submits.
 */

interface LearningCoachProps {
  onRunAgent: (goal: string, documentId?: string) => Promise<void>;
  isLoading: boolean;
  selectedDocumentId?: string;
  isDevMode?: boolean;
  lastAgentResult?: AgentResponse | null;
}

const SAMPLE_GOALS = [
  'Help me prepare for my DBMS exam',
  'Create a revision plan for Module 1',
  'Summarize this chapter',
  'Quiz me on this topic',
  'Give me practice questions on normal forms',
  'Identify core topics in this material',
];

export const LearningCoach: React.FC<LearningCoachProps> = ({
  onRunAgent,
  isLoading,
  selectedDocumentId = '',
  isDevMode = false,
  lastAgentResult = null,
}) => {
  const [goal, setGoal] = useState<string>('');
  const [docFilter, setDocFilter] = useState<string>(selectedDocumentId);
  const [showSources, setShowSources] = useState<boolean>(false);

  const handleSubmit = async () => {
    if (!goal.trim() || isLoading) return;
    await onRunAgent(goal.trim(), docFilter || undefined);
    // Keep goal in input or clear based on preference; clear enables follow-up
    setGoal('');
  };

  // Map intent string to friendly student label and icon
  const getIntentMeta = (intent: string) => {
    switch (intent) {
      case 'STUDY_PLAN':
        return { label: 'Structured Study Roadmap', icon: '📋', color: 'blue' };
      case 'REVISION_PLAN':
        return { label: 'High-Yield Revision Plan', icon: '🔄', color: 'amber' };
      case 'PRACTICE':
        return { label: 'Targeted Practice Exercises', icon: '🛠️', color: 'green' };
      case 'QUIZ':
        return { label: 'Diagnostic Concept Quiz', icon: '📝', color: 'purple' };
      case 'SUMMARY':
        return { label: 'Executive Summary', icon: '📑', color: 'teal' };
      case 'TOPICS':
        return { label: 'Curriculum & Topic Breakdown', icon: '📌', color: 'indigo' };
      case 'EXPLAIN':
      default:
        return { label: 'Concept Deep Dive', icon: '💡', color: 'emerald' };
    }
  };

  return (
    <div className="learning-coach-card">
      {/* Header Banner */}
      <div className="coach-header">
        <div className="coach-title-row">
          <span className="coach-badge">
            {isDevMode ? '🧠 Learning Agent Core (/api/agent/learn)' : '🧠 Learning Coach'}
          </span>
          <h2 className="coach-title">ByteMind Learning Coach</h2>
        </div>
        <p className="coach-subtitle">
          Tell ByteMind your learning goal. The agent will orchestrate a personalized workflow using your notes or computer science foundations.
        </p>

        {/* Optional Document Target Indicator */}
        {selectedDocumentId && (
          <div className="coach-doc-target-row">
            <span className="target-label">Target Document:</span>
            <span className="target-pill" title={selectedDocumentId}>
              📄 {selectedDocumentId}
            </span>
            {docFilter && (
              <button
                type="button"
                className="target-clear-btn"
                onClick={() => setDocFilter('')}
                title="Search across all notes"
              >
                ✕ Search all notes
              </button>
            )}
          </div>
        )}
      </div>

      {/* Input Section (Reusing QuestionInput for voice + text) */}
      <div className="coach-input-section">
        <QuestionInput
          question={goal}
          onChange={setGoal}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          inputId="coach-goal-input"
          label="What do you want to learn?"
          accessibleVoiceLabel="Speak your learning goal or type below"
          placeholder="e.g. 'Help me prepare for my DBMS exam', 'Create a revision plan for Module 1', 'Summarize this chapter', or 'Quiz me on binary search'..."
          submitButtonText="Ask Learning Coach"
          loadingButtonText="Orchestrating learning plan..."
          quickPrompts={SAMPLE_GOALS}
          onSelectPrompt={(p) => setGoal(p)}
          helperText="Tip: Tap 🎤 Speak to state your goal by voice, edit your prompt, and tap Ask Learning Coach."
        />
      </div>

      {/* Structured Agent Output Card (When a plan has been generated) */}
      {lastAgentResult && (
        <div className="agent-result-card" role="region" aria-label="Learning Agent Result">
          {/* Result Header & Badges */}
          <div className="agent-result-header">
            <div className="agent-badges-row">
              {/* Intent Pill */}
              {(() => {
                const meta = getIntentMeta(lastAgentResult.intent);
                return (
                  <span className={`agent-intent-badge intent-${meta.color}`}>
                    <span className="intent-icon">{meta.icon}</span>
                    <span className="intent-name">{meta.label}</span>
                  </span>
                );
              })()}

              {/* Grounding Source Badge */}
              {lastAgentResult.relevantDocument ? (
                <span className="agent-grounding-badge grounded" title={`Grounded in ${lastAgentResult.relevantDocument}`}>
                  📄 Grounded in: <strong>{lastAgentResult.relevantDocument}</strong>
                </span>
              ) : (
                <span className="agent-grounding-badge general" title="Answered using Computer Science foundational knowledge">
                  🌐 Grounded in: General CS Knowledge
                </span>
              )}
            </div>
          </div>

          {/* Goal Echo */}
          <div className="agent-goal-echo">
            <span className="goal-label">Student Goal:</span>
            <span className="goal-text">"{lastAgentResult.goal}"</span>
          </div>

          {/* Structured Workflow Milestones */}
          {lastAgentResult.workflow && lastAgentResult.workflow.length > 0 && (
            <div className="agent-workflow-card">
              <span className="workflow-title">🗺️ Orchestrated Workflow Milestones:</span>
              <div className="workflow-steps-list">
                {lastAgentResult.workflow.map((step, idx) => (
                  <div key={idx} className="workflow-step-item">
                    <span className="step-number">{idx + 1}</span>
                    <span className="step-text">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agent Response Body */}
          <div className="agent-response-body">
            <div className="agent-response-text">
              {lastAgentResult.response}
            </div>
          </div>

          {/* Source Citations (if RAG was used) */}
          {lastAgentResult.sources && lastAgentResult.sources.length > 0 && (
            <div className="agent-sources-container">
              <button
                type="button"
                className="agent-sources-toggle"
                onClick={() => setShowSources((prev) => !prev)}
              >
                <span>📚 Grounded Sources ({lastAgentResult.sources.length} chunks)</span>
                <span>{showSources ? '▲ Hide' : '▼ View'}</span>
              </button>

              {showSources && (
                <div className="agent-sources-list">
                  {lastAgentResult.sources.map((src: RAGSource, idx: number) => (
                    <div key={src.chunkId || idx} className="agent-source-item">
                      <div className="source-item-header">
                        <span className="source-doc-name">{src.filename}</span>
                        <span className="source-chunk-badge">Chunk #{src.chunkIndex}</span>
                        <span className="source-sim-score">
                          {(src.similarity * 100).toFixed(1)}% match
                        </span>
                      </div>
                      <p className="source-preview-text">"{src.textPreview}"</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
