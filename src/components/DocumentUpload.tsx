/**
 * DocumentUpload.tsx
 * 
 * WHY THIS COMPONENT IS NEEDED:
 * Step 5: RAG Document Pipeline Experiment.
 * Provides an accessible, mobile-first interface for students to:
 * 1. Choose a PDF file from their device
 * 2. Upload it to POST /api/documents
 * 3. Inspect the extracted metadata (filename, page count, text length, and text preview)
 * 4. Experience clear, friendly error handling for invalid files, oversized files, or corrupted PDFs
 */

import React, { useState, useRef } from 'react';
import { uploadPdfDocument, generateEmbeddings, searchDocumentChunks } from '../services/documentService';
import { DocumentUploadResult, EmbeddingResult, SearchResponse } from '../types';

interface DocumentUploadProps {
  onAskWithDocument?: (documentId: string) => void;
  isDevMode?: boolean;
}

export function DocumentUpload({ onAskWithDocument, isDevMode = false }: DocumentUploadProps = {}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [result, setResult] = useState<DocumentUploadResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Step 5.3 & RAG progress pipeline states
  const [pipelineStatus, setPipelineStatus] = useState<
    'idle' | 'extracting' | 'chunking' | 'embedding' | 'ready' | 'error'
  >('idle');
  const [isEmbedding, setIsEmbedding] = useState<boolean>(false);
  const [embeddingResult, setEmbeddingResult] = useState<EmbeddingResult | null>(null);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);

  // Step 5.4: Semantic Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [topK, setTopK] = useState<number>(3);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Trigger native file picker dialog
  const handleChoosePdfClick = () => {
    setErrorMessage(null);
    setEmbeddingError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Reset so the same file can be re-selected
      fileInputRef.current.click();
    }
  };

  // Handle file selection from native file picker
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset previous extraction result and errors
    setResult(null);
    setEmbeddingResult(null);
    setErrorMessage(null);
    setEmbeddingError(null);
    setPipelineStatus('idle');

    // Initial validation
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setErrorMessage('Please select a PDF file (.pdf). Other formats are not supported in this experiment.');
      setSelectedFile(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage(`The selected file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Upload limit is 10 MB.`);
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  // Complete end-to-end upload & ingestion pipeline
  const handleUploadAndProcess = async () => {
    if (!selectedFile) {
      setErrorMessage('Please select a PDF document first.');
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);
    setEmbeddingError(null);
    setPipelineStatus('extracting');

    try {
      // 1. Extract PDF text & create chunks on server
      const data = await uploadPdfDocument(selectedFile);
      setResult(data);

      // 2. Chunks created
      setPipelineStatus('chunking');
      await new Promise((r) => setTimeout(r, 250)); // Visual progress transition

      // 3. Generate embeddings using official batch embedding API
      setPipelineStatus('embedding');
      setIsEmbedding(true);
      const embedData = await generateEmbeddings(data.filename);
      setEmbeddingResult(embedData);

      // 4. Document is fully ready for RAG questions
      setPipelineStatus('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred during document processing.';
      setErrorMessage(msg);
      setPipelineStatus('error');
      setEmbeddingResult(null);
    } finally {
      setIsUploading(false);
      setIsEmbedding(false);
    }
  };

  // Clear current document state to test another document
  const handleReset = () => {
    setSelectedFile(null);
    setResult(null);
    setErrorMessage(null);
    setCopied(false);
    setIsEmbedding(false);
    setEmbeddingResult(null);
    setEmbeddingError(null);
    setSearchQuery('');
    setSearchResult(null);
    setSearchError(null);
    setIsSearching(false);
    setPipelineStatus('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Step 5.3: Manual Generate embeddings handler (if triggered separately)
  const handleGenerateEmbeddings = async () => {
    if (!result || !result.filename) return;

    setIsEmbedding(true);
    setEmbeddingError(null);
    setPipelineStatus('embedding');

    try {
      const embedData = await generateEmbeddings(result.filename);
      setEmbeddingResult(embedData);
      setPipelineStatus('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate embeddings.';
      setEmbeddingError(msg);
      setPipelineStatus('error');
      setEmbeddingResult(null);
    } finally {
      setIsEmbedding(false);
    }
  };

  // Step 5.4: Semantic search handler
  const handleSemanticSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query || isSearching) return;

    setIsSearching(true);
    setSearchError(null);

    try {
      const searchRes = await searchDocumentChunks(query, topK, result?.filename);
      setSearchResult(searchRes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Semantic search failed.';
      setSearchError(msg);
    } finally {
      setIsSearching(false);
    }
  };

  // Copy preview text to clipboard
  const handleCopyPreview = async () => {
    if (!result?.textPreview) return;
    try {
      await navigator.clipboard.writeText(result.textPreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy text', e);
    }
  };

  // Format file size helper
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="doc-upload-container">
      <div className="doc-upload-header">
        <div className="doc-upload-title-row">
          <span className="doc-icon">📄</span>
          <div>
            <h2 className="doc-section-title">
              {isDevMode ? 'Document Pipeline (RAG Experiment)' : 'Upload Study Material'}
            </h2>
            <p className="doc-section-desc">
              {isDevMode
                ? 'Upload a PDF document to test server-side text extraction before chunking & embeddings.'
                : 'Upload course notes, textbook chapters, or lecture slides to ask questions about your material.'}
            </p>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        disabled={isUploading}
      />

      {/* File Selection / Action Bar */}
      <div className="doc-action-bar">
        <button
          type="button"
          className="btn btn-secondary doc-choose-btn"
          onClick={handleChoosePdfClick}
          disabled={isUploading || isEmbedding}
        >
          📁 Choose PDF
        </button>

        <button
          type="button"
          className={`btn btn-primary doc-upload-btn ${pipelineStatus === 'ready' ? 'btn-success' : ''}`}
          onClick={handleUploadAndProcess}
          disabled={!selectedFile || isUploading || isEmbedding}
        >
          {pipelineStatus === 'extracting' ? (
            <>
              <span className="spinner-sm" aria-hidden="true" />
              <span>{isDevMode ? 'Extracting PDF...' : 'Reading your material...'}</span>
            </>
          ) : pipelineStatus === 'chunking' || pipelineStatus === 'embedding' ? (
            <>
              <span className="spinner-sm" aria-hidden="true" />
              <span>{isDevMode ? (pipelineStatus === 'chunking' ? 'Creating chunks...' : 'Generating embeddings...') : 'Understanding your material...'}</span>
            </>
          ) : pipelineStatus === 'ready' ? (
            isDevMode ? '✓ Document ready' : 'Study material ready ✓'
          ) : (
            isDevMode ? '⚡ Upload & Ingest' : 'Upload & Prepare Material'
          )}
        </button>
      </div>

      {/* Selected File Badge */}
      {selectedFile && !result && (
        <div className="selected-file-info">
          <span className="file-pill">
            <span className="file-icon">📎</span>
            <span className="file-name">{selectedFile.name}</span>
            <span className="file-size">({formatFileSize(selectedFile.size)})</span>
          </span>
          <button
            type="button"
            className="clear-file-btn"
            onClick={handleReset}
            title="Remove selection"
            disabled={isUploading}
          >
            ✕
          </button>
        </div>
      )}

      {/* Friendly Student Progress Bar (Requirement 11) */}
      {!isDevMode && (pipelineStatus === 'extracting' || pipelineStatus === 'chunking' || pipelineStatus === 'embedding') && (
        <div className="student-processing-card">
          <div className="student-processing-header">
            <span className="spinner-sm" aria-hidden="true" />
            <span className="student-processing-status">
              {pipelineStatus === 'extracting' ? 'Reading your material...' : 'Understanding your material...'}
            </span>
          </div>
          <div className="student-processing-track">
            <div
              className={`student-processing-bar ${
                pipelineStatus === 'extracting' ? 'reading' : 'understanding'
              }`}
            />
          </div>
        </div>
      )}

      {/* Error Message Alert */}
      {errorMessage && (
        <div className="doc-error-alert" role="alert">
          <span className="error-icon">⚠️</span>
          <div className="error-body">
            <strong>{isDevMode ? 'Extraction Error:' : 'Notice:'}</strong>
            <p>{errorMessage}</p>
          </div>
          <button
            type="button"
            className="clear-error-btn"
            onClick={() => setErrorMessage(null)}
            title="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Student Mode Document Ready Card (Requirement 10) */}
      {!isDevMode && result && (
        <div className="student-doc-card">
          <div className="student-doc-header">
            <div className="student-doc-icon-wrap">
              <span className="student-doc-icon">📄</span>
            </div>
            <div className="student-doc-details">
              <h3 className="student-doc-filename" title={result.filename}>
                {result.filename}
              </h3>
              <p className="student-doc-status">
                <span className="ready-check">✓</span> Study material ready
              </p>
            </div>
          </div>

          <div className="student-doc-actions">
            {onAskWithDocument && (
              <button
                type="button"
                className="btn-student-ask"
                onClick={() => onAskWithDocument(result.filename)}
              >
                💬 Ask questions about this material
              </button>
            )}
            <button
              type="button"
              className="btn-student-reset"
              onClick={handleReset}
              title="Upload another PDF"
            >
              Upload another PDF
            </button>
          </div>
        </div>
      )}

      {/* Developer Mode Extraction Results & Diagnostics Display (Requirement 5) */}
      {isDevMode && result && (
        <div className="doc-result-panel">
          <div className="dev-panel-banner">
            🛠️ Developer Mode Active: Inspecting Raw Extraction, Chunks, 768-D Embeddings & Semantic Search
          </div>
          <div className="result-header">
            <div className="result-badge">
              <span className="check-icon">✓</span> Extracted on Server
            </div>
            <button
              type="button"
              className="btn-text-reset"
              onClick={handleReset}
            >
              Upload another PDF
            </button>
          </div>

          <div className="result-stats-grid">
            <div className="stat-card">
              <span className="stat-label">Filename</span>
              <span className="stat-value file-value" title={result.filename}>
                {result.filename}
              </span>
            </div>

            <div className="stat-card">
              <span className="stat-label">Pages</span>
              <span className="stat-value">{result.pages}</span>
            </div>

            <div className="stat-card">
              <span className="stat-label">Extracted Characters</span>
              <span className="stat-value">{result.textLength.toLocaleString()}</span>
            </div>

            <div className="stat-card">
              <span className="stat-label">Total Chunks</span>
              <span className="stat-value stat-highlight">{result.totalChunks}</span>
            </div>
          </div>

          {/* Step 5.2: Document Chunks Preview List */}
          {result.chunks && result.chunks.length > 0 && (
            <div className="chunks-section">
              <div className="chunks-header">
                <div className="chunks-title-group">
                  <span className="chunks-title">Document Chunks ({result.totalChunks})</span>
                  <span className="chunks-subtitle">
                    Split into ~800–1200 words with ~100–150 words overlap for RAG
                  </span>
                </div>
              </div>

              <div className="chunks-list">
                {result.chunks.map((chunk) => (
                  <div key={chunk.chunkId} className="chunk-card">
                    <div className="chunk-header">
                      <div className="chunk-title-group">
                        <span className="chunk-badge">Chunk {chunk.chunkIndex}</span>
                        <code className="chunk-id">{chunk.chunkId}</code>
                      </div>
                      <span className="chunk-meta">
                        {chunk.wordCount} words • {chunk.charCount.toLocaleString()} chars
                      </span>
                    </div>
                    <div className="chunk-preview-box">
                      <p className="chunk-preview-text">"{chunk.preview}"</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 5.3: Generate Embeddings Control */}
          {result.chunks && result.chunks.length > 0 && (
            <div className="embedding-control-card">
              <div className="embedding-control-header">
                <div>
                  <h4 className="embedding-title">Vector Embeddings (Step 5.3)</h4>
                  <p className="embedding-desc">
                    Generate 768-dimensional numerical vectors using Gemini's <code>gemini-embedding-2</code> model.
                  </p>
                </div>
                {!embeddingResult && (
                  <button
                    type="button"
                    className="btn btn-primary doc-embed-btn"
                    onClick={handleGenerateEmbeddings}
                    disabled={isEmbedding}
                  >
                    {isEmbedding ? (
                      <>
                        <span className="spinner-sm" aria-hidden="true" />
                        <span>Generating embeddings...</span>
                      </>
                    ) : (
                      '🧬 Generate 768-D Embeddings'
                    )}
                  </button>
                )}
              </div>

              {embeddingError && (
                <div className="doc-error-alert embedding-error" role="alert">
                  <span className="error-icon">⚠️</span>
                  <div className="error-body">
                    <strong>Embedding Error:</strong>
                    <p>{embeddingError}</p>
                  </div>
                </div>
              )}

              {embeddingResult && (
                <div className="embedding-result-box">
                  <div className="embedding-badge-row">
                    <span className="embedding-status-badge doc-ready-badge">
                      ✓ Document ready ({embeddingResult.storageMode === 'pgvector' ? 'PostgreSQL' : 'RAM cache'})
                    </span>
                    <span className="model-tag">gemini-embedding-2 • 768-D</span>
                    {embeddingResult.storageMode && (
                      <span className={`storage-pill ${embeddingResult.storageMode}`}>
                        {embeddingResult.storageMode === 'pgvector' ? '🐘 Persistent DB' : '🧠 RAM Store'}
                      </span>
                    )}
                  </div>

                  <div className="embedding-stats-row">
                    <span className="embed-stat">
                      <strong>Chunks Embedded:</strong> {embeddingResult.chunksProcessed}
                    </span>
                    <span className="embed-stat">
                      <strong>Vector Dimensions:</strong> {embeddingResult.embeddingDimensions}
                    </span>
                    {onAskWithDocument && (
                      <button
                        type="button"
                        className="btn-rag-action"
                        onClick={() => onAskWithDocument(embeddingResult.documentId)}
                      >
                        💬 Ask Mentor about this document
                      </button>
                    )}
                  </div>

                  <div className="embedding-sample-box">
                    <div className="sample-header">
                      <span>Vector Sample ({embeddingResult.sample.chunkId}):</span>
                    </div>
                    <code className="sample-vector">
                      [
                      {embeddingResult.sample.embeddingPreview.map((v) => v.toFixed(5)).join(', ')}
                      , ... 763 more dimensions]
                    </code>
                  </div>

                  {/* Step 5.4: Test Semantic Search Section */}
                  <div className="semantic-search-section">
                    <div className="search-section-header">
                      <span className="search-title">🔍 Test Semantic Search (Step 5.4)</span>
                      <span className="search-subtitle">
                        Find top matching chunks using 768-D vector cosine similarity
                      </span>
                    </div>

                    <form onSubmit={handleSemanticSearch} className="search-form">
                      <div className="search-input-group">
                        <input
                          type="text"
                          className="search-input"
                          placeholder="e.g., What is partial dependency? or How does indexing work?"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          disabled={isSearching}
                        />

                        <div className="topk-dropdown-group">
                          <label htmlFor="topk-select">Top-K:</label>
                          <select
                            id="topk-select"
                            value={topK}
                            onChange={(e) => setTopK(Number(e.target.value))}
                            disabled={isSearching}
                            className="topk-select"
                          >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                            <option value={5}>5</option>
                          </select>
                        </div>

                        <button
                          type="submit"
                          className="btn btn-primary search-submit-btn"
                          disabled={!searchQuery.trim() || isSearching}
                        >
                          {isSearching ? (
                            <>
                              <span className="spinner-sm" aria-hidden="true" />
                              <span>Searching...</span>
                            </>
                          ) : (
                            'Search'
                          )}
                        </button>
                      </div>
                    </form>

                    {searchError && (
                      <div className="doc-error-alert search-error-alert" role="alert">
                        <span className="error-icon">⚠️</span>
                        <div className="error-body">
                          <p>{searchError}</p>
                        </div>
                      </div>
                    )}

                    {searchResult && (
                      <div className="search-results-container">
                        <div className="search-results-meta">
                          <span>
                            Top {searchResult.results.length} Chunks for: <em>"{searchResult.query}"</em>
                          </span>
                        </div>

                        <div className="search-results-list">
                          {searchResult.results.map((item, idx) => (
                            <div key={item.chunkId} className="search-result-card">
                              <div className="result-card-header">
                                <div className="result-badge-group">
                                  <span className="rank-badge">#{idx + 1}</span>
                                  <span className="chunk-badge">Chunk {item.chunkIndex}</span>
                                  <code className="chunk-id">{item.chunkId}</code>
                                </div>
                                <span className="similarity-pill">
                                  Similarity: <strong>{item.similarity.toFixed(4)}</strong> ({(item.similarity * 100).toFixed(1)}%)
                                </span>
                              </div>
                              <p className="search-preview-text">"{item.textPreview}"</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="preview-container">
            <div className="preview-header">
              <span className="preview-title">Full Document Preview (First 300 chars)</span>
              <button
                type="button"
                className="btn-copy-preview"
                onClick={handleCopyPreview}
                title="Copy preview text"
              >
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <div className="preview-box">
              <pre className="preview-text">{result.textPreview}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
