/**
 * aiService.ts
 * 
 * WHY THIS FILE IS NEEDED:
 * Frontend API client layer.
 * 
 * Phone-First & Multi-Turn Features:
 * - Uses dynamic getApiUrl() from ./apiConfig for seamless LAN mobile access and Vite proxy routing.
 * - Standardizes on friendly mobile network failure notices ("ByteMind can't reach the learning server...").
 * - Supports multi-turn conversation memory with interactionId.
 * - Routes to General Mentor, Document RAG, Multimodal Image Vision, Learning Coach, and Classroom Assistant.
 */

import {
  AskAIResponse,
  RAGAskResponse,
  ImageAskResponse,
  AgentResponse,
  ClassroomActionResponse,
  ClassroomIntent,
} from '../types';
import { getApiUrl, handleApiFetchError } from './apiConfig';
import { isAssessmentActiveClient, getClientAssessmentSession } from './teacherService';

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

/**
 * Guards against calling any AI service when Assessment Mode is active.
 * Throws an immediate error without sending any network request.
 */
function assertAssessmentInactive(): void {
  if (isAssessmentActiveClient()) {
    const err = new Error('AI assistance is disabled during this assessment.');
    (err as any).statusCode = 403;
    (err as any).serverData = {
      error: 'ASSESSMENT_MODE_ACTIVE',
      message: 'AI assistance is disabled during this assessment.',
    };
    throw err;
  }
}

/**
 * Attaches client assessment tracking headers to outbound AI requests.
 */
function getAssessmentHeaders(): Record<string, string> {
  const active = isAssessmentActiveClient();
  return {
    'X-Assessment-Active': active ? 'true' : 'false',
    'X-Assessment-Session': getClientAssessmentSession(),
  };
}

/**
 * Sends the user prompt and optional interactionId to the backend /api/ask endpoint.
 * 
 * @param prompt - The question entered by the student
 * @param interactionId - Optional ID of the previous interaction turn (for multi-turn memory)
 * @returns Promise<AskAIResponse> - The AI answer and the new interactionId
 */
