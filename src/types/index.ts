export type MeetingType = string;

export const MEETING_TYPES: string[] = [
  'College project',
  'Business meeting',
  'Team stand-up',
  'Brainstorming',
  'Academic discussion',
  'Client meeting',
  'Interview',
  'General meeting',
];

export const PRIORITY_LANGUAGES = [
  'English',
  'Malayalam',
  'Hindi',
  'Tamil',
  'Kannada',
  'Telugu',
  'Arabic',
] as const;

export const REPORT_TRANSLATION_LANGUAGES = [
  'English',
  'Malayalam',
  'Hindi',
  'Tamil',
  'Kannada',
  'Telugu',
  'Arabic',
  'Spanish',
  'French',
  'German',
] as const;

export type MeetingStatus =
  | 'recording'
  | 'recorded_locally'
  | 'uploading'
  | 'waiting_for_processing'
  | 'processing'
  | 'completed'
  | 'error';

export type DecisionType = 'final' | 'proposed' | 'pending' | 'rejected';
export type ActionPriority = 'low' | 'medium' | 'high';
export type ActionStatus = 'pending' | 'completed';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  defaultReportLanguage: string;
  preferredLanguages: string[];
  theme: 'light' | 'dark';
  autoDeleteAudio: boolean;
  chunkDurationSec: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Meeting {
  id: string;
  userId: string;
  title: string;
  description: string;
  meetingType: MeetingType;
  attendees?: string[];
  venue?: string;
  preferredOutputLanguage: string;
  expectedLanguages: string[];
  startedAt: string;
  endedAt: string;
  duration: number; // seconds
  status: MeetingStatus;
  executiveSummary: string;
  objectives: string[];
  discussionPoints: string[];
  unresolvedQuestions: string[];
  risks: string[];
  followUpSuggestions: string[];
  meetingConclusion: string;
  speakers: Record<string, string>; // speakerLabel -> displayName
  languagesDetected: string[];
  segmentCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TranscriptSegment {
  id: string;
  userId: string;
  meetingId: string;
  speakerLabel: string;
  originalText: string;
  englishTranslation: string;
  detectedLanguage: string;
  startTime: number;
  endTime: number;
  confidence?: number | null;
  uncertain: boolean;
  chunkIndex: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Decision {
  id: string;
  userId: string;
  meetingId: string;
  decisionText: string;
  decisionType: DecisionType;
  speaker: string;
  timestamp: string;
  transcriptReference: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ActionItem {
  id: string;
  userId: string;
  meetingId: string;
  meetingTitle: string;
  task: string;
  assignedTo: string;
  deadline: string;
  priority: ActionPriority;
  status: ActionStatus;
  transcriptReference: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChatMessage {
  id: string;
  userId: string;
  meetingId: string;
  question: string;
  answer: string;
  createdAt?: unknown;
}

export interface StructuredMinutesOutput {
  meeting_title: string;
  executive_summary: string;
  objectives: string[];
  discussion_points: string[];
  decisions: Array<{
    decision: string;
    type: DecisionType;
    speaker: string | null;
    timestamp: string | null;
    transcript_reference: string | null;
  }>;
  action_items: Array<{
    task: string;
    assigned_to: string | null;
    deadline: string | null;
    priority: ActionPriority;
    status: ActionStatus;
    transcript_reference: string | null;
  }>;
  unresolved_questions: string[];
  risks: string[];
  follow_up_suggestions: string[];
  meeting_conclusion: string;
}

export interface TranscribedSegmentDTO {
  speaker_label: string;
  original_text: string;
  detected_language: string;
  english_translation: string;
  start_time: number;
  end_time: number;
  confidence: number | null;
  uncertain: boolean;
}

export interface OfflineAudioChunk {
  chunkId: string;
  meetingId: string;
  userId: string;
  chunkIndex: number;
  startOffsetSec: number;
  durationSec: number;
  mimeType: string;
  blob: Blob;
  sizeBytes: number;
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'processed' | 'failed';
  retryCount: number;
  createdAt: number;
  lastError?: string;
}

export interface OfflineMeetingMeta {
  meetingId: string;
  userId: string;
  title: string;
  description: string;
  meetingType: MeetingType;
  attendees?: string[];
  venue?: string;
  preferredOutputLanguage: string;
  expectedLanguages: string[];
  startedAt: string;
  duration: number;
  syncedToFirestore: boolean;
  status: MeetingStatus;
}

export type AppRoute =
  | { view: 'landing' }
  | { view: 'dashboard' }
  | { view: 'new-meeting' }
  | { view: 'live-room'; meetingId: string }
  | { view: 'results'; meetingId: string }
  | { view: 'history' }
  | { view: 'settings' };
