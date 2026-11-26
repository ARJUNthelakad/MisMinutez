import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import {
  checkServerConnectivity,
  transcribeAudioChunkApi,
  analyzeMeetingTranscriptApi,
} from '../lib/api';
import {
  blobToBase64,
  deleteAudioChunk,
  deleteOfflineMeetingMeta,
  getAllLocalChunks,
  getAllPendingChunks,
  getChunksForMeeting,
  listOfflineMeetings,
  saveOfflineMeetingMeta,
  updateAudioChunkStatus,
} from '../lib/offlineDb';
import {
  createMeetingRecord,
  saveStructuredMinutes,
  saveTranscriptSegments,
  updateMeetingProgress,
} from '../lib/firestore';
import type { OfflineAudioChunk, OfflineMeetingMeta } from '../types';

interface ConnectivityContextValue {
  isOnline: boolean;
  aiConfigured: boolean;
  aiProvider: 'self_hosted' | 'gemini' | 'unconfigured';
  selfHostedConfigured: boolean;
  checking: boolean;
  pendingChunksCount: number;
  localBytesUsed: number;
  offlineMeetings: OfflineMeetingMeta[];
  syncingQueue: boolean;
  syncProgressText: string | null;
  lastSyncError: string | null;
  recheckConnectivity: () => Promise<boolean>;
  refreshLocalQueueStats: () => Promise<void>;
  syncPendingQueue: () => Promise<void>;
}

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [aiConfigured, setAiConfigured] = useState<boolean>(true);
  const [aiProvider, setAiProvider] = useState<'self_hosted' | 'gemini' | 'unconfigured'>('gemini');
  const [selfHostedConfigured, setSelfHostedConfigured] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(false);
  const [pendingChunksCount, setPendingChunksCount] = useState<number>(0);
  const [localBytesUsed, setLocalBytesUsed] = useState<number>(0);
  const [offlineMeetings, setOfflineMeetings] = useState<OfflineMeetingMeta[]>([]);
  const [syncingQueue, setSyncingQueue] = useState<boolean>(false);
  const [syncProgressText, setSyncProgressText] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const syncInFlightRef = useRef(false);

  const refreshLocalQueueStats = useCallback(async () => {
    if (!user) {
      setPendingChunksCount(0);
      setLocalBytesUsed(0);
      setOfflineMeetings([]);
      return;
    }
    try {
      const [allChunks, pending, meetings] = await Promise.all([
        getAllLocalChunks(user.uid),
        getAllPendingChunks(user.uid),
        listOfflineMeetings(user.uid),
      ]);
      setPendingChunksCount(pending.length);
      setLocalBytesUsed(allChunks.reduce((acc, c) => acc + (c.sizeBytes || 0), 0));
      setOfflineMeetings(meetings);
    } catch (err) {
      console.error('Failed to read local IndexedDB stats:', err);
    }
  }, [user]);

  const recheckConnectivity = useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      const status = await checkServerConnectivity();
      setIsOnline(status.online);
      setAiConfigured(status.aiConfigured);
      setAiProvider(status.aiProvider);
      setSelfHostedConfigured(status.selfHostedConfigured);
      return status.online;
    } finally {
      setChecking(false);
    }
  }, []);

  const syncPendingQueue = useCallback(async () => {
    if (!user || syncInFlightRef.current) return;
    const onlineNow = await recheckConnectivity();
    if (!onlineNow) return;

    const pendingChunks = await getAllPendingChunks(user.uid);
    const localMetas = await listOfflineMeetings(user.uid);
    if (pendingChunks.length === 0 && localMetas.every((m) => m.syncedToFirestore)) {
      await refreshLocalQueueStats();
      return;
    }

    syncInFlightRef.current = true;
    setSyncingQueue(true);
    setLastSyncError(null);

    try {
      // Group pending chunks by meetingId
      const byMeeting = new Map<string, OfflineAudioChunk[]>();
      for (const ch of pendingChunks) {
        const list = byMeeting.get(ch.meetingId) || [];
        list.push(ch);
        byMeeting.set(ch.meetingId, list);
      }

      const meetingIds = new Set<string>([
        ...Array.from(byMeeting.keys()),
        ...localMetas.filter((m) => !m.syncedToFirestore).map((m) => m.meetingId),
      ]);

      for (const meetingId of meetingIds) {
        const meta = localMetas.find((m) => m.meetingId === meetingId);
        // Skip meetings currently being actively recorded
        if (meta && meta.status === 'recording') continue;

        if (meta && !meta.syncedToFirestore) {
          setSyncProgressText(`Syncing offline meeting "${meta.title}"...`);
          await createMeetingRecord({
            id: meta.meetingId,
            userId: user.uid,
            title: meta.title,
            description: meta.description,
            meetingType: meta.meetingType,
            attendees: meta.attendees || [],
            venue: meta.venue || '',
            preferredOutputLanguage: meta.preferredOutputLanguage,
            expectedLanguages: meta.expectedLanguages,
            status: 'uploading',
            startedAt: meta.startedAt,
          });
          await saveOfflineMeetingMeta({ ...meta, syncedToFirestore: true, status: 'uploading' });
        }

        const chunks = (byMeeting.get(meetingId) || []).sort((a, b) => a.chunkIndex - b.chunkIndex);
        const allSegmentsForAnalysis: Array<{
          speakerLabel: string;
          originalText: string;
          englishTranslation: string;
          detectedLanguage: string;
          startTime: number;
          endTime: number;
          uncertain: boolean;
        }> = [];
        const knownSpeakers = new Set<string>();
        const languagesDetected = new Set<string>();

        for (let idx = 0; idx < chunks.length; idx++) {
          const chunk = chunks[idx];
          setSyncProgressText(
            `Uploading & transcribing chunk ${idx + 1} of ${chunks.length} (${meta?.title || meetingId})...`
          );
          await updateAudioChunkStatus(chunk.chunkId, 'uploading');

          try {
            const base64Audio = await blobToBase64(chunk.blob);

            // Single-pass idempotent upload + multilingual transcription
            const transcription = await transcribeAudioChunkApi({
              chunkId: chunk.chunkId,
              base64Audio,
              mimeType: chunk.mimeType,
              startOffsetSec: chunk.startOffsetSec,
              durationSec: chunk.durationSec,
              expectedLanguages: meta?.expectedLanguages || [],
              knownSpeakers: Array.from(knownSpeakers),
            });
            await updateAudioChunkStatus(chunk.chunkId, 'uploaded');

            if (transcription.segments.length > 0) {
              const formatted = transcription.segments.map((s) => {
                knownSpeakers.add(s.speaker_label);
                languagesDetected.add(s.detected_language);
                return {
                  speakerLabel: s.speaker_label,
                  originalText: s.original_text,
                  englishTranslation: s.english_translation,
                  detectedLanguage: s.detected_language,
                  startTime: s.start_time,
                  endTime: s.end_time,
                  uncertain: s.uncertain,
                };
              });
              allSegmentsForAnalysis.push(...formatted);
              await saveTranscriptSegments(user.uid, meetingId, chunk.chunkIndex, formatted);
            }

            await updateAudioChunkStatus(chunk.chunkId, 'processed');

            if (profile?.autoDeleteAudio ?? true) {
              await deleteAudioChunk(chunk.chunkId);
            }
          } catch (chunkErr) {
            const msg = chunkErr instanceof Error ? chunkErr.message : 'Chunk sync failed';
            await updateAudioChunkStatus(chunk.chunkId, 'failed', {
              retryCount: chunk.retryCount + 1,
              lastError: msg,
            });
            setLastSyncError(msg);
          }
        }

        // Check if all chunks for this meeting are now processed
        const remainingForMeeting = (await getChunksForMeeting(meetingId)).filter(
          (c) => c.uploadStatus !== 'processed'
        );

        if (remainingForMeeting.length === 0 && meta) {
          if (allSegmentsForAnalysis.length > 0) {
            setSyncProgressText(`Generating structured AI minutes for "${meta.title}"...`);
            await updateMeetingProgress(meetingId, { status: 'processing', duration: meta.duration });
            const speakersMap: Record<string, string> = {};
            knownSpeakers.forEach((s) => {
              speakersMap[s] = '';
            });
            const minutes = await analyzeMeetingTranscriptApi({
              title: meta.title,
              description: meta.description,
              meetingType: meta.meetingType,
              speakers: speakersMap,
              transcript: allSegmentsForAnalysis,
            });
            await saveStructuredMinutes({
              userId: user.uid,
              meetingId,
              meetingTitle: meta.title,
              duration: meta.duration,
              endedAt: new Date().toISOString(),
              speakers: speakersMap,
              languagesDetected: Array.from(languagesDetected),
              segmentCount: allSegmentsForAnalysis.length,
              minutes,
              isInitialSave: true,
            });
          } else {
            await updateMeetingProgress(meetingId, {
              status: 'completed',
              duration: meta.duration,
              endedAt: new Date().toISOString(),
            });
          }
          await deleteOfflineMeetingMeta(meetingId);
        }
      }
    } catch (err) {
      setLastSyncError(err instanceof Error ? err.message : 'Queue sync encountered an error.');
    } finally {
      syncInFlightRef.current = false;
      setSyncingQueue(false);
      setSyncProgressText(null);
      await refreshLocalQueueStats();
    }
  }, [user, profile, recheckConnectivity, refreshLocalQueueStats]);

  // Listen to browser network events as hints and verify against real /api/health
  useEffect(() => {
    void recheckConnectivity();

    const onBrowserOnline = () => {
      void recheckConnectivity().then((ok) => {
        if (ok) void syncPendingQueue();
      });
    };
    const onBrowserOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
    const interval = setInterval(() => {
      void recheckConnectivity();
    }, 30000);

    return () => {
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
      clearInterval(interval);
    };
  }, [recheckConnectivity, syncPendingQueue]);

  useEffect(() => {
    void refreshLocalQueueStats();
  }, [refreshLocalQueueStats]);

  return (
    <ConnectivityContext.Provider
      value={{
        isOnline,
        aiConfigured,
        aiProvider,
        selfHostedConfigured,
        checking,
        pendingChunksCount,
        localBytesUsed,
        offlineMeetings,
        syncingQueue,
        syncProgressText,
        lastSyncError,
        recheckConnectivity,
        refreshLocalQueueStats,
        syncPendingQueue,
      }}
    >
      {children}
    </ConnectivityContext.Provider>
  );
}

export function useConnectivity(): ConnectivityContextValue {
  const ctx = useContext(ConnectivityContext);
  if (!ctx) throw new Error('useConnectivity must be used inside ConnectivityProvider');
  return ctx;
}