export async function sendPromptToAI(
  prompt: string,
  interactionId?: string,
  externalSignal?: AbortSignal
): Promise<AskAIResponse> {
  assertAssessmentInactive();
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('Please enter a question before asking AI.');
  }

  // 245s frontend timeout guard (slightly above 240s server timeout)
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => {
    timeoutController.abort(new Error('LOCAL_AI_TIMEOUT'));
  }, 245000);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutTimer);
      throw new Error('Request was cancelled.');
    }
    externalSignal.addEventListener('abort', () => {
      timeoutController.abort(externalSignal.reason);
    });
  }

  try {
    const requestBody: { question: string; interactionId?: string } = {
      question: trimmedPrompt,
    };

    if (interactionId && interactionId.trim()) {
      requestBody.interactionId = interactionId.trim();
    }

    const response = await fetch(getApiUrl('/api/ask'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAssessmentHeaders(),
      },
      body: JSON.stringify(requestBody),
      signal: timeoutController.signal,
    });

    const data: (AskAIResponse & ApiErrorResponse & { message?: string }) = await response.json().catch(() => ({
      error: `Server returned non-JSON response with HTTP status ${response.status}`,
    }));

    if (!response.ok) {
      const serverErrorMessage = data.message || data.error || `Request failed with HTTP status ${response.status}`;
      const err = new Error(serverErrorMessage);
      (err as any).statusCode = response.status;
      (err as any).serverData = data;
      throw err;
    }

    if (!data.answer) {
      throw new Error('Received an empty answer from the server.');
    }

    return {
      answer: data.answer,
      interactionId: data.interactionId || '',
      provider: data.provider,
      model: data.model,
      executionMs: data.executionMs,
      localAI: data.localAI,
    };
  } catch (error: any) {
    if (timeoutController.signal.aborted || error?.name === 'AbortError' || error?.message?.includes('LOCAL_AI_TIMEOUT')) {
      const timeoutErr = new Error("ByteMind local AI took too long to respond.");
      (timeoutErr as any).statusCode = 504;
      (timeoutErr as any).code = 'LOCAL_AI_TIMEOUT';
      throw timeoutErr;
    }
    handleApiFetchError(error);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

/**
 * Sends the user question, optional documentId, topK, and interactionId to POST /api/rag/ask.
 * Returns grounded answer + sources metadata.
 */
export async function sendRAGPromptToAI(
  prompt: string,
  options?: {
    documentId?: string;
    interactionId?: string;
    topK?: number;
  }
): Promise<RAGAskResponse> {
  assertAssessmentInactive();
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('Please enter a question before asking AI.');
  }

  // 245s frontend timeout guard (slightly above 240s server timeout)
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => {
    timeoutController.abort(new Error('LOCAL_AI_TIMEOUT'));
  }, 245000);

  try {
    const requestBody: {
      question: string;
      documentId?: string;
      interactionId?: string;
      topK?: number;
    } = {
      question: trimmedPrompt,
    };

    if (options?.documentId && options.documentId.trim()) {
      requestBody.documentId = options.documentId.trim();
    }

    if (options?.interactionId && options.interactionId.trim()) {
      requestBody.interactionId = options.interactionId.trim();
    }

    if (options?.topK) {
      requestBody.topK = options.topK;
    }

    const response = await fetch(getApiUrl('/api/rag/ask'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAssessmentHeaders(),
      },
      body: JSON.stringify(requestBody),
      signal: timeoutController.signal,
    });

    const data: (RAGAskResponse & ApiErrorResponse & { message?: string }) = await response.json().catch(() => ({
      error: `Server returned non-JSON response with HTTP status ${response.status}`,
    }));

    if (!response.ok) {
      const serverErrorMessage = data.message || data.error || `Request failed with HTTP status ${response.status}`;
      const err = new Error(serverErrorMessage);
      (err as any).statusCode = response.status;
      (err as any).serverData = data;
      throw err;
    }

    if (!data.answer) {
      throw new Error('Received an empty answer from the RAG server.');
    }

    return {
      success: data.success ?? true,
      answer: data.answer,
      interactionId: data.interactionId || '',
      sources: data.sources || [],
      provider: data.provider,
      model: data.model,
      executionMs: data.executionMs,
      localAI: data.localAI,
    };
  } catch (error: any) {
    if (timeoutController.signal.aborted || error?.name === 'AbortError' || error?.message?.includes('LOCAL_AI_TIMEOUT')) {
      const timeoutErr = new Error("ByteMind local AI took too long to respond.");
      (timeoutErr as any).statusCode = 504;
      (timeoutErr as any).code = 'LOCAL_AI_TIMEOUT';
      throw timeoutErr;
    }
    handleApiFetchError(error);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

/**
 * Sends an image file and question to POST /api/image/ask (Step 6: Multimodal Image Understanding)
 * 
 * @param imageFile - Selected or captured image File from browser input
 * @param prompt - Question asked by the student about the image
 * @param interactionId - Optional conversation memory ID
 * @returns Promise<ImageAskResponse>
 */
export async function sendImagePromptToAI(
  imageFile: File,
  prompt: string,
  interactionId?: string
): Promise<ImageAskResponse> {
  assertAssessmentInactive();
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('Please enter a question about the image.');
  }

  if (!imageFile) {
    throw new Error('Please select or capture an image first.');
  }

  try {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('question', trimmedPrompt);

    if (interactionId && interactionId.trim()) {
      formData.append('interactionId', interactionId.trim());
    }

    const response = await fetch(getApiUrl('/api/image/ask'), {
      method: 'POST',
      headers: {
        ...getAssessmentHeaders(),
      },
      body: formData,
    });

    const data: (ImageAskResponse & ApiErrorResponse) = await response.json().catch(() => ({
      error: `Server returned non-JSON response with HTTP status ${response.status}`,
    }));

    if (!response.ok) {
      const serverErrorMessage = data.error || `Request failed with HTTP status ${response.status}`;
      throw new Error(serverErrorMessage);
    }

    if (!data.answer) {
      throw new Error('Received an empty answer from the Image Mentor service.');
    }

    return {
      success: data.success ?? true,
      answer: data.answer,
      interactionId: data.interactionId || '',
      provider: data.provider,
      model: data.model,
      executionMs: data.executionMs,
      localAI: data.localAI,
    };
  } catch (error) {
    handleApiFetchError(error);
  }
}

/**
 * Sends a learning goal to POST /api/agent/learn for the Learning Agent orchestrator (Step 8.1)
 * 
 * @param goal - The student's learning goal (e.g. "Help me prepare for my DBMS exam")
 * @param options - Optional documentId and interactionId
 * @returns Promise<AgentResponse>
 */
