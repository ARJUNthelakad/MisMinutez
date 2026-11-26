import { auth } from './firebase';
import type { StructuredMinutesOutput, TranscribedSegmentDTO } from '../types';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to run AI meeting processing.');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function checkServerConnectivity(): Promise<{
  online: boolean;
  aiConfigured: boolean;
  aiProvider: 'self_hosted' | 'gemini' | 'unconfigured';
  selfHostedConfigured: boolean;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { online: false, aiConfigured: false, aiProvider: 'unconfigured', selfHostedConfigured: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      return { online: false, aiConfigured: false, aiProvider: 'unconfigured', selfHostedConfigured: false };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      aiConfigured?: boolean;
      aiProvider?: 'self_hosted' | 'gemini' | 'unconfigured';
      selfHostedConfigured?: boolean;
    };
    return {
      online: Boolean(data.ok),
      aiConfigured: Boolean(data.aiConfigured),
      aiProvider: data.aiProvider || 'gemini',
      selfHostedConfigured: Boolean(data.selfHostedConfigured),
    };
  } catch {
    return { online: false, aiConfigured: false, aiProvider: 'unconfigured', selfHostedConfigured: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadAudioChunkToServer(payload: {
  chunkId: string;
  meetingId: string;
  chunkIndex: number;
  mimeType: string;
  base64Audio: string;
  durationSec: number;
}): Promise<{ chunkId: string; duplicate: boolean; receivedBytes: number; confirmedAt: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/recordings/upload', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Chunk upload failed (${res.status})`);
  }
  return data;
}

export async function transcribeAudioChunkApi(payload: {
  chunkId?: string;
  base64Audio: string;
  mimeType: string;
  startOffsetSec: number;
  durationSec: number;
  expectedLanguages: string[];
  knownSpeakers: string[];
  previousContext?: string;
}): Promise<{ segments: TranscribedSegmentDTO[]; audioNotes: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/transcription', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Transcription failed (${res.status})`);
  }
  return data;
}

export async function analyzeMeetingTranscriptApi(payload: {
  title: string;
  description: string;
  meetingType: string;
  speakers: Record<string, string>;
  transcript: Array<{
    speakerLabel: string;
    englishTranslation: string;
    originalText: string;
    detectedLanguage: string;
    startTime: number;
    endTime: number;
    uncertain: boolean;
  }>;
}): Promise<StructuredMinutesOutput> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/meeting-analysis', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Meeting analysis failed (${res.status})`);
  }
  return data;
}

export async function askMeetingChatApi(payload: {
  question: string;
  meetingTitle: string;
  executiveSummary: string;
  decisions: Array<{ decisionText: string; decisionType: string; speaker: string; timestamp: string }>;
  actionItems: Array<{ task: string; assignedTo: string; deadline: string; status: string }>;
  transcript: Array<{
    speakerLabel: string;
    displayName?: string;
    englishTranslation: string;
    originalText: string;
    detectedLanguage: string;
    startTime: number;
  }>;
  history: Array<{ question: string; answer: string }>;
}): Promise<{ answer: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/meeting-chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Ask Your Meeting failed (${res.status})`);
  }
  return data;
}

export interface TranslatedReportData {
  targetLanguage: string;
  meetingTitle: string;
  executiveSummary: string;
  objectives: string[];
  discussionPoints: string[];
  decisions: Array<{ decisionText: string; decisionType: string }>;
  actionItems: Array<{ task: string; assignedTo: string; deadline: string; priority: string; status: string }>;
  unresolvedQuestions: string[];
  risks: string[];
  followUpSuggestions: string[];
  meetingConclusion: string;
}

export async function translateReportApi(payload: {
  targetLanguage: string;
  report: Omit<TranslatedReportData, 'targetLanguage'>;
}): Promise<TranslatedReportData> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/translation', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'report',
      targetLanguage: payload.targetLanguage,
      report: payload.report,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Report translation failed (${res.status})`);
  }
  return data;
}

export async function generateFollowUpEmailApi(payload: {
  meetingTitle: string;
  meetingDate: string;
  executiveSummary: string;
  finalDecisions: string[];
  actionItems: Array<{ task: string; assignedTo: string; deadline: string; status: string }>;
  unresolvedQuestions: string[];
  followUpSuggestions: string[];
}): Promise<{ subject: string; body: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/followup-email', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Follow-up email generation failed (${res.status})`);
  }
  return data;
}
