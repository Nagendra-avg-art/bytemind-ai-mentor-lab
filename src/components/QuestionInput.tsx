import React, { useState, useRef, useEffect } from 'react';

/**
 * QuestionInput.tsx
 * 
 * WHY THIS FILE IS NEEDED:
 * Step 7.1: Voice Input for ByteMind AI Mentor.
 * 
 * Features:
 * 1. Mobile-friendly microphone button (🎤 Speak) with accessible label "Ask by voice".
 * 2. Browser Web Speech API detection (window.SpeechRecognition || window.webkitSpeechRecognition).
 * 3. Graceful fallback when unsupported: "Voice input isn't supported in this browser."
 * 4. Four voice states:
 *    - Idle: Ready to speak
 *    - Listening...: Microphone actively recording with stop toggle
 *    - Processing speech...: Converting audio to text
 *    - Transcript ready: Text populated into textarea for student review & editing
 * 5. Places recognized transcript directly into the question textarea.
 * 6. Does NOT automatically submit to Gemini. The student can edit and must explicitly press "Ask ByteMind".
 * 7. Works seamlessly with any selected mode (General CS Mentor, Document Grounded RAG, Image Mentor).
 */

export interface QuestionInputProps {
  question: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  isDevMode?: boolean;
  // Step 7.2: Combined Image + Voice customization
  label?: string;
  accessibleVoiceLabel?: string;
  placeholder?: string;
  submitButtonText?: string;
  loadingButtonText?: string;
  disabled?: boolean;
  onVoiceStateChange?: (state: VoiceState) => void;
  quickPrompts?: string[];
  onSelectPrompt?: (prompt: string) => void;
  helperText?: React.ReactNode;
  inputId?: string;
  onTriggerCamera?: () => void;
  triggerVoiceStart?: number;
}

export type VoiceState = 'idle' | 'listening' | 'processing' | 'ready';

