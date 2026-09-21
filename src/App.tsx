import { useState, useEffect, useRef } from 'react';
import { QuestionInput, VoiceState } from './components/QuestionInput';
import { ResponseDisplay } from './components/ResponseDisplay';
import { DocumentUpload } from './components/DocumentUpload';
import { ImageMentor } from './components/ImageMentor';
import { LearningCoach } from './components/LearningCoach';
import { StudentHome, StudyMaterial, DEFAULT_STUDY_MATERIALS } from './components/StudentHome';
import { ClassroomAssistant } from './components/ClassroomAssistant';
import { LocalAiLabPanel } from './components/LocalAiLabPanel';
import {
  sendPromptToAI,
  sendRAGPromptToAI,
  sendImagePromptToAI,
  sendAgentGoal,
} from './services/aiService';
import { optimizeImageForUpload, ImageOptimizationResult } from './utils/imageOptimizer';
import { ChatMessage, AgentResponse } from './types';
import './App.css';

/**
 * Storage keys for browser session persistence
 */
const SESSION_INTERACTION_KEY = 'bytemind_interaction_id';
const SESSION_CHAT_KEY = 'bytemind_chat_history';
const STORAGE_CUSTOM_DOCS_KEY = 'bytemind_custom_docs';

/**
 * Safely load initial messages from sessionStorage
 */
function loadInitialMessages(): ChatMessage[] {
  try {
    const saved = sessionStorage.getItem(SESSION_CHAT_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to parse chat history from sessionStorage', e);
  }
  return [];
}

/**
 * Safely load initial interactionId from sessionStorage
 */
function loadInitialInteractionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_INTERACTION_KEY);
  } catch {
    return null;
  }
}

/**
 * Safely load custom uploaded docs from localStorage
 */
