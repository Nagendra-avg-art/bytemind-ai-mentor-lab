/**
 * src/services/teacherService.ts
 * 
 * Frontend API service for the Teacher Hub and Shared Artifact workflows.
 * Communicates with backend endpoints under /api/teacher/* and /api/share/*
 */

export interface QuestionItem {
  id: string;
  prompt: string;
  type?: 'multiple_choice' | 'short_answer';
  options?: string[];
  correctAnswer?: string;
}

export interface PublishedArtifact {
  id: string;
  artifactId?: string;
  teacherId?: string;
  shareId: string;
  type: string;
  title: string;
  description: string;
  instructions?: string;
  content?: string;
  documentId?: string | null;
  documentFilename?: string | null;
  documentText?: string | null;
  documentPages?: number | null;
  hasFile?: boolean;
  questions: QuestionItem[];
  allowAiAssistance: boolean;
  createdAt: string;
  status?: string;
}

export interface SubmissionRecord {
  submissionId: string;
  teacherId?: string;
  artifactId?: string;
  shareId: string;
  artifactTitle: string;
  artifactType: string;
  studentName: string;
  studentId?: string;
  studentIdentifier?: string;
  answers: Record<string, string>;
  submittedAt: string;
  status: 'submitted' | 'reviewed';
}

export interface CreateArtifactPayload {
  teacherId?: string;
  type: 'notes' | 'assignment' | 'quiz' | 'NOTES' | 'ASSIGNMENT' | 'QUIZ';
  title: string;
  description?: string;
  instructions?: string;
  content?: string;
  documentId?: string | null;
  questions?: QuestionItem[];
  allowAiAssistance?: boolean;
  customShareId?: string;
}

export interface AskSharedResponse {
  success: boolean;
  answer: string;
  interactionId: string;
  provider: string;
  artifactType: string;
  artifactTitle: string;
  sources?: any[];
}

/**
 * Storage key for lightweight Teacher session identity
 */
const TEACHER_STORAGE_KEY = 'bytemind_teacher_id';

/**
 * Generates or restores a lightweight Teacher session ID (e.g. TCH-X7K29P).
 * Enables clean multi-teacher isolation without requiring full account infrastructure.
 */
export function getOrCreateTeacherId(): string {
  try {
    let id = localStorage.getItem(TEACHER_STORAGE_KEY);
    if (!id || !id.trim()) {
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      id = `TCH-${code}`;
      localStorage.setItem(TEACHER_STORAGE_KEY, id);
    }
    return id.trim();
  } catch {
    return 'TCH-DEFAULT';
  }
}

/**
 * Returns backend API base URL.
 */
function getApiUrl(path: string): string {
  return path;
}

/**
 * Fetches published artifacts for the Teacher Hub, filtered by teacherId.
 */
export async function fetchPublishedArtifacts(teacherId?: string): Promise<PublishedArtifact[]> {
  const tid = teacherId || getOrCreateTeacherId();
  const query = tid ? `?teacherId=${encodeURIComponent(tid)}` : '';
  const response = await fetch(getApiUrl(`/api/teacher/artifacts${query}`), {
    headers: { 'x-teacher-id': tid },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch published materials (${response.status})`);
  }
  const data = await response.json();
  return data.artifacts || [];
}

/**
 * Creates and publishes a new learning material artifact bound to the teacherId.
 */
export async function createPublishedArtifact(payload: CreateArtifactPayload): Promise<PublishedArtifact> {
  const tid = payload.teacherId || getOrCreateTeacherId();
  const fullPayload = { ...payload, teacherId: tid };
  const response = await fetch(getApiUrl('/api/teacher/artifacts'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-teacher-id': tid,
    },
    body: JSON.stringify(fullPayload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to publish material (${response.status})`);
  }

  const data = await response.json();
  return data.artifact;
}

/**
 * Fetches student submissions for the Teacher Hub, isolated by teacherId.
 */
export async function fetchSubmissions(teacherId?: string, shareId?: string): Promise<SubmissionRecord[]> {
  const tid = teacherId || getOrCreateTeacherId();
  const params = new URLSearchParams();
  if (tid) params.set('teacherId', tid);
  if (shareId) params.set('shareId', shareId);
  const query = params.toString() ? `?${params.toString()}` : '';

  const response = await fetch(getApiUrl(`/api/teacher/submissions${query}`), {
    headers: { 'x-teacher-id': tid },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch submissions (${response.status})`);
  }
  const data = await response.json();
  return data.submissions || [];
}

/**
 * Public endpoint: Loads a published artifact for a student by its shareId.
 */
export async function fetchSharedArtifact(shareId: string): Promise<PublishedArtifact> {
  const cleanId = shareId.trim().toLowerCase();
  const response = await fetch(getApiUrl(`/api/share/${encodeURIComponent(cleanId)}`));
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Material not found for code: "${shareId}"`);
  }
  const data = await response.json();
  return data.artifact;
}

