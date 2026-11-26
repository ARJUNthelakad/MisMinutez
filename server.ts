import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { requireFirebaseAuth, type AuthedRequest } from './src/server/verifyToken.ts';
import {
  transcribeMultilingualAudio,
  generateStructuredMinutes,
  answerMeetingQuestion,
  translateContent,
  generateFollowUpEmail,
  formatAiError,
  getAiProviderStatus,
} from './src/server/aiProvider.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory idempotency registry for uploaded audio chunk IDs (prevents duplicate chunk processing)
const uploadedChunkRegistry = new Map<string, { userId: string; receivedAt: number; sizeBytes: number }>();

const UploadChunkSchema = z.object({
  chunkId: z.string().min(4).max(160).regex(/^[a-zA-Z0-9_\-]+$/),
  meetingId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
  chunkIndex: z.number().int().min(0).max(10000),
  mimeType: z.string().min(3).max(80),
  base64Audio: z.string().min(10).max(20_000_000),
  durationSec: z.number().min(0).max(3600),
});

const TranscriptionSchema = z.object({
  chunkId: z.string().min(4).max(160).regex(/^[a-zA-Z0-9_\-]+$/).optional(),
  base64Audio: z.string().min(10).max(20_000_000),
  mimeType: z.string().min(3).max(80),
  startOffsetSec: z.number().min(0).max(86400).default(0),
  durationSec: z.number().min(0).max(3600).default(15),
  expectedLanguages: z.array(z.string().max(40)).max(10).default([]),
  knownSpeakers: z.array(z.string().max(60)).max(25).default([]),
  previousContext: z.string().max(1000).optional(),
});

const MeetingAnalysisSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).default(''),
  meetingType: z.string().min(1).max(60).default('General meeting'),
  speakers: z.record(z.string(), z.string()).default({}),
  transcript: z
    .array(
      z.object({
        speakerLabel: z.string().max(60),
        englishTranslation: z.string().max(6000),
        originalText: z.string().max(6000),
        detectedLanguage: z.string().max(60),
        startTime: z.number().min(0),
        endTime: z.number().min(0),
        uncertain: z.boolean().default(false),
      })
    )
    .min(1)
    .max(2000),
});

const MeetingChatSchema = z.object({
  question: z.string().min(1).max(2000),
  meetingTitle: z.string().min(1).max(200),
  executiveSummary: z.string().max(8000).default(''),
  decisions: z
    .array(
      z.object({
        decisionText: z.string(),
        decisionType: z.string(),
        speaker: z.string().default(''),
        timestamp: z.string().default(''),
      })
    )
    .max(100)
    .default([]),
  actionItems: z
    .array(
      z.object({
        task: z.string(),
        assignedTo: z.string().default(''),
        deadline: z.string().default(''),
        status: z.string().default('pending'),
      })
    )
    .max(100)
    .default([]),
  transcript: z
    .array(
      z.object({
        speakerLabel: z.string(),
        displayName: z.string().optional(),
        englishTranslation: z.string(),
        originalText: z.string(),
        detectedLanguage: z.string(),
        startTime: z.number(),
      })
    )
    .max(2000),
  history: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
      })
    )
    .max(20)
    .default([]),
});

const TranslationSchema = z.object({
  mode: z.enum(['segments', 'report']),
  targetLanguage: z.string().min(2).max(50),
  segments: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(6000),
        detectedLanguage: z.string().optional(),
      })
    )
    .max(500)
    .optional(),
  report: z
    .object({
      meetingTitle: z.string(),
      executiveSummary: z.string(),
      objectives: z.array(z.string()),
      discussionPoints: z.array(z.string()),
      decisions: z.array(z.object({ decisionText: z.string(), decisionType: z.string() })),
      actionItems: z.array(
        z.object({
          task: z.string(),
          assignedTo: z.string(),
          deadline: z.string(),
          priority: z.string(),
          status: z.string(),
        })
      ),
      unresolvedQuestions: z.array(z.string()),
      risks: z.array(z.string()),
      followUpSuggestions: z.array(z.string()),
      meetingConclusion: z.string(),
    })
    .optional(),
});

