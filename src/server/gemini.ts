import { GoogleGenAI, Type, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import type { StructuredMinutesOutput, TranscribedSegmentDTO } from '../types/index.ts';

const PRIMARY_QUALITY_MODEL = 'gemini-4-hydrogen';
const FAST_QUOTA_MODEL = 'gemini-3.1-flash-lite';
const ASR_MODEL = 'gemini-3.5-transcribe';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaOrRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota exceeded') ||
    msg.includes('rate limit')
  );
}

export function formatGeminiError(err: unknown, fallbackMessage: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (isQuotaOrRateLimitError(err)) {
    return 'Gemini API free-tier quota limit reached across available models. Upgrade to a billing-enabled API key in Settings > Secrets for higher limits, or retry shortly.';
  }
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
    return 'Gemini API key permission error. Please verify your API key in Settings > Secrets.';
  }
  if (msg.length > 260) {
    return `${fallbackMessage} (${msg.slice(0, 220)}...)`;
  }
  return msg || fallbackMessage;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Do not waste retries on 4xx client/auth/quota errors — fail fast so fallback model runs immediately
      if (
        msg.includes('400') ||
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('404') ||
        msg.includes('API_KEY') ||
        isQuotaOrRateLimitError(err)
      ) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastError;
}

function thinkingConfigFor(model: string) {
  // ThinkingLevel.MINIMAL is supported on gemini-3.1-flash-lite (ultra-fast);
  // gemini-4-hydrogen requires ThinkingLevel.LOW as its lowest latency level.
  return model === FAST_QUOTA_MODEL
    ? { thinkingLevel: ThinkingLevel.MINIMAL }
    : { thinkingLevel: ThinkingLevel.LOW };
}

/**
 * Runs generateContent across an ordered list of models, automatically falling over
 * to the next model when hitting 429 RESOURCE_EXHAUSTED quota limits or transient errors.
 */
async function generateWithFallback(
  ai: GoogleGenAI,
  models: string[],
  contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'],
  baseConfig: Record<string, unknown> = {}
): Promise<GenerateContentResponse> {
  let lastError: unknown;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return await withRetry(() =>
        ai.models.generateContent({
          model,
          contents,
          config: {
            ...baseConfig,
            thinkingConfig: thinkingConfigFor(model),
          },
        })
      );
    } catch (err) {
      lastError = err;
      const hasNext = i < models.length - 1;
      if (hasNext) {
        console.warn(
          `Model ${model} failed (${isQuotaOrRateLimitError(err) ? '429 quota' : 'error'}), failing over to ${models[i + 1]}`
        );
        continue;
      }
    }
  }
  throw lastError;
}

function safeParseJson<T>(raw: string | undefined, fallbackJson: string): T {
  const cleaned = (raw ?? fallbackJson)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned || fallbackJson) as T;
}

const TranscribedSegmentSchema = z.object({
  speaker_label: z.string().min(1).max(60),
  original_text: z.string().min(1).max(6000),
  detected_language: z.string().min(1).max(60),
  english_translation: z.string().max(6000),
  start_time: z.number().min(0),
  end_time: z.number().min(0),
  confidence: z.number().nullable().optional().default(null),
  uncertain: z.boolean().optional().default(false),
});

const TranscriptionResponseSchema = z.object({
  segments: z.array(TranscribedSegmentSchema),
  audio_notes: z.string().optional().default(''),
});

const SEGMENT_JSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker_label: { type: Type.STRING },
          original_text: { type: Type.STRING },
          detected_language: { type: Type.STRING },
          english_translation: { type: Type.STRING },
          start_time: { type: Type.NUMBER },
          end_time: { type: Type.NUMBER },
          uncertain: { type: Type.BOOLEAN },
        },
        required: [
          'speaker_label',
          'original_text',
          'detected_language',
          'english_translation',
          'start_time',
          'end_time',
          'uncertain',
        ],
      },
    },
    audio_notes: { type: Type.STRING },
  },
  required: ['segments'],
};

export interface TranscribeChunkParams {
  base64Audio: string;
  mimeType: string;
  startOffsetSec: number;
  durationSec: number;
  expectedLanguages: string[];
  knownSpeakers: string[];
  previousContext?: string;
}