/**
 * Public endpoint: Submits student answers for an assignment or quiz.
 */
export async function submitSharedAnswers(
  shareId: string,
  payload: { studentName: string; studentId?: string; studentIdentifier?: string; answers: Record<string, string> }
): Promise<{ success: boolean; submissionId: string; submittedAt: string }> {
  const response = await fetch(getApiUrl(`/api/share/${encodeURIComponent(shareId)}/submit`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentName: payload.studentName,
      studentId: payload.studentId,
      studentIdentifier: payload.studentIdentifier || (payload.studentId ? `${payload.studentName} (${payload.studentId})` : payload.studentName),
      answers: payload.answers,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to submit answers (${response.status})`);
  }

  const data = await response.json();
  return {
    success: true,
    submissionId: data.submissionId || data.submission?.submissionId || 'sub_recorded',
    submittedAt: data.submittedAt || data.submission?.submittedAt || new Date().toISOString(),
  };
}

/**
 * Public endpoint: Asks a grounded AI question about the shared teacher material.
 */
export async function askAboutSharedArtifact(
  shareId: string,
  question: string,
  interactionId?: string,
  isSubmitted?: boolean
): Promise<AskSharedResponse> {
  const response = await fetch(getApiUrl(`/api/share/${encodeURIComponent(shareId)}/ask`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, interactionId, isSubmitted }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `AI error on shared material (${response.status})`);
  }

  return response.json();
}

/**
 * Returns direct URL to open or download the published document file.
 */
export function getDocumentFileUrl(documentId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/file`;
}

/**
 * Fetches the document text and metadata for in-app reader modal.
 */
export async function fetchDocumentContent(documentId: string): Promise<{
  filename: string;
  documentId: string;
  pages: number;
  textLength: number;
  text: string;
  hasFile?: boolean;
}> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/content`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch document content (${response.status})`);
  }
  return response.json();
}

const STORAGE_ASSESSMENT_SESSION_KEY = 'bytemind_assessment_session';

export function isAssessmentModeType(type?: string): boolean {
  if (!type) return false;
  const t = type.trim().toUpperCase();
  return t === 'ASSIGNMENT' || t === 'QUIZ' || t === 'TEST' || t === 'EXAM';
}

export function getClientAssessmentSession(): string {
  try {
    let sess = sessionStorage.getItem(STORAGE_ASSESSMENT_SESSION_KEY);
    if (!sess) {
      sess = `asm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(STORAGE_ASSESSMENT_SESSION_KEY, sess);
    }
    return sess;
  } catch {
    return `asm_${Date.now()}`;
  }
}

export function isAssessmentActiveClient(): boolean {
  try {
    return sessionStorage.getItem('bytemind_assessment_active') === 'true';
  } catch {
    return false;
  }
}

export function setAssessmentActiveClient(active: boolean, sessionId?: string): void {
  try {
    if (active) {
      sessionStorage.setItem('bytemind_assessment_active', 'true');
      if (sessionId) {
        sessionStorage.setItem(STORAGE_ASSESSMENT_SESSION_KEY, sessionId);
      }
    } else {
      sessionStorage.removeItem('bytemind_assessment_active');
      sessionStorage.removeItem(STORAGE_ASSESSMENT_SESSION_KEY);
    }
  } catch {
    // ignore
  }
}

export async function startAssessmentSessionApi(params: {
  shareId: string;
  artifactType: string;
  artifactTitle?: string;
  sessionId?: string;
}): Promise<void> {
  const sessionId = params.sessionId || getClientAssessmentSession();
  setAssessmentActiveClient(true, sessionId);
  await fetch(getApiUrl('/api/assessment/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, sessionId }),
  }).catch((err) => console.warn('Failed to start assessment session on backend:', err));
}

export async function endAssessmentSessionApi(params?: {
  shareId?: string;
  sessionId?: string;
}): Promise<void> {
  setAssessmentActiveClient(false);
  const sessionId = params?.sessionId || getClientAssessmentSession();
  await fetch(getApiUrl('/api/assessment/end'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, sessionId }),
  }).catch((err) => console.warn('Failed to end assessment session on backend:', err));
}