export const QuestionInput: React.FC<QuestionInputProps> = ({
  question,
  onChange,
  onSubmit,
  isLoading,
  isDevMode = false,
  label,
  accessibleVoiceLabel,
  placeholder,
  submitButtonText,
  loadingButtonText,
  disabled = false,
  onVoiceStateChange,
  quickPrompts,
  onSelectPrompt,
  helperText,
  inputId = 'question-input',
  onTriggerCamera,
  triggerVoiceStart,
}) => {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Auto-start voice recognition when triggerVoiceStart increments
  useEffect(() => {
    if (triggerVoiceStart && triggerVoiceStart > 0 && voiceState === 'idle') {
      toggleVoiceInput();
    }
  }, [triggerVoiceStart]);

  // Helper to update voice state and notify parent listeners (e.g. ImageMentor status pills)
  const updateVoiceState = (newState: VoiceState) => {
    setVoiceState(newState);
    if (onVoiceStateChange) {
      onVoiceStateChange(newState);
    }
  };

  // Detect browser support for Web Speech API
  const isSpeechAvailable =
    typeof window !== 'undefined' &&
    Boolean(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );

  // Temporary Developer Diagnostics State (Only visible in Developer Mode - Requirement)
  const [micDiagnostics, setMicDiagnostics] = useState<{
    secureContext: string;
    protocol: string;
    hostname: string;
    mediaDevicesExists: string;
    speechRecognitionExists: string;
    permissionState: string;
    lastError: string | null;
    testingMic: boolean;
  }>(() => {
    const isClient = typeof window !== 'undefined';
    return {
      secureContext: isClient ? (window.isSecureContext ? 'YES' : 'NO') : 'NO',
      protocol: isClient ? window.location.protocol : 'N/A',
      hostname: isClient ? window.location.hostname : 'N/A',
      mediaDevicesExists: isClient && Boolean(navigator?.mediaDevices) ? 'YES' : 'NO',
      speechRecognitionExists:
        isClient && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
          ? 'YES'
          : 'NO',
      permissionState: 'checking...',
      lastError: null,
      testingMic: false,
    };
  });

  // Query microphone permission state if browser supports navigator.permissions.query
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let isMounted = true;

    async function queryMicPermission() {
      try {
        if (navigator?.permissions?.query) {
          const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (isMounted) {
            setMicDiagnostics((prev) => ({
              ...prev,
              permissionState: status.state || 'unknown',
            }));
          }
          status.onchange = () => {
            if (isMounted) {
              setMicDiagnostics((prev) => ({
                ...prev,
                permissionState: status.state || 'unknown',
              }));
            }
          };
        } else {
          if (isMounted) {
            setMicDiagnostics((prev) => ({
              ...prev,
              permissionState: 'unsupported (permissions.query unavailable)',
            }));
          }
        }
      } catch (e: any) {
        if (isMounted) {
          setMicDiagnostics((prev) => ({
            ...prev,
            permissionState: `query error (${e?.name || 'unknown'})`,
          }));
        }
      }
    }

    queryMicPermission();
    return () => {
      isMounted = false;
    };
  }, []);

  // Dedicated test function for developer mode: tests mediaDevices.getUserMedia without recording or calling Gemini
  const handleTestMicrophonePermission = async () => {
    if (typeof window === 'undefined') return;
    setMicDiagnostics((prev) => ({ ...prev, testingMic: true, lastError: null }));

    if (!navigator?.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const errMsg = !window.isSecureContext
        ? 'SecurityError: navigator.mediaDevices is undefined in non-secure HTTP contexts. Secure context (HTTPS or localhost) required.'
        : 'NotFoundError: navigator.mediaDevices.getUserMedia is unavailable in this browser environment.';
      setMicDiagnostics((prev) => ({
        ...prev,
        testingMic: false,
        lastError: errMsg,
        permissionState: 'denied/insecure',
      }));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop all tracks to never record or keep mic open
      stream.getTracks().forEach((track) => track.stop());
      setMicDiagnostics((prev) => ({
        ...prev,
        testingMic: false,
        lastError: null,
        permissionState: 'granted',
      }));
    } catch (err: any) {
      console.warn('Microphone permission test error:', err);
      let errorReport = `${err.name || 'UnknownError'}: ${err.message || 'Microphone access failed'}`;

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorReport = 'NotAllowedError: Permission was denied by user or browser security policy.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorReport = 'NotFoundError: No audio input device (microphone) was found on this hardware.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorReport = 'NotReadableError: Microphone is already in use by another application or OS service.';
      } else if (err.name === 'SecurityError') {
        errorReport = 'SecurityError: Microphone media access is restricted in non-secure HTTP contexts.';
      }

      setMicDiagnostics((prev) => ({
        ...prev,
        testingMic: false,
        lastError: errorReport,
        permissionState: 'denied',
      }));
    }
  };

  // Clean up any running speech recognition instance on component unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const toggleVoiceInput = () => {
    setVoiceNotice(null);

    // If unsupported, show user-friendly message
    if (!isSpeechAvailable) {
      setVoiceNotice("Voice input isn't supported in this browser.");
      return;
    }

    // If currently listening or processing, allow student to stop recording
    if (voiceState === 'listening' || voiceState === 'processing') {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      updateVoiceState('processing');
      return;
    }

    try {
      const SpeechRecognitionClass =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognitionClass();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        updateVoiceState('listening');
        setVoiceNotice(null);
      };

      recognition.onspeechstart = () => {
        updateVoiceState('listening');
      };

      recognition.onspeechend = () => {
        updateVoiceState('processing');
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = 0; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        const recognizedText = finalTranscript || interimTranscript;
        if (recognizedText.trim()) {
          // Put transcript into the existing question input (editable by student)
          onChange(recognizedText.trim());
        }

        if (finalTranscript) {
          updateVoiceState('ready');
          // Return to idle after student sees "Transcript ready ✓"
          setTimeout(() => {
            setVoiceState((prev) => {
              if (prev === 'ready') {
                if (onVoiceStateChange) onVoiceStateChange('idle');
                return 'idle';
              }
              return prev;
            });
          }, 2000);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        const errType = event.error || 'unknown';
        const rawMsg = event.message ? `: ${event.message}` : '';
        const detailedErr = `SpeechRecognitionError (${errType})${rawMsg}`;

        setMicDiagnostics((prev) => ({
          ...prev,
          lastError: detailedErr,
        }));

        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          setVoiceNotice('Microphone access was denied. Please allow microphone permission in your browser settings.');
        } else if (event.error === 'service-not-allowed') {
          setVoiceNotice('Speech recognition is not permitted by this browser over local network HTTP. Please type your question.');
        } else if (event.error === 'audio-capture') {
          setVoiceNotice('No microphone was found or microphone is busy. Check your device settings.');
        } else if (event.error === 'network') {
          setVoiceNotice('Network error occurred during speech recognition. Please check your connection or type your question.');
        } else if (event.error === 'no-speech') {
          setVoiceNotice('No speech was detected. Tap Speak to try again.');
        } else {
          setVoiceNotice(`Voice recognition notice: ${event.error}. You can also type your question.`);
        }
        updateVoiceState('idle');
      };

      recognition.onend = () => {
        setVoiceState((prev) => {
          const nextState = prev === 'listening' || prev === 'processing' ? 'idle' : prev;
          if (onVoiceStateChange && nextState !== prev) {
            onVoiceStateChange(nextState);
          }
          return nextState;
        });
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.warn('Could not initialize SpeechRecognition:', err);
      const initErr = `${err?.name || 'Error'}: ${err?.message || 'Could not instantiate SpeechRecognition'}`;
      setMicDiagnostics((prev) => ({ ...prev, lastError: initErr }));
      setVoiceNotice('Unable to access microphone in this browser. Please type your question instead.');
      updateVoiceState('idle');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isLoading || disabled) return;

    // Stop recording if active when student submits
    if (voiceState === 'listening' && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      updateVoiceState('idle');
    }
    onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Allows submitting with Enter while Shift+Enter creates a new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (question.trim() && !isLoading && !disabled) {
        if (voiceState === 'listening' && recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch {
            // ignore
          }
          updateVoiceState('idle');
        }
        onSubmit();
      }
    }
  };

  const computedLabel =
    label ||
    (isDevMode
      ? 'Ask a question or prompt (/api/ask or /api/rag/ask):'
      : 'Enter your question:');

  const computedAccessibleVoiceLabel =
    accessibleVoiceLabel || 'Ask by voice or type below';

  const defaultPlaceholder =
    voiceState === 'listening'
      ? "Listening to your voice... (e.g., 'Explain paging in simple terms'). Speak now..."
      : "Type your question here or tap 'Speak' (e.g., 'What is paging in OS?' or 'Explain binary search')...";

  const computedPlaceholder =
    voiceState === 'listening'
      ? "Listening to your voice... Speak now..."
      : placeholder || defaultPlaceholder;

  return (
    <form className="question-form" onSubmit={handleSubmit}>
      <div className="input-header-row">
        <div className="input-label-wrap">
          <label htmlFor={inputId} className="input-label">
            {computedLabel}
          </label>
          <span className="voice-accessible-label">
            {computedAccessibleVoiceLabel}
          </span>
        </div>

        <div className="input-actions-cluster">
          {onTriggerCamera && (
            <button
              type="button"
              className="camera-quick-btn"
              onClick={onTriggerCamera}
              disabled={isLoading || disabled}
              title="Capture or select a photo of a question or diagram"
              aria-label="Capture question image"
            >
              <span className="camera-icon-bubble" aria-hidden="true">📷</span>
              <span className="camera-btn-text">Photo</span>
            </button>
          )}

          {/* Voice Input Action Button with 4 States (Idle, Listening, Processing, Ready) */}
          <div className="voice-action-container">
          {isSpeechAvailable ? (
            <button
              type="button"
              className={`voice-record-btn state-${voiceState}`}
              onClick={toggleVoiceInput}
              disabled={isLoading || disabled}
              title={
                voiceState === 'listening'
                  ? 'Tap to stop recording'
                  : `${computedAccessibleVoiceLabel}: Speak your question`
              }
              aria-label={computedAccessibleVoiceLabel}
            >
              <span className="mic-icon-bubble" aria-hidden="true">
                {voiceState === 'listening' ? '⏹️' : '🎤'}
              </span>
              <span className="voice-btn-text">
                {voiceState === 'idle' && 'Speak'}
                {voiceState === 'listening' && 'Listening...'}
                {voiceState === 'processing' && 'Processing speech...'}
                {voiceState === 'ready' && 'Transcript ready ✓'}
              </span>
              {voiceState === 'listening' && (
                <span className="voice-pulse-ring" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="voice-unsupported-text" role="status">
              🎙️ Voice input isn't supported in this browser.
            </span>
          )}
        </div>
        </div>
      </div>

      {/* Voice notice / error alert */}
      {voiceNotice && (
        <div className="voice-notice-banner" role="status">
          <span className="voice-notice-icon">⚠️</span>
          <span className="voice-notice-text">{voiceNotice}</span>
          <button
            type="button"
            className="voice-notice-close"
            onClick={() => setVoiceNotice(null)}
            title="Dismiss notice"
          >
            ✕
          </button>
        </div>
      )}

      {/* Active Recording State Banner */}
      {voiceState === 'listening' && (
        <div className="voice-active-bar" role="status">
          <span className="voice-recording-dot" aria-hidden="true" />
          <span className="voice-active-instruction">
            Listening to your voice... Speak clearly. Tap <strong>Stop</strong> or finish speaking when done.
          </span>
        </div>
      )}

      {/* Developer Mode Microphone Environment Diagnostics (Requirement: Only visible in Developer Mode) */}
      {isDevMode && (
        <div
          className="dev-mic-environment-card"
          style={{
            background: '#0f172a',
            border: '1px solid #38bdf8',
            borderRadius: '8px',
            padding: '0.85rem 1rem',
            margin: '0.75rem 0',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            color: '#e2e8f0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ color: '#38bdf8' }}>Microphone environment:</strong>
            <button
              type="button"
              onClick={handleTestMicrophonePermission}
              disabled={micDiagnostics.testingMic}
              style={{
                background: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #38bdf8',
                borderRadius: '4px',
                padding: '3px 8px',
                cursor: 'pointer',
                fontSize: '0.75rem',
              }}
            >
              {micDiagnostics.testingMic ? 'Testing...' : 'Test Permission'}
            </button>
          </div>

          <div style={{ whiteSpace: 'pre-line', lineHeight: '1.6' }}>
{`Secure Context: ${micDiagnostics.secureContext}
Protocol: ${micDiagnostics.protocol}
Hostname: ${micDiagnostics.hostname}
MediaDevices: ${micDiagnostics.mediaDevicesExists}
Speech Recognition: ${micDiagnostics.speechRecognitionExists}
Permission: ${micDiagnostics.permissionState}`}
          </div>

          {micDiagnostics.lastError && (
            <div
              style={{
                marginTop: '0.6rem',
                padding: '0.5rem',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                borderRadius: '4px',
                color: '#fca5a5',
              }}
            >
              <strong>Exact Error:</strong> {micDiagnostics.lastError}
            </div>
          )}

          {micDiagnostics.secureContext === 'NO' && (
            <div
              style={{
                marginTop: '0.6rem',
                padding: '0.5rem',
                background: 'rgba(234, 179, 8, 0.15)',
                border: '1px solid #eab308',
                borderRadius: '4px',
                color: '#fef08a',
                fontSize: '0.75rem',
                lineHeight: '1.4',
              }}
            >
              ℹ️ <strong>Physical Phone Access Diagnosis:</strong>
              <br />
              Browsers (such as Android Chrome on iQOO) require a <strong>Secure Context</strong> (HTTPS or localhost) for microphone and Web Speech access. Accessing via LAN HTTP (<code>{`http://${micDiagnostics.hostname}:5173`}</code>) is non-secure, causing the phone to deny or block microphone access.
              <br /><br />
              <strong>iQOO Phone Workaround:</strong>
              <br />
              1. Open Chrome on your phone.
              <br />
              2. Go to: <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>
              <br />
              3. Add: <code>{`http://${micDiagnostics.hostname}:5173`}</code>
              <br />
              4. Enable the flag and tap <strong>Relaunch</strong>. Chrome will now treat ByteMind as a Secure Context on local Wi-Fi!
            </div>
          )}
        </div>
      )}

      {/* Question Textarea (Editable by student before pressing Ask ByteMind) */}
      <textarea
        id={inputId}
        className={`question-textarea ${voiceState === 'listening' ? 'listening-active' : ''}`}
        rows={3}
        placeholder={computedPlaceholder}
        value={question}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading || disabled}
      />

      {/* Optional Quick Starter Prompts */}
      {quickPrompts && quickPrompts.length > 0 && (
        <div className="input-quick-prompts">
          <span className="quick-prompts-label">Quick suggestions:</span>
          <div className="quick-prompts-list">
            {quickPrompts.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                className="quick-prompt-chip"
                onClick={() => {
                  if (onSelectPrompt) {
                    onSelectPrompt(prompt);
                  } else {
                    onChange(prompt);
                  }
                }}
                disabled={isLoading || disabled}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="form-footer">
        {/* Student-facing "Ask ByteMind" button with loading protection */}
        <button
          type="submit"
          className="ask-button"
          disabled={!question.trim() || isLoading || disabled}
        >
          {isLoading ? (
            <>
              <span className="spinner" aria-hidden="true"></span>
              <span>{loadingButtonText || 'Generating answer...'}</span>
            </>
          ) : (
            <>
              <span>{submitButtonText || 'Ask ByteMind'}</span>
              <span aria-hidden="true"> ✨</span>
            </>
          )}
        </button>

        <span className="helper-text">
          {helperText || (
            <>
              Tip: You can edit the voice transcript before pressing <kbd>{submitButtonText || 'Ask ByteMind'}</kbd>.
            </>
          )}
        </span>
      </div>
    </form>
  );
};