function normalizeSegments(
  rawSegments: z.infer<typeof TranscribedSegmentSchema>[],
  startOffsetSec: number,
  durationSec: number
): TranscribedSegmentDTO[] {
  const safeDur = Math.max(1, durationSec);
  const filtered = rawSegments.filter((s) => {
    const txt = s.original_text.trim();
    if (!txt) return false;
    const lower = txt.toLowerCase();
    if (
      lower === '[silence]' ||
      lower === 'silence' ||
      lower === '[no speech]' ||
      lower === '[inaudible]' ||
      lower === 'no speech detected'
    ) {
      return false;
    }
    return true;
  });

  return filtered.map((s, idx) => {
    const defaultSlice = safeDur / Math.max(1, filtered.length);
    const rawStart = Number.isFinite(s.start_time) ? s.start_time : idx * defaultSlice;
    const rawEnd = Number.isFinite(s.end_time) ? s.end_time : (idx + 1) * defaultSlice;
    const relStart = Math.max(0, Math.min(rawStart, safeDur));
    const relEnd = Math.max(relStart + 0.5, Math.min(rawEnd, safeDur + 1));

    const original = s.original_text.trim();
    const english = (s.english_translation || '').trim() || original;

    return {
      speaker_label: s.speaker_label.trim() || 'Speaker 1',
      original_text: original,
      detected_language: s.detected_language.trim() || 'English',
      english_translation: english,
      start_time: Number((startOffsetSec + relStart).toFixed(1)),
      end_time: Number((startOffsetSec + relEnd).toFixed(1)),
      confidence: null,
      uncertain: Boolean(s.uncertain),
    };
  });
}

export async function transcribeMultilingualAudio(
  params: TranscribeChunkParams
): Promise<{ segments: TranscribedSegmentDTO[]; audioNotes: string }> {
  const ai = getAiClient();
  const normalizedMime = params.mimeType.split(';')[0].trim() || 'audio/webm';
  const clipDur = Math.max(1, Math.round(params.durationSec));

  const expectedLangHint =
    params.expectedLanguages.length > 0
      ? `Likely room languages: ${params.expectedLanguages.join(', ')}. Still detect the actual language spoken.`
      : 'Participants may speak English, Malayalam, Hindi, Tamil, Kannada, Telugu, Arabic, or code-switch mid-sentence.';

  const speakerHint =
    params.knownSpeakers.length > 0
      ? `Existing anonymous speakers: ${params.knownSpeakers.join(', ')}. Reuse matching labels; use Speaker ${params.knownSpeakers.length + 1} for a new voice.`
      : 'Label distinct voices anonymously as "Speaker 1", "Speaker 2", etc. Never guess real names.';

  const audioPart = {
    inlineData: {
      mimeType: normalizedMime,
      data: params.base64Audio,
    },
  };

  // Stage 1: Dedicated high-accuracy multilingual ASR using gemini-3.5-transcribe
  try {
    const asrPrompt = [
      'Transcribe all spoken words in this meeting room audio accurately in their original spoken language(s) and native script.',
      expectedLangHint,
      speakerHint,
      'Preserve code-switching naturally as spoken. Only output [SILENCE] if there is strictly no human voice at all.',
    ].join(' ');

    const asrResponse = await withRetry(() =>
      ai.models.generateContent({
        model: ASR_MODEL,
        contents: { parts: [audioPart, { text: asrPrompt }] },
      })
    );

    const verbatim = (asrResponse.text ?? '').trim();
    if (!verbatim || /^\[?silence\]?\.?$/i.test(verbatim) || /^\[?no speech\]?\.?$/i.test(verbatim)) {
      return { segments: [], audioNotes: 'No speech detected in this chunk.' };
    }

    // Stage 2: High-quota, ultra-fast structuring & translation using gemini-3.1-flash-lite first
    // (preserves gemini-4-hydrogen free-tier quota for executive minutes; falls back to gemini-4-hydrogen if needed)
    const structurePrompt = [
      `Convert this verbatim ${clipDur}-second meeting room transcript into clean structured JSON segments.`,
      speakerHint,
      params.previousContext
        ? `Previous context (for pronoun/term clarity only, do NOT include in output): ${params.previousContext.slice(-300)}`
        : '',
      'RULES:',
      '1. Keep `original_text` faithful to the verbatim spoken words and native script.',
      '2. Set `detected_language` accurately (e.g., "English", "Malayalam", "Hindi", "Tamil", "Kannada", "Telugu", "Arabic", or code-switched like "Malayalam + English").',
      '3. Write a crystal-clear, natural, faithful English translation in `english_translation` (if already English, clean up punctuation only without changing meaning).',
      `4. Estimate relative start_time and end_time in seconds between 0 and ${clipDur} based on any timestamps or turn length.`,
      '5. Set `uncertain: true` only if the text contains [inaudible] or unclear fragments.',
      '',
      'Verbatim transcript:',
      verbatim,
    ]
      .filter(Boolean)
      .join('\n');

    const structuredResp = await generateWithFallback(
      ai,
      [FAST_QUOTA_MODEL, PRIMARY_QUALITY_MODEL],
      structurePrompt,
      {
        responseMimeType: 'application/json',
        responseSchema: SEGMENT_JSON_SCHEMA,
      }
    );

    const parsed = TranscriptionResponseSchema.parse(
      safeParseJson(structuredResp.text, '{"segments":[]}')
    );
    return {
      segments: normalizeSegments(parsed.segments, params.startOffsetSec, params.durationSec),
      audioNotes: parsed.audio_notes,
    };
  } catch (asrErr) {
    // Fallback: direct multimodal transcription (high-quota gemini-3.1-flash-lite -> gemini-4-hydrogen)
    console.warn(
      'gemini-3.5-transcribe fallback to direct multimodal transcription:',
      asrErr instanceof Error ? asrErr.message : asrErr
    );

    const directPrompt = [
      `Transcribe this ${clipDur}-second multilingual meeting audio into structured JSON segments.`,
      expectedLangHint,
      speakerHint,
      'Transcribe ONLY real audible human speech; return empty segments array on silence.',
      'Preserve native scripts in `original_text`, detect `detected_language`, and provide accurate natural English in `english_translation`.',
      `Provide relative start_time and end_time in seconds within 0..${clipDur}.`,
    ].join('\n');

    const fallbackResp = await generateWithFallback(
      ai,
      [FAST_QUOTA_MODEL, PRIMARY_QUALITY_MODEL],
      { parts: [audioPart, { text: directPrompt }] },
      {
        responseMimeType: 'application/json',
        responseSchema: SEGMENT_JSON_SCHEMA,
      }
    );

    const parsed = TranscriptionResponseSchema.parse(
      safeParseJson(fallbackResp.text, '{"segments":[]}')
    );
    return {
      segments: normalizeSegments(parsed.segments, params.startOffsetSec, params.durationSec),
      audioNotes: parsed.audio_notes,
    };
  }
}

