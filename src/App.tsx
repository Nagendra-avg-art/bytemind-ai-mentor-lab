import { useState, useEffect, useRef } from 'react';
import { QuestionInput, VoiceState } from './components/QuestionInput';
import { ResponseDisplay } from './components/ResponseDisplay';
import { DocumentUpload } from './components/DocumentUpload';
import { StudentHome, StudyMaterial, DEFAULT_STUDY_MATERIALS } from './components/StudentHome';
import { TeacherHub } from './components/TeacherHub';
import { SharedArtifactViewer } from './components/SharedArtifactViewer';
import { endAssessmentSessionApi } from './services/teacherService';
import {
  sendPromptToAI,
  sendRAGPromptToAI,
  sendImagePromptToAI,
  sendAgentGoal,
} from './services/aiService';
import { optimizeImageForUpload, ImageOptimizationResult } from './utils/imageOptimizer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CoachActionModal, CoachActionType } from './components/CoachActionModal';
import { ChatMessage } from './types';
import './App.css';

/**
 * Storage keys for browser session persistence
 */
const SESSION_INTERACTION_KEY = 'bytemind_interaction_id';
const SESSION_CHAT_KEY = 'bytemind_chat_history';
const STORAGE_CUSTOM_DOCS_KEY = 'bytemind_custom_docs';

/**
 * Extracts any deep-linked shareId from window.location pathname, query, or hash
 */
