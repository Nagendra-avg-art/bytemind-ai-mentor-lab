/**
 * documentService.ts
 * 
 * WHY THIS FILE IS NEEDED:
 * Frontend API client service for document management (Step 5: RAG Document Pipeline).
 * 
 * Key Responsibilities:
 * 1. Performs initial client-side validation (file selection, extension/MIME check, size check).
 * 2. Packages the PDF into a FormData multipart request.
 * 3. Uses getApiUrl() from ./apiConfig for reliable desktop and mobile LAN access.
 * 4. Normalizes network/server error responses into user-friendly messages for the student.
 */

import { DocumentUploadResult, DocumentChunk, EmbeddingResult, SearchResponse } from '../types';
import { getApiUrl, handleApiFetchError } from './apiConfig';

interface ApiErrorResponse {
  error?: string;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit

/**
 * Uploads a PDF document to the server for text extraction.
 * 
 * @param file - The user-selected PDF File object
 * @returns Promise<DocumentUploadResult> - Extraction summary from server
 */
export async function uploadPdfDocument(file: File): Promise<DocumentUploadResult> {
  // 1. Client-side validation
  if (!file) {
    throw new Error('Please choose a PDF file before uploading.');
  }

  const isPdfExtension = file.name.toLowerCase().endsWith('.pdf');
  const isPdfMime = file.type === 'application/pdf';

  if (!isPdfExtension && !isPdfMime) {
    throw new Error('Invalid file type. Please select a valid PDF file (.pdf).');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 10 MB limit. Please select a smaller PDF.`
    );
  }

  if (file.size === 0) {
    throw new Error('The selected PDF file is empty (0 bytes). Please select a valid document.');
  }

  // 2. Prepare FormData payload
  const formData = new FormData();
  formData.append('document', file);

  try {
    // 3. Send multipart POST request to backend
    const response = await fetch(getApiUrl('/api/documents'), {
      method: 'POST',
      body: formData,
    });

    const data: (DocumentUploadResult & ApiErrorResponse) = await response.json().catch(() => ({
      error: `Server returned non-JSON response with HTTP status ${response.status}`,
    }));

    if (!response.ok) {
      const message = data.error || `Upload failed with HTTP status ${response.status}`;
      throw new Error(message);
    }

    if (!data.success) {
      throw new Error(data.error || 'Server did not return a successful extraction result.');
    }

    return {
      success: true,
      filename: data.filename,
      pages: data.pages,
      textLength: data.textLength,
      textPreview: data.textPreview,
      totalChunks: data.totalChunks || (data.chunks ? data.chunks.length : 0),
      chunks: data.chunks || [],
    };
  } catch (error) {
    handleApiFetchError(error);
  }
}

/**
 * Triggers server-side generation of 768-dimensional embeddings for document chunks.
 * 
 * @param documentId - The identifier/filename of the document
 * @param chunks - Optional array of chunks (if not already cached on server)
 * @returns Promise<EmbeddingResult> - Metadata summary of the generated embeddings
 */
export async function generateEmbeddings(
  documentId: string,
  chunks?: DocumentChunk[]
): Promise<EmbeddingResult> {
  if (!documentId || !documentId.trim()) {
    throw new Error('Please provide a document ID to generate embeddings.');
  }

  try {
    const response = await fetch(getApiUrl('/api/documents/embed'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documentId: documentId.trim(),
        chunks,
      }),
    });

    const data: (EmbeddingResult & ApiErrorResponse) = await response.json().catch(() => ({
      error: `Server returned non-JSON response with HTTP status ${response.status}`,
    }));

    if (!response.ok) {
      const message = data.error || `Embedding request failed with HTTP status ${response.status}`;
      throw new Error(message);
    }

    if (!data.success) {
      throw new Error(data.error || 'Server did not return a successful embedding result.');
    }

    return data;
  } catch (error) {
    handleApiFetchError(error);
  }
}

/**
 * Executes a semantic search query over embedded document chunks.
 * 
 * @param query - The search query / student question
 * @param topK - Number of top chunks to retrieve (default: 3)
 * @param documentId - Optional document filter
 * @returns Promise<SearchResponse> - Ranked relevant chunks with similarity scores
 */
export async function searchDocumentChunks(
  query: string,
  topK: number = 3,
  documentId?: string
): Promise<SearchResponse> {
  if (!query || !query.trim()) {
    throw new Error('Please enter a search query.');
  }

  try {
    const response = await fetch(getApiUrl('/api/search'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query.trim(),
        topK,
        documentId,
      }),
    });

    const data: (SearchResponse & ApiErrorResponse) = await response.json().catch(() => ({
      error: `Server returned non-JSON response with HTTP status ${response.status}`,
    }));

    if (!response.ok) {
      const message = data.error || `Search failed with HTTP status ${response.status}`;
      throw new Error(message);
    }

    if (!data.success) {
      throw new Error(data.error || 'Server did not return a successful search result.');
    }

    return data;
  } catch (error) {
    handleApiFetchError(error);
  }
}