const StructuredMinutesSchema = z.object({
  meeting_title: z.string(),
  executive_summary: z.string(),
  objectives: z.array(z.string()),
  discussion_points: z.array(z.string()),
  decisions: z.array(
    z.object({
      decision: z.string(),
      type: z.enum(['final', 'proposed', 'pending', 'rejected']),
      speaker: z.string().nullable(),
      timestamp: z.string().nullable(),
      transcript_reference: z.string().nullable(),
    })
  ),
  action_items: z.array(
    z.object({
      task: z.string(),
      assigned_to: z.string().nullable(),
      deadline: z.string().nullable(),
      priority: z.enum(['low', 'medium', 'high']),
      status: z.enum(['pending', 'completed']),
      transcript_reference: z.string().nullable(),
    })
  ),
  unresolved_questions: z.array(z.string()),
  risks: z.array(z.string()),
  follow_up_suggestions: z.array(z.string()),
  meeting_conclusion: z.string(),
});

export async function generateStructuredMinutes(params: {
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
  const ai = getAiClient();

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const transcriptLines = params.transcript
    .map((seg) => {
      const assigned = params.speakers[seg.speakerLabel]?.trim();
      const displaySpeaker = assigned
        ? `${assigned} (${seg.speakerLabel})`
        : seg.speakerLabel;
      const uncertainTag = seg.uncertain ? ' [UNCERTAIN]' : '';
      return `[${formatTime(seg.startTime)}] ${displaySpeaker} (${seg.detectedLanguage})${uncertainTag}: ${seg.englishTranslation}`;
    })
    .join('\n');

  const systemInstruction = `You are MisMinutez, an expert executive secretary producing clear, accurate, concise meeting minutes in English strictly grounded in the provided transcript.

CLARITY & ACCURACY STANDARDS:
1. Executive Summary: Write 2-4 crisp, clear, readable sentences summarizing the meeting purpose, main topics discussed, key outcomes, and next steps. Do NOT copy raw transcript fragments or use robotic filler.
2. Objectives: List 1-5 concise, concrete goals that participants explicitly stated or worked toward. If none were clear, infer only what is directly obvious from the agenda/discussion.
3. Discussion Points: Group related turns into clean, well-written topic bullets formatted as "Topic Name: Clear 1-2 sentence summary of the point raised." Never dump raw unedited speech fragments.
4. Decisions: Extract ONLY real decisions or proposals. Phrase each clearly as a complete statement.
   - "final": explicitly agreed/confirmed
   - "proposed": suggested without final agreement
   - "pending": deferred or awaiting more info
   - "rejected": explicitly ruled out
   Always include speaker, timestamp [MM:SS], and a short exact quote in transcript_reference. Never turn a proposal into a final decision.
5. Action Items: Phrase each task clearly starting with an action verb (e.g., "Complete database schema design").
   - assigned_to: ONLY populate if explicitly stated in the transcript (use speaker name/label); otherwise null.
   - deadline: ONLY populate if explicitly mentioned; otherwise null.
   - Do NOT invent tasks that were never committed to or requested.
6. Unresolved Questions: List concise, specific open questions left unanswered in the meeting. Leave empty [] if none.
7. Risks: List risks raised by participants. If you include an AI-inferred risk, prefix it with "[AI Suggestion] ". Leave empty [] if none apply.
8. Follow-Up Suggestions: Provide 1-4 practical, specific AI next-step recommendations clearly framed as recommendations.
9. Meeting Conclusion: 1-2 crisp sentences summarizing where the team stands at the end of the session.
10. Minor ASR typos in translated text may be normalized for clarity using surrounding context, but NEVER invent facts, people, numbers, or deadlines.`;

  // Try gemini-4-hydrogen first; automatically fall back to high-quota gemini-3.1-flash-lite on 429 quota limits
  const response = await generateWithFallback(
    ai,
    [PRIMARY_QUALITY_MODEL, FAST_QUOTA_MODEL],
    `Meeting Title: ${params.title}\nMeeting Type: ${params.meetingType}\nAgenda/Context: ${params.description || 'None provided'}\n\nFull English Transcript:\n${transcriptLines}`,
    {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          meeting_title: { type: Type.STRING },
          executive_summary: { type: Type.STRING },
          objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
          discussion_points: { type: Type.ARRAY, items: { type: Type.STRING } },
          decisions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                decision: { type: Type.STRING },
                type: { type: Type.STRING, enum: ['final', 'proposed', 'pending', 'rejected'] },
                speaker: { type: Type.STRING, nullable: true },
                timestamp: { type: Type.STRING, nullable: true },
                transcript_reference: { type: Type.STRING, nullable: true },
              },
              required: ['decision', 'type', 'speaker', 'timestamp', 'transcript_reference'],
            },
          },
          action_items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                task: { type: Type.STRING },
                assigned_to: { type: Type.STRING, nullable: true },
                deadline: { type: Type.STRING, nullable: true },
                priority: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                status: { type: Type.STRING, enum: ['pending', 'completed'] },
                transcript_reference: { type: Type.STRING, nullable: true },
              },
              required: ['task', 'assigned_to', 'deadline', 'priority', 'status', 'transcript_reference'],
            },
          },
          unresolved_questions: { type: Type.ARRAY, items: { type: Type.STRING } },
          risks: { type: Type.ARRAY, items: { type: Type.STRING } },
          follow_up_suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          meeting_conclusion: { type: Type.STRING },
        },
        required: [
          'meeting_title',
          'executive_summary',
          'objectives',
          'discussion_points',
          'decisions',
          'action_items',
          'unresolved_questions',
          'risks',
          'follow_up_suggestions',
          'meeting_conclusion',
        ],
      },
    }
  );

  return StructuredMinutesSchema.parse(safeParseJson(response.text, '{}'));
}