const FollowUpEmailSchema = z.object({
  meetingTitle: z.string().min(1).max(200),
  meetingDate: z.string().max(60),
  executiveSummary: z.string().max(8000),
  finalDecisions: z.array(z.string()).max(50),
  actionItems: z
    .array(
      z.object({
        task: z.string(),
        assignedTo: z.string(),
        deadline: z.string(),
        status: z.string(),
      })
    )
    .max(100),
  unresolvedQuestions: z.array(z.string()).max(40),
  followUpSuggestions: z.array(z.string()).max(40),
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

  // Real server connectivity health check (used by offline-first sync engine)
  app.get('/api/health', (_req, res) => {
    const provider = getAiProviderStatus();
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      aiConfigured: provider.aiConfigured,
      aiProvider: provider.activeProvider,
      aiMode: provider.mode,
      selfHostedConfigured: provider.selfHostedConfigured,
      geminiConfigured: provider.geminiConfigured,
    });
  });

  // Idempotent audio chunk upload verification endpoint
  app.post('/api/recordings/upload', requireFirebaseAuth, (req: AuthedRequest, res) => {
    const parsed = UploadChunkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid recording chunk payload.', details: parsed.error.flatten() });
      return;
    }

    const { chunkId, base64Audio } = parsed.data;
    const uid = req.user!.uid;
    const registryKey = `${uid}:${chunkId}`;
    const existing = uploadedChunkRegistry.get(registryKey);

    if (existing) {
      res.json({
        chunkId,
        duplicate: true,
        receivedBytes: existing.sizeBytes,
        confirmedAt: new Date(existing.receivedAt).toISOString(),
      });
      return;
    }

    const sizeBytes = Buffer.byteLength(base64Audio, 'base64');
    // Prune oldest entries if registry grows large
    if (uploadedChunkRegistry.size > 5000) {
      const oldestKey = uploadedChunkRegistry.keys().next().value;
      if (oldestKey) uploadedChunkRegistry.delete(oldestKey);
    }

    uploadedChunkRegistry.set(registryKey, {
      userId: uid,
      receivedAt: Date.now(),
      sizeBytes,
    });

    res.json({
      chunkId,
      duplicate: false,
      receivedBytes: sizeBytes,
      confirmedAt: new Date().toISOString(),
    });
  });

  // Multilingual audio transcription, language detection, speaker diarization & English translation
  app.post('/api/transcription', requireFirebaseAuth, async (req: AuthedRequest, res) => {
    const parsed = TranscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid transcription request.', details: parsed.error.flatten() });
      return;
    }

    const uid = req.user!.uid;
    const { chunkId, base64Audio } = parsed.data;
    if (chunkId) {
      const registryKey = `${uid}:${chunkId}`;
      if (uploadedChunkRegistry.has(registryKey)) {
        res.json({ segments: [], audioNotes: 'Duplicate chunk skipped.', duplicate: true });
        return;
      }
      if (uploadedChunkRegistry.size > 5000) {
        const oldestKey = uploadedChunkRegistry.keys().next().value;
        if (oldestKey) uploadedChunkRegistry.delete(oldestKey);
      }
      uploadedChunkRegistry.set(registryKey, {
        userId: uid,
        receivedAt: Date.now(),
        sizeBytes: Buffer.byteLength(base64Audio, 'base64'),
      });
    }

    try {
      const result = await transcribeMultilingualAudio(parsed.data);
      res.json(result);
    } catch (err) {
      if (chunkId) {
        uploadedChunkRegistry.delete(`${uid}:${chunkId}`);
      }
      console.error('Transcription error:', err);
      const message = formatAiError(err, 'Transcription failed.');
      res.status(message.includes('quota') ? 429 : 502).json({ error: message });
    }
  });

  // Structured meeting minutes extraction with Gemini
  app.post('/api/meeting-analysis', requireFirebaseAuth, async (req: AuthedRequest, res) => {
    const parsed = MeetingAnalysisSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid meeting analysis request.', details: parsed.error.flatten() });
      return;
    }

    try {
      const minutes = await generateStructuredMinutes(parsed.data);
      res.json(minutes);
    } catch (err) {
      console.error('Meeting analysis error:', err);
      const message = formatAiError(err, 'Failed to analyze meeting transcript.');
      res.status(message.includes('quota') ? 429 : 502).json({ error: message });
    }
  });

  // Grounded Ask Your Meeting Q&A
  app.post('/api/meeting-chat', requireFirebaseAuth, async (req: AuthedRequest, res) => {
    const parsed = MeetingChatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid chat request.', details: parsed.error.flatten() });
      return;
    }

    try {
      const answer = await answerMeetingQuestion(parsed.data);
      res.json({ answer });
    } catch (err) {
      console.error('Meeting chat error:', err);
      const message = formatAiError(err, 'Failed to answer meeting question.');
      res.status(message.includes('quota') ? 429 : 502).json({ error: message });
    }
  });

  // Multilingual segment or report translation
  app.post('/api/translation', requireFirebaseAuth, async (req: AuthedRequest, res) => {
    const parsed = TranslationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid translation request.', details: parsed.error.flatten() });
      return;
    }

    try {
      const translated = await translateContent(parsed.data);
      res.json(translated);
    } catch (err) {
      console.error('Translation error:', err);
      const message = formatAiError(err, 'Translation failed.');
      res.status(message.includes('quota') ? 429 : 502).json({ error: message });
    }
  });

  // Smart Follow-up Email draft generator
  app.post('/api/followup-email', requireFirebaseAuth, async (req: AuthedRequest, res) => {
    const parsed = FollowUpEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid follow-up email request.', details: parsed.error.flatten() });
      return;
    }

    try {
      const draft = await generateFollowUpEmail(parsed.data);
      res.json(draft);
    } catch (err) {
      console.error('Follow-up email error:', err);
      const message = formatAiError(err, 'Failed to draft follow-up email.');
      res.status(message.includes('quota') ? 429 : 502).json({ error: message });
    }
  });

  // Vite middleware for dev or static dist serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MisMinutez server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
