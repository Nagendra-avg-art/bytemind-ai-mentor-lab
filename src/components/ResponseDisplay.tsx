import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';

/**
 * ResponseDisplay.tsx
 * 
 * WHY THIS FILE IS NEEDED:
 * Renders the multi-turn conversation thread between the student and ByteMind AI Mentor.
 * 
 * Features:
 * 1. Shows a sequential thread of User questions and AI Mentor answers (chat cards).
 * 2. Provides per-response copy-to-clipboard functionality.
 * 3. Auto-scrolls to the newest message smoothly.
 * 4. Displays loading pulse dots and actionable error states.
 */

interface ResponseDisplayProps {
  messages: ChatMessage[];
  isLoading: boolean;
  loadingStatusText?: string | null;
  errorMessage: string | null;
  onNewConversation: () => void;
  interactionId: string | null;
  isDevMode?: boolean;
}

export const ResponseDisplay: React.FC<ResponseDisplayProps> = ({
  messages,
  isLoading,
  loadingStatusText,
  errorMessage,
  onNewConversation,
  interactionId,
  isDevMode = false,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const threadEndRef = useRef<HTMLDivElement>(null);

  const toggleSourceExpand = (messageId: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  // Smooth scroll to latest reply whenever messages update or loading begins
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, errorMessage]);

  const handleCopy = (messageId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const hasContent = messages.length > 0;

  return (
    <div className="response-container">
      <div className="response-header">
        <div className="response-header-left">
          <h2 className="response-title">Conversation</h2>
          {interactionId && (
            <span className="session-pill" title="Gemini multi-turn session active">
              ● Memory Active
            </span>
          )}
        </div>

        {hasContent && (
          <button
            type="button"
            className="new-chat-btn"
            onClick={onNewConversation}
            title="Start a fresh conversation"
          >
            ➕ New Conversation
          </button>
        )}
      </div>

      <div className="response-body">
        {/* Idle State: When no messages have been sent yet */}
        {!hasContent && !isLoading && !errorMessage && (
          <div className="empty-state">
            <p className="empty-icon">💡</p>
            <p className="empty-title">Ready when you are</p>
            <p className="empty-subtitle">
              Ask any Computer Science or programming question to begin learning with your AI Mentor.
            </p>
          </div>
        )}

        {/* Conversation Thread */}
        {hasContent && (
          <div className="conversation-thread">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`message-card ${msg.role === 'user' ? 'user-message' : 'assistant-message'}`}
              >
                <div className="message-header">
                  <span className="message-sender">
                    {msg.role === 'user' ? (
                      <>
                        👤 You
                        {msg.isImage && <span className="message-image-badge">📷 Image Attached</span>}
                        {msg.isAgent && <span className="message-agent-badge">🎯 Learning Goal</span>}
                      </>
                    ) : msg.isAgent ? (
                      '🧠 ByteMind Learning Coach'
                    ) : msg.isImage ? (
                      '📸 ByteMind Image Mentor'
                    ) : msg.isRag ? (
                      '📄 ByteMind Mentor (Document Grounded)'
                    ) : (
                      '🤖 ByteMind AI Mentor'
                    )}
                  </span>
                  <div className="message-actions">
                    {msg.timestamp && (
                      <span className="message-time">{msg.timestamp}</span>
                    )}
                    {msg.role === 'assistant' && (
                      <button
                        type="button"
                        className="copy-button"
                        onClick={() => handleCopy(msg.id, msg.text)}
                        aria-label="Copy response"
                      >
                        {copiedId === msg.id ? '✓ Copied' : '📋 Copy'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Optional Attached Study Image Preview */}
                {msg.imageUrl && (
                  <div className="message-image-container">
                    <img
                      src={msg.imageUrl}
                      alt={msg.imageName || 'Attached study material'}
                      className="message-image-thumbnail"
                    />
                    {msg.imageName && (
                      <span className="message-image-caption">📎 {msg.imageName}</span>
                    )}
                  </div>
                )}

                {/* Step 8.1: Agent Workflow Milestones Strip */}
                {msg.isAgent && msg.workflow && msg.workflow.length > 0 && (
                  <div className="message-workflow-strip">
                    <div className="workflow-strip-header">
                      <span className="workflow-strip-label">
                        {isDevMode && msg.intent ? `🎯 Workflow (${msg.intent}):` : '🎯 Learning Steps:'}
                      </span>
                      {msg.relevantDocument && (
                        <span className="workflow-doc-tag" title={msg.relevantDocument}>
                          📄 Grounded in {msg.relevantDocument}
                        </span>
                      )}
                    </div>
                    <div className="workflow-strip-steps">
                      {msg.workflow.map((step, idx) => (
                        <span key={idx} className="workflow-strip-step">
                          <span className="step-num">{idx + 1}</span> {step}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Developer Mode Agent Debug Info */}
                {isDevMode && msg.isAgent && (
                  <div className="agent-msg-debug">
                    <span className="dev-tag">⚙️ AGENT</span>
                    <span>Intent: <strong>{msg.intent || 'N/A'}</strong></span>
                    {msg.selectedTool && (
                      <span>Tool: <strong>{msg.selectedTool}</strong></span>
                    )}
                    <span>Doc: <strong>{msg.documentUsed || msg.relevantDocument || 'None (General)'}</strong></span>
                    {msg.ragRequired !== undefined && (
                      <span>RAG: <strong>{msg.ragRequired ? `Active (${msg.retrievedChunks || msg.sources?.length || 0} chunks)` : 'Inactive'}</strong></span>
                    )}
                    {msg.similarityResult && (
                      <span>Sim: <strong>{msg.similarityResult}</strong></span>
                    )}
                    {msg.executionMs !== undefined && (
                      <span>Time: <strong>{msg.executionMs}ms</strong></span>
                    )}
                  </div>
                )}

                {/* Developer Mode Provider & Local AI Telemetry */}
                {isDevMode && !msg.isAgent && (msg.provider || msg.model || msg.isLocalAI) && (
                  <div className="agent-msg-debug">
                    <span className="dev-tag">⚡ {msg.isLocalAI || msg.provider === 'ollama' ? 'LOCAL AI' : msg.provider === 'groq' ? 'GROQ CLOUD' : 'GEMINI CLOUD'}</span>
                    {msg.provider && (
                      <span>
                        Provider: <strong>{msg.provider === 'ollama' ? 'Ollama' : msg.provider === 'groq' ? 'Groq' : 'Gemini'}</strong>
                      </span>
                    )}
                    {msg.model && <span>Model: <strong>{msg.model}</strong></span>}
                    {msg.executionMs !== undefined && <span>Response time: <strong>{msg.executionMs}ms</strong></span>}
                    {(msg.isLocalAI || msg.provider === 'ollama') && <span>Local AI: <strong>Active</strong></span>}
                  </div>
                )}

                <div className="message-content">
                  <pre className="message-text">{msg.text}</pre>
                </div>

                {/* Step 5.7: Minimal Grounded Sources Display */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="rag-sources-container">
                    <div className="rag-sources-header">
                      <span className="rag-sources-title">Sources used:</span>
                      <button
                        type="button"
                        className="rag-sources-toggle"
                        onClick={() => toggleSourceExpand(msg.id)}
                      >
                        {expandedSources.has(msg.id) ? '▲ Hide details' : '▼ Details'}
                      </button>
                    </div>
                    <ul className="rag-sources-list">
                      {msg.sources.map((src, sIdx) => (
                        <li key={`${src.chunkId || sIdx}-${sIdx}`} className="rag-source-item">
                          <span className="rag-source-bullet">•</span>
                          <span className="rag-source-text">
                            <strong>{src.filename || src.documentId}</strong> — {isDevMode ? `Chunk ${src.chunkIndex}` : `Section ${src.chunkIndex}`}
                            {src.page != null ? ` (Page ${src.page})` : ''}
                            {isDevMode && src.chunkId && (
                              <code className="dev-chunk-code" style={{ marginLeft: '0.4rem', fontSize: '0.72rem', opacity: 0.8 }}>
                                {src.chunkId}
                              </code>
                            )}
                          </span>
                          {isDevMode && (
                            <span className="rag-source-score" title="Cosine Similarity Score">
                              ({(src.similarity * 100).toFixed(1)}% match)
                            </span>
                          )}
                          {expandedSources.has(msg.id) && src.textPreview && (
                            <div className="rag-source-preview-box">
                              <p className="rag-source-preview-text">"{src.textPreview}"</p>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="loading-state">
            <div className="pulse-loader">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
            <p className="loading-text">{loadingStatusText || 'ByteMind AI Mentor is thinking...'}</p>
          </div>
        )}

        {/* Error State Banner (Requirement 5: Mobile Error Handling without stack traces in Student Mode) */}
        {errorMessage && (() => {
          const isNetwork =
            errorMessage.includes("can't reach the learning server") ||
            errorMessage.toLowerCase().includes('failed to fetch') ||
            errorMessage.toLowerCase().includes('network');

          // In Student Mode: strip stack traces, line references, or raw internals
          const studentCleanMessage = errorMessage
            .split('\n')
            .filter(
              (line) =>
                !line.trim().startsWith('at ') &&
                !line.includes('node_modules') &&
                !line.includes('webpack-internal') &&
                !line.includes('.js:')
            )
            .join(' ')
            .trim();

          const displayTitle = isNetwork ? 'Connection Notice' : 'Notice';
          const displayBody = isDevMode ? errorMessage : (studentCleanMessage || errorMessage);

          return (
            <div className="error-state" role="alert">
              <p className="error-icon">⚠️</p>
              <div className="error-body">
                <p className="error-title">{displayTitle}</p>
                <p className="error-message">{displayBody}</p>
                {isDevMode && (
                  <div className="error-dev-info" style={{ marginTop: '0.4rem', fontSize: '0.75rem', opacity: 0.85 }}>
                    <code>Origin: {window.location.origin} • Browser Online: {navigator.onLine ? 'Yes' : 'No'}</code>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="error-reset-btn"
                onClick={onNewConversation}
              >
                Start New Conversation
              </button>
            </div>
          );
        })()}

        {/* Anchor element for smooth auto-scroll */}
        <div ref={threadEndRef} />
      </div>
    </div>
  );
};