export async function sendAgentGoal(
  goal: string,
  options?: {
    documentId?: string;
    interactionId?: string;
  }
): Promise<AgentResponse> {
  assertAssessmentInactive();
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) {
    throw new Error('Please enter a learning goal before asking the Learning Coach.');
  }

  // 125s frontend timeout guard (slightly above 120s server timeout)
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => {
    timeoutController.abort(new Error('LOCAL_AI_TIMEOUT'));
  }, 125000);

  try {
    const requestBody: {
      goal: string;
      documentId?: string;
      interactionId?: string;
    } = {
      goal: trimmedGoal,
    };

    if (options?.documentId && options.documentId.trim()) {
      requestBody.documentId = options.documentId.trim();
    }
    if (options?.interactionId && options.interactionId.trim()) {
      requestBody.interactionId = options.interactionId.trim();
    }

    const response = await fetch(getApiUrl('/api/agent/learn'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAssessmentHeaders(),
      },
      body: JSON.stringify(requestBody),
      signal: timeoutController.signal,
    });

    const data: (AgentResponse & ApiErrorResponse) = await response.json().catch(() => ({
      error: `Server returned non-JSON response with HTTP status ${response.status}`,
    }));

    if (!response.ok) {
      const serverErrorMessage = data.error || `Request failed with HTTP status ${response.status}`;
      throw new Error(serverErrorMessage);
    }

    return data;
  } catch (error: any) {
    if (timeoutController.signal.aborted || error?.name === 'AbortError' || error?.message?.includes('LOCAL_AI_TIMEOUT')) {
      const timeoutErr = new Error("Learning Agent request timed out. Please try again.");
      (timeoutErr as any).statusCode = 504;
      (timeoutErr as any).code = 'TIMEOUT';
      throw timeoutErr;
    }
    handleApiFetchError(error);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

/**
 * Sends a classroom action to POST /api/agent/classroom (Pre-Hackathon Experiment: Classroom Assistant)
 * 
 * @param documentId - The lecture PDF document filename/ID
 * @param action - The classroom action intent (CLASSROOM_SUMMARY, TOPIC_IDENTIFICATION, ASSIGNMENT_GENERATION, ASSESSMENT_GENERATION)
 * @param interactionId - Optional conversation turn ID
 * @returns Promise<ClassroomActionResponse>
 */
export async function sendClassroomAction(
  documentId: string,
  action: ClassroomIntent | string,
  interactionId?: string
): Promise<ClassroomActionResponse> {
  assertAssessmentInactive();
  const trimmedDoc = documentId.trim();
  if (!trimmedDoc) {
    throw new Error('Please select or upload a lecture PDF document first.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 30000); // 30-second hard client timeout

  try {
    const requestBody: {
      action: string;
      intent: string;
      documentId: string;
      interactionId?: string;
    } = {
      action: typeof action === 'string' ? action.trim() : action,
      intent: typeof action === 'string' ? action.trim() : action,
      documentId: trimmedDoc,
    };

    if (interactionId && interactionId.trim()) {
      requestBody.interactionId = interactionId.trim();
    }

    const response = await fetch(getApiUrl('/api/agent/classroom'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAssessmentHeaders(),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const data: (ClassroomActionResponse & ApiErrorResponse) = await response.json().catch(() => ({
      error: `Server returned non-JSON response with HTTP status ${response.status}`,
    }));

    if (!response.ok) {
      const serverErrorMessage = data.error || `Request failed with HTTP status ${response.status}`;
      const err: any = new Error(serverErrorMessage);
      err.code = data.code;
      err.geminiStatus = data.geminiStatus;
      err.statusCode = response.status;
      throw err;
    }

    return data;
  } catch (error: any) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw new Error('Classroom Assistant request timed out after 30 seconds. Please try again.');
    }
    if (error instanceof Error) {
      // Re-throw specific server errors (quota, rate limit, timeout, bad input) directly
      throw error;
    }
    handleApiFetchError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches the list of all indexed documents in the shared storage.
 */
export async function fetchAvailableDocuments(): Promise<Array<{ id: string; filename: string; chunksCount: number; ready: boolean }>> {
  try {
    const response = await fetch(getApiUrl('/api/documents'));
    if (!response.ok) return [];
    const data = await response.json();
    return data.documents || [];
  } catch (error) {
    handleApiFetchError(error);
  }
}

/**
 * Step 15: Fetches the Local AI Feasibility Lab status from GET /api/local-ai/status
 */
export async function fetchLocalAiStatus(): Promise<{
  enabled: boolean;
  model: string;
  runtime: string;
  status: string;
  disclaimer: string;
  lastError?: string | null;
}> {
  try {
    const response = await fetch(getApiUrl('/api/local-ai/status'));
    if (!response.ok) {
      return {
        enabled: false,
        model: 'None',
        runtime: 'Regex / Rule-Based',
        status: 'Unavailable',
        disclaimer: 'Endpoint returned error',
      };
    }
    return await response.json();
  } catch (error) {
    return {
      enabled: false,
      model: 'None',
      runtime: 'Regex / Rule-Based',
      status: 'Unavailable',
      disclaimer: 'Failed to contact local AI status endpoint',
    };
  }
}

/**
 * Step 15: Classifies learning intent using the local ONNX model via POST /api/local-ai/classify
 */
export async function classifyIntentLocally(text: string): Promise<{
  model: string;
  runtime: string;
  status: string;
  input: string;
  predictedIntent: string;
  confidence: number;
  scores?: Record<string, number>;
  executionMs: number;
  isFallback: boolean;
  disclaimer: string;
}> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Please enter text to classify.');
  }

  const response = await fetch(getApiUrl('/api/local-ai/classify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: trimmed }),
  });

  const data = await response.json().catch(() => ({
    error: `Server returned non-JSON response with HTTP ${response.status}`,
  }));

  if (!response.ok) {
    throw new Error(data.error || 'Failed to classify intent locally.');
  }

  return data;
}

