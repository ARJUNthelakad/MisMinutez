import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic,
  Pause,
  Play,
  Square,
  Wifi,
  WifiOff,
  HardDrive,
  Loader2,
  AlertCircle,
  Edit3,
  Check,
  X,
  Users,
  Smartphone,
  MapPin,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConnectivity } from '../../context/ConnectivityContext';
import {
  createMeetingRecord,
  generateSafeId,
  saveStructuredMinutes,
  saveTranscriptSegments,
  updateMeetingProgress,
  updateMeetingSpeakers,
  updateTranscriptSegment,
} from '../../lib/firestore';
import {
  blobToBase64,
  deleteAudioChunk,
  deleteOfflineMeetingMeta,
  getOfflineMeetingMeta,
  saveAudioChunk,
  saveOfflineMeetingMeta,
  updateAudioChunkStatus,
} from '../../lib/offlineDb';
import {
  analyzeMeetingTranscriptApi,
  transcribeAudioChunkApi,
} from '../../lib/api';
import { formatDuration, formatMeetingDate, getSpeakerDisplayName } from '../../lib/format';
import type { AppRoute, MeetingType, TranscriptSegment } from '../../types';

interface LiveMeetingRoomProps {
  meetingId: string;
  initialConfig?: {
    selectedDeviceId: string;
    expectedLanguages: string[];
    title: string;
    description: string;
    meetingType: MeetingType;
    attendees: string[];
    venue: string;
    startedAt: string;
    preferredOutputLanguage: string;
  };
  onNavigate: (route: AppRoute) => void;
}

type TranscriptViewMode = 'both' | 'original' | 'english';

function pickSupportedAudioMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export function LiveMeetingRoom({
  meetingId,
  initialConfig,
  onNavigate,
}: LiveMeetingRoomProps) {
  const { user, profile } = useAuth();
  const { isOnline, refreshLocalQueueStats, recheckConnectivity } = useConnectivity();

  const [title, setTitle] = useState(initialConfig?.title || 'Live Physical Meeting');
  const [description, setDescription] = useState(initialConfig?.description || '');
  const [meetingType, setMeetingType] = useState<MeetingType>(
    initialConfig?.meetingType || 'General meeting'
  );
  const [attendees, setAttendees] = useState<string[]>(initialConfig?.attendees || []);
  const [venue, setVenue] = useState<string>(initialConfig?.venue || '');
  const [startedAt, setStartedAt] = useState<string>(
    initialConfig?.startedAt || new Date().toISOString()
  );
  const [preferredOutputLanguage, setPreferredOutputLanguage] = useState(
    initialConfig?.preferredOutputLanguage || 'English'
  );
  const [expectedLanguages, setExpectedLanguages] = useState<string[]>(
    initialConfig?.expectedLanguages || ['English', 'Malayalam', 'Hindi', 'Tamil']
  );

  // Recording state
  const [recordState, setRecordState] = useState<'idle' | 'recording' | 'paused' | 'finalizing'>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [processingChunkCount, setProcessingChunkCount] = useState(0);
  const [savedLocalChunks, setSavedLocalChunks] = useState(0);
  const [uploadedChunks, setUploadedChunks] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Ready to record. Press Start Recording when participants are ready.'
  );

  // Live transcript & speakers
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [speakers, setSpeakers] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<TranscriptViewMode>('both');
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [editOriginal, setEditOriginal] = useState('');
  const [editEnglish, setEditEnglish] = useState('');
  const [editSpeaker, setEditSpeaker] = useState('');

  // Refs for audio capture & chunk rotation
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkIndexRef = useRef(0);
  const chunkStartOffsetRef = useRef(0);
  const elapsedRef = useRef(0);
  const isStoppingRef = useRef(false);
  const isPausedRef = useRef(false);
  const mimeTypeRef = useRef<string>('');
  const pendingPromisesRef = useRef<Promise<void>[]>([]);
  const finalStopResolveRef = useRef<(() => void) | null>(null);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const speakersRef = useRef<Record<string, string>>({});
  const lastChunkErrorRef = useRef<string | null>(null);
  const onlineRef = useRef(isOnline);

  useEffect(() => {
    onlineRef.current = isOnline;
  }, [isOnline]);

  // Hydrate offline meeting metadata if returning to a session
  useEffect(() => {
    if (initialConfig) return;
    void getOfflineMeetingMeta(meetingId).then((meta) => {
      if (meta) {
        setTitle(meta.title);
        setDescription(meta.description);
        setMeetingType(meta.meetingType);
        setAttendees(meta.attendees || []);
        setVenue(meta.venue || '');
        setStartedAt(meta.startedAt || new Date().toISOString());
        setPreferredOutputLanguage(meta.preferredOutputLanguage);
        setExpectedLanguages(meta.expectedLanguages);
      }
    });
  }, [meetingId, initialConfig]);

  const chunkDurationSec = Math.min(45, Math.max(12, profile?.chunkDurationSec || 20));

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      analyser.getByteFrequencyData(dataArray);
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barCount = 48;
      const gap = 3;
      const barWidth = Math.max(2, (width - gap * (barCount - 1)) / barCount);

      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * (bufferLength * 0.65));
        const val = isPausedRef.current ? 4 : dataArray[idx] || 0;
        const normalized = val / 255;
        const barH = Math.max(4, normalized * (height - 8));
        const x = i * (barWidth + gap);
        const y = (height - barH) / 2;

        ctx.fillStyle = isPausedRef.current
          ? 'rgba(148, 163, 184, 0.5)'
          : normalized > 0.55
          ? '#1D4ED8'
          : '#3B82F6';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 2);
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(render);
    };
    render();
  }, []);

  const handleRecordedBlob = useCallback(
    async (blob: Blob, chunkIdx: number, startOffset: number, durationSec: number) => {
      if (!user || blob.size < 400) return;

      const chunkId = `${meetingId}_ch_${chunkIdx}_${Date.now().toString(36)}`;
      const mimeType = blob.type || mimeTypeRef.current || 'audio/webm';

      // 1. ALWAYS save chunk locally to IndexedDB first (Offline-First Guarantee)
      await saveAudioChunk({
        chunkId,
        meetingId,
        userId: user.uid,
        chunkIndex: chunkIdx,
        startOffsetSec: startOffset,
        durationSec,
        mimeType,
        blob,
        sizeBytes: blob.size,
        uploadStatus: 'pending',
        retryCount: 0,
        createdAt: Date.now(),
      });
      setSavedLocalChunks((c) => c + 1);

      // 2. Skip network call immediately if offline
      if (!onlineRef.current || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        setStatusMessage('Saved Locally — Waiting for Internet. Recording continues safely.');
        void refreshLocalQueueStats();
        return;
      }

      // 3. Single-pass idempotent upload + multilingual transcription (eliminates double upload latency)
      setProcessingChunkCount((n) => n + 1);
      setStatusMessage(`Transcribing audio chunk #${chunkIdx + 1}...`);

      try {
        await updateAudioChunkStatus(chunkId, 'uploading');
        const base64Audio = await blobToBase64(blob);

        const knownSpeakers = Object.keys(speakersRef.current);
        const recentContext = segmentsRef.current
          .slice(-3)
          .map((s) => `${s.speakerLabel}: ${s.englishTranslation}`)
          .join(' | ');

        const transcription = await transcribeAudioChunkApi({
          chunkId,
          base64Audio,
          mimeType,
          startOffsetSec: startOffset,
          durationSec,
          expectedLanguages,
          knownSpeakers,
          previousContext: recentContext,
        });
        setUploadedChunks((n) => n + 1);

        if (transcription.segments.length > 0) {
          const formatted = transcription.segments.map((s) => ({
            speakerLabel: s.speaker_label,
            originalText: s.original_text,
            englishTranslation: s.english_translation,
            detectedLanguage: s.detected_language,
            startTime: s.start_time,
            endTime: s.end_time,
            uncertain: s.uncertain,
          }));

          const savedSegs = await saveTranscriptSegments(user.uid, meetingId, chunkIdx, formatted);

          // Synchronously update refs BEFORE React re-renders so Stop & Finalize never misses the final chunk
          const updatedSpeakers = { ...speakersRef.current };
          const nextSegments = [...segmentsRef.current, ...savedSegs];
          const allLangs = new Set<string>(nextSegments.map((s) => s.detectedLanguage));
          savedSegs.forEach((s) => {
            if (!(s.speakerLabel in updatedSpeakers)) {
              updatedSpeakers[s.speakerLabel] = '';
            }
          });

          speakersRef.current = updatedSpeakers;
          segmentsRef.current = nextSegments;
          setSpeakers(updatedSpeakers);
          setSegments(nextSegments);

          if (!isStoppingRef.current) {
            void updateMeetingProgress(meetingId, {
              duration: elapsedRef.current,
              speakers: updatedSpeakers,
              languagesDetected: Array.from(allLangs),
              segmentCount: nextSegments.length,
            });
          }
        }

        await updateAudioChunkStatus(chunkId, 'processed');
        if (profile?.autoDeleteAudio ?? true) {
          void deleteAudioChunk(chunkId);
        }
        lastChunkErrorRef.current = null;
        setStatusMessage(
          transcription.segments.length > 0
            ? `Chunk #${chunkIdx + 1} transcribed (${transcription.segments.length} segment${transcription.segments.length === 1 ? '' : 's'})`
            : `Chunk #${chunkIdx + 1} processed (no speech detected)`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Chunk upload interrupted';
        lastChunkErrorRef.current = msg;
        await updateAudioChunkStatus(chunkId, 'failed', { retryCount: 1, lastError: msg });
        setStatusMessage(`Chunk #${chunkIdx + 1} saved locally for retry (${msg})`);
      } finally {
        setProcessingChunkCount((n) => Math.max(0, n - 1));
        void refreshLocalQueueStats();
      }
    },
    [user, meetingId, expectedLanguages, profile, refreshLocalQueueStats]
  );

  // Start a fresh MediaRecorder slice so every chunk is a complete, valid audio container file
  const spawnRecorderSlice = useCallback(
    (stream: MediaStream) => {
      const mimeType = mimeTypeRef.current;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const parts: BlobPart[] = [];
      const thisChunkIndex = chunkIndexRef.current;
      const thisStartOffset = chunkStartOffsetRef.current;
      const sliceStartedAt = Date.now();

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          parts.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const durSec = Math.max(1, (Date.now() - sliceStartedAt) / 1000);
        const blob = new Blob(parts, { type: mimeType || recorder.mimeType || 'audio/webm' });
        chunkIndexRef.current += 1;
        chunkStartOffsetRef.current = elapsedRef.current;

        const p = handleRecordedBlob(blob, thisChunkIndex, thisStartOffset, durSec);
        pendingPromisesRef.current.push(p);

        if (finalStopResolveRef.current) {
          const resolve = finalStopResolveRef.current;
          finalStopResolveRef.current = null;
          resolve();
        }

        // If still actively recording and not paused/stopping, immediately start the next clean container chunk
        if (!isStoppingRef.current && !isPausedRef.current && streamRef.current?.active) {
          spawnRecorderSlice(streamRef.current);
        }
      };

      recorderRef.current = recorder;
      recorder.start();
    },
    [handleRecordedBlob]
  );

  const cleanupMediaResources = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      isStoppingRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // Ignore teardown error
        }
      }
      cleanupMediaResources();
    };
  }, [cleanupMediaResources]);

  const handleStartRecording = async () => {
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Microphone API unavailable in this browser.');
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: initialConfig?.selectedDeviceId
          ? {
              deviceId: { exact: initialConfig.selectedDeviceId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      mimeTypeRef.current = pickSupportedAudioMime();
      isStoppingRef.current = false;
      isPausedRef.current = false;
      lastChunkErrorRef.current = null;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      spawnRecorderSlice(stream);
      setRecordState('recording');
      setStatusMessage(
        isOnline
          ? `Recording active — transcribing every ${chunkDurationSec}s with local IndexedDB backup.`
          : 'Saved Locally — Waiting for Internet. Recording safely to device storage.'
      );
      drawWaveform();

      timerRef.current = setInterval(() => {
        if (!isPausedRef.current) {
          elapsedRef.current += 1;
          setElapsedSec(elapsedRef.current);
        }
      }, 1000);

      // Rotate clean audio containers on interval
      chunkTimerRef.current = setInterval(() => {
        if (
          !isPausedRef.current &&
          !isStoppingRef.current &&
          recorderRef.current &&
          recorderRef.current.state === 'recording'
        ) {
          recorderRef.current.stop();
        }
      }, chunkDurationSec * 1000);
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Please allow microphone access in your browser settings and try again.'
          : err instanceof Error
          ? err.message
          : 'Failed to start microphone capture.';
      setMicError(msg);
    }
  };

  const handlePauseRecording = () => {
    isPausedRef.current = true;
    setRecordState('paused');
    setStatusMessage('Recording paused. Current audio chunk saved.');
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  const handleResumeRecording = () => {
    if (!streamRef.current?.active) return;
    isPausedRef.current = false;
    setRecordState('recording');
    setStatusMessage('Recording resumed.');
    spawnRecorderSlice(streamRef.current);
  };

  const handleStopAndFinish = async () => {
    if (!user) return;
    isStoppingRef.current = true;
    isPausedRef.current = false;
    setRecordState('finalizing');
    setStatusMessage('Step 1/3: Transcribing final audio segment...');

    // Deterministically await the final MediaRecorder.onstop flush (with safety timeout)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        finalStopResolveRef.current = resolve;
        const safety = setTimeout(() => {
          finalStopResolveRef.current = null;
          resolve();
        }, 1500);
        const origResolve = resolve;
        finalStopResolveRef.current = () => {
          clearTimeout(safety);
          origResolve();
        };
        recorderRef.current?.stop();
      });
    }
    cleanupMediaResources();

    // Await all in-flight audio chunk transcriptions
    await Promise.allSettled(pendingPromisesRef.current);

    const onlineNow = onlineRef.current ? true : await recheckConnectivity();
    const finalDuration = elapsedRef.current;

    if (!onlineNow) {
      await saveOfflineMeetingMeta({
        meetingId,
        userId: user.uid,
        title,
        description,
        meetingType,
        attendees,
        venue,
        preferredOutputLanguage,
        expectedLanguages,
        startedAt,
        duration: finalDuration,
        syncedToFirestore: false,
        status: 'recorded_locally',
      });
      await refreshLocalQueueStats();
      onNavigate({ view: 'dashboard' });
      return;
    }

    // Ensure meeting exists in Firestore if session started offline and reconnected mid-meeting
    const meta = await getOfflineMeetingMeta(meetingId);
    if (meta && !meta.syncedToFirestore) {
      await createMeetingRecord({
        id: meetingId,
        userId: user.uid,
        title,
        description,
        meetingType,
        attendees,
        venue,
        preferredOutputLanguage,
        expectedLanguages,
        status: 'processing',
        startedAt: meta.startedAt || startedAt,
      });
    }

    const finalSegments = segmentsRef.current;
    if (finalSegments.length === 0) {
      if (lastChunkErrorRef.current) {
        setMicError(
          `Transcription failed: ${lastChunkErrorRef.current}. Audio was saved locally so you can retry sync from the dashboard.`
        );
        setRecordState('idle');
        return;
      }
      await updateMeetingProgress(meetingId, {
        status: 'completed',
        duration: finalDuration,
        endedAt: new Date().toISOString(),
      });
      await deleteOfflineMeetingMeta(meetingId);
      onNavigate({ view: 'results', meetingId });
      return;
    }

    setStatusMessage('Step 2/3: Extracting executive summary, decisions & action items...');
    try {
      const minutes = await analyzeMeetingTranscriptApi({
        title,
        description,
        meetingType,
        speakers: speakersRef.current,
        transcript: finalSegments.map((s) => ({
          speakerLabel: s.speakerLabel,
          englishTranslation: s.englishTranslation,
          originalText: s.originalText,
          detectedLanguage: s.detectedLanguage,
          startTime: s.startTime,
          endTime: s.endTime,
          uncertain: s.uncertain,
        })),
      });

      setStatusMessage('Step 3/3: Saving structured report...');
      const allLangs = Array.from(new Set(finalSegments.map((s) => s.detectedLanguage)));
      await saveStructuredMinutes({
        userId: user.uid,
        meetingId,
        meetingTitle: title,
        duration: finalDuration,
        endedAt: new Date().toISOString(),
        speakers: speakersRef.current,
        languagesDetected: allLangs,
        segmentCount: finalSegments.length,
        minutes,
        isInitialSave: true,
      });
      void deleteOfflineMeetingMeta(meetingId);
      void refreshLocalQueueStats();
      onNavigate({ view: 'results', meetingId });
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Failed to generate final meeting minutes.');
      setRecordState('idle');
    }
  };

  const startEditSegment = (seg: TranscriptSegment) => {
    setEditingSegId(seg.id);
    setEditOriginal(seg.originalText);
    setEditEnglish(seg.englishTranslation);
    setEditSpeaker(seg.speakerLabel);
  };

  const saveEditSegment = async (seg: TranscriptSegment) => {
    const nextOriginal = editOriginal.trim() || seg.originalText;
    const nextEnglish = editEnglish.trim() || seg.englishTranslation;
    const nextSpeaker = editSpeaker.trim() || seg.speakerLabel;

    const updatedSegs = segmentsRef.current.map((s) =>
      s.id === seg.id
        ? {
            ...s,
            originalText: nextOriginal,
            englishTranslation: nextEnglish,
            speakerLabel: nextSpeaker,
          }
        : s
    );
    segmentsRef.current = updatedSegs;
    setSegments(updatedSegs);
    setEditingSegId(null);

    if (onlineRef.current) {
      try {
        await updateTranscriptSegment(meetingId, seg.id, {
          originalText: nextOriginal,
          englishTranslation: nextEnglish,
          speakerLabel: nextSpeaker,
        });
      } catch (err) {
        console.error('Failed to persist segment edit:', err);
      }
    }
  };

  const handleRenameSpeaker = async (label: string, name: string) => {
    const next = { ...speakersRef.current, [label]: name };
    speakersRef.current = next;
    setSpeakers(next);
    if (onlineRef.current) {
      await updateMeetingSpeakers(meetingId, next).catch(() => undefined);
    }
  };

  const detectedLanguages = useMemo(
    () => Array.from(new Set(segments.map((s) => s.detectedLanguage))),
    [segments]
  );

  const speakerLabels = useMemo(
    () => Array.from(new Set([...Object.keys(speakers), ...segments.map((s) => s.speakerLabel)])),
    [speakers, segments]
  );

  return (
    <div className="space-y-6">
      {/* Live Room Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>{meetingType}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatMeetingDate(startedAt)}</span>
              {venue.trim() && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{venue.trim()}</span>
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                {isOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                      Saved Locally — Waiting for Internet
                    </span>
                  </>
                )}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <HardDrive className="w-3.5 h-3.5" />
                {savedLocalChunks} local · {uploadedChunks} uploaded
              </span>
            </div>
            <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-900 dark:text-white truncate">
              {title}
            </h1>
            {attendees.length > 0 && (
              <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5 pt-0.5">
                <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Attendees:</span>{' '}
                  {attendees.join(', ')}
                </span>
              </p>
            )}
          </div>

          {/* Real Recording Timer & Active State Indicator */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <p className="font-mono text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white tabular-nums">
                {formatDuration(elapsedSec)}
              </p>
              <p
                className={`text-xs font-medium ${
                  recordState === 'recording'
                    ? 'text-red-600 dark:text-red-400'
                    : recordState === 'paused'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {recordState === 'recording'
                  ? 'Recording in progress — Room notified'
                  : recordState === 'paused'
                  ? 'Paused'
                  : recordState === 'finalizing'
                  ? 'Finalizing meeting minutes...'
                  : 'Standby'}
              </p>
            </div>
          </div>
        </div>

        {/* Audio Waveform Visualizer */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0 text-xs font-medium text-slate-600 dark:text-slate-300">
            <Mic
              className={`w-4 h-4 ${
                recordState === 'recording'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-400'
              }`}
            />
            <span className="hidden sm:inline">Mic Input</span>
          </div>
          <canvas ref={canvasRef} width={560} height={42} className="w-full h-10" />
        </div>

        {/* Touch-Friendly Recording Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            {recordState === 'idle' && (
              <button
                type="button"
                onClick={() => void handleStartRecording()}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer min-h-[44px] whitespace-nowrap"
              >
                <Mic className="w-4 h-4" />
                <span>Start Recording</span>
              </button>
            )}

            {recordState === 'recording' && (
              <button
                type="button"
                onClick={handlePauseRecording}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer min-h-[44px] whitespace-nowrap"
              >
                <Pause className="w-4 h-4" />
                <span>Pause</span>
              </button>
            )}

            {recordState === 'paused' && (
              <button
                type="button"
                onClick={handleResumeRecording}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 transition-colors cursor-pointer min-h-[44px] whitespace-nowrap"
              >
                <Play className="w-4 h-4" />
                <span>Resume</span>
              </button>
            )}

            {(recordState === 'recording' || recordState === 'paused') && (
              <button
                type="button"
                onClick={() => void handleStopAndFinish()}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors cursor-pointer min-h-[44px] whitespace-nowrap"
              >
                <Square className="w-4 h-4" />
                <span>{isOnline ? 'Stop & Generate Minutes' : 'Stop & Save Locally'}</span>
              </button>
            )}

            {recordState === 'finalizing' && (
              <div className="inline-flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-blue-700 dark:text-blue-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Finalizing &amp; analyzing transcript...</span>
              </div>
            )}
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            {processingChunkCount > 0 && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}
            <span>{statusMessage}</span>
          </div>
        </div>

        {micError && (
          <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-start gap-2.5 text-xs sm:text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{micError}</span>
          </div>
        )}
      </div>

      {/* Live Transcript + Speaker Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Live Transcript Feed */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                Multilingual Transcript
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {segments.length} segment{segments.length === 1 ? '' : 's'} · Processed in {chunkDurationSec}s chunks
              </p>
            </div>

            {/* 3 Transcript Viewing Modes */}
            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-slate-800 self-start">
              {(
                [
                  { id: 'both', label: 'Original + English' },
                  { id: 'original', label: 'Original' },
                  { id: 'english', label: 'English' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setViewMode(m.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    viewMode === m.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-[540px] overflow-y-auto">
            {segments.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {recordState === 'recording'
                    ? isOnline
                      ? `Listening to the room — first transcript segments appear after ${chunkDurationSec} seconds.`
                      : 'Recording offline — audio is being stored locally in IndexedDB for processing once internet returns.'
                    : 'Transcript segments will appear here as audio chunks are transcribed.'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Original spoken languages and English translations are never fabricated.
                </p>
              </div>
            ) : (
              segments.map((seg) => {
                const isEditing = editingSegId === seg.id;
                return (
                  <div key={seg.id} className="p-4 sm:p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {getSpeakerDisplayName(seg.speakerLabel, speakers)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-blue-700 dark:text-blue-400 font-medium">
                          {seg.detectedLanguage}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatDuration(seg.startTime)}–{formatDuration(seg.endTime)}
                        </span>
                        {seg.uncertain && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                              Uncertain audio
                            </span>
                          </>
                        )}
                      </div>

                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => startEditSegment(seg)}
                          aria-label="Edit transcript segment"
                          className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2.5 pt-1">
                        <input
                          type="text"
                          value={editSpeaker}
                          onChange={(e) => setEditSpeaker(e.target.value)}
                          placeholder="Speaker label (e.g. Speaker 1)"
                          className="w-full sm:w-52 px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                        />
                        <textarea
                          rows={2}
                          value={editOriginal}
                          onChange={(e) => setEditOriginal(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                        />
                        <textarea
                          rows={2}
                          value={editEnglish}
                          onChange={(e) => setEditEnglish(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void saveEditSegment(seg)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" /> Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSegId(null)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {(viewMode === 'original' || viewMode === 'both') && (
                          <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                            {seg.originalText}
                          </p>
                        )}
                        {(viewMode === 'english' ||
                          (viewMode === 'both' &&
                            seg.englishTranslation.trim() !== seg.originalText.trim())) && (
                          <p
                            className={`text-sm leading-relaxed ${
                              viewMode === 'both'
                                ? 'text-slate-600 dark:text-slate-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {viewMode === 'both' ? `English: ${seg.englishTranslation}` : seg.englishTranslation}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Live Speakers & Detected Languages */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                Detected Speakers
              </h3>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {speakerLabels.length}
              </span>
            </div>
            {speakerLabels.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Anonymous labels (Speaker 1, Speaker 2...) appear once speech is transcribed. You can manually assign names below.
              </p>
            ) : (
              <div className="space-y-2.5">
                {speakerLabels.map((lbl) => (
                  <div key={lbl} className="space-y-1">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      {lbl}
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      value={speakers[lbl] || ''}
                      onChange={(e) => void handleRenameSpeaker(lbl, e.target.value)}
                      placeholder="Assign name (optional)"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
              Languages Detected
            </h3>
            {detectedLanguages.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Listening for multilingual utterances...
              </p>
            ) : (
              <p className="text-sm text-slate-700 dark:text-slate-300">
                {detectedLanguages.join(' · ')}
              </p>
            )}
          </div>

          <div className="p-4 rounded-xl bg-slate-100/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
            <Smartphone className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
            <span>
              Keep this tab open while recording. On mobile devices, locking the screen or switching apps may pause audio capture.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
