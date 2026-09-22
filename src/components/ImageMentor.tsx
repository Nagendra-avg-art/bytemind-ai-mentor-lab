import React, { useState, useRef, ChangeEvent, useEffect } from 'react';
import { optimizeImageForUpload, ImageOptimizationResult } from '../utils/imageOptimizer';
import { QuestionInput, VoiceState } from './QuestionInput';

/**
 * ImageMentor.tsx
 * 
 * WHY THIS COMPONENT IS NEEDED:
 * Step 6 & Step 7.2: Combined Image + Voice Mentor.
 * 
 * Coherent workflow:
 * 1. Student captures / selects a study image (camera or gallery).
 * 2. Client-side canvas optimizer downscales to max 1600px edge to prevent Android memory limits.
 * 3. Student taps the microphone button to ask a question by voice.
 * 4. Web Speech API converts speech to editable text inside the question textarea.
 * 5. Student reviews/edits transcript and explicitly presses "Ask ByteMind".
 * 6. Server receives BOTH the image and question, passing them to Gemini multimodal API.
 * 7. Multi-turn memory preserves context for follow-up questions.
 * 
 * Reuses QuestionInput.tsx to guarantee zero duplicated microphone logic.
 */

interface ImageMentorProps {
  onAskImage: (file: File, question: string) => Promise<void>;
  isLoading: boolean;
  activeInteractionId: string | null;
  isDevMode?: boolean;
  activeImageFile?: File | null;
  onActiveImageChange?: (file: File | null) => void;
}

export type ImageProcessingStatus =
  | 'idle'
  | 'optimizing'
  | 'image-ready'
  | 'listening'
  | 'processing-speech'
  | 'transcript-ready'
  | 'analyzing'
  | 'answer-ready'
  | 'error';

const SAMPLE_IMAGE_PROMPTS = [
  'Explain this question step by step',
  'What is the bug or issue in this code?',
  'Explain this diagram and its main components',
  'Transcribe and solve this mathematical problem',
];

