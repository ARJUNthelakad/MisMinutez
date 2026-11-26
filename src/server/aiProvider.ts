import type { StructuredMinutesOutput, TranscribedSegmentDTO } from '../types/index.ts';
import {
  transcribeMultilingualAudio as transcribeWithGemini,
  generateStructuredMinutes as generateMinutesWithGemini,
  answerMeetingQuestion as answerQuestionWithGemini,
  translateContent as translateWithGemini,
  generateFollowUpEmail as generateEmailWithGemini,
  formatGeminiError,
  type TranscribeChunkParams,
} from './gemini.ts';
import {
  getSelfHostedConfig,
  transcribeWithSelfHosted,
  generateMinutesWithSelfHosted,
  answerQuestionWithSelfHosted,
  translateWithSelfHosted,
  generateFollowUpEmailWithSelfHosted,
} from './selfHostedAi.ts';

export type ActiveAiProvider = 'self_hosted' | 'gemini' | 'unconfigured';

export function getAiProviderStatus() {
  const mode = (process.env.AI_PROVIDER || 'auto').trim().toLowerCase();
  const selfHosted = getSelfHostedConfig();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);

  let activeProvider: ActiveAiProvider = 'unconfigured';
  if (mode === 'self_hosted') {
    activeProvider = selfHosted.configured ? 'self_hosted' : 'unconfigured';
  } else if (mode === 'gemini') {
    activeProvider = geminiConfigured ? 'gemini' : 'unconfigured';
  } else {
    // auto: prefer self-hosted whenever configured, otherwise Gemini
    if (selfHosted.configured) activeProvider = 'self_hosted';
    else if (geminiConfigured) activeProvider = 'gemini';
  }

  return {
    mode: mode === 'self_hosted' || mode === 'gemini' ? mode : 'auto',
    activeProvider,
    selfHostedConfigured: selfHosted.configured,
    selfHostedHasAsr: selfHosted.hasAsr,
    selfHostedHasLlm: selfHosted.hasLlm,
    geminiConfigured,
    aiConfigured: activeProvider !== 'unconfigured',
  };
}

export function formatAiError(err: unknown, fallbackMessage: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Self-hosted') || msg.includes('SELF_HOSTED_') || msg.includes('ECONNREFUSED') || msg.includes('abort')) {
    return `Self-hosted AI API unreachable or returned an error: ${msg.slice(0, 220)}`;
  }
  return formatGeminiError(err, fallbackMessage);
}

async function routeOperation<T>(opts: {
  capability: 'asr' | 'llm';
  runSelfHosted: () => Promise<T>;
  runGemini: () => Promise<T>;
}): Promise<T> {
  const status = getAiProviderStatus();
  const selfHostedReady =
    opts.capability === 'asr' ? status.selfHostedHasAsr : status.selfHostedHasLlm;

  if (status.mode === 'gemini') {
    return opts.runGemini();
  }

  if (status.mode === 'self_hosted') {
    if (!selfHostedReady) {
      throw new Error(
        opts.capability === 'asr'
          ? 'AI_PROVIDER is set to self_hosted, but SELF_HOSTED_ASR_URL (or SELF_HOSTED_BASE_URL) is not configured.'
          : 'AI_PROVIDER is set to self_hosted, but SELF_HOSTED_LLM_URL (or SELF_HOSTED_BASE_URL) is not configured.'
      );
    }
    return opts.runSelfHosted();
  }

  // auto mode: prefer self-hosted when configured; fall back to Gemini if unreachable
  if (selfHostedReady) {
    try {
      return await opts.runSelfHosted();
    } catch (err) {
      if (status.geminiConfigured) {
        console.warn(
          `Self-hosted ${opts.capability.toUpperCase()} failed in auto mode; falling back to Gemini:`,
          err instanceof Error ? err.message : err
        );
        return opts.runGemini();
      }
      throw err;
    }
  }

  return opts.runGemini();
}

export async function transcribeMultilingualAudio(
  params: TranscribeChunkParams
): Promise<{ segments: TranscribedSegmentDTO[]; audioNotes: string }> {
  return routeOperation({
    capability: 'asr',
    runSelfHosted: () => transcribeWithSelfHosted(params),
    runGemini: () => transcribeWithGemini(params),
  });
}

export async function generateStructuredMinutes(
  params: Parameters<typeof generateMinutesWithGemini>[0]
): Promise<StructuredMinutesOutput> {
  return routeOperation({
    capability: 'llm',
    runSelfHosted: () => generateMinutesWithSelfHosted(params),
    runGemini: () => generateMinutesWithGemini(params),
  });
}

export async function answerMeetingQuestion(
  params: Parameters<typeof answerQuestionWithGemini>[0]
): Promise<string> {
  return routeOperation({
    capability: 'llm',
    runSelfHosted: () => answerQuestionWithSelfHosted(params),
    runGemini: () => answerQuestionWithGemini(params),
  });
}

export async function translateContent(
  params: Parameters<typeof translateWithGemini>[0]
): Promise<unknown> {
  return routeOperation({
    capability: 'llm',
    runSelfHosted: () => translateWithSelfHosted(params),
    runGemini: () => translateWithGemini(params),
  });
}

export async function generateFollowUpEmail(
  params: Parameters<typeof generateEmailWithGemini>[0]
): Promise<{ subject: string; body: string }> {
  return routeOperation({
    capability: 'llm',
    runSelfHosted: () => generateFollowUpEmailWithSelfHosted(params),
    runGemini: () => generateEmailWithGemini(params),
  });
}
