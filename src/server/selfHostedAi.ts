import { z } from 'zod';
import type { StructuredMinutesOutput, TranscribedSegmentDTO } from '../types/index.ts';
import type { TranscribeChunkParams } from './gemini.ts';

function getSafeEnvUrl(envName: string): string | null {
  const raw = (process.env[envName] || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`${envName} must use http:// or https://`);
    }
    return parsed.toString();
  } catch (err) {
    console.warn(`Invalid ${envName} ignored:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export function getSelfHostedConfig() {
  const baseUrl = getSafeEnvUrl('SELF_HOSTED_BASE_URL');
  const asrUrl =
    getSafeEnvUrl('SELF_HOSTED_ASR_URL') ||
    (baseUrl ? new URL('/v1/audio/transcriptions', baseUrl).toString() : null);
  const llmUrl =
    getSafeEnvUrl('SELF_HOSTED_LLM_URL') ||
    (baseUrl ? new URL('/v1/chat/completions', baseUrl).toString() : null);
  const llmModel = (process.env.SELF_HOSTED_LLM_MODEL || 'qwen2.5:7b').trim();
  const asrModel = (process.env.SELF_HOSTED_ASR_MODEL || 'large-v3-turbo').trim();
  const apiToken = (process.env.SELF_HOSTED_API_TOKEN || '').trim();

  return {
    asrUrl,
    llmUrl,
    llmModel,
    asrModel,
    apiToken,
    hasAsr: Boolean(asrUrl),
    hasLlm: Boolean(llmUrl),
    configured: Boolean(asrUrl || llmUrl),
  };
}

function buildAuthHeaders(apiToken: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }
  return headers;
}

function safeExtractJson<T>(raw: string, fallbackJson: string): T {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(trimmed || fallbackJson) as T;
  } catch {
    // Attempt to slice the outermost JSON object if model emitted brief lead/trailing prose
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }
    return JSON.parse(fallbackJson) as T;
  }
}

async function callSelfHostedChat(params: {
  system: string;
  user: string;
  jsonMode?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const cfg = getSelfHostedConfig();
  if (!cfg.llmUrl) {
    throw new Error('SELF_HOSTED_LLM_URL is not configured on the server.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 90_000);

  try {
    const body: Record<string, unknown> = {
      model: cfg.llmModel,
      temperature: 0.2,
      stream: false,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    };
    if (params.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(cfg.llmUrl, {
      method: 'POST',
      headers: buildAuthHeaders(cfg.apiToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Self-hosted LLM error (${res.status}): ${errText.slice(0, 240)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
      response?: string;
    };

    const content =
      data.choices?.[0]?.message?.content ??
      data.message?.content ??
      data.response ??
      '';

    if (!content.trim()) {
      throw new Error('Self-hosted LLM returned an empty response.');
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

const WhisperResponseSchema = z.object({
  text: z.string().optional().default(''),
  language: z.string().optional().default('English'),
  segments: z
    .array(
      z.object({
        start: z.number().optional().default(0),
        end: z.number().optional().default(0),
        text: z.string().optional().default(''),
      })
    )
    .optional()
    .default([]),
});

const StructuredSegmentsSchema = z.object({
  segments: z.array(
    z.object({
      speaker_label: z.string().default('Speaker 1'),
      original_text: z.string().min(1),
      detected_language: z.string().default('English'),
      english_translation: z.string().default(''),
      start_time: z.number().default(0),
      end_time: z.number().default(1),
      uncertain: z.boolean().optional().default(false),
    })
  ),
  audio_notes: z.string().optional().default(''),
});

const ISO_LANG_NAMES: Record<string, string> = {
  en: 'English',
  ml: 'Malayalam',
  hi: 'Hindi',
  ta: 'Tamil',
  kn: 'Kannada',
  te: 'Telugu',
  ar: 'Arabic',
  ur: 'Urdu',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
};

function mapLanguageLabel(codeOrName: string): string {
  const clean = (codeOrName || '').trim();
  if (!clean) return 'English';
  return ISO_LANG_NAMES[clean.toLowerCase()] || clean;
}

function extFromMime(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base.includes('wav')) return 'wav';
  if (base.includes('mp3') || base.includes('mpeg')) return 'mp3';
  if (base.includes('mp4') || base.includes('m4a')) return 'm4a';
  if (base.includes('ogg')) return 'ogg';
  return 'webm';
}

export async function transcribeWithSelfHosted(
  params: TranscribeChunkParams
): Promise<{ segments: TranscribedSegmentDTO[]; audioNotes: string }> {
  const cfg = getSelfHostedConfig();
  if (!cfg.asrUrl) {
    throw new Error('SELF_HOSTED_ASR_URL is not configured on the server.');
  }

  const normalizedMime = params.mimeType.split(';')[0].trim() || 'audio/webm';
  const audioBuffer = Buffer.from(params.base64Audio, 'base64');
  const blob = new Blob([audioBuffer], { type: normalizedMime });

  const form = new FormData();
  form.append('file', blob, `chunk.${extFromMime(normalizedMime)}`);
  form.append('model', cfg.asrModel);
  form.append('response_format', 'verbose_json');
  if (params.previousContext) {
    form.append('prompt', params.previousContext.slice(-240));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  let whisperParsed: z.infer<typeof WhisperResponseSchema>;
  try {
    const res = await fetch(cfg.asrUrl, {
      method: 'POST',
      headers: buildAuthHeaders(cfg.apiToken),
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Self-hosted ASR error (${res.status}): ${errText.slice(0, 240)}`);
    }
    whisperParsed = WhisperResponseSchema.parse(await res.json());
  } finally {
    clearTimeout(timer);
  }

  const rawText = (whisperParsed.text || '').trim();
  if (!rawText && whisperParsed.segments.length === 0) {
    return { segments: [], audioNotes: 'No speech detected in this chunk.' };
  }

  const detectedLang = mapLanguageLabel(whisperParsed.language);
  const clipDur = Math.max(1, Math.round(params.durationSec));
  const rawTurns =
    whisperParsed.segments.length > 0
      ? whisperParsed.segments
          .filter((s) => s.text.trim())
          .map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text.trim()}`)
          .join('\n')
      : `[0.0s-${clipDur}.0s] ${rawText}`;

  // If self-hosted LLM is also configured, structure speaker turns + translate to clean English
  if (cfg.llmUrl) {
    const speakerHint =
      params.knownSpeakers.length > 0
        ? `Existing anonymous speakers: ${params.knownSpeakers.join(', ')}. Reuse them or add Speaker ${params.knownSpeakers.length + 1}.`
        : 'Use anonymous speaker labels like "Speaker 1", "Speaker 2".';

    const llmOutput = await callSelfHostedChat({
      system:
        'You format raw ASR meeting transcripts into strict JSON with speaker turns, detected language, and faithful English translations. Output ONLY valid JSON.',
      user: [
        `Return JSON with shape: {"segments":[{"speaker_label":"Speaker 1","original_text":"...","detected_language":"${detectedLang}","english_translation":"...","start_time":0,"end_time":${clipDur},"uncertain":false}],"audio_notes":""}`,
        speakerHint,
        'Keep original_text faithful to the spoken text. Provide a natural, accurate English translation in english_translation.',
        '',
        'ASR output:',
        rawTurns,
      ].join('\n'),
      jsonMode: true,
    });

    const parsed = StructuredSegmentsSchema.parse(
      safeExtractJson(llmOutput, '{"segments":[],"audio_notes":""}')
    );
    return {
      segments: parsed.segments.map((s) => ({
        speaker_label: s.speaker_label.trim() || 'Speaker 1',
        original_text: s.original_text.trim(),
        detected_language: s.detected_language.trim() || detectedLang,
        english_translation: (s.english_translation || '').trim() || s.original_text.trim(),
        start_time: Number((params.startOffsetSec + Math.max(0, s.start_time)).toFixed(1)),
        end_time: Number(
          (params.startOffsetSec + Math.max(s.start_time + 0.5, s.end_time)).toFixed(1)
        ),
        confidence: null,
        uncertain: Boolean(s.uncertain),
      })),
      audioNotes: parsed.audio_notes,
    };
  }

  // Fallback when only SELF_HOSTED_ASR_URL is set (no self-hosted LLM): emit Whisper segments directly
  const baseSegments =
    whisperParsed.segments.length > 0
      ? whisperParsed.segments.filter((s) => s.text.trim())
      : [{ start: 0, end: clipDur, text: rawText }];

  return {
    segments: baseSegments.map((s) => ({
      speaker_label: params.knownSpeakers[0] || 'Speaker 1',
      original_text: s.text.trim(),
      detected_language: detectedLang,
      english_translation: s.text.trim(),
      start_time: Number((params.startOffsetSec + Math.max(0, s.start)).toFixed(1)),
      end_time: Number((params.startOffsetSec + Math.max(s.start + 0.5, s.end)).toFixed(1)),
      confidence: null,
      uncertain: false,
    })),
    audioNotes: 'Transcribed via self-hosted Whisper ASR.',
  };
}

const StructuredMinutesSchema = z.object({
  meeting_title: z.string().default('Meeting Minutes'),
  executive_summary: z.string().default(''),
  objectives: z.array(z.string()).default([]),
  discussion_points: z.array(z.string()).default([]),
  decisions: z
    .array(
      z.object({
        decision: z.string(),
        type: z.enum(['final', 'proposed', 'pending', 'rejected']).catch('proposed'),
        speaker: z.string().nullable().default(null),
        timestamp: z.string().nullable().default(null),
        transcript_reference: z.string().nullable().default(null),
      })
    )
    .default([]),
  action_items: z
    .array(
      z.object({
        task: z.string(),
        assigned_to: z.string().nullable().default(null),
        deadline: z.string().nullable().default(null),
        priority: z.enum(['low', 'medium', 'high']).catch('medium'),
        status: z.enum(['pending', 'completed']).catch('pending'),
        transcript_reference: z.string().nullable().default(null),
      })
    )
    .default([]),
  unresolved_questions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  follow_up_suggestions: z.array(z.string()).default([]),
  meeting_conclusion: z.string().default(''),
});

export async function generateMinutesWithSelfHosted(params: {
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
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const transcriptLines = params.transcript
    .map((seg) => {
      const assigned = params.speakers[seg.speakerLabel]?.trim();
      const sp = assigned ? `${assigned} (${seg.speakerLabel})` : seg.speakerLabel;
      return `[${formatTime(seg.startTime)}] ${sp} (${seg.detectedLanguage}): ${seg.englishTranslation}`;
    })
    .join('\n');

  const raw = await callSelfHostedChat({
    system:
      'You are MisMinutez, an expert executive secretary. Output ONLY valid JSON grounded strictly in the transcript. Never invent facts, owners, or deadlines.',
    user: [
      `Meeting Title: ${params.title}`,
      `Meeting Type: ${params.meetingType}`,
      `Agenda/Context: ${params.description || 'None provided'}`,
      '',
      'Return JSON with these exact keys:',
      '{',
      '  "meeting_title": "string",',
      '  "executive_summary": "2-4 crisp readable sentences summarizing purpose, topics, outcomes, and next steps",',
      '  "objectives": ["concise goal"],',
      '  "discussion_points": ["Topic Name: Clear 1-2 sentence summary"],',
      '  "decisions": [{"decision":"string","type":"final|proposed|pending|rejected","speaker":"string|null","timestamp":"[MM:SS]|null","transcript_reference":"short quote|null"}],',
      '  "action_items": [{"task":"Verb-first task","assigned_to":"string|null","deadline":"string|null","priority":"low|medium|high","status":"pending","transcript_reference":"short quote|null"}],',
      '  "unresolved_questions": ["open question"],',
      '  "risks": ["risk"],',
      '  "follow_up_suggestions": ["recommended next step"],',
      '  "meeting_conclusion": "1-2 crisp sentences"',
      '}',
      '',
      'Transcript:',
      transcriptLines,
    ].join('\n'),
    jsonMode: true,
    timeoutMs: 120_000,
  });

  return StructuredMinutesSchema.parse(safeExtractJson(raw, '{}'));
}

export async function answerQuestionWithSelfHosted(params: {
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
}): Promise<string> {
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const transcriptBlock = params.transcript
    .map((s) => {
      const sp = s.displayName ? `${s.displayName} (${s.speakerLabel})` : s.speakerLabel;
      return `[${formatTime(s.startTime)}] ${sp}: ${s.englishTranslation}`;
    })
    .join('\n');

  const decisionsBlock = params.decisions
    .map((d) => `- [${d.decisionType.toUpperCase()}] ${d.decisionText}`)
    .join('\n');

  const actionsBlock = params.actionItems
    .map((a) => `- [${a.status.toUpperCase()}] ${a.task} (${a.assignedTo || 'Unassigned'})`)
    .join('\n');

  const historyBlock = params.history
    .slice(-6)
    .map((h) => `User: ${h.question}\nAssistant: ${h.answer}`)
    .join('\n\n');

  return callSelfHostedChat({
    system:
      'You are Ask Your Meeting inside MisMinutez. Answer ONLY from the transcript, decisions, and action items below. Cite speaker labels and [MM:SS] timestamps. If unsupported, say "This was not discussed in the meeting."',
    user: [
      `Meeting: ${params.meetingTitle}`,
      `Summary: ${params.executiveSummary || 'None'}`,
      `Decisions:\n${decisionsBlock || 'None'}`,
      `Action Items:\n${actionsBlock || 'None'}`,
      `Transcript:\n${transcriptBlock || 'None'}`,
      historyBlock ? `Previous Q&A:\n${historyBlock}` : '',
      `Question: ${params.question}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
}