export async function answerMeetingQuestion(params: {
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
  const ai = getAiClient();

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const transcriptBlock = params.transcript
    .map((s) => {
      const sp = s.displayName ? `${s.displayName} (${s.speakerLabel})` : s.speakerLabel;
      return `[${formatTime(s.startTime)}] ${sp} (${s.detectedLanguage}): ${s.englishTranslation}`;
    })
    .join('\n');

  const decisionsBlock = params.decisions
    .map((d) => `- [${d.decisionType.toUpperCase()}] ${d.decisionText} (Speaker: ${d.speaker || 'Unspecified'}, Time: ${d.timestamp || 'N/A'})`)
    .join('\n');

  const actionBlock = params.actionItems
    .map((a) => `- [${a.status.toUpperCase()}] ${a.task} (Assigned: ${a.assignedTo || 'Unassigned'}, Deadline: ${a.deadline || 'None'})`)
    .join('\n');

  const historyBlock = params.history
    .slice(-6)
    .map((h) => `User: ${h.question}\nAssistant: ${h.answer}`)
    .join('\n\n');

  const systemInstruction = `You are "Ask Your Meeting", a strictly grounded meeting Q&A assistant inside MisMinutez.
RULES:
1. Answer ONLY using evidence present in the meeting transcript, decisions, and action items below.
2. Always cite speaker labels (or their assigned names) and timestamps (e.g., [01:24]) when referencing what was said.
3. If the answer is NOT supported by the meeting transcript or minutes, respond clearly: "This was not discussed in the meeting."
4. Never fabricate details, deadlines, or external facts as if they occurred in the meeting.
5. Keep answers concise, clear, and well-structured.`;

  const contents = [
    `Meeting: ${params.meetingTitle}`,
    `Summary: ${params.executiveSummary || 'No summary yet.'}`,
    `Decisions:\n${decisionsBlock || 'None recorded.'}`,
    `Action Items:\n${actionBlock || 'None recorded.'}`,
    `Transcript:\n${transcriptBlock || 'No transcript segments available.'}`,
    historyBlock ? `Previous Q&A:\n${historyBlock}` : '',
    `Current Question: ${params.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await generateWithFallback(
    ai,
    [FAST_QUOTA_MODEL, PRIMARY_QUALITY_MODEL],
    contents,
    { systemInstruction }
  );

  return (response.text ?? 'This was not discussed in the meeting.').trim();
}

export async function translateContent(params: {
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
  const ai = getAiClient();

  if (params.mode === 'segments' && params.segments) {
    const response = await generateWithFallback(
      ai,
      [FAST_QUOTA_MODEL, PRIMARY_QUALITY_MODEL],
      `Translate each speech segment faithfully into ${params.targetLanguage}. Preserve technical terms and exact meaning.\n\n${JSON.stringify(params.segments)}`,
      {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  translatedText: { type: Type.STRING },
                },
                required: ['id', 'translatedText'],
              },
            },
          },
          required: ['translations'],
        },
      }
    );
    return safeParseJson(response.text, '{"translations":[]}');
  }

  if (params.mode === 'report' && params.report) {
    const response = await generateWithFallback(
      ai,
      [FAST_QUOTA_MODEL, PRIMARY_QUALITY_MODEL],
      `Translate this entire structured English meeting minutes report into natural, professional ${params.targetLanguage} (using its native script, e.g. Malayalam script for Malayalam, Devanagari for Hindi, Tamil script for Tamil, Arabic script for Arabic, etc.). Keep speaker labels, technical product names, and decision/status codes clear and faithful. Do NOT omit any item or invent new facts.\n\n${JSON.stringify(params.report)}`,
      {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            targetLanguage: { type: Type.STRING },
            meetingTitle: { type: Type.STRING },
            executiveSummary: { type: Type.STRING },
            objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
            discussionPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            decisions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  decisionText: { type: Type.STRING },
                  decisionType: { type: Type.STRING },
                },
                required: ['decisionText', 'decisionType'],
              },
            },
            actionItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  task: { type: Type.STRING },
                  assignedTo: { type: Type.STRING },
                  deadline: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  status: { type: Type.STRING },
                },
                required: ['task', 'assignedTo', 'deadline', 'priority', 'status'],
              },
            },
            unresolvedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            risks: { type: Type.ARRAY, items: { type: Type.STRING } },
            followUpSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            meetingConclusion: { type: Type.STRING },
          },
          required: [
            'targetLanguage',
            'meetingTitle',
            'executiveSummary',
            'objectives',
            'discussionPoints',
            'decisions',
            'actionItems',
            'unresolvedQuestions',
            'risks',
            'followUpSuggestions',
            'meetingConclusion',
          ],
        },
      }
    );
    return safeParseJson(response.text, '{}');
  }

  throw new Error('Invalid translation payload');
}

export async function generateFollowUpEmail(params: {
  meetingTitle: string;
  meetingDate: string;
  executiveSummary: string;
  finalDecisions: string[];
  actionItems: Array<{ task: string; assignedTo: string; deadline: string; status: string }>;
  unresolvedQuestions: string[];
  followUpSuggestions: string[];
}): Promise<{ subject: string; body: string }> {
  const ai = getAiClient();

  const response = await generateWithFallback(
    ai,
    [FAST_QUOTA_MODEL, PRIMARY_QUALITY_MODEL],
    `Draft a crisp, professional follow-up email based strictly on these meeting minutes. Never invent deadlines, names, or facts. Clearly separate confirmed decisions from AI-recommended next steps.\n\n${JSON.stringify(params)}`,
    {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ['subject', 'body'],
      },
    }
  );

  return safeParseJson<{ subject: string; body: string }>(
    response.text,
    '{"subject":"","body":""}'
  );
}
