/**
 * server/services/documentStore.js
 * 
 * WHY THIS SERVICE IS NEEDED:
 * Provides a safe, lightweight in-memory document registry for teacher-uploaded
 * and starter study materials:
 * 1. Zero disk writes: keeps uploaded buffers in server RAM (multer memory storage).
 * 2. Zero duplicate storage: reuses the single in-memory buffer and extracted text
 *    created during document ingestion.
 * 3. Safe document retrieval: enables students to view formatted notes and download
 *    the exact teacher-uploaded PDF/file safely without exposing unrelated system files.
 * 4. Case-insensitive and filename/ID normalized lookup.
 */

// In-memory document storage map: documentId / filename -> DocumentRecord
const documentsMap = new Map();

/**
 * Normalizes document identifier for resilient lookups.
 * @param {string} docId
 * @returns {string}
 */
function normalizeKey(docId) {
  if (!docId || typeof docId !== 'string') return '';
  return docId.trim().toLowerCase().replace(/[^\w.-]/g, '_');
}

/**
 * Registers an uploaded PDF or seeded study material into the document registry.
 * 
 * @param {object} params
 * @param {string} params.filename - e.g. "AImaterial-MBU.pdf" or "dbms-normalization.pdf"
 * @param {Buffer|null} [params.buffer] - Raw file buffer
 * @param {string} [params.mimetype] - MIME type, e.g. "application/pdf" or "text/plain"
 * @param {string} params.text - Extracted document text
 * @param {number} [params.pages] - Total page count
 * @param {number} [params.textLength] - Character count
 * @param {boolean} [params.isStarter] - Whether it is a pre-seeded starter doc
 * @returns {object} Stored document record
 */
export function saveUploadedDocument({
  filename,
  buffer = null,
  mimetype = 'application/pdf',
  text = '',
  pages = 1,
  textLength = 0,
  isStarter = false,
}) {
  if (!filename || typeof filename !== 'string' || !filename.trim()) {
    throw new Error('Filename is required to store document');
  }

  const cleanFilename = filename.trim();
  const cleanDocId = cleanFilename.replace(/[^\w.-]/g, '_');
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  const calculatedLength = textLength || normalizedText.length;

  const docRecord = {
    documentId: cleanDocId,
    filename: cleanFilename,
    buffer: buffer && Buffer.isBuffer(buffer) ? buffer : null,
    mimetype: mimetype || (cleanFilename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain'),
    text: normalizedText,
    pages: typeof pages === 'number' && pages > 0 ? pages : 1,
    textLength: calculatedLength,
    isStarter: Boolean(isStarter),
    uploadedAt: new Date().toISOString(),
  };

  // Register under exact filename, sanitized id, and normalized lowercase key
  documentsMap.set(cleanFilename, docRecord);
  documentsMap.set(cleanDocId, docRecord);
  documentsMap.set(normalizeKey(cleanFilename), docRecord);
  documentsMap.set(normalizeKey(cleanDocId), docRecord);

  // Also register without .pdf extension if applicable
  if (cleanFilename.toLowerCase().endsWith('.pdf')) {
    const baseName = cleanFilename.slice(0, -4);
    documentsMap.set(baseName, docRecord);
    documentsMap.set(normalizeKey(baseName), docRecord);
  }

  return docRecord;
}

/**
 * Retrieves a document record by identifier or filename.
 * @param {string} documentId
 * @returns {object|null}
 */
export function getDocument(documentId) {
  if (!documentId || typeof documentId !== 'string') return null;
  const clean = documentId.trim();

  // 1. Direct match
  if (documentsMap.has(clean)) {
    return documentsMap.get(clean);
  }

  // 2. Normalized key match
  const normKey = normalizeKey(clean);
  if (documentsMap.has(normKey)) {
    return documentsMap.get(normKey);
  }

  // 3. Fallback scan by filename or documentId (case-insensitive)
  const lowerClean = clean.toLowerCase();
  for (const doc of documentsMap.values()) {
    if (
      doc.filename.toLowerCase() === lowerClean ||
      doc.documentId.toLowerCase() === lowerClean ||
      doc.filename.toLowerCase().replace(/\.pdf$/i, '') === lowerClean.replace(/\.pdf$/i, '')
    ) {
      return doc;
    }
  }

  return null;
}

/**
 * Checks if a document exists in storage.
 * @param {string} documentId
 * @returns {boolean}
 */
export function hasDocument(documentId) {
  return getDocument(documentId) !== null;
}

/**
 * Retrieves readable document content (metadata + text) for in-app reader modal.
 * @param {string} documentId
 * @returns {{ filename: string, documentId: string, pages: number, textLength: number, text: string, hasFile: boolean }|null}
 */
export function getDocumentContent(documentId) {
  const doc = getDocument(documentId);
  if (!doc) return null;

  return {
    documentId: doc.documentId,
    filename: doc.filename,
    pages: doc.pages,
    textLength: doc.textLength,
    text: doc.text,
    hasFile: Boolean(doc.buffer && doc.buffer.length > 0),
    mimetype: doc.mimetype,
  };
}

/**
 * Retrieves raw file buffer and mimetype for file download / PDF viewing.
 * @param {string} documentId
 * @returns {{ buffer: Buffer, mimetype: string, filename: string }|null}
 */
export function getDocumentFile(documentId) {
  const doc = getDocument(documentId);
  if (!doc) return null;

  if (doc.buffer && Buffer.isBuffer(doc.buffer)) {
    return {
      buffer: doc.buffer,
      mimetype: doc.mimetype || 'application/pdf',
      filename: doc.filename,
    };
  }

  // If only text is available (e.g. starter doc without PDF bytes), return text as file
  if (doc.text) {
    const isPdfName = doc.filename.toLowerCase().endsWith('.pdf');
    return {
      buffer: Buffer.from(doc.text, 'utf-8'),
      mimetype: isPdfName ? 'text/plain; charset=utf-8' : 'text/plain; charset=utf-8',
      filename: isPdfName ? doc.filename.replace(/\.pdf$/i, '.txt') : `${doc.filename}.txt`,
    };
  }

  return null;
}

/**
 * Lists all registered documents.
 * @returns {Array<{ documentId: string, filename: string, pages: number, textLength: number, isStarter: boolean }>}
 */
export function listDocuments() {
  const seen = new Set();
  const list = [];

  for (const doc of documentsMap.values()) {
    if (!seen.has(doc.documentId)) {
      seen.add(doc.documentId);
      list.push({
        documentId: doc.documentId,
        filename: doc.filename,
        pages: doc.pages,
        textLength: doc.textLength,
        isStarter: doc.isStarter,
        hasFile: Boolean(doc.buffer),
        uploadedAt: doc.uploadedAt,
      });
    }
  }

  return list;
}
