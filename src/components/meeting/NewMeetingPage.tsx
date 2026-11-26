import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  Upload,
  Volume2,
  ShieldAlert,
  Loader2,
  Users,
  Plus,
  X,
  Calendar,
  Clock,
  MapPin,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConnectivity } from '../../context/ConnectivityContext';
import {
  MEETING_TYPES,
  PRIORITY_LANGUAGES,
  REPORT_TRANSLATION_LANGUAGES,
  type AppRoute,
  type MeetingType,
} from '../../types';
import {
  createMeetingRecord,
  generateSafeId,
  saveStructuredMinutes,
  saveTranscriptSegments,
  updateMeetingProgress,
} from '../../lib/firestore';
import { blobToBase64, saveOfflineMeetingMeta } from '../../lib/offlineDb';
import { analyzeMeetingTranscriptApi, transcribeAudioChunkApi } from '../../lib/api';

const CUSTOM_TYPE_VALUE = '__custom__';

function getLocalDateInputValue(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLocalTimeInputValue(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

function combineDateAndTimeToIso(dateStr: string, timeStr: string): string {
  if (dateStr) {
    const combined = new Date(`${dateStr}T${timeStr || '00:00'}`);
    if (!Number.isNaN(combined.getTime())) {
      return combined.toISOString();
    }
  }
  return new Date().toISOString();
}

interface NewMeetingPageProps {
  onStartLiveRoom: (meetingId: string, config: {
    selectedDeviceId: string;
    expectedLanguages: string[];
    title: string;
    description: string;
    meetingType: MeetingType;
    attendees: string[];
    venue: string;
    startedAt: string;
    preferredOutputLanguage: string;
  }) => void;
  onNavigate: (route: AppRoute) => void;
}

export function NewMeetingPage({ onStartLiveRoom, onNavigate }: NewMeetingPageProps) {
  const { user, profile } = useAuth();
  const { isOnline, recheckConnectivity } = useConnectivity();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [meetingDate, setMeetingDate] = useState(() => getLocalDateInputValue(new Date()));
  const [meetingTime, setMeetingTime] = useState(() => getLocalTimeInputValue(new Date()));
  const [venue, setVenue] = useState('');
  const [selectedTypeOption, setSelectedTypeOption] = useState<string>('College project');
  const [customMeetingType, setCustomMeetingType] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [preferredOutputLanguage, setPreferredOutputLanguage] = useState(
    profile?.defaultReportLanguage || 'English'
  );
  const [autoDetect, setAutoDetect] = useState(true);
  const [expectedLanguages, setExpectedLanguages] = useState<string[]>(
    profile?.preferredLanguages || ['English', 'Malayalam', 'Hindi', 'Tamil']
  );
  const [consentChecked, setConsentChecked] = useState(false);

  // Microphone test state
  const [micPermission, setMicPermission] = useState<'idle' | 'granted' | 'denied' | 'unsupported'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [testingMic, setTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Start / upload state
  const [starting, setStarting] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const testStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopMicTest = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((t) => t.stop());
      testStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setTestingMic(false);
    setMicLevel(0);
  };

  useEffect(() => {
    void recheckConnectivity();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
    } else if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (status.state === 'granted') setMicPermission('granted');
          else if (status.state === 'denied') setMicPermission('denied');
        })
        .catch(() => {
          // Safari/Firefox may not support querying microphone permission
        });
    }
    return () => stopMicTest();
  }, [recheckConnectivity]);

  const handleTestMicrophone = async () => {
    if (testingMic) {
      stopMicTest();
      return;
    }

    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
      setMicError('This browser does not support microphone capture. Try Chrome, Edge, or Safari over HTTPS.');
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;
      setMicPermission('granted');
      setTestingMic(true);

      const enumerated = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = enumerated.filter((d) => d.kind === 'audioinput');
      setDevices(audioInputs);
      if (!selectedDeviceId && audioInputs.length > 0) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const norm = (dataArray[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        setMicLevel(Math.min(100, Math.round(rms * 320)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      setMicPermission('denied');
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Click the lock/microphone icon in your browser address bar, allow microphone access, and retry.'
          : err instanceof Error
          ? err.message
          : 'Could not access microphone.';
      setMicError(msg);
    }
  };

  const toggleExpectedLanguage = (lang: string) => {
    setExpectedLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  };

  const addAttendeesFromString = (raw: string, existing: string[] = attendees): string[] => {
    const incoming = raw
      .split(/[\n,;]+/)
      .map((name) => name.trim().slice(0, 80))
      .filter(Boolean);
    if (incoming.length === 0) return existing;
    const seen = new Set(existing.map((n) => n.toLowerCase()));
    const merged = [...existing];
    for (const name of incoming) {
      if (merged.length >= 50) break;
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        merged.push(name);
      }
    }
    return merged;
  };

  const handleAddAttendee = () => {
    if (!attendeeInput.trim()) return;
    setAttendees((prev) => addAttendeesFromString(attendeeInput, prev));
    setAttendeeInput('');
  };

  const handleRemoveAttendee = (nameToRemove: string) => {
    setAttendees((prev) => prev.filter((n) => n !== nameToRemove));
  };

  const resolveMeetingType = (): string => {
    if (selectedTypeOption === CUSTOM_TYPE_VALUE) {
      return customMeetingType.trim().slice(0, 60);
    }
    return selectedTypeOption;
  };

  const handleStartLiveMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!user) {
      setFormError('Please sign in before starting a meeting.');
      return;
    }

    const resolvedType = resolveMeetingType();
    if (!resolvedType) {
      setFormError('Please enter your custom meeting type or choose one from the list.');
      return;
    }

    if (!meetingDate || !meetingTime) {
      setFormError('Please provide both the meeting date and time.');
      return;
    }

    const finalAttendees = addAttendeesFromString(attendeeInput, attendees);
    if (attendeeInput.trim()) {
      setAttendees(finalAttendees);
      setAttendeeInput('');
    }

    const startedAt = combineDateAndTimeToIso(meetingDate, meetingTime);
    const cleanTitle = title.trim() || `${resolvedType} — ${new Date(startedAt).toLocaleDateString()}`;
    if (!consentChecked) {
      setFormError('Please confirm that participants in the room know audio recording will begin.');
      return;
    }

    stopMicTest();
    setStarting(true);
    const meetingId = generateSafeId('mtg');
    const langs = autoDetect ? expectedLanguages : expectedLanguages;

    try {
      if (isOnline) {
        await createMeetingRecord({
          id: meetingId,
          userId: user.uid,
          title: cleanTitle,
          description: description.trim(),
          meetingType: resolvedType,
          attendees: finalAttendees,
          venue: venue.trim(),
          preferredOutputLanguage,
          expectedLanguages: langs,
          status: 'recording',
          startedAt,
        });
        await saveOfflineMeetingMeta({
          meetingId,
          userId: user.uid,
          title: cleanTitle,
          description: description.trim(),
          meetingType: resolvedType,
          attendees: finalAttendees,
          venue: venue.trim(),
          preferredOutputLanguage,
          expectedLanguages: langs,
          startedAt,
          duration: 0,
          syncedToFirestore: true,
          status: 'recording',
        });
      } else {
        // Offline-first creation strictly in IndexedDB
        await saveOfflineMeetingMeta({
          meetingId,
          userId: user.uid,
          title: cleanTitle,
          description: description.trim(),
          meetingType: resolvedType,
          attendees: finalAttendees,
          venue: venue.trim(),
          preferredOutputLanguage,
          expectedLanguages: langs,
          startedAt,
          duration: 0,
          syncedToFirestore: false,
          status: 'recording',
        });
      }

      onStartLiveRoom(meetingId, {
        selectedDeviceId,
        expectedLanguages: langs,
        title: cleanTitle,
        description: description.trim(),
        meetingType: resolvedType,
        attendees: finalAttendees,
        venue: venue.trim(),
        startedAt,
        preferredOutputLanguage,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to initialize meeting.');
      setStarting(false);
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setFormError(null);

    if (!isOnline) {
      setFormError('Uploading a pre-recorded audio file for AI processing requires an internet connection.');
      return;
    }
    if (file.size > 14 * 1024 * 1024) {
      setFormError('Please upload an audio file under 14 MB (MP3, WAV, WebM, OGG, or M4A).');
      return;
    }

    const resolvedType = resolveMeetingType() || 'General meeting';
    const finalAttendees = addAttendeesFromString(attendeeInput, attendees);
    if (attendeeInput.trim()) {
      setAttendees(finalAttendees);
      setAttendeeInput('');
    }

    setUploadingAudio(true);
    setUploadStatusText('Creating meeting record...');
    const meetingId = generateSafeId('mtg');
    const cleanTitle = title.trim() || file.name.replace(/\.[^.]+$/, '') || 'Uploaded Meeting Recording';
    const startedAt = combineDateAndTimeToIso(meetingDate, meetingTime);

    try {
      await createMeetingRecord({
        id: meetingId,
        userId: user.uid,
        title: cleanTitle,
        description: description.trim() || `Processed from uploaded audio file (${file.name})`,
        meetingType: resolvedType,
        attendees: finalAttendees,
        venue: venue.trim(),
        preferredOutputLanguage,
        expectedLanguages,
        status: 'processing',
        startedAt,
      });

      setUploadStatusText('Transcribing multilingual audio, detecting languages & diarizing speakers...');
      const base64Audio = await blobToBase64(file);
      const mimeType = file.type || 'audio/mp3';

      // Estimate duration cleanly via Audio element if available
      let durationSec = 60;
      try {
        const url = URL.createObjectURL(file);
        durationSec = await new Promise<number>((resolve) => {
          const audio = new Audio(url);
          audio.onloadedmetadata = () => {
            URL.revokeObjectURL(url);
            resolve(Number.isFinite(audio.duration) ? Math.max(1, Math.round(audio.duration)) : 60);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(60);
          };
        });
      } catch {
        durationSec = 60;
      }

      const transcription = await transcribeAudioChunkApi({
        base64Audio,
        mimeType,
        startOffsetSec: 0,
        durationSec,
        expectedLanguages,
        knownSpeakers: [],
      });

      const formattedSegments = transcription.segments.map((s) => ({
        speakerLabel: s.speaker_label,
        originalText: s.original_text,
        englishTranslation: s.english_translation,
        detectedLanguage: s.detected_language,
        startTime: s.start_time,
        endTime: s.end_time,
        uncertain: s.uncertain,
      }));

      if (formattedSegments.length === 0) {
        await updateMeetingProgress(meetingId, {
          status: 'completed',
          duration: durationSec,
          endedAt: new Date().toISOString(),
        });
        setFormError('No audible speech was detected in that audio file.');
        setUploadingAudio(false);
        setUploadStatusText(null);
        return;
      }

      await saveTranscriptSegments(user.uid, meetingId, 0, formattedSegments);

      const speakersMap: Record<string, string> = {};
      const langs = new Set<string>();
      formattedSegments.forEach((s) => {
        speakersMap[s.speakerLabel] = '';
        langs.add(s.detectedLanguage);
      });

      setUploadStatusText('Generating structured meeting minutes, decisions & action items...');
      const minutes = await analyzeMeetingTranscriptApi({
        title: cleanTitle,
        description: description.trim(),
        meetingType: resolvedType,
        speakers: speakersMap,
        transcript: formattedSegments,
      });

      await saveStructuredMinutes({
        userId: user.uid,
        meetingId,
        meetingTitle: cleanTitle,
        duration: durationSec,
        endedAt: new Date().toISOString(),
        speakers: speakersMap,
        languagesDetected: Array.from(langs),
        segmentCount: formattedSegments.length,
        minutes,
        isInitialSave: true,
      });

      onNavigate({ view: 'results', meetingId });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Audio upload processing failed.');
      await updateMeetingProgress(meetingId, { status: 'error' }).catch(() => undefined);
    } finally {
      setUploadingAudio(false);
      setUploadStatusText(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-8">
      <div className="pb-6 border-b border-slate-200 dark:border-slate-800">
        <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white">
          New Physical Meeting
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Configure room languages, verify your built-in microphone, and start capturing.
        </p>
      </div>

      {formError && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-start gap-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Meeting Configuration Form */}
        <form onSubmit={handleStartLiveMeeting} className="lg:col-span-7 space-y-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="meeting-title" className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-1.5">
                Meeting Title
              </label>
              <input
                id="meeting-title"
                type="text"
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Final Year Project Sprint Review"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="meeting-desc" className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-1.5">
                Agenda / Context <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="meeting-desc"
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Briefly note the meeting goal or key topics so minutes stay well-framed."
                className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
              />
            </div>

            {/* Meeting Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="meeting-date" className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    Meeting Date
                  </span>
                </label>
                <input
                  id="meeting-date"
                  type="date"
                  required
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label htmlFor="meeting-time" className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    Meeting Time
                  </span>
                </label>
                <input
                  id="meeting-time"
                  type="time"
                  required
                  value={meetingTime}
                  onChange={(e) => setMeetingTime(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            {/* Venue / Location */}
            <div>
              <label htmlFor="meeting-venue" className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  Venue / Location <span className="text-slate-400 font-normal">(optional)</span>
                </span>
              </label>
              <input
                id="meeting-venue"
                type="text"
                maxLength={160}
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g., Conference Room B, Seminar Hall 2, Main Office"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="meeting-type" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                  Meeting Type
                </label>
                <select
                  id="meeting-type"
                  value={selectedTypeOption}
                  onChange={(e) => setSelectedTypeOption(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {MEETING_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  <option value={CUSTOM_TYPE_VALUE}>+ Custom (Enter manually)</option>
                </select>
                {selectedTypeOption === CUSTOM_TYPE_VALUE && (
                  <input
                    id="custom-meeting-type"
                    type="text"
                    maxLength={60}
                    value={customMeetingType}
                    onChange={(e) => setCustomMeetingType(e.target.value)}
                    placeholder="e.g., Board Review, Sprint Retro, Faculty Meet"
                    className="w-full px-3.5 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-blue-400 dark:border-blue-600 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                )}
              </div>

              <div>
                <label htmlFor="output-lang" className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-1.5">
                  Preferred Output Language
                </label>
                <select
                  id="output-lang"
                  value={preferredOutputLanguage}
                  onChange={(e) => setPreferredOutputLanguage(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {REPORT_TRANSLATION_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Attendees List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label htmlFor="meeting-attendees" className="text-sm font-medium text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-500" />
                  <span>Attendees List</span>
                </label>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {attendees.length} added
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="meeting-attendees"
                  type="text"
                  maxLength={240}
                  value={attendeeInput}
                  onChange={(e) => setAttendeeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddAttendee();
                    }
                  }}
                  placeholder="Enter attendee name(s), e.g., Arjun, Priya, Rahul"
                  className="flex-1 px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={handleAddAttendee}
                  disabled={!attendeeInput.trim() || attendees.length >= 50}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add</span>
                </button>
              </div>
              {attendees.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {attendees.map((person) => (
                    <span
                      key={person}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                    >
                      <span>{person}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttendee(person)}
                        aria-label={`Remove ${person}`}
                        className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Press Enter or click Add. You can also paste comma-separated names. Attendees will appear in your live room, report, and exported PDF.
              </p>
            </div>

            {/* Automatic Language Detection & Expected Languages */}
            <div className="pt-2 space-y-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Automatic Per-Segment Language Detection
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Detects language switches and code-switching automatically for each utterance.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoDetect}
                  onClick={() => setAutoDetect((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer ${
                    autoDetect ? 'bg-blue-700' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                      autoDetect ? 'translate-x-5.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Expected Languages in Room (optional hints)
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRIORITY_LANGUAGES.map((lang) => {
                    const selected = expectedLanguages.includes(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => toggleExpectedLanguage(lang)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                          selected
                            ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-600 dark:border-blue-500 text-blue-700 dark:text-blue-300'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Participant Consent Notice */}
            <label className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                I confirm all participants in this physical meeting room have been notified that audio will be recorded for transcription and AI meeting minutes.
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={starting || uploadingAudio}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
              <span>{starting ? 'Opening Live Room...' : 'Start Live Meeting'}</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleAudioFileUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={starting || uploadingAudio || !isOnline}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              {uploadingAudio ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span>{uploadingAudio ? 'Processing Audio...' : 'Upload Pre-Recorded Audio'}</span>
            </button>
          </div>

          {uploadStatusText && (
            <div className="p-3.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-center gap-2.5 text-xs sm:text-sm text-blue-800 dark:text-blue-200">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{uploadStatusText}</span>
            </div>
          )}
        </form>

        {/* Pre-Flight Hardware & Connectivity Diagnostics */}
        <div className="lg:col-span-5 space-y-5">
          {/* Microphone Test Panel */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                Microphone Check
              </h2>
              <span
                className={`text-xs font-medium flex items-center gap-1.5 ${
                  micPermission === 'granted'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : micPermission === 'denied' || micPermission === 'unsupported'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {micPermission === 'granted' ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                  </>
                ) : micPermission === 'denied' ? (
                  <>
                    <MicOff className="w-3.5 h-3.5" /> Denied
                  </>
                ) : micPermission === 'unsupported' ? (
                  'Unsupported'
                ) : (
                  'Permission needed'
                )}
              </span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              MisMinutez uses your device&apos;s built-in microphone by default. Place the laptop or phone near the center of the table and run a quick level test.
            </p>

            {devices.length > 1 && (
              <div>
                <label htmlFor="mic-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Input Microphone
                </label>
                <select
                  id="mic-select"
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                >
                  {devices.map((d, idx) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Live Audio Level Meter */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" /> Input Level
                </span>
                <span className="font-mono tabular-nums">{testingMic ? `${micLevel}%` : 'Idle'}</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-75 ${
                    micLevel > 75
                      ? 'bg-emerald-600'
                      : micLevel > 15
                      ? 'bg-blue-600'
                      : 'bg-slate-400'
                  }`}
                  style={{ width: `${Math.max(testingMic ? 4 : 0, micLevel)}%` }}
                />
              </div>
            </div>

            {micError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 leading-relaxed">
                {micError}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleTestMicrophone()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {testingMic ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>{testingMic ? 'Stop Microphone Test' : 'Test Built-in Microphone'}</span>
            </button>
          </div>

          {/* Connectivity & Mobile Limitation Notice */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                Connection &amp; Offline Mode
              </h2>
              <span
                className={`text-xs font-medium flex items-center gap-1.5 ${
                  isOnline
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {isOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5" /> Online
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5" /> Offline
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {isOnline
                ? 'Server connection verified. Audio chunks will back up locally in IndexedDB and transcribe automatically during the meeting.'
                : 'No internet detected. You can still start recording now — chunks will save locally as "Saved Locally — Waiting for Internet" and process automatically once reconnected.'}
            </p>
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-500 dark:text-slate-400">
              <ShieldAlert className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <span>
                Keep this browser tab active on mobile phones and tablets — mobile operating systems may pause microphone recording if the screen locks or the browser moves to the background.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