export async function translateWithSelfHosted(params: {
  mode: 'segments' | 'report';
  targetLanguage: string;
  segments?: Array<{ id: string; text: string; detectedLanguage?: string }>;
  report?: {
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
  };
}): Promise<unknown> {
  if (params.mode === 'segments' && params.segments) {
    const raw = await callSelfHostedChat({
      system: 'Translate JSON segments faithfully. Output ONLY valid JSON.',
      user: `Translate each item into ${params.targetLanguage} and return {"translations":[{"id":"...","translatedText":"..."}]}.\n\n${JSON.stringify(params.segments)}`,
      jsonMode: true,
    });
    return safeExtractJson(raw, '{"translations":[]}');
  }

  if (params.mode === 'report' && params.report) {
    const raw = await callSelfHostedChat({
      system: 'Translate structured meeting minutes into natural native script. Output ONLY valid JSON preserving all keys.',
      user: `Translate this report into ${params.targetLanguage} and include "targetLanguage":"${params.targetLanguage}" in the returned JSON object:\n\n${JSON.stringify(params.report)}`,
      jsonMode: true,
      timeoutMs: 120_000,
    });
    return safeExtractJson(raw, '{}');
  }

  throw new Error('Invalid translation payload');
}

export async function generateFollowUpEmailWithSelfHosted(params: {
  meetingTitle: string;
  meetingDate: string;
  executiveSummary: string;
  finalDecisions: string[];
  actionItems: Array<{ task: string; assignedTo: string; deadline: string; status: string }>;
  unresolvedQuestions: string[];
  followUpSuggestions: string[];
}): Promise<{ subject: string; body: string }> {
  const raw = await callSelfHostedChat({
    system: 'Draft a crisp, professional follow-up email strictly grounded in the provided minutes. Output ONLY JSON with {"subject":"...","body":"..."}.',
    user: JSON.stringify(params),
    jsonMode: true,
  });
  return safeExtractJson<{ subject: string; body: string }>(raw, '{"subject":"","body":""}');
}