function getInitialShareId(): string | null {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname;
  if (path.startsWith('/share/')) {
    const id = path.replace(/^\/share\//, '').split('/')[0].trim();
    if (id) return id;
  }
  const params = new URLSearchParams(window.location.search);
  const qShare = params.get('share');
  if (qShare) return qShare.trim();

  const hash = window.location.hash;
  if (hash.startsWith('#share/')) {
    return hash.replace(/^#share\//, '').split('/')[0].trim();
  }
  return null;
}

/**
 * Extracts initial role from window.location pathname, query, or hash.
 * Teachers access ByteMind at /teacher, /teacher-hub, or ?role=teacher.
 * Default role is 'student'.
 */
function getInitialRole(): 'teacher' | 'student' {
  if (typeof window === 'undefined') return 'student';
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.toLowerCase();

  // If opening /share/..., always student mode
  if (path.startsWith('/share/') || params.has('share') || hash.startsWith('#share/')) {
    return 'student';
  }

  // Teacher route
  if (
    path.startsWith('/teacher') ||
    path.startsWith('/teacher-hub') ||
    params.get('role') === 'teacher' ||
    params.has('teacher') ||
    hash.startsWith('#teacher')
  ) {
    return 'teacher';
  }

  return 'student';
}

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
  const [chatMode, setChatMode] = useState<'general' | 'rag' | 'image' | 'agent' | 'classroom'>('general');
  const [role, setRole] = useState<'teacher' | 'student'>(getInitialRole);
  const [activeShareId, setActiveShareId] = useState<string | null>(getInitialShareId);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [shareInputText, setShareInputText] = useState<string>('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [activeImageFile, setActiveImageFile] = useState<File | null>(null);
  const [optimizedImageResult, setOptimizedImageResult] = useState<ImageOptimizationResult | null>(null);
  const [loadingStatusText, setLoadingStatusText] = useState<string | null>(null);
  const [customDocuments, setCustomDocuments] = useState<StudyMaterial[]>(loadCustomDocs);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [showImageSourcePicker, setShowImageSourcePicker] = useState<boolean>(false);
  const [coachModalAction, setCoachModalAction] = useState<CoachActionType | null>(null);

  // Synchronize role and activeShareId with browser history (back/forward navigation)
  useEffect(() => {
    const handlePopState = () => {
      setRole(getInitialRole());
      setActiveShareId(getInitialShareId());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Voice state for synchronizing with StudentHome
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [triggerVoiceStart, setTriggerVoiceStart] = useState<number>(0);

  // Hidden inputs for camera capture & file picker
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const handlePopState = () => {
      const shareId = getInitialShareId();
      setActiveShareId(shareId);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
    } catch (err: any) {
      const msg = err?.message || err?.serverData?.message || 'ByteMind is temporarily unable to answer. Please try again.';
      setErrorMessage(msg);
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

  // Open Learning Coach interactive configuration modal (Phase 8 UX)
  const handleSelectCoachAction = (actionType: 'Explain' | 'Revise' | 'Practice' | 'Quiz') => {
    setCoachModalAction(actionType);
  };

  // Launch Coach workflow with explicitly configured user goal
  const handleStartCoachWorkflow = async (_action: CoachActionType, goalPrompt: string) => {
    setCoachModalAction(null);
    await handleRunAgent(goalPrompt, selectedDocumentId || undefined);
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
          <div
            className="brand-header-left"
            onClick={() => {
              if (role === 'teacher') {
                setRole('student');
                setActiveShareId(null);
                window.history.pushState({}, '', '/');
              }
            }}
            style={{ cursor: role === 'teacher' ? 'pointer' : 'default' }}
            title={role === 'teacher' ? 'Click to return to Student Mode' : 'ByteMind'}
          >
            <span className="brand-mini-spark" aria-hidden="true">✨</span>
            <span className="brand-logo-text">ByteMind</span>
          </div>

          {role === 'teacher' ? (
            <div className="app-mode-selector" role="tablist" aria-label="Teacher Hub Navigation">
              <button
                type="button"
                className="app-mode-pill active"
                role="tab"
                aria-selected={true}
                title="Teacher Hub Active"
              >
                👨‍🏫 Teacher
              </button>
            </div>
          ) : (
            <div className="app-mode-selector" role="tablist" aria-label="Student Navigation">
              <button
                type="button"
                className={`app-mode-pill ${!activeShareId ? 'active' : ''}`}
                onClick={() => {
                  endAssessmentSessionApi();
                  setActiveShareId(null);
                  window.history.pushState({}, '', '/');
                }}
                role="tab"
                aria-selected={!activeShareId}
                title="Student Learning Mentor Mode"
              >
                🎓 Student
              </button>
              <button
                type="button"
                className={`app-mode-pill code-entry-pill ${activeShareId ? 'active' : ''}`}
                onClick={() => setShowShareModal(true)}
                title="Enter a teacher share code or scan QR"
              >
                🔗 {activeShareId ? `Code: ${activeShareId}` : 'Enter Code'}
              </button>
              <button
                type="button"
                className="app-mode-pill teacher-entry-pill"
                onClick={() => {
                  setRole('teacher');
                  window.history.pushState({}, '', '/teacher');
                }}
                title="Navigate to Teacher Hub"
              >
                👨‍🏫 Teacher
              </button>
            </div>
          )}
        </div>
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
              <h3 className="modal-title">
                {role === 'teacher' ? '📄 Upload Study Material for Notes / Assignment' : '📄 Upload Course Study Material'}
              </h3>
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
              {role === 'teacher'
                ? 'Upload textbook chapters or lecture notes in PDF format. Students will be able to read and ask questions about these notes.'
                : 'Upload textbook chapters or lecture notes in PDF format. ByteMind will ground answers in your material.'}
            </p>
            <ErrorBoundary fallbackTitle="Upload failed to load">
              <DocumentUpload
                isTeacherMode={role === 'teacher'}
                onAskWithDocument={handleAskWithDocument}
                onSelectForTeacher={(docId) => {
                  setSelectedDocumentId(docId);
                  setShowUploadModal(false);
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
                }}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* Learning Coach Configuration Modal (Phase 8 UX) */}
      <CoachActionModal
        isOpen={Boolean(coachModalAction)}
        initialAction={coachModalAction || 'Explain'}
        activeDocumentId={selectedDocumentId || null}
        currentDraftQuestion={question}
        isExecuting={isLoading && chatMode === 'agent'}
        onClose={() => setCoachModalAction(null)}
        onStartWorkflow={handleStartCoachWorkflow}
      />

      {/* Enter Share Code Modal */}
      {showShareModal && (
        <div className="upload-modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="upload-modal-card share-code-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">🔗 Open Shared Learning Material</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowShareModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <p className="modal-subtitle">
              Enter the teacher's share code or URL to access notes, assignments, or quizzes.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                let code = shareInputText.trim();
                if (!code) return;
                if (code.includes('/share/')) {
                  code = code.split('/share/')[1].split('?')[0].split('#')[0];
                }
                setActiveShareId(code);
                setShowShareModal(false);
                setShareInputText('');
                window.history.pushState({}, '', `/share/${code}`);
              }}
              className="share-code-form"
            >
              <input
                type="text"
                className="teacher-input-text share-modal-input"
                placeholder="e.g., BM-X7K29P"
                value={shareInputText}
                onChange={(e) => setShareInputText(e.target.value)}
                autoFocus
                required
              />
              <button type="submit" className="publish-submit-btn">
                Open Material
              </button>
            </form>
          </div>
        </div>
      )}

      <main className="app-main">
        {/* ================================================================
            TEACHER ROLE: TEACHER HUB ONLY
            ================================================================ */}
        {role === 'teacher' ? (
          <ErrorBoundary fallbackTitle="Teacher Hub encountered an issue">
            <TeacherHub
              availableDocuments={[...customDocuments, ...DEFAULT_STUDY_MATERIALS]}
              activeDocumentId={selectedDocumentId || null}
              onSelectDocument={(id) => setSelectedDocumentId(id)}
              onOpenUploadModal={() => setShowUploadModal(true)}
              onExitToStudent={() => {
                setRole('student');
                setActiveShareId(null);
                window.history.pushState({}, '', '/');
              }}
            />
          </ErrorBoundary>
        ) : activeShareId ? (
          /* ================================================================
              STUDENT ROLE: SHARED ARTIFACT VIEW (/share/<shareId> or Enter Code)
              ================================================================ */
          <ErrorBoundary fallbackTitle="Shared learning material encountered an issue">
            <SharedArtifactViewer
              shareId={activeShareId}
              onBackToStudent={() => {
                endAssessmentSessionApi();
                setActiveShareId(null);
                window.history.pushState({}, '', '/');
              }}
            />
          </ErrorBoundary>
        ) : (
          /* ================================================================
              STUDENT ROLE: NORMAL STUDENT LEARNING MODE
              ================================================================ */
          <>
            {/* Fresh State: Show Full Phone-First Student Home */}
            {messages.length === 0 && !optimizedImageResult && (
              <ErrorBoundary fallbackTitle="Student Home encountered an issue">
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
                onAskQuestionText={(prompt) => setQuestion(prompt)}
              />
            </ErrorBoundary>
            )}

            {/* Active Image Attachment Card */}
            {activeImageFile && (
              <div className="active-image-attachment-card">
                <div className="attachment-preview-box">
                  <img
                    src={URL.createObjectURL(activeImageFile)}
                    alt="Question thumbnail preview"
                    className="attachment-thumb"
                  />
                  <div className="attachment-info">
                    <span className="attachment-badge">📷 Attached Image</span>
                    <span className="attachment-filename">{activeImageFile.name}</span>
                    {optimizedImageResult && (
                      <span className="attachment-opt-tag">✓ Optimized for Fast Vision</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="remove-attachment-btn"
                  onClick={handleRemoveActiveImage}
                  title="Remove image"
                  aria-label="Remove image"
                >
                  ✕ Remove
                </button>
              </div>
            )}

            {/* Selected Document Filter Pill (above chat) */}
            {selectedDocumentId && messages.length > 0 && (
              <div className="chat-doc-context-pill">
                <span className="context-pill-label">📄 Answering from:</span>
                <strong className="context-pill-name">{selectedDocumentId}</strong>
                <button
                  type="button"
                  className="context-pill-clear"
                  onClick={() => setSelectedDocumentId('')}
                  title="Search across all knowledge"
                >
                  ✕
                </button>
              </div>
            )}

            {/* In-chat Coach Quick Bar (shown after conversation has begun) */}
            {messages.length > 0 && !activeImageFile && (
              <div className="inchat-coach-bar">
                <span className="coach-bar-label">Coach Actions:</span>
                <div className="coach-mini-chips">
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
                    🎯 Practice
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
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>
          {role === 'teacher' ? (
            <>
              👨‍🏫 <strong>ByteMind Teacher Hub:</strong> Create & Distribute Learning • Teacher Console
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
