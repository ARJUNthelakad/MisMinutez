import type { ActionItem, Decision, Meeting, TranscriptSegment } from '../types';

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationHuman(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function formatMeetingDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getSpeakerDisplayName(
  speakerLabel: string,
  speakers: Record<string, string> | undefined
): string {
  const assigned = speakers?.[speakerLabel]?.trim();
  return assigned ? `${assigned} (${speakerLabel})` : speakerLabel;
}

export interface LanguageTimelineEntry {
  startTime: number;
  endTime: number;
  language: string;
  segmentCount: number;
}

export function buildLanguageTimeline(segments: TranscriptSegment[]): LanguageTimelineEntry[] {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const timeline: LanguageTimelineEntry[] = [];

  for (const seg of sorted) {
    const lang = seg.detectedLanguage || 'Unknown';
    const last = timeline[timeline.length - 1];
    if (last && last.language.toLowerCase() === lang.toLowerCase()) {
      last.endTime = Math.max(last.endTime, seg.endTime);
      last.segmentCount += 1;
    } else {
      timeline.push({
        startTime: seg.startTime,
        endTime: Math.max(seg.startTime, seg.endTime),
        language: lang,
        segmentCount: 1,
      });
    }
  }
  return timeline;
}

export interface SpeakerAnalyticsRow {
  speakerLabel: string;
  displayName: string;
  segmentCount: number;
  speakingDurationSec: number;
  languages: string[];
}

export function computeSpeakerAnalytics(
  segments: TranscriptSegment[],
  speakersMap: Record<string, string>
): SpeakerAnalyticsRow[] {
  const map = new Map<
    string,
    { segmentCount: number; speakingDurationSec: number; languages: Set<string> }
  >();

  for (const seg of segments) {
    const label = seg.speakerLabel || 'Speaker 1';
    const entry = map.get(label) || {
      segmentCount: 0,
      speakingDurationSec: 0,
      languages: new Set<string>(),
    };
    entry.segmentCount += 1;
    entry.speakingDurationSec += Math.max(1, seg.endTime - seg.startTime);
    if (seg.detectedLanguage) entry.languages.add(seg.detectedLanguage);
    map.set(label, entry);
  }

  return Array.from(map.entries())
    .map(([speakerLabel, stats]) => ({
      speakerLabel,
      displayName: speakersMap[speakerLabel]?.trim() || speakerLabel,
      segmentCount: stats.segmentCount,
      speakingDurationSec: Math.round(stats.speakingDurationSec),
      languages: Array.from(stats.languages),
    }))
    .sort((a, b) => b.speakingDurationSec - a.speakingDurationSec);
}

export interface MissedInfoIssue {
  category: 'Unanswered Question' | 'Unassigned Task' | 'Missing Deadline' | 'Pending Decision' | 'Uncertain Audio';
  detail: string;
}

export function detectMissedInformation(
  meeting: Meeting,
  decisions: Decision[],
  actionItems: ActionItem[],
  segments: TranscriptSegment[]
): MissedInfoIssue[] {
  const issues: MissedInfoIssue[] = [];

  for (const q of meeting.unresolvedQuestions || []) {
    issues.push({ category: 'Unanswered Question', detail: q });
  }
  for (const item of actionItems) {
    if (!item.assignedTo?.trim()) {
      issues.push({ category: 'Unassigned Task', detail: `"${item.task}" has no explicitly assigned owner.` });
    }
    if (!item.deadline?.trim() && item.status === 'pending') {
      issues.push({ category: 'Missing Deadline', detail: `"${item.task}" has no deadline specified.` });
    }
  }
  for (const dec of decisions) {
    if (dec.decisionType === 'pending' || dec.decisionType === 'proposed') {
      issues.push({
        category: 'Pending Decision',
        detail: `${dec.decisionType === 'proposed' ? 'Proposal awaiting confirmation' : 'Pending decision'}: ${dec.decisionText}`,
      });
    }
  }
  const uncertainCount = segments.filter((s) => s.uncertain).length;
  if (uncertainCount > 0) {
    issues.push({
      category: 'Uncertain Audio',
      detail: `${uncertainCount} transcript segment${uncertainCount === 1 ? '' : 's'} marked uncertain due to overlapping speech or low clarity — review recommended.`,
    });
  }
  return issues;
}

export const STATUS_LABELS: Record<Meeting['status'], string> = {
  recording: 'Recording live',
  recorded_locally: 'Saved locally — waiting for internet',
  uploading: 'Uploading audio chunks',
  waiting_for_processing: 'Waiting for processing',
  processing: 'Generating minutes',
  completed: 'Completed',
  error: 'Needs attention',
};
