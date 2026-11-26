import { jsPDF } from 'jspdf';

interface SectionTableRow {
  col1: string;
  col2: string;
  col3?: string;
}

export function buildArchitectureDocPdf(): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const maxWidth = pageWidth - margin * 2;
  let y = 52;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 54) {
      doc.addPage();
      y = 52;
    }
  };

  const addSectionHeader = (num: string, title: string) => {
    ensureSpace(44);
    y += 10;
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(margin, y - 14, maxWidth, 24, 4, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(29, 78, 216);
    doc.text(`${num}. ${title}`, margin + 10, y + 2);
    y += 22;
    doc.setTextColor(15, 23, 42);
  };

  const addSubheading = (title: string) => {
    ensureSpace(24);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(title, margin, y);
    y += 14;
  };

  const addParagraph = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      ensureSpace(14);
      doc.text(line, margin, y);
      y += 13.5;
    }
    y += 4;
  };

  const addBullet = (lead: string, text: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.2);
    const prefix = `${lead}: `;
    const combined = `${prefix}${text}`;
    const lines = doc.splitTextToSize(combined, maxWidth - 14) as string[];
    ensureSpace(lines.length * 13 + 4);

    doc.setFillColor(29, 78, 216);
    doc.circle(margin + 4, y - 3, 2, 'F');

    lines.forEach((line, idx) => {
      if (idx === 0 && line.startsWith(prefix)) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(prefix, margin + 12, y);
        const prefixW = doc.getTextWidth(prefix);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        doc.text(line.slice(prefix.length), margin + 12 + prefixW + 1.5, y);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        doc.text(line, margin + 12, y);
      }
      y += 13;
    });
    y += 2.5;
  };

  const addTable = (headers: string[], rows: SectionTableRow[], colWidths: number[]) => {
    ensureSpace(38);
    const rowPadX = 6;
    const rowPadY = 5.5;

    const drawHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.rect(margin, y, maxWidth, 20, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.4);
      doc.setTextColor(255, 255, 255);
      let x = margin;
      headers.forEach((h, i) => {
        doc.text(h, x + rowPadX, y + 13);
        x += colWidths[i];
      });
      y += 20;
    };

    drawHeader();

    rows.forEach((row, rIdx) => {
      const vals = row.col3 !== undefined ? [row.col1, row.col2, row.col3] : [row.col1, row.col2];
      const wrappedCols = vals.map((v, i) => {
        doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
        doc.setFontSize(8.2);
        return doc.splitTextToSize(v, colWidths[i] - rowPadX * 2) as string[];
      });
      const maxLines = Math.max(...wrappedCols.map((c) => c.length));
      const rowHeight = maxLines * 11 + rowPadY * 2;

      if (y + rowHeight + 6 > pageHeight - 54) {
        doc.addPage();
        y = 52;
        drawHeader();
      }

      if (rIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, maxWidth, rowHeight, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, maxWidth, rowHeight, 'S');

      let cx = margin;
      wrappedCols.forEach((lines, cIdx) => {
        doc.setFont('helvetica', cIdx === 0 ? 'bold' : 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(cIdx === 0 ? 15 : 51, cIdx === 0 ? 23 : 65, cIdx === 0 ? 42 : 85);
        lines.forEach((line, lIdx) => {
          doc.text(line, cx + rowPadX, y + rowPadY + 8.5 + lIdx * 11);
        });
        cx += colWidths[cIdx];
      });
      y += rowHeight;
    });
    y += 10;
  };

  // ==================== COVER BANNER ====================
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, y - 16, maxWidth, 88, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('MisMinutez', margin + 18, y + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(191, 219, 254);
  doc.text('Complete Technical Architecture, Stack & System Documentation', margin + 18, y + 34);

  doc.setFontSize(8.8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `AI-Powered Multilingual Meeting Minutes Generator  |  Generated: ${new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}`,
    margin + 18,
    y + 54
  );
  y += 88;

  addParagraph(
    'MisMinutez is a full-stack, offline-first web application designed to record physical, face-to-face multilingual meetings directly through a device built-in microphone, transcribe and translate mixed-language speech (English, Malayalam, Hindi, Tamil, Kannada, Telugu, Arabic, and more), diarize anonymous speakers, and automatically generate structured executive meeting minutes, decisions, action items, analytics, grounded AI Q&A chat, follow-up emails, and PDF reports.'
  );

  addTable(
    ['Layer', 'Primary Technology', 'Role in Application'],
    [
      {
        col1: 'Frontend (Client)',
        col2: 'React 19 + TypeScript + Vite 8 + Tailwind CSS v4',
        col3: 'Responsive SPA, built-in mic audio capture, waveform UI, offline queue, analytics & PDF export',
      },
      {
        col1: 'Backend (Server)',
        col2: 'Node.js + Express 4 + TypeScript (tsx)',
        col3: 'Authenticated REST API, Firebase JWT verification, Zod validation, server-side Gemini AI proxy',
      },
      {
        col1: 'Cloud Database',
        col2: 'Firebase Cloud Firestore (NoSQL)',
        col3: 'Real-time cloud persistence for users, meetings, segments, decisions, action items & Q&A chat',
      },
      {
        col1: 'Local Offline DB',
        col2: 'Browser IndexedDB (misminutez_offline_store)',
        col3: 'Offline-first local audio chunk storage & automatic background upload/retry queue',
      },
      {
        col1: 'Authentication',
        col2: 'Firebase Authentication (Google Sign-In)',
        col3: 'User login, session persistence & RS256 Bearer ID tokens verified by backend',
      },
      {
        col1: 'AI Engine (Dual)',
        col2: 'Self-Hosted (Whisper + Ollama) OR Gemini API',
        col3: 'Unified router supports your own FastAPI faster-whisper + Ollama server (zero quotas) and Gemini Cloud failover',
      },
    ],
    [102, 185, maxWidth - 287]
  );

  // ==================== SECTION 1: SYSTEM ARCHITECTURE ====================
  addSectionHeader('1', 'End-to-End System Architecture & Data Flow');
  addParagraph(
    'MisMinutez follows a single-origin full-stack Node.js architecture running on port 3000. In development, Express mounts Vite middleware (vite.middlewares) to serve the React frontend alongside /api/* REST routes. In production, Express serves the compiled static bundle from dist/ and handles all API traffic on the same host.'
  );
  addBullet(
    'Step 1 — Audio Capture (Browser)',
    'The user starts a live physical meeting using Web APIs (navigator.mediaDevices.getUserMedia + MediaRecorder). Audio is sliced into clean, self-contained containers (default 20s chunks, configurable 15s-45s) while AudioContext + AnalyserNode renders a real-time frequency waveform on HTML5 Canvas.'
  );
  addBullet(
    'Step 2 — Offline-First Guarantee (IndexedDB)',
    'Every recorded audio blob is persisted immediately into browser IndexedDB (audio_chunks) BEFORE any network request. If the room loses Wi-Fi, recording continues seamlessly and automatically syncs when connectivity returns.'
  );
  addBullet(
    'Step 3 — Authenticated API Upload (Express Backend)',
    'When online, the client attaches the Firebase ID Token (Authorization: Bearer <JWT>) and posts each audio chunk once to POST /api/transcription with an idempotent chunkId to prevent duplicate processing.'
  );
  addBullet(
    'Step 4 — Multilingual AI Transcription (Server-Side AI Router)',
    'The Express backend verifies the JWT signature against Google public x509 certificates, validates the payload with Zod, and routes via src/server/aiProvider.ts to either your Self-Hosted AI API (faster-whisper + Ollama) or Gemini Cloud (gemini-3.5-transcribe + gemini-3.1-flash-lite / gemini-4-hydrogen).'
  );
  addBullet(
    'Step 5 — Real-Time Persistence & Final Analysis (Firestore + Gemini)',
    'Transcribed segments save immediately to Firestore (/meetings/{id}/segments). On Stop & Finalize, the full transcript is sent to POST /api/meeting-analysis to extract structured minutes, decisions, and action items, which commit in a single atomic Firestore writeBatch.'
  );

  // ==================== SECTION 2: FRONTEND ARCHITECTURE ====================
  addSectionHeader('2', 'Frontend Architecture (Client-Side SPA)');
  addParagraph(
    'Built with React 19, TypeScript, Vite 8, and Tailwind CSS v4. State management uses React Context providers (AuthContext for Firebase authentication/profile/theme and ConnectivityContext for live /api/health monitoring and IndexedDB queue synchronization) paired with real-time Firestore onSnapshot subscriptions.'
  );

  addTable(
    ['Frontend Module', 'Responsibility'],
    [
      {
        col1: 'App.tsx & layout/AppShell.tsx',
        col2: 'Root view routing (Landing, Dashboard, New Meeting, Live Room, Results, History, Settings), responsive sidebar/header, theme toggle, connectivity badge & sync banner.',
      },
      {
        col1: 'components/landing/LandingPage.tsx',
        col2: 'Public landing page highlighting multilingual physical meeting capture, offline-first resilience, and Google Sign-In entry.',
      },
      {
        col1: 'components/dashboard/DashboardPage.tsx',
        col2: 'Workspace overview: meeting count, action item tracker (pending/completed), offline queued recordings banner with manual sync trigger, and recent meetings list.',
      },
      {
        col1: 'components/meeting/NewMeetingPage.tsx',
        col2: 'Meeting setup (title, agenda, type, output language, expected room languages), live built-in microphone level test, device picker, participant consent check, and pre-recorded audio file upload (MP3/WAV/WebM/OGG/M4A up to 14 MB).',
      },
      {
        col1: 'components/meeting/LiveMeetingRoom.tsx',
        col2: 'Live recording studio: rotating MediaRecorder chunks, Canvas audio waveform, pause/resume, real-time multilingual transcript feed (Both/Original/English views), inline speaker renaming & segment editing, deterministic Stop & Finalize pipeline.',
      },
      {
        col1: 'components/reports/MeetingResultsPage.tsx',
        col2: '10-tab meeting intelligence report: Executive Summary, Discussion Points, Decisions (editable status), Action Items (CRUD + filters), Unresolved Questions, Risks, Speaker Analytics (Recharts bar charts), Language Timeline, Full Editable Transcript, and Grounded AI Chat. Includes native-script report translation, follow-up email drafter, Re-analyze, and PDF export.',
      },
      {
        col1: 'components/history/MeetingHistoryPage.tsx',
        col2: 'Searchable, filterable archive of all past meetings by title, type, status, or detected language, with full cascade deletion.',
      },
      {
        col1: 'components/settings/SettingsPage.tsx',
        col2: 'User profile, default output language, preferred room languages, light/dark theme, audio chunk interval (15-45s), auto-delete local audio toggle, IndexedDB cache inspector/cleaner, and Technical Documentation PDF export.',
      },
      {
        col1: 'lib/pdfExport.ts & lib/format.ts',
        col2: 'Client-side jsPDF meeting minutes generator (with optional full transcript appendix), speaker talk-time analytics, language switch timeline builder, and missed-information quality checks.',
      },
    ],
    [195, maxWidth - 195]
  );

  // ==================== SECTION 3: BACKEND ARCHITECTURE ====================
  addSectionHeader('3', 'Backend Architecture & REST API (Node.js + Express)');
  addParagraph(
    'The backend runs in server.ts using Express 4 (express.json with 25 MB limit) executed via tsx. All AI keys and self-hosted tokens stay strictly on the server and are never exposed to the browser. Every protected endpoint runs requireFirebaseAuth middleware (src/server/verifyToken.ts) and strict Zod schema validation before invoking the unified AI router (src/server/aiProvider.ts).'
  );

  addTable(
    ['Endpoint', 'Auth & Validation', 'Function'],
    [
      {
        col1: 'GET /api/health',
        col2: 'Public',
        col3: 'Verifies live server reachability and reports active AI engine status (aiProvider: self_hosted | gemini, aiMode, selfHostedConfigured, geminiConfigured).',
      },
      {
        col1: 'POST /api/recordings/upload',
        col2: 'Bearer JWT + UploadChunkSchema',
        col3: 'Idempotent chunk receipt verification backed by an in-memory per-user chunk registry (caps at 5,000 entries).',
      },
      {
        col1: 'POST /api/transcription',
        col2: 'Bearer JWT + TranscriptionSchema',
        col3: 'Single-pass idempotent audio chunk intake + multilingual ASR, speaker diarization, language detection & English translation.',
      },
      {
        col1: 'POST /api/meeting-analysis',
        col2: 'Bearer JWT + MeetingAnalysisSchema',
        col3: 'Extracts structured JSON meeting minutes: summary, objectives, discussion points, classified decisions, action items, questions, risks & next steps.',
      },
      {
        col1: 'POST /api/meeting-chat',
        col2: 'Bearer JWT + MeetingChatSchema',
        col3: 'Grounded Ask Your Meeting Q&A citing speaker labels and [MM:SS] timestamps; refuses to hallucinate outside transcript evidence.',
      },
      {
        col1: 'POST /api/translation',
        col2: 'Bearer JWT + TranslationSchema',
        col3: 'Translates transcript segments or entire structured meeting reports into native scripts (Malayalam, Hindi, Tamil, Kannada, Telugu, Arabic, etc.).',
      },
      {
        col1: 'POST /api/followup-email',
        col2: 'Bearer JWT + FollowUpEmailSchema',
        col3: 'Drafts a professional follow-up email (subject + body) strictly grounded in finalized decisions and action items.',
      },
    ],
    [138, 128, maxWidth - 266]
  );

  // ==================== SECTION 4: AI ENGINE ====================
  addSectionHeader('4', 'AI Engine: Self-Hosted AI API & Gemini Cloud Pipeline');
  addParagraph(
    'All AI processing is routed server-side through src/server/aiProvider.ts supporting three modes via AI_PROVIDER: auto (uses your Self-Hosted AI API whenever configured and falls back to Gemini Cloud if offline), self_hosted (strictly uses your own server with zero daily quotas), or gemini.'
  );
  addSubheading('A. Own Self-Hosted AI API (/self-hosted-ai + src/server/selfHostedAi.ts)');
  addBullet(
    'FastAPI + faster-whisper (POST /v1/audio/transcriptions)',
    'Standalone Python FastAPI microservice (self-hosted-ai/server.py + Dockerfile + docker-compose.yml) running faster-whisper (large-v3-turbo / small / medium) for unlimited multilingual speech-to-text with VAD filtering and timestamps.'
  );
  addBullet(
    'Ollama OpenAI-Compatible LLM (POST /v1/chat/completions)',
    'Proxies structured JSON minutes, speaker turn structuring, grounded Q&A, report translation, and follow-up email generation to Ollama (qwen2.5:7b / qwen2.5:3b) or any OpenAI-compatible server (vLLM, LM Studio, LocalAI).'
  );
  addBullet(
    'Zero-Quota Private Security',
    'Protected by constant-time Bearer token verification (SELF_HOSTED_API_TOKEN), 25 MB audio size limit, safe system temp files auto-deleted after transcription, and HTTPS exposure via Cloudflare Tunnel.'
  );
  addSubheading('B. Gemini Cloud Pipeline (src/server/gemini.ts — @google/genai v3.6.1)');
  addBullet(
    'Primary Speech Recognition (ASR)',
    'gemini-3.5-transcribe processes raw audio blobs (audio/webm, audio/mp4, audio/mp3, audio/wav, audio/ogg) verbatim in native scripts with code-switching support and immediately short-circuits on [SILENCE].'
  );
  addBullet(
    'Quota-Resilient Structuring, Minutes, Chat & Translation',
    'High-frequency chunk structuring, Q&A chat, translations, and follow-up emails prioritize gemini-3.1-flash-lite (ThinkingLevel.MINIMAL). Executive minutes use gemini-4-hydrogen (ThinkingLevel.LOW) with automatic 429 failover to gemini-3.1-flash-lite.'
  );

  // ==================== SECTION 5: DATABASE & STORAGE ====================
  addSectionHeader('5', 'Database & Offline Storage Architecture');
  addSubheading('A. Cloud Database — Firebase Cloud Firestore');
  addParagraph(
    'Primary persistent storage uses Firebase Cloud Firestore (Database ID: ai-studio-92d9aa41-560c-4e66-8456-8dae8d6ad097) configured via firebase-applet-config.json. Client queries use real-time onSnapshot listeners for instant UI synchronization and atomic writeBatch operations for saving minutes and cascade deletions.'
  );

  addTable(
    ['Firestore Collection Path', 'Key Fields & Purpose'],
    [
      {
        col1: '/users/{userId}',
        col2: 'uid, name, email, defaultReportLanguage, preferredLanguages[], theme (light|dark), autoDeleteAudio, chunkDurationSec, createdAt, updatedAt.',
      },
      {
        col1: '/meetings/{meetingId}',
        col2: 'userId, title, description, meetingType, preferredOutputLanguage, expectedLanguages[], startedAt, endedAt, duration, status, executiveSummary, objectives[], discussionPoints[], unresolvedQuestions[], risks[], followUpSuggestions[], meetingConclusion, speakers{}, languagesDetected[], segmentCount.',
      },
      {
        col1: '/meetings/{id}/segments/{segId}',
        col2: 'userId, meetingId, speakerLabel, originalText, englishTranslation, detectedLanguage, startTime, endTime, uncertain, chunkIndex.',
      },
      {
        col1: '/meetings/{id}/decisions/{decId}',
        col2: 'userId, meetingId, decisionText, decisionType (final|proposed|pending|rejected), speaker, timestamp, transcriptReference.',
      },
      {
        col1: '/meetings/{id}/chatMessages/{msgId}',
        col2: 'userId, meetingId, question, answer, createdAt — stores Ask Your Meeting grounded Q&A history.',
      },
      {
        col1: '/actionItems/{itemId}',
        col2: 'userId, meetingId, meetingTitle, task, assignedTo, deadline, priority (low|medium|high), status (pending|completed), transcriptReference.',
      },
    ],
    [182, maxWidth - 182]
  );

  addSubheading('B. Local Offline Storage — Browser IndexedDB');
  addParagraph(
    'Implemented in src/lib/offlineDb.ts using native IndexedDB (DB_NAME: misminutez_offline_store, Version 1). Two object stores power offline-first recording:'
  );
  addBullet(
    'Object Store: audio_chunks (keyPath: chunkId)',
    'Stores raw binary Blob chunks, meetingId, userId, chunkIndex, startOffsetSec, durationSec, mimeType, sizeBytes, uploadStatus (pending | uploading | uploaded | processed | failed), retryCount, and lastError. Indexed by by_meeting and by_status.'
  );
  addBullet(
    'Object Store: offline_meetings (keyPath: meetingId)',
    'Stores meeting metadata when sessions start or finish offline (syncedToFirestore flag). Automatically syncs and creates the Firestore meeting record once /api/health confirms connectivity.'
  );

  // ==================== SECTION 6: SECURITY & PRIVACY ====================
  addSectionHeader('6', 'Authentication, Security & Privacy Design');
  addBullet(
    'Authentication Flow',
    'Firebase Auth with Google Sign-In (signInWithPopup + redirect fallback). Client retrieves fresh Firebase ID tokens via user.getIdToken() and sends them in Authorization: Bearer <token> headers.'
  );
  addBullet(
    'Server-Side Cryptographic Token Verification',
    'src/server/verifyToken.ts decodes JWT headers/payloads, enforces RS256, checks aud, iss, exp, iat, and sub against the Firebase project ID, caches Google x509 public keys respecting Cache-Control, and verifies the RSA-SHA256 signature via Node crypto.'
  );
  addBullet(
    'Hardened Firestore Security Rules (firestore.rules)',
    'Default-deny architecture enforcing strict per-user isolation (request.auth.uid == resource.data.userId), parent meeting ownership checks on subcollections, strict field type/length/enum validation, immutable userId/meetingId fields on update, and linted with @firebase/eslint-plugin-security-rules.'
  );
  addBullet(
    'API Key & Privacy Hygiene',
    'GEMINI_API_KEY exists solely in server-side process.env. Audio chunks can be auto-deleted from IndexedDB after confirmed transcription. Speakers are labeled anonymously (Speaker 1, Speaker 2) without voice biometrics, and explicit participant consent confirmation is required before recording.'
  );

  // ==================== SECTION 7: DEPENDENCIES & RUNTIME ====================
  addSectionHeader('7', 'Dependencies, Environment & Deployment');
  addTable(
    ['Category', 'Packages & Versions'],
    [
      {
        col1: 'Frontend Core & UI',
        col2: 'react (^19.0.1), react-dom (^19.0.1), tailwindcss (^4.3.3), @tailwindcss/vite (^4.3.3), lucide-react (^0.546.0), motion (^12.23.24), recharts (^3.11.0), jspdf (^4.2.1)',
      },
      {
        col1: 'Backend & AI',
        col2: 'express (^4.21.2), @google/genai (^3.6.1), zod (^4.6.7), dotenv (^17.2.3), tsx (^4.21.0)',
      },
      {
        col1: 'Database & Auth',
        col2: 'firebase (^13.4.0), @firebase/eslint-plugin-security-rules (^0.0.2)',
      },
      {
        col1: 'Build & Tooling',
        col2: 'vite (^8.3.0), @vitejs/plugin-react (^6.1.1), typescript (^7.0.2), esbuild (^0.25.0), eslint (^10.15.0)',
      },
      {
        col1: 'Self-Hosted AI Stack',
        col2: 'Python 3.11, FastAPI, Uvicorn, faster-whisper, httpx, python-multipart, ffmpeg, Ollama (qwen2.5:7b), Docker Compose',
      },
    ],
    [130, maxWidth - 130]
  );

  addBullet(
    'Environment Variables (.env.example)',
    'GEMINI_API_KEY, APP_URL, AI_PROVIDER (auto | self_hosted | gemini), SELF_HOSTED_BASE_URL, SELF_HOSTED_ASR_URL, SELF_HOSTED_LLM_URL, SELF_HOSTED_ASR_MODEL, SELF_HOSTED_LLM_MODEL, and SELF_HOSTED_API_TOKEN. Firebase web config is loaded from firebase-applet-config.json.'
  );
  addBullet(
    'Runtime & Build Scripts',
    'npm run dev runs tsx server.ts (Express + Vite middleware on port 3000); npm run build runs vite build to output dist/; npm start runs NODE_ENV=production tsx server.ts; npm run lint runs tsc --noEmit.'
  );

  // Page numbers footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'MisMinutez — Technical Architecture & System Documentation',
      margin,
      pageHeight - 22
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 22, {
      align: 'right',
    });
  }

  return doc;
}

export function downloadArchitectureDocPdf(): void {
  const doc = buildArchitectureDocPdf();
  doc.save('MisMinutez-Technical-Documentation.pdf');
}