export const ImageMentor: React.FC<ImageMentorProps> = ({
  onAskImage,
  isLoading,
  activeInteractionId,
  isDevMode = false,
  onActiveImageChange,
}) => {
  const [optimizedResult, setOptimizedResult] = useState<ImageOptimizationResult | null>(null);
  const [status, setStatus] = useState<ImageProcessingStatus>('idle');
  const [question, setQuestion] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const prevLoadingRef = useRef<boolean>(isLoading);

  // Synchronize useful states: Image ready, Listening..., Transcript ready, Analyzing image..., Answer ready
  useEffect(() => {
    if (isLoading) {
      setStatus('analyzing');
    } else if (prevLoadingRef.current && !isLoading && optimizedResult) {
      // Completed image query successfully!
      setStatus('answer-ready');
      const timer = setTimeout(() => {
        setStatus((prev) => (prev === 'answer-ready' ? 'image-ready' : prev));
      }, 3000);
      return () => clearTimeout(timer);
    } else if (optimizedResult) {
      setStatus((prev) => {
        // Keep active voice states if student is currently speaking or processing
        if (prev === 'listening' || prev === 'processing-speech' || prev === 'transcript-ready') {
          return prev;
        }
        return 'image-ready';
      });
    } else {
      setStatus('idle');
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, optimizedResult]);

  // Clean up object URLs when component unmounts or image changes
  useEffect(() => {
    return () => {
      if (optimizedResult?.previewUrl) {
        URL.revokeObjectURL(optimizedResult.previewUrl);
      }
    };
  }, [optimizedResult]);

  // Handle image selection from gallery or mobile camera
  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;

    // Reset previous image preview
    if (optimizedResult?.previewUrl) {
      URL.revokeObjectURL(optimizedResult.previewUrl);
    }
    setOptimizedResult(null);
    onActiveImageChange?.(null);
    setLocalError(null);
    setStatus('optimizing');

    try {
      // Validate supported image format
      if (!rawFile.type.startsWith('image/')) {
        throw new Error('Selected file is not an image. Please choose or capture a JPEG, PNG, or WebP photo.');
      }

      // Optimize image client-side before upload to prevent mobile memory errors
      const result = await optimizeImageForUpload(rawFile, {
        maxDimension: 1600,
        targetMaxBytes: 2 * 1024 * 1024,
        initialQuality: 0.85,
      });

      setOptimizedResult(result);
      onActiveImageChange?.(result.file);
      setStatus('image-ready');
    } catch (err) {
      console.error('Image optimization failed:', err);
      const msg = err instanceof Error ? err.message : 'Could not process or resize the selected image.';
      setLocalError(msg);
      setStatus('error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  // Remove current image and reset state
  const handleRemoveImage = () => {
    if (optimizedResult?.previewUrl) {
      URL.revokeObjectURL(optimizedResult.previewUrl);
    }
    setOptimizedResult(null);
    onActiveImageChange?.(null);
    setStatus('idle');
    setLocalError(null);
  };

  // Submit combined Image + Question (from voice or typing)
  const handleSubmit = async () => {
    if (!optimizedResult) {
      setLocalError('Please choose or take an image first.');
      return;
    }
    if (!question.trim()) {
      setLocalError('Please enter or speak a question about this image.');
      return;
    }

    setLocalError(null);
    try {
      await onAskImage(optimizedResult.file, question.trim());
      // Clear question for follow-ups, but keep image in view
      setQuestion('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to query Image Mentor.';
      setLocalError(msg);
      setStatus(optimizedResult ? 'image-ready' : 'idle');
    }
  };

  // Handle voice state updates from QuestionInput
  const handleVoiceStateChange = (voiceState: VoiceState) => {
    if (status === 'analyzing' || status === 'optimizing') return;
    if (voiceState === 'listening') {
      setStatus('listening');
    } else if (voiceState === 'processing') {
      setStatus('processing-speech');
    } else if (voiceState === 'ready') {
      setStatus('transcript-ready');
    } else if (voiceState === 'idle') {
      setStatus(optimizedResult ? 'image-ready' : 'idle');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const reductionPercent =
    optimizedResult && optimizedResult.originalSize > 0
      ? Math.max(
          0,
          Math.round(
            ((optimizedResult.originalSize - optimizedResult.optimizedSize) /
              optimizedResult.originalSize) *
              100
          )
        )
      : 0;

  return (
    <div className="image-mentor-container">
      {/* Header */}
      <div className="image-mentor-header">
        <div className="image-mentor-title-row">
          <span className="image-mentor-badge">
            {isDevMode ? '📷 Multimodal Vision (/api/image/ask)' : '📷 Multimodal Vision'}
          </span>
          <h2 className="image-mentor-title">Image + Voice Mentor</h2>

          {/* Useful Status Indicators (Requirement 19) */}
          {status === 'optimizing' && (
            <span className="image-status-pill optimizing">
              <span className="mini-spinner" aria-hidden="true" /> Optimizing image...
            </span>
          )}
          {status === 'image-ready' && (
            <span className="image-status-pill ready">
              ✓ Image ready
            </span>
          )}
          {status === 'listening' && (
            <span className="image-status-pill listening">
              <span className="voice-recording-dot" aria-hidden="true" /> Listening to voice...
            </span>
          )}
          {status === 'processing-speech' && (
            <span className="image-status-pill processing">
              Processing speech...
            </span>
          )}
          {status === 'transcript-ready' && (
            <span className="image-status-pill transcript-ready">
              ✓ Transcript ready
            </span>
          )}
          {status === 'analyzing' && (
            <span className="image-status-pill analyzing">
              <span className="mini-spinner" aria-hidden="true" /> Analyzing image...
            </span>
          )}
          {status === 'answer-ready' && (
            <span className="image-status-pill answer-ready">
              ✨ Answer ready
            </span>
          )}
          {status === 'error' && (
            <span className="image-status-pill error">
              ⚠️ Needs attention
            </span>
          )}
        </div>
        <p className="image-mentor-description">
          Take or choose a photo of textbook problems, diagrams, notes, or code, then ask about it using voice or text.
        </p>
      </div>

      {/* Hidden file inputs: gallery picker + mobile rear camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
        id="image-file-input"
        disabled={isLoading || status === 'optimizing'}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
        id="camera-file-input"
        disabled={isLoading || status === 'optimizing'}
      />

      {/* Dropzone / Upload Action View (shown when no image is loaded yet) */}
      {!optimizedResult && status !== 'optimizing' && (
        <div className="image-dropzone">
          <div className="dropzone-icon">📸</div>
          <p className="dropzone-title">Upload or Capture a Study Image</p>
          <p className="dropzone-subtitle">
            Supported formats: JPEG, PNG, WebP. High-res camera photos are automatically optimized client-side for mobile reliability.
          </p>

          <div className="dropzone-buttons">
            <button
              type="button"
              className="upload-action-btn primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              📁 Choose from Gallery
            </button>
            <button
              type="button"
              className="upload-action-btn secondary"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isLoading}
              title="Open camera directly on mobile phone"
            >
              📷 Take Photo
            </button>
          </div>
        </div>
      )}

      {/* Active Optimizing View */}
      {status === 'optimizing' && (
        <div className="image-optimizing-card">
          <div className="optimizing-pulse-box">
            <span className="mini-spinner large" aria-hidden="true" />
            <p className="optimizing-text">Optimizing image for mobile safety...</p>
            <p className="optimizing-subtext">Downscaling to 1600px edge to avoid browser memory errors</p>
          </div>
        </div>
      )}

      {/* Optimized Image Preview Card (Requirement 18 Context Layout) */}
      {optimizedResult && (
        <div className="image-preview-card">
          <div className="image-preview-badge-row">
            <span className="image-badge-label">📷 Question image</span>
            {activeInteractionId && (
              <span className="memory-indicator" title="Follow-up question will preserve conversation context">
                ● Memory Active
              </span>
            )}
          </div>

          <div className="image-preview-wrapper">
            <img
              src={optimizedResult.previewUrl}
              alt="Question study material"
              className="image-preview-element"
            />
          </div>

          {/* Image Metadata & Actions */}
          <div className="image-preview-meta">
            <div className="image-meta-info">
              <span className="image-meta-name" title={optimizedResult.file.name}>
                📄 {optimizedResult.file.name}
              </span>
              <span className="image-meta-size">
                {formatFileSize(optimizedResult.optimizedSize)} • {optimizedResult.optimizedWidth}×{optimizedResult.optimizedHeight}px
              </span>
            </div>

            <div className="image-preview-actions">
              <button
                type="button"
                className="image-action-btn change"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || status === 'optimizing'}
                title="Choose a different image"
              >
                🔄 Replace
              </button>
              <button
                type="button"
                className="image-action-btn remove"
                onClick={handleRemoveImage}
                disabled={isLoading || status === 'optimizing'}
                title="Remove current image"
              >
                🗑️ Remove
              </button>
            </div>
          </div>

          {/* Development / Debug Optimization Info (Hidden in Student Mode - Requirement 24) */}
          {isDevMode && (
            <div className="image-optimization-debug">
              <span className="debug-label">⚡ Optimization Info:</span>
              <span className="debug-metric">
                Original: {formatFileSize(optimizedResult.originalSize)} ({optimizedResult.originalWidth}×{optimizedResult.originalHeight})
              </span>
              <span className="debug-arrow">→</span>
              <span className="debug-metric highlight">
                Optimized: {formatFileSize(optimizedResult.optimizedSize)} ({optimizedResult.optimizedWidth}×{optimizedResult.optimizedHeight})
              </span>
              {reductionPercent > 0 && (
                <span className="debug-badge">
                  {reductionPercent}% smaller
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Local validation error banner */}
      {localError && (
        <div className="image-mentor-error" role="alert">
          <span>⚠️ {localError}</span>
          <button
            type="button"
            className="error-dismiss-btn"
            onClick={() => setLocalError(null)}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Combined Question + Voice Input (Requirement 1, 2, 3, 5, 6, 18) */}
      <div className="image-question-container">
        <QuestionInput
          question={question}
          onChange={setQuestion}
          onSubmit={handleSubmit}
          isLoading={isLoading || status === 'optimizing'}
          inputId="image-question-input"
          label="Ask about this image:"
          accessibleVoiceLabel="Ask about this image by voice or type below"
          placeholder={
            optimizedResult
              ? "e.g. 'Explain why this state is final', or 'Find bugs in this code'..."
              : "Capture or select a photo above, then ask your question here or tap 'Speak'..."
          }
          submitButtonText="Ask ByteMind"
          loadingButtonText="Analyzing image..."
          disabled={!optimizedResult || status === 'optimizing'}
          onVoiceStateChange={handleVoiceStateChange}
          quickPrompts={optimizedResult ? SAMPLE_IMAGE_PROMPTS : undefined}
          onSelectPrompt={(p) => setQuestion(p)}
          helperText="Tip: Tap 🎤 Speak to ask by voice, edit your question, and tap Ask ByteMind."
        />
      </div>
    </div>
  );
};