function loadCustomDocs(): StudyMaterial[] {
  try {
    const saved = localStorage.getItem(STORAGE_CUSTOM_DOCS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }
  return [];
}

export function App() {
  const [question, setQuestion] = useState<string>('');
  const [interactionId, setInteractionId] = useState<string | null>(loadInitialInteractionId);
  const [messages, setMessages] = useState<ChatMessage[]>(loadInitialMessages);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<'general' | 'rag' | 'image' | 'agent' | 'classroom' | 'local-ai'>('general');
  const [appViewMode, setAppViewMode] = useState<'student' | 'classroom'>('student');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [activeImageFile, setActiveImageFile] = useState<File | null>(null);
  const [optimizedImageResult, setOptimizedImageResult] = useState<ImageOptimizationResult | null>(null);
  const [loadingStatusText, setLoadingStatusText] = useState<string | null>(null);
  const [lastAgentResult, setLastAgentResult] = useState<AgentResponse | null>(null);
  const [customDocuments, setCustomDocuments] = useState<StudyMaterial[]>(loadCustomDocs);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [showImageSourcePicker, setShowImageSourcePicker] = useState<boolean>(false);

  // Voice state for synchronizing with StudentHome
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [triggerVoiceStart, setTriggerVoiceStart] = useState<number>(0);

  // Hidden inputs for camera capture & file picker
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Developer Mode toggle state (Default mode is Student Mode)
  const [isDevMode, setIsDevMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bytemind_dev_mode') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleDevMode = () => {
    setIsDevMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('bytemind_dev_mode', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Synchronous lock and in-flight duplicate tracker to prevent rapid repeated clicks
  const isSubmittingRef = useRef<boolean>(false);
  const inFlightQuestionRef = useRef<string | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  // Sync messages to sessionStorage whenever they change
  useEffect(() => {
    try {
      if (messages.length > 0) {
        // Strip out ephemeral object URLs before persisting to sessionStorage
        const serialized = messages.map((m) => {
          if (m.imageUrl && m.imageUrl.startsWith('blob:')) {
            const { imageUrl, ...rest } = m;
            return rest;
          }
          return m;
        });
        sessionStorage.setItem(SESSION_CHAT_KEY, JSON.stringify(serialized));
      } else {
        sessionStorage.removeItem(SESSION_CHAT_KEY);
      }
    } catch (e) {
      console.error('Failed to save chat to sessionStorage', e);
    }
  }, [messages]);

  // Sync interactionId to sessionStorage whenever it changes
  useEffect(() => {
    try {
      if (interactionId) {
        sessionStorage.setItem(SESSION_INTERACTION_KEY, interactionId);
      } else {
        sessionStorage.removeItem(SESSION_INTERACTION_KEY);
      }
    } catch (e) {
      console.error('Failed to save interactionId to sessionStorage', e);
    }
  }, [interactionId]);

  // Clean up object URLs when active image changes
  useEffect(() => {
    return () => {
      if (optimizedImageResult?.previewUrl) {
        URL.revokeObjectURL(optimizedImageResult.previewUrl);
      }
    };
  }, [optimizedImageResult]);

  // Handle client-side image processing from camera or gallery
  const handleImageFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;

    setShowImageSourcePicker(false);
    setErrorMessage(null);
    setLoadingStatusText('Optimizing image for mobile...');

    try {
      if (!rawFile.type.startsWith('image/')) {
        throw new Error('Selected file is not an image. Please choose a JPEG, PNG, or WebP photo.');
      }

      const result = await optimizeImageForUpload(rawFile, {
        maxDimension: 1600,
        targetMaxBytes: 2 * 1024 * 1024,
        initialQuality: 0.85,
      });

      if (optimizedImageResult?.previewUrl) {
        URL.revokeObjectURL(optimizedImageResult.previewUrl);
      }

      setOptimizedImageResult(result);
      setActiveImageFile(result.file);
      setChatMode('image');

      // Scroll to input box for easy question entry
      setTimeout(() => {
        const inputArea = document.querySelector('textarea');
        if (inputArea) {
          inputArea.focus();
          inputArea.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    } catch (err) {
      console.error('Image optimization failed:', err);
      const msg = err instanceof Error ? err.message : 'Could not process the selected image.';
      setErrorMessage(msg);
    } finally {
      setLoadingStatusText(null);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  // Remove active image
  const handleRemoveActiveImage = () => {
    if (optimizedImageResult?.previewUrl) {
      URL.revokeObjectURL(optimizedImageResult.previewUrl);
    }
    setOptimizedImageResult(null);
    setActiveImageFile(null);
    if (chatMode === 'image') {
      setChatMode('general');
    }
  };

  // Handler for asking AI via Image Mentor (Step 6)
  const handleAskImage = async (file: File, imageQuestion: string) => {
    const trimmedQuestion = imageQuestion.trim();
    if (!trimmedQuestion || !file || isLoading || isSubmittingRef.current) return;
    if (inFlightQuestionRef.current === trimmedQuestion) return;

    isSubmittingRef.current = true;
    inFlightQuestionRef.current = trimmedQuestion;

    // Create user chat message with local blob preview
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmedQuestion,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isImage: true,
      imageUrl: URL.createObjectURL(file),
      imageName: file.name,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setErrorMessage(null);
    setLoadingStatusText('ByteMind is inspecting your image...');

    try {
      const response = await sendImagePromptToAI(file, trimmedQuestion, interactionId || undefined);

      if (response.interactionId) {
        setInteractionId(response.interactionId);
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: response.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isImage: true,
        provider: response.provider,
        model: response.model,
        executionMs: response.executionMs,
        isLocalAI: response.localAI,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'An unexpected error occurred';
      setErrorMessage(msg);
    } finally {
      setLoadingStatusText(null);
      setIsLoading(false);
      isSubmittingRef.current = false;
      inFlightQuestionRef.current = null;
    }
  };

  // Handler for running the Controlled Learning Agent (Step 8.1)
  const handleRunAgent = async (goal: string, documentId?: string) => {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || isLoading || isSubmittingRef.current) return;
    if (inFlightQuestionRef.current === trimmedGoal) return;

    isSubmittingRef.current = true;
    inFlightQuestionRef.current = trimmedGoal;

    // Create user chat message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmedGoal,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isAgent: true,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setErrorMessage(null);
    setLoadingStatusText('Orchestrating learning workflow...');

    try {
      const result = await sendAgentGoal(trimmedGoal, {
        documentId: documentId || selectedDocumentId || undefined,
        interactionId: interactionId || undefined,
      });

      setLastAgentResult(result);

      if (result.interactionId) {
        setInteractionId(result.interactionId);
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: result.response,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isAgent: true,
        intent: result.intent,
        selectedTool: result.selectedTool,
        documentUsed: result.documentUsed || result.relevantDocument,
        ragRequired: result.ragRequired,
        retrievedChunks: result.retrievedChunks,
        similarityResult: result.similarityResult,
        workflow: result.workflow,
        relevantDocument: result.relevantDocument || result.documentUsed,
        sources: result.sources,
        executionMs: result.executionMs,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'An unexpected error occurred';
      setErrorMessage(msg);
    } finally {
      setLoadingStatusText(null);
      setIsLoading(false);
      isSubmittingRef.current = false;
      inFlightQuestionRef.current = null;
    }
  };

  // Handler for asking AI a question (General or RAG or Image follow-up)
  const handleAskAI = async () => {
    const currentQuestion = question.trim();
    if (!currentQuestion || isLoading || isSubmittingRef.current) return;

    // If an image is actively loaded, route to image mentor workflow
    if (activeImageFile) {
      setQuestion('');
      await handleAskImage(activeImageFile, currentQuestion);
      return;
    }

    if (inFlightQuestionRef.current === currentQuestion) return;

    isSubmittingRef.current = true;
    inFlightQuestionRef.current = currentQuestion;

    // Abort any existing in-flight request to ensure 1 action -> 1 request
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    // Create user message entry
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: currentQuestion,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRag: chatMode === 'rag' || Boolean(selectedDocumentId),
      isImage: false,
    };

    // Append user message immediately and clear input
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setIsLoading(true);
    setLoadingStatusText('Thinking...');
    setErrorMessage(null);

    let phaseTimer: NodeJS.Timeout | null = null;

    try {
      if (chatMode === 'rag' || Boolean(selectedDocumentId)) {
        // Document-Grounded RAG Ask
        setLoadingStatusText('Searching your study material...');
        phaseTimer = setTimeout(() => {
          setLoadingStatusText('Generating answer...');
        }, 600);

        const response = await sendRAGPromptToAI(currentQuestion, {
          documentId: selectedDocumentId || undefined,
          topK: 3,
          interactionId: interactionId || undefined,
        });

        if (response.interactionId) {
          setInteractionId(response.interactionId);
        }

        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: response.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          sources: response.sources,
          isRag: true,
          provider: response.provider,
          model: response.model,
          executionMs: response.executionMs,
          isLocalAI: response.localAI,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        setLoadingStatusText('Thinking...');
        // Standard General CS Mentor Ask with timeout & abort protection
        const response = await sendPromptToAI(
          currentQuestion,
          interactionId || undefined,
          abortController.signal
        );

        if (response.interactionId) {
          setInteractionId(response.interactionId);
        }

        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: response.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isRag: false,
          provider: response.provider,
          model: response.model,
          executionMs: response.executionMs,
          isLocalAI: response.localAI,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (error) {
      const technicalMsg = error instanceof Error ? error.message : 'An unexpected error occurred';
      const studentMsg = "ByteMind couldn't complete that response. Please try again.";
      // Requirement 7: Clean Student Mode message, technical error in Developer Mode
      setErrorMessage(isDevMode ? technicalMsg : studentMsg);
    } finally {
      // Requirement 5: Guaranteed reset in all scenarios (success, error, timeout, network failure)
      if (phaseTimer) clearTimeout(phaseTimer);
      setLoadingStatusText(null);
      setIsLoading(false);
      isSubmittingRef.current = false;
      inFlightQuestionRef.current = null;
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null;
      }
    }
  };

  // Switch to RAG mode when a user clicks "Ask Mentor about this document"
  const handleAskWithDocument = (docId: string) => {
    setSelectedDocumentId(docId);
    setChatMode('rag');
    setShowUploadModal(false);

    // Save newly uploaded doc into customDocuments if not already present
    setCustomDocuments((prev) => {
      if (prev.some((d) => d.id === docId)) return prev;
      const cleanTitle = docId.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      const newDoc: StudyMaterial = {
        id: docId,
        title: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
        subtitle: `Custom uploaded notes (${docId})`,
        icon: '📄',
        isCustom: true,
      };
      const updated = [newDoc, ...prev];
      try {
        localStorage.setItem(STORAGE_CUSTOM_DOCS_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });

    const inputArea = document.querySelector('textarea');
    if (inputArea) {
      inputArea.focus();
      inputArea.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Reset conversation handler ("New Conversation" / "Clear Chat")
  const handleNewConversation = () => {
    setInteractionId(null);
    setMessages([]);
    setErrorMessage(null);
    handleRemoveActiveImage();
    setLastAgentResult(null);
    sessionStorage.removeItem(SESSION_INTERACTION_KEY);
    sessionStorage.removeItem(SESSION_CHAT_KEY);
  };

  // Trigger primary camera workflow ("Show me")
  const handleTriggerCamera = () => {
    setShowImageSourcePicker(true);
  };

  // Trigger primary voice workflow ("Ask ByteMind")
  const handleTriggerVoice = () => {
    setTriggerVoiceStart((prev) => prev + 1);
    const inputArea = document.querySelector('textarea');
    if (inputArea) {
      inputArea.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Handle Learning Coach Quick Actions (Explain, Revise, Practice, Quiz)
  const handleSelectCoachAction = async (actionType: 'Explain' | 'Revise' | 'Practice' | 'Quiz') => {
    const docLabel = selectedDocumentId ? ` based on my notes (${selectedDocumentId})` : '';

    switch (actionType) {
      case 'Explain': {
        const goal = question.trim()
          ? `Explain ${question.trim()} clearly step by step${docLabel}`
          : selectedDocumentId
          ? `Explain the core concepts and key definitions in my study notes${docLabel}`
          : 'Explain the difference between Stacks and Queues with real-world computer science examples';
        await handleRunAgent(goal, selectedDocumentId || undefined);
        break;
      }
      case 'Revise': {
        const goal = selectedDocumentId
          ? `Create a high-yield exam revision plan and formula checklist${docLabel}`
          : 'Create a structured 3-day revision plan for Database Management Systems exams';
        await handleRunAgent(goal, selectedDocumentId || undefined);
        break;
      }
      case 'Practice': {
        const goal = selectedDocumentId
          ? `Give me 3 targeted practice exercises with step-by-step solutions${docLabel}`
          : 'Give me 3 hands-on practice problems on binary search trees with solutions';
        await handleRunAgent(goal, selectedDocumentId || undefined);
        break;
      }
      case 'Quiz': {
        const goal = selectedDocumentId
          ? `Quiz me with 3 diagnostic multiple-choice questions to test my understanding${docLabel}`
          : 'Quiz me with 3 multiple-choice concept questions on Computer Science fundamentals';
        await handleRunAgent(goal, selectedDocumentId || undefined);
        break;
      }
    }
  };

  // Dynamic sample prompts for Student & Developer Modes
  const samplePrompts =
    selectedDocumentId
      ? [
          'What are the core concepts covered in this material?',
          'Explain the key definitions from my notes',
          'Summarize the main rules and takeaways',
          'Give me an exam question on this topic',
        ]
      : activeImageFile
      ? [
          'Explain this question step by step',
          'What is the bug or issue in this code?',
          'Explain this diagram and its components',
          'Solve this problem with a clean explanation',
        ]
      : [
          'What is Normalization in DBMS with an example?',
          'Explain how B-Trees work in Databases',
          'What are React Hooks and why use them?',
          'What is the difference between TCP and UDP?',
        ];

  return (
    <div className="app-layout">
      {/* Hidden file inputs for camera & gallery photo picker */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleImageFileSelected}
        style={{ display: 'none' }}
        id="camera-capture-input"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageFileSelected}
        style={{ display: 'none' }}
        id="gallery-picker-input"
      />

      {/* Top Header Navigation */}
      <header className="app-header">
        <div className="header-top-row">
          <div className="brand-header-left">
            <span className="brand-mini-spark" aria-hidden="true">✨</span>
            <span className="brand-logo-text">ByteMind</span>
            {isDevMode ? (
              <span className="header-badge dev-badge">🛠️ Dev Mode</span>
            ) : (
              <div className="app-mode-selector" role="tablist" aria-label="Application View Mode">
                <button
                  type="button"
                  className={`app-mode-pill ${appViewMode === 'student' ? 'active' : ''}`}
                  onClick={() => setAppViewMode('student')}
                  role="tab"
                  aria-selected={appViewMode === 'student'}
                  title="Student Learning Mentor Mode"
                >
                  🎓 Student
                </button>
                <button
                  type="button"
                  className={`app-mode-pill ${appViewMode === 'classroom' ? 'active' : ''}`}
                  onClick={() => setAppViewMode('classroom')}
                  role="tab"
                  aria-selected={appViewMode === 'classroom'}
                  title="Classroom Assistant: Turn class material into structured learning resources"
                >
                  🏫 Classroom
                </button>
              </div>
            )}
          </div>

          <div className="dev-settings-wrapper">
            <button
              type="button"
              className={`dev-settings-btn ${isDevMode ? 'active' : ''}`}
              onClick={handleToggleDevMode}
              title={isDevMode ? 'Return to Student Mode' : 'Developer Tools & Diagnostics'}
              aria-label={isDevMode ? 'Return to Student Mode' : 'Developer Tools'}
            >
              <span className="settings-icon" aria-hidden="true">⚙️</span>
              <span className="settings-btn-text">
                {isDevMode ? 'Exit Dev' : 'Dev'}
              </span>
            </button>
          </div>
        </div>

        {/* In Developer Mode: Display Technical Subtitle */}
        {isDevMode && (
          <div className="dev-header-banner">
            <h1 className="dev-app-title">ByteMind Engineering Console</h1>
            <p className="dev-app-subtitle">
              Configured AI Provider Architecture • Ollama (Local) / Groq (Render Cloud) / Gemini • Vector Store
            </p>
          </div>
        )}
      </header>

      {/* Camera / Image Source Picker Modal (Sheet) */}
      {showImageSourcePicker && (
        <div className="image-source-modal-overlay" onClick={() => setShowImageSourcePicker(false)}>
          <div className="image-source-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <h3 className="sheet-title">Show me: Choose Image Source</h3>
            <p className="sheet-desc">Capture a textbook question, handwritten notes, or diagram</p>

            <div className="sheet-actions-grid">
              <button
                type="button"
                className="sheet-action-btn camera-btn"
                onClick={() => cameraInputRef.current?.click()}
              >
                <span className="sheet-action-icon" aria-hidden="true">📷</span>
                <div className="sheet-btn-text">
                  <strong>Take Photo</strong>
                  <span>Use phone camera</span>
                </div>
              </button>

              <button
                type="button"
                className="sheet-action-btn gallery-btn"
                onClick={() => galleryInputRef.current?.click()}
              >
                <span className="sheet-action-icon" aria-hidden="true">📁</span>
                <div className="sheet-btn-text">
                  <strong>Photo Gallery</strong>
                  <span>Choose existing picture</span>
                </div>
              </button>
            </div>

            <button
              type="button"
              className="sheet-cancel-btn"
              onClick={() => setShowImageSourcePicker(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Upload Notes Modal */}
      {showUploadModal && (
        <div className="upload-modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="upload-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">📄 Upload Course Study Material</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowUploadModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <p className="modal-subtitle">
              Upload textbook chapters or lecture notes in PDF format. ByteMind will ground answers in your material.
            </p>
            <DocumentUpload onAskWithDocument={handleAskWithDocument} isDevMode={isDevMode} />
          </div>
        </div>
      )}

      <main className="app-main">
        {/* ================================================================
            CLASSROOM ASSISTANT VIEW (Turn class material into structured learning resources)
            ================================================================ */}
        {!isDevMode && appViewMode === 'classroom' ? (
          <ClassroomAssistant
            availableDocuments={[...customDocuments, ...DEFAULT_STUDY_MATERIALS]}
            activeDocumentId={selectedDocumentId || null}
            onSelectDocument={(id) => setSelectedDocumentId(id)}
            onOpenUploadModal={() => setShowUploadModal(true)}
            isDevMode={false}
          />
        ) : !isDevMode ? (
          /* ================================================================
              STUDENT MODE VIEW (Clean, phone-first, zero technical jargon)
              ================================================================ */
          <>
            {/* Fresh State: Show Full Phone-First Student Home */}
            {messages.length === 0 && !optimizedImageResult && (
              <StudentHome
                onTriggerCamera={handleTriggerCamera}
                onTriggerVoice={handleTriggerVoice}
                voiceState={voiceState}
                isListening={voiceState === 'listening'}
                activeDocumentId={selectedDocumentId || null}
                onSelectStudyMaterial={(id) => {
                  setSelectedDocumentId(id);
                  setChatMode('rag');
                }}
                onClearDocumentFilter={() => {
                  setSelectedDocumentId('');
                  setChatMode('general');
                }}
                onOpenUploadNotes={() => setShowUploadModal(true)}
                onSelectCoachAction={handleSelectCoachAction}
                messages={messages}
                onNewConversation={handleNewConversation}
                customDocuments={customDocuments}
                onAskQuestionText={(prompt) => {
                  setQuestion(prompt);
                  const inputArea = document.querySelector('textarea');
                  if (inputArea) {
                    inputArea.focus();
                    inputArea.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
              />
            )}

            {/* Active Image Preview Card (When user took a photo or uploaded image) */}
            {optimizedImageResult && (
              <section className="card active-image-card">
                <div className="active-image-header">
                  <div className="image-title-wrap">
                    <span className="image-badge-icon">📷</span>
                    <div>
                      <h3 className="active-image-title">Captured Study Material</h3>
                      <p className="active-image-sub">{optimizedImageResult.file.name}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="image-dismiss-btn"
                    onClick={handleRemoveActiveImage}
                    title="Remove image"
                    aria-label="Remove image"
                  >
                    ✕ Remove
                  </button>
                </div>

                <div className="active-image-preview-box">
                  <img
                    src={optimizedImageResult.previewUrl}
                    alt="Study material"
                    className="active-image-element"
                  />
                </div>

                <div className="active-image-actions-bar">
                  <button
                    type="button"
                    className="retake-photo-btn"
                    onClick={handleTriggerCamera}
                  >
                    🔄 Replace Photo
                  </button>
                  <span className="image-ready-pill">✓ Ready to ask</span>
                </div>
              </section>
            )}

            {/* In-Conversation Navigation & Quick Pills (when messages exist) */}
            {messages.length > 0 && (
              <div className="conversation-top-controls">
                <div className="active-grounding-chip-row">
                  {selectedDocumentId ? (
                    <span className="grounding-status-pill grounded">
                      📄 Grounded in: <strong>{selectedDocumentId}</strong>
                      <button
                        type="button"
                        className="pill-clear-btn"
                        onClick={() => setSelectedDocumentId('')}
                        title="Clear document grounding"
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span className="grounding-status-pill general">
                      🌐 General CS Mentor
                    </span>
                  )}

                  <button
                    type="button"
                    className="pill-action-upload"
                    onClick={() => setShowUploadModal(true)}
                  >
                    + Notes
                  </button>
                </div>

                {/* Quick Coach Follow-Up Actions */}
                <div className="conversation-coach-bar">
                  <span className="coach-bar-label">Coach:</span>
                  <button
                    type="button"
                    className="coach-mini-chip"
                    onClick={() => handleSelectCoachAction('Explain')}
                  >
                    💡 Explain
                  </button>
                  <button
                    type="button"
                    className="coach-mini-chip"
                    onClick={() => handleSelectCoachAction('Revise')}
                  >
                    🔄 Revise
                  </button>
                  <button
                    type="button"
                    className="coach-mini-chip"
                    onClick={() => handleSelectCoachAction('Practice')}
                  >
                    🛠️ Practice
                  </button>
                  <button
                    type="button"
                    className="coach-mini-chip"
                    onClick={() => handleSelectCoachAction('Quiz')}
                  >
                    📝 Quiz
                  </button>
                </div>
              </div>
            )}

            {/* Conversation Messages Display (shown when messages exist or loading) */}
            {(messages.length > 0 || isLoading || errorMessage) && (
              <section className="card response-card student-response-card">
                <ResponseDisplay
                  messages={messages}
                  isLoading={isLoading}
                  loadingStatusText={loadingStatusText}
                  errorMessage={errorMessage}
                  onNewConversation={handleNewConversation}
                  interactionId={interactionId}
                  isDevMode={false}
                />
              </section>
            )}

            {/* Quick Starter Suggestions (when conversation is active) */}
            {messages.length > 0 && (
              <section className="chips-section">
                <div className="chips-container">
                  {samplePrompts.slice(0, 3).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="chip"
                      onClick={() => setQuestion(prompt)}
                      disabled={isLoading}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Clean Mobile-First Input Bar (Always accessible at bottom of screen) */}
            <section className="card input-card student-input-card">
              <QuestionInput
                question={question}
                onChange={setQuestion}
                onSubmit={handleAskAI}
                isLoading={isLoading}
                isDevMode={false}
                placeholder={
                  activeImageFile
                    ? 'Ask about this image... (or tap 🎤 Speak)'
                    : selectedDocumentId
                    ? `Ask about ${selectedDocumentId}... (or tap 🎤 Speak)`
                    : "Ask ByteMind anything... (or tap 🎤 Speak)"
                }
                submitButtonText={activeImageFile ? 'Ask about Image' : 'Ask ByteMind'}
                loadingButtonText={loadingStatusText || 'Generating answer...'}
                onTriggerCamera={handleTriggerCamera}
                triggerVoiceStart={triggerVoiceStart}
                onVoiceStateChange={setVoiceState}
                helperText="Tip: Tap 📷 for camera, 🎤 to speak, or type your question."
              />
            </section>
          </>
        ) : (
          /* ================================================================
             DEVELOPER MODE VIEW (Full Engineering Diagnostics & Inspection)
             ================================================================ */
          <>
            {/* Developer Mode Tabs */}
            <section className="chat-mode-selector-card dev-mode-card">
              <div className="dev-badge-banner">
                🛠️ <strong>Developer Mode Active:</strong> Inspecting raw chunks, 768-D vectors, cosine similarity, agent intent & timing.
              </div>
              <div className="chat-mode-tabs">
                <button
                  type="button"
                  className={`mode-tab-btn ${chatMode === 'general' ? 'active' : ''}`}
                  onClick={() => setChatMode('general')}
                >
                  🤖 General (/api/ask)
                </button>
                <button
                  type="button"
                  className={`mode-tab-btn ${chatMode === 'rag' ? 'active' : ''}`}
                  onClick={() => setChatMode('rag')}
                >
                  📄 RAG Pipeline (/api/rag/ask)
                </button>
                <button
                  type="button"
                  className={`mode-tab-btn ${chatMode === 'image' ? 'active' : ''}`}
                  onClick={() => setChatMode('image')}
                >
                  📷 Vision (/api/image/ask)
                </button>
                <button
                  type="button"
                  className={`mode-tab-btn ${chatMode === 'agent' ? 'active' : ''}`}
                  onClick={() => setChatMode('agent')}
                >
                  🧠 Agent (/api/agent/learn)
                </button>
                <button
                  type="button"
                  className={`mode-tab-btn ${chatMode === 'classroom' ? 'active' : ''}`}
                  onClick={() => setChatMode('classroom')}
                >
                  🏫 Classroom (/api/agent/classroom)
                </button>
                <button
                  type="button"
                  className={`mode-tab-btn ${chatMode === 'local-ai' ? 'active' : ''}`}
                  onClick={() => setChatMode('local-ai')}
                >
                  🧪 Local AI (/api/local-ai)
                </button>
              </div>
            </section>

            {/* Developer Mode Document Ingestion & Vector Inspection */}
            {chatMode === 'rag' && (
              <section className="card document-upload-card">
                <DocumentUpload onAskWithDocument={handleAskWithDocument} isDevMode={true} />
              </section>
            )}

            {/* Developer Mode Image Mentor & Optimization Inspection */}
            {chatMode === 'image' && (
              <section className="card image-mentor-card">
                <ImageMentor
                  onAskImage={handleAskImage}
                  isLoading={isLoading}
                  activeInteractionId={interactionId}
                  isDevMode={true}
                  activeImageFile={activeImageFile}
                  onActiveImageChange={setActiveImageFile}
                />
              </section>
            )}

            {/* Developer Mode Learning Coach & Milestone Diagnostics */}
            {chatMode === 'agent' && (
              <section className="card agent-coach-section">
                <LearningCoach
                  onRunAgent={handleRunAgent}
                  isLoading={isLoading}
                  selectedDocumentId={selectedDocumentId}
                  isDevMode={true}
                  lastAgentResult={lastAgentResult}
                />
              </section>
            )}

            {/* Developer Mode Classroom Assistant & Diagnostics */}
            {chatMode === 'classroom' && (
              <ClassroomAssistant
                availableDocuments={[...customDocuments, ...DEFAULT_STUDY_MATERIALS]}
                activeDocumentId={selectedDocumentId || null}
                onSelectDocument={(id) => setSelectedDocumentId(id)}
                onOpenUploadModal={() => setShowUploadModal(true)}
                isDevMode={true}
              />
            )}

            {/* Developer Mode Local AI Feasibility Lab */}
            {chatMode === 'local-ai' && (
              <section className="card local-ai-card">
                <LocalAiLabPanel />
              </section>
            )}

            {/* Developer Mode Quick Chips */}
            {chatMode !== 'image' && chatMode !== 'agent' && chatMode !== 'classroom' && chatMode !== 'local-ai' && (
              <section className="chips-section">
                <span className="chips-label">Developer Test Prompts:</span>
                <div className="chips-container">
                  {samplePrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="chip"
                      onClick={() => setQuestion(prompt)}
                      disabled={isLoading}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Developer Mode Response Thread with full debug inspect */}
            {chatMode !== 'classroom' && chatMode !== 'local-ai' && (
              <section className="card response-card">
                <ResponseDisplay
                  messages={messages}
                  isLoading={isLoading}
                  loadingStatusText={loadingStatusText}
                  errorMessage={errorMessage}
                  onNewConversation={handleNewConversation}
                  interactionId={interactionId}
                  isDevMode={true}
                />
              </section>
            )}

            {/* Developer Mode Input */}
            {chatMode !== 'image' && chatMode !== 'agent' && chatMode !== 'classroom' && chatMode !== 'local-ai' && (
              <section className="card input-card">
                <QuestionInput
                  question={question}
                  onChange={setQuestion}
                  onSubmit={handleAskAI}
                  isLoading={isLoading}
                  isDevMode={true}
                  onTriggerCamera={handleTriggerCamera}
                  triggerVoiceStart={triggerVoiceStart}
                  onVoiceStateChange={setVoiceState}
                />
              </section>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>
          {isDevMode ? (
            <>
              🧠 <strong>AI Provider:</strong> Ollama • <strong>Model:</strong> qwen3:4b • <strong>Vision:</strong> qwen3-vl:4b • <strong>Embeddings:</strong> qwen3-embedding:0.6b
            </>
          ) : (
            <>
              🧠 <strong>ByteMind AI:</strong> See. Ask. Learn. • Multimodal Learning Mentor
            </>
          )}
        </p>
      </footer>
    </div>
  );
}

export default App;
