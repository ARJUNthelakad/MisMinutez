import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  ActionItem,
  ActionPriority,
  ActionStatus,
  ChatMessage,
  Decision,
  DecisionType,
  Meeting,
  MeetingStatus,
  MeetingType,
  StructuredMinutesOutput,
  TranscriptSegment,
  UserProfile,
} from '../types';

function clampStr(val: string | null | undefined, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

function clampList(arr: string[] | undefined, maxItems: number, maxItemLen = 600): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => String(s ?? '').trim().slice(0, maxItemLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function generateSafeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export async function getOrCreateUserProfile(params: {
  uid: string;
  name: string;
  email: string;
}): Promise<UserProfile> {
  const path = `users/${params.uid}`;
  const ref = doc(db, 'users', params.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }

    const profile: UserProfile = {
      uid: params.uid,
      name: clampStr(params.name || 'MisMinutez User', 120),
      email: clampStr(params.email, 254),
      defaultReportLanguage: 'English',
      preferredLanguages: ['English', 'Malayalam', 'Hindi', 'Tamil'],
      theme: 'light',
      autoDeleteAudio: true,
      chunkDurationSec: 30,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      'name' | 'defaultReportLanguage' | 'preferredLanguages' | 'theme' | 'autoDeleteAudio' | 'chunkDurationSec'
    >
  >
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.name !== undefined) payload.name = clampStr(updates.name, 120);
    if (updates.defaultReportLanguage !== undefined)
      payload.defaultReportLanguage = clampStr(updates.defaultReportLanguage, 40) || 'English';
    if (updates.preferredLanguages !== undefined)
      payload.preferredLanguages = clampList(updates.preferredLanguages, 10, 40);
    if (updates.theme !== undefined) payload.theme = updates.theme === 'dark' ? 'dark' : 'light';
    if (updates.autoDeleteAudio !== undefined) payload.autoDeleteAudio = Boolean(updates.autoDeleteAudio);
    if (updates.chunkDurationSec !== undefined)
      payload.chunkDurationSec = Math.min(60, Math.max(10, Number(updates.chunkDurationSec) || 20));

    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createMeetingRecord(params: {
  id?: string;
  userId: string;
  title: string;
  description: string;
  meetingType: MeetingType;
  attendees?: string[];
  venue?: string;
  preferredOutputLanguage: string;
  expectedLanguages: string[];
  status?: MeetingStatus;
  startedAt?: string;
}): Promise<Meeting> {
  const id = params.id || generateSafeId('mtg');
  const path = `meetings/${id}`;
  const startedAt = params.startedAt || new Date().toISOString();
  const record: Omit<Meeting, 'id'> = {
    userId: params.userId,
    title: clampStr(params.title, 200) || 'Untitled Meeting',
    description: clampStr(params.description, 1000),
    meetingType: clampStr(params.meetingType, 60) || 'General meeting',
    attendees: clampList(params.attendees, 50, 80),
    venue: clampStr(params.venue, 160),
    preferredOutputLanguage: clampStr(params.preferredOutputLanguage, 40) || 'English',
    expectedLanguages: clampList(params.expectedLanguages, 10, 40),
    startedAt: clampStr(startedAt, 40),
    endedAt: '',
    duration: 0,
    status: params.status || 'recording',
    executiveSummary: '',
    objectives: [],
    discussionPoints: [],
    unresolvedQuestions: [],
    risks: [],
    followUpSuggestions: [],
    meetingConclusion: '',
    speakers: {},
    languagesDetected: [],
    segmentCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'meetings', id), record);
    return { id, ...record };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMeetingProgress(
  meetingId: string,
  updates: {
    status?: MeetingStatus;
    duration?: number;
    endedAt?: string;
    speakers?: Record<string, string>;
    languagesDetected?: string[];
    segmentCount?: number;
  }
): Promise<void> {
  const path = `meetings/${meetingId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.duration !== undefined) payload.duration = Math.max(0, Math.min(86400, Math.round(updates.duration)));
    if (updates.endedAt !== undefined) payload.endedAt = clampStr(updates.endedAt, 40);
    if (updates.speakers !== undefined) {
      const cleanSpeakers: Record<string, string> = {};
      Object.entries(updates.speakers)
        .slice(0, 25)
        .forEach(([k, v]) => {
          cleanSpeakers[clampStr(k, 60)] = clampStr(v, 100);
        });
      payload.speakers = cleanSpeakers;
    }
    if (updates.languagesDetected !== undefined) {
      payload.languagesDetected = clampList(updates.languagesDetected, 20, 60);
    }
    if (updates.segmentCount !== undefined) {
      payload.segmentCount = Math.max(0, Math.min(5000, updates.segmentCount));
    }

    await updateDoc(doc(db, 'meetings', meetingId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateMeetingSpeakers(
  meetingId: string,
  speakers: Record<string, string>
): Promise<void> {
  const path = `meetings/${meetingId}`;
  try {
    const cleanSpeakers: Record<string, string> = {};
    Object.entries(speakers)
      .slice(0, 25)
      .forEach(([k, v]) => {
        cleanSpeakers[clampStr(k, 60)] = clampStr(v, 100);
      });
    await updateDoc(doc(db, 'meetings', meetingId), {
      speakers: cleanSpeakers,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateMeetingAttendees(
  meetingId: string,
  attendees: string[]
): Promise<void> {
  const path = `meetings/${meetingId}`;
  try {
    const clamped = clampList(attendees, 50, 80);
    const seen = new Set<string>();
    const cleanAttendees: string[] = [];
    for (const name of clamped) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        cleanAttendees.push(name);
      }
    }
    await updateDoc(doc(db, 'meetings', meetingId), {
      attendees: cleanAttendees,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveTranscriptSegments(
  userId: string,
  meetingId: string,
  chunkIndex: number,
  segments: Array<{
    speakerLabel: string;
    originalText: string;
    englishTranslation: string;
    detectedLanguage: string;
    startTime: number;
    endTime: number;
    uncertain: boolean;
  }>
): Promise<TranscriptSegment[]> {
  if (segments.length === 0) return [];
  const basePath = `meetings/${meetingId}/segments`;
  try {
    const batch = writeBatch(db);
    const saved: TranscriptSegment[] = [];

    for (const seg of segments) {
      const segId = generateSafeId('seg');
      const docRef = doc(db, 'meetings', meetingId, 'segments', segId);
      const data = {
        userId,
        meetingId,
        speakerLabel: clampStr(seg.speakerLabel || 'Speaker 1', 60) || 'Speaker 1',
        originalText: clampStr(seg.originalText, 6000) || '[Inaudible]',
        englishTranslation: clampStr(seg.englishTranslation || seg.originalText, 6000),
        detectedLanguage: clampStr(seg.detectedLanguage || 'Unknown', 60) || 'Unknown',
        startTime: Math.max(0, Math.min(86400, Number(seg.startTime) || 0)),
        endTime: Math.max(0, Math.min(86400, Number(seg.endTime) || 0)),
        uncertain: Boolean(seg.uncertain),
        chunkIndex: Math.max(0, Math.min(10000, chunkIndex)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      batch.set(docRef, data);
      saved.push({ id: segId, ...data });
    }

    await batch.commit();
    return saved;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, basePath);
  }
}

export async function updateTranscriptSegment(
  meetingId: string,
  segmentId: string,
  updates: Partial<Pick<TranscriptSegment, 'speakerLabel' | 'originalText' | 'englishTranslation' | 'detectedLanguage' | 'uncertain'>>
): Promise<void> {
  const path = `meetings/${meetingId}/segments/${segmentId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.speakerLabel !== undefined) payload.speakerLabel = clampStr(updates.speakerLabel, 60) || 'Speaker 1';
    if (updates.originalText !== undefined) payload.originalText = clampStr(updates.originalText, 6000) || '[Edited]';
    if (updates.englishTranslation !== undefined)
      payload.englishTranslation = clampStr(updates.englishTranslation, 6000);
    if (updates.detectedLanguage !== undefined)
      payload.detectedLanguage = clampStr(updates.detectedLanguage, 60) || 'Unknown';
    if (updates.uncertain !== undefined) payload.uncertain = Boolean(updates.uncertain);

    await updateDoc(doc(db, 'meetings', meetingId, 'segments', segmentId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveStructuredMinutes(params: {
  userId: string;
  meetingId: string;
  meetingTitle: string;
  duration: number;
  endedAt: string;
  speakers: Record<string, string>;
  languagesDetected: string[];
  segmentCount: number;
  minutes: StructuredMinutesOutput;
  isInitialSave?: boolean;
}): Promise<void> {
  const { userId, meetingId, minutes, isInitialSave } = params;
  const meetingPath = `meetings/${meetingId}`;

  try {
    // Only query & clear old decisions/actions when re-analyzing an existing meeting
    if (!isInitialSave) {
      const [oldDecisions, oldActions] = await Promise.all([
        getDocs(query(collection(db, 'meetings', meetingId, 'decisions'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'actionItems'), where('userId', '==', userId), where('meetingId', '==', meetingId))),
      ]);

      if (!oldDecisions.empty || !oldActions.empty) {
        const cleanupBatch = writeBatch(db);
        oldDecisions.forEach((d) => cleanupBatch.delete(d.ref));
        oldActions.forEach((a) => cleanupBatch.delete(a.ref));
        await cleanupBatch.commit();
      }
    }

    const cleanSpeakers: Record<string, string> = {};
    Object.entries(params.speakers)
      .slice(0, 25)
      .forEach(([k, v]) => {
        cleanSpeakers[clampStr(k, 60)] = clampStr(v, 100);
      });

    const batch = writeBatch(db);

    batch.update(doc(db, 'meetings', meetingId), {
      title: clampStr(params.meetingTitle || minutes.meeting_title, 200) || 'Untitled Meeting',
      status: 'completed',
      endedAt: clampStr(params.endedAt || new Date().toISOString(), 40),
      duration: Math.max(0, Math.min(86400, Math.round(params.duration))),
      executiveSummary: clampStr(minutes.executive_summary, 8000),
      objectives: clampList(minutes.objectives, 25, 500),
      discussionPoints: clampList(minutes.discussion_points, 50, 800),
      unresolvedQuestions: clampList(minutes.unresolved_questions, 40, 500),
      risks: clampList(minutes.risks, 40, 500),
      followUpSuggestions: clampList(minutes.follow_up_suggestions, 40, 500),
      meetingConclusion: clampStr(minutes.meeting_conclusion, 4000),
      speakers: cleanSpeakers,
      languagesDetected: clampList(params.languagesDetected, 20, 60),
      segmentCount: Math.max(0, Math.min(5000, params.segmentCount)),
      updatedAt: serverTimestamp(),
    });

    for (const d of minutes.decisions.slice(0, 50)) {
      if (!d.decision?.trim()) continue;
      const decId = generateSafeId('dec');
      batch.set(doc(db, 'meetings', meetingId, 'decisions', decId), {
        userId,
        meetingId,
        decisionText: clampStr(d.decision, 2000),
        decisionType: (['final', 'proposed', 'pending', 'rejected'].includes(d.type)
          ? d.type
          : 'proposed') as DecisionType,
        speaker: clampStr(d.speaker ?? '', 80),
        timestamp: clampStr(d.timestamp ?? '', 40),
        transcriptReference: clampStr(d.transcript_reference ?? '', 1000),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const a of minutes.action_items.slice(0, 60)) {
      if (!a.task?.trim()) continue;
      const actId = generateSafeId('act');
      batch.set(doc(db, 'actionItems', actId), {
        userId,
        meetingId,
        meetingTitle: clampStr(params.meetingTitle || minutes.meeting_title, 200),
        task: clampStr(a.task, 1000),
        assignedTo: clampStr(a.assigned_to ?? '', 120),
        deadline: clampStr(a.deadline ?? '', 80),
        priority: (['low', 'medium', 'high'].includes(a.priority) ? a.priority : 'medium') as ActionPriority,
        status: (a.status === 'completed' ? 'completed' : 'pending') as ActionStatus,
        transcriptReference: clampStr(a.transcript_reference ?? '', 1000),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, meetingPath);
  }
}

export async function updateDecisionType(
  meetingId: string,
  decisionId: string,
  decisionType: DecisionType
): Promise<void> {
  const path = `meetings/${meetingId}/decisions/${decisionId}`;
  try {
    await updateDoc(doc(db, 'meetings', meetingId, 'decisions', decisionId), {
      decisionType,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createActionItem(params: {
  userId: string;
  meetingId: string;
  meetingTitle: string;
  task: string;
  assignedTo: string;
  deadline: string;
  priority: ActionPriority;
}): Promise<void> {
  const id = generateSafeId('act');
  const path = `actionItems/${id}`;
  try {
    await setDoc(doc(db, 'actionItems', id), {
      userId: params.userId,
      meetingId: params.meetingId,
      meetingTitle: clampStr(params.meetingTitle, 200),
      task: clampStr(params.task, 1000),
      assignedTo: clampStr(params.assignedTo, 120),
      deadline: clampStr(params.deadline, 80),
      priority: params.priority,
      status: 'pending',
      transcriptReference: 'Manually added',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateActionItem(
  itemId: string,
  updates: Partial<Pick<ActionItem, 'task' | 'assignedTo' | 'deadline' | 'priority' | 'status'>>
): Promise<void> {
  const path = `actionItems/${itemId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.task !== undefined) payload.task = clampStr(updates.task, 1000) || 'Untitled Task';
    if (updates.assignedTo !== undefined) payload.assignedTo = clampStr(updates.assignedTo, 120);
    if (updates.deadline !== undefined) payload.deadline = clampStr(updates.deadline, 80);
    if (updates.priority !== undefined) payload.priority = updates.priority;
    if (updates.status !== undefined) payload.status = updates.status;

    await updateDoc(doc(db, 'actionItems', itemId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteActionItem(itemId: string): Promise<void> {
  const path = `actionItems/${itemId}`;
  try {
    await deleteDoc(doc(db, 'actionItems', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveChatMessage(params: {
  userId: string;
  meetingId: string;
  question: string;
  answer: string;
}): Promise<void> {
  const id = generateSafeId('msg');
  const path = `meetings/${params.meetingId}/chatMessages/${id}`;
  try {
    await setDoc(doc(db, 'meetings', params.meetingId, 'chatMessages', id), {
      userId: params.userId,
      meetingId: params.meetingId,
      question: clampStr(params.question, 2000),
      answer: clampStr(params.answer, 12000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteMeetingCascade(userId: string, meetingId: string): Promise<void> {
  const path = `meetings/${meetingId}`;
  try {
    const [segmentsSnap, decisionsSnap, chatSnap, actionsSnap] = await Promise.all([
      getDocs(query(collection(db, 'meetings', meetingId, 'segments'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'meetings', meetingId, 'decisions'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'meetings', meetingId, 'chatMessages'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'actionItems'), where('userId', '==', userId), where('meetingId', '==', meetingId))),
    ]);

    const refs = [
      ...segmentsSnap.docs.map((d) => d.ref),
      ...decisionsSnap.docs.map((d) => d.ref),
      ...chatSnap.docs.map((d) => d.ref),
      ...actionsSnap.docs.map((d) => d.ref),
    ];

    // Commit deletes in batches of 400
    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db);
      refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }

    await deleteDoc(doc(db, 'meetings', meetingId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Real-time Subscriptions ---

export function subscribeUserMeetings(
  userId: string,
  onData: (meetings: Meeting[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'meetings'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Meeting, 'id'>) }))
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
      onData(rows);
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, 'meetings');
    }
  );
}

export function subscribeUserActionItems(
  userId: string,
  onData: (items: ActionItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'actionItems'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ActionItem, 'id'>) }));
      onData(rows);
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, 'actionItems');
    }
  );
}

export function subscribeMeetingDetail(
  userId: string,
  meetingId: string,
  callbacks: {
    onMeeting: (meeting: Meeting | null) => void;
    onSegments: (segments: TranscriptSegment[]) => void;
    onDecisions: (decisions: Decision[]) => void;
    onChat: (messages: ChatMessage[]) => void;
  }
): () => void {
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      doc(db, 'meetings', meetingId),
      (snap) => {
        if (!snap.exists()) {
          callbacks.onMeeting(null);
          return;
        }
        callbacks.onMeeting({ id: snap.id, ...(snap.data() as Omit<Meeting, 'id'>) });
      },
      (err) => handleFirestoreError(err, OperationType.GET, `meetings/${meetingId}`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'meetings', meetingId, 'segments'), where('userId', '==', userId)),
      (snap) => {
        const segs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<TranscriptSegment, 'id'>) }))
          .sort((a, b) => a.startTime - b.startTime || a.chunkIndex - b.chunkIndex);
        callbacks.onSegments(segs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `meetings/${meetingId}/segments`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'meetings', meetingId, 'decisions'), where('userId', '==', userId)),
      (snap) => {
        const decs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Decision, 'id'>) }));
        callbacks.onDecisions(decs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `meetings/${meetingId}/decisions`)
    )
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, 'meetings', meetingId, 'chatMessages'), where('userId', '==', userId)),
      (snap) => {
        const msgs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) }))
          .sort((a, b) => {
            const ta = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
            const tb = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
            return ta - tb;
          });
        callbacks.onChat(msgs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `meetings/${meetingId}/chatMessages`)
    )
  );

  return () => unsubs.forEach((u) => u());
}
