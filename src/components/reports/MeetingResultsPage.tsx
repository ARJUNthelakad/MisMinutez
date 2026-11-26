import React, { useEffect, useMemo, useState } from 'react';
import {
  FileDown,
  Mail,
  Languages,
  RefreshCw,
  CheckCircle2,
  Circle,
  Send,
  Edit3,
  Check,
  X,
  Plus,
  Trash2,
  AlertTriangle,
  ArrowLeft,
  Copy,
  Loader2,
  Users,
  Clock,
  MessageSquareText,
  MapPin,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useAuth } from '../../context/AuthContext';
import { useConnectivity } from '../../context/ConnectivityContext';
import {
  createActionItem,
  deleteActionItem,
  saveChatMessage,
  saveStructuredMinutes,
  subscribeMeetingDetail,
  updateActionItem,
  updateDecisionType,
  updateMeetingAttendees,
  updateMeetingSpeakers,
  updateTranscriptSegment,
} from '../../lib/firestore';
import {
  analyzeMeetingTranscriptApi,
  askMeetingChatApi,
  generateFollowUpEmailApi,
  translateReportApi,
  type TranslatedReportData,
} from '../../lib/api';
import {
  buildLanguageTimeline,
  computeSpeakerAnalytics,
  detectMissedInformation,
  formatDuration,
  formatDurationHuman,
  formatMeetingDate,
  getSpeakerDisplayName,
  STATUS_LABELS,
} from '../../lib/format';
import { exportMeetingReportPdf } from '../../lib/pdfExport';
import {
  REPORT_TRANSLATION_LANGUAGES,
  type ActionItem,
  type ActionPriority,
  type AppRoute,
  type ChatMessage,
  type Decision,
  type DecisionType,
  type Meeting,
  type TranscriptSegment,
} from '../../types';

interface MeetingResultsPageProps {
  meetingId: string;
  allActionItems: ActionItem[];
  onNavigate: (route: AppRoute) => void;
}

type ResultTab =
  | 'summary'
  | 'discussion'
  | 'decisions'
  | 'actions'
  | 'questions'
  | 'risks'
  | 'speakers'
  | 'timeline'
  | 'transcript'
  | 'chat';

const TABS: Array<{ id: ResultTab; label: string }> = [
  { id: 'summary', label: 'Executive Summary' },
  { id: 'discussion', label: 'Discussion Points' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'actions', label: 'Action Items' },
  { id: 'questions', label: 'Unresolved Questions' },
  { id: 'risks', label: 'Risks' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'timeline', label: 'Language Timeline' },
  { id: 'transcript', label: 'Full Transcript' },
  { id: 'chat', label: 'AI Meeting Chat' },
];

const EXAMPLE_CHAT_QUESTIONS = [
  'What decisions were finalized?',
  'Which tasks are pending and who owns them?',
  'Were there any unresolved questions?',
  'What was discussed about deadlines?',
];

export function MeetingResultsPage({
  meetingId,
  allActionItems,
  onNavigate,
}: MeetingResultsPageProps) {
  const { user } = useAuth();
  const { isOnline } = useConnectivity();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ResultTab>('summary');
  const [bannerError, setBannerError] = useState<string | null>(null);

  // PDF Export options
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [includeTranscriptInPdf, setIncludeTranscriptInPdf] = useState(true);

  // Multilingual Report Translation (keeps original English intact)
  const [selectedReportLang, setSelectedReportLang] = useState('English');
  const [translatedReport, setTranslatedReport] = useState<TranslatedReportData | null>(null);
  const [translatingReport, setTranslatingReport] = useState(false);

  // Follow-up email drawer state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [draftingEmail, setDraftingEmail] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Re-analyze state
  const [reanalyzing, setReanalyzing] = useState(false);

  // Action item filter & add/edit
  const [actionFilter, setActionFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskOwner, setNewTaskOwner] = useState('');
  const [newTaskDeadline, setNewTaskDeadline] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<ActionPriority>('medium');
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editActionForm, setEditActionForm] = useState({
    task: '',
    assignedTo: '',
    deadline: '',
    priority: 'medium' as ActionPriority,
  });

  // Transcript view mode & inline editing
  const [transcriptMode, setTranscriptMode] = useState<'both' | 'original' | 'english'>('both');
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [editSegForm, setEditSegForm] = useState({
    speakerLabel: '',
    originalText: '',
    englishTranslation: '',
  });

  // Speaker renaming local state
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, string>>({});
  const [savingSpeakers, setSavingSpeakers] = useState(false);

  // Attendance / Attendees editing state
  const [editingAttendees, setEditingAttendees] = useState(false);
  const [attendeeDrafts, setAttendeeDrafts] = useState<string[]>([]);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [editingAttendeeIdx, setEditingAttendeeIdx] = useState<number | null>(null);
  const [editingAttendeeText, setEditingAttendeeText] = useState('');
  const [savingAttendees, setSavingAttendees] = useState(false);

  // Ask Your Meeting Chat
  const [chatInput, setChatInput] = useState('');
  const [askingChat, setAskingChat] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const unsub = subscribeMeetingDetail(user.uid, meetingId, {
      onMeeting: (m) => {
        setMeeting(m);
        if (m) setSpeakerDrafts(m.speakers || {});
        setLoading(false);
      },
      onSegments: setSegments,
      onDecisions: setDecisions,
      onChat: setChatMessages,
    });
    return () => unsub();
  }, [user, meetingId]);

  const meetingActions = useMemo(
    () => allActionItems.filter((a) => a.meetingId === meetingId),
    [allActionItems, meetingId]
  );

  const filteredActions = useMemo(() => {
    if (actionFilter === 'all') return meetingActions;
    return meetingActions.filter((a) => a.status === actionFilter);
  }, [meetingActions, actionFilter]);

  const languageTimeline = useMemo(() => buildLanguageTimeline(segments), [segments]);

  const speakerAnalytics = useMemo(
    () => computeSpeakerAnalytics(segments, meeting?.speakers || {}),
    [segments, meeting?.speakers]
  );

  const missedIssues = useMemo(
    () => (meeting ? detectMissedInformation(meeting, decisions, meetingActions, segments) : []),
    [meeting, decisions, meetingActions, segments]
  );

  const languageChartData = useMemo(() => {
    const counts = new Map<string, number>();
    segments.forEach((s) => {
      const lang = s.detectedLanguage || 'Unknown';
      counts.set(lang, (counts.get(lang) || 0) + Math.max(1, Math.round(s.endTime - s.startTime)));
    });
    return Array.from(counts.entries()).map(([language, seconds]) => ({ language, seconds }));
  }, [segments]);

  const handleTranslateReport = async (targetLang: string) => {
    setSelectedReportLang(targetLang);
    setBannerError(null);
    if (targetLang === 'English') {
      setTranslatedReport(null);
      return;
    }
    if (!meeting) return;
    if (!isOnline) {
      setBannerError('Internet connectivity is required to translate reports.');
      return;
    }

    setTranslatingReport(true);
    try {
      const result = await translateReportApi({
        targetLanguage: targetLang,
        report: {
          meetingTitle: meeting.title,
          executiveSummary: meeting.executiveSummary,
          objectives: meeting.objectives,
          discussionPoints: meeting.discussionPoints,
          decisions: decisions.map((d) => ({
            decisionText: d.decisionText,
            decisionType: d.decisionType,
          })),
          actionItems: meetingActions.map((a) => ({
            task: a.task,
            assignedTo: a.assignedTo || 'Unassigned',
            deadline: a.deadline || 'Not specified',
            priority: a.priority,
            status: a.status,
          })),
          unresolvedQuestions: meeting.unresolvedQuestions,
          risks: meeting.risks,
          followUpSuggestions: meeting.followUpSuggestions,
          meetingConclusion: meeting.meetingConclusion,
        },
      });
      setTranslatedReport(result);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Report translation failed.');
      setSelectedReportLang('English');
      setTranslatedReport(null);
    } finally {
      setTranslatingReport(false);
    }
  };

  const handleReanalyze = async () => {
    if (!user || !meeting || segments.length === 0 || !isOnline) return;
    setReanalyzing(true);
    setBannerError(null);
    try {
      const minutes = await analyzeMeetingTranscriptApi({
        title: meeting.title,
        description: meeting.description,
        meetingType: meeting.meetingType,
        speakers: meeting.speakers,
        transcript: segments.map((s) => ({
          speakerLabel: s.speakerLabel,
          englishTranslation: s.englishTranslation,
          originalText: s.originalText,
          detectedLanguage: s.detectedLanguage,
          startTime: s.startTime,
          endTime: s.endTime,
          uncertain: s.uncertain,
        })),
      });
      await saveStructuredMinutes({
        userId: user.uid,
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        duration: meeting.duration,
        endedAt: meeting.endedAt || new Date().toISOString(),
        speakers: meeting.speakers,
        languagesDetected: Array.from(new Set(segments.map((s) => s.detectedLanguage))),
        segmentCount: segments.length,
        minutes,
      });
      setTranslatedReport(null);
      setSelectedReportLang('English');
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Re-analysis failed.');
    } finally {
      setReanalyzing(false);
    }
  };

  const handleOpenFollowUpEmail = async () => {
    if (!meeting) return;
    setShowEmailModal(true);
    setCopiedEmail(false);
    if (emailBody) return;
    if (!isOnline) {
      setEmailSubject(`Meeting Minutes: ${meeting.title}`);
      setEmailBody(
        `Hi team,\n\nSummary:\n${meeting.executiveSummary}\n\nAction Items:\n${meetingActions
          .map((a) => `- ${a.task} (${a.assignedTo || 'Unassigned'}${a.deadline ? `, due ${a.deadline}` : ''})`)
          .join('\n')}`
      );
      return;
    }

    setDraftingEmail(true);
    try {
      const draft = await generateFollowUpEmailApi({
        meetingTitle: meeting.title,
        meetingDate: formatMeetingDate(meeting.startedAt),
        executiveSummary: meeting.executiveSummary,
        finalDecisions: decisions.filter((d) => d.decisionType === 'final').map((d) => d.decisionText),
        actionItems: meetingActions.map((a) => ({
          task: a.task,
          assignedTo: a.assignedTo || 'Unassigned',
          deadline: a.deadline || 'Not specified',
          status: a.status,
        })),
        unresolvedQuestions: meeting.unresolvedQuestions,
        followUpSuggestions: meeting.followUpSuggestions,
      });
      setEmailSubject(draft.subject);
      setEmailBody(draft.body);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Could not draft follow-up email.');
    } finally {
      setDraftingEmail(false);
    }
  };

  const handleSaveSpeakers = async () => {
    if (!meeting) return;
    setSavingSpeakers(true);
    try {
      await updateMeetingSpeakers(meeting.id, speakerDrafts);
    } finally {
      setSavingSpeakers(false);
    }
  };

  const mergeAttendeeInput = (raw: string, current: string[]): string[] => {
    const incoming = raw
      .split(/[\n,;]+/)
      .map((name) => name.trim().slice(0, 80))
      .filter(Boolean);
    if (incoming.length === 0) return current;
    const seen = new Set(current.map((n) => n.toLowerCase()));
    const merged = [...current];
    for (const name of incoming) {
      if (merged.length >= 50) break;
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        merged.push(name);
      }
    }
    return merged;
  };

  const handleStartEditAttendees = () => {
    if (!meeting) return;
    setAttendeeDrafts(meeting.attendees ? [...meeting.attendees] : []);
    setAttendeeInput('');
    setEditingAttendeeIdx(null);
    setEditingAttendeeText('');
    setEditingAttendees(true);
  };

  const handleAddAttendeeDraft = () => {
    if (!attendeeInput.trim()) return;
    setAttendeeDrafts((prev) => mergeAttendeeInput(attendeeInput, prev));
    setAttendeeInput('');
  };

  const handleRemoveAttendeeDraft = (nameToRemove: string) => {
    setAttendeeDrafts((prev) => prev.filter((n) => n !== nameToRemove));
    setEditingAttendeeIdx(null);
  };

  const commitAttendeeRename = (idx: number, currentList: string[]): string[] => {
    const cleaned = editingAttendeeText.trim().slice(0, 80);
    if (!cleaned) {
      return currentList.filter((_, i) => i !== idx);
    }
    const next = [...currentList];
    next[idx] = cleaned;
    const seen = new Set<string>();
    return next.filter((name) => {
      const k = name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const handleSaveAttendees = async () => {
    if (!meeting) return;
    const baseList =
      editingAttendeeIdx !== null
        ? commitAttendeeRename(editingAttendeeIdx, attendeeDrafts)
        : attendeeDrafts;
    const finalList = mergeAttendeeInput(attendeeInput, baseList);
    setSavingAttendees(true);
    setBannerError(null);
    try {
      await updateMeetingAttendees(meeting.id, finalList);
      setAttendeeInput('');
      setEditingAttendeeIdx(null);
      setEditingAttendeeText('');
      setEditingAttendees(false);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to update attendees list.');
    } finally {
      setSavingAttendees(false);
    }
  };

  const handleAddActionItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !meeting || !newTaskText.trim()) return;
    await createActionItem({
      userId: user.uid,
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      task: newTaskText.trim(),
      assignedTo: newTaskOwner.trim(),
      deadline: newTaskDeadline.trim(),
      priority: newTaskPriority,
    });
    setNewTaskText('');
    setNewTaskOwner('');
    setNewTaskDeadline('');
    setNewTaskPriority('medium');
  };

  const handleSaveActionEdit = async (itemId: string) => {
    await updateActionItem(itemId, {
      task: editActionForm.task.trim(),
      assignedTo: editActionForm.assignedTo.trim(),
      deadline: editActionForm.deadline.trim(),
      priority: editActionForm.priority,
    });
    setEditingActionId(null);
  };

  const handleSaveSegmentEdit = async (segId: string) => {
    await updateTranscriptSegment(meetingId, segId, {
      speakerLabel: editSegForm.speakerLabel.trim(),
      originalText: editSegForm.originalText.trim(),
      englishTranslation: editSegForm.englishTranslation.trim(),
    });
    setEditingSegId(null);
  };

  const handleAskQuestion = async (questionOverride?: string) => {
    const q = (questionOverride ?? chatInput).trim();
    if (!q || !user || !meeting || askingChat) return;
    if (!isOnline) {
      setBannerError('Ask Your Meeting requires an internet connection.');
      return;
    }

    setAskingChat(true);
    setBannerError(null);
    if (!questionOverride) setChatInput('');

    try {
      const { answer } = await askMeetingChatApi({
        question: q,
        meetingTitle: meeting.title,
        executiveSummary: meeting.executiveSummary,
        decisions: decisions.map((d) => ({
          decisionText: d.decisionText,
          decisionType: d.decisionType,
          speaker: d.speaker,
          timestamp: d.timestamp,
        })),
        actionItems: meetingActions.map((a) => ({
          task: a.task,
          assignedTo: a.assignedTo,
          deadline: a.deadline,
          status: a.status,
        })),
        transcript: segments.map((s) => ({
          speakerLabel: s.speakerLabel,
          displayName: meeting.speakers?.[s.speakerLabel] || undefined,
          englishTranslation: s.englishTranslation,
          originalText: s.originalText,
          detectedLanguage: s.detectedLanguage,
          startTime: s.startTime,
        })),
        history: chatMessages.map((m) => ({ question: m.question, answer: m.answer })),
      });

      await saveChatMessage({
        userId: user.uid,
        meetingId: meeting.id,
        question: q,
        answer,
      });
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to answer question.');
    } finally {
      setAskingChat(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-xl bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
        <div className="h-96 rounded-xl bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-4">
        <p className="text-base font-semibold text-slate-900 dark:text-white">Meeting not found</p>
        <button
          type="button"
          onClick={() => onNavigate({ view: 'history' })}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Meeting History
        </button>
      </div>
    );
  }

  // Active report text (English original OR translated view while preserving English untouched)
  const displayTitle = translatedReport?.meetingTitle || meeting.title;
  const displaySummary = translatedReport?.executiveSummary || meeting.executiveSummary;
  const displayObjectives = translatedReport?.objectives || meeting.objectives;
  const displayDiscussion = translatedReport?.discussionPoints || meeting.discussionPoints;
  const displayQuestions = translatedReport?.unresolvedQuestions || meeting.unresolvedQuestions;
  const displayRisks = translatedReport?.risks || meeting.risks;
  const displayFollowUps = translatedReport?.followUpSuggestions || meeting.followUpSuggestions;
  const displayConclusion = translatedReport?.meetingConclusion || meeting.meetingConclusion;

  const allSpeakerLabels = Array.from(
    new Set([...Object.keys(meeting.speakers || {}), ...segments.map((s) => s.speakerLabel)])
  );

  return (
    <div className="space-y-6">
      {/* Header & Report Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate({ view: 'history' })}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              All Meetings
            </button>
            <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white">
              {displayTitle}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>{meeting.meetingType}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatMeetingDate(meeting.startedAt)}</span>
              {meeting.venue?.trim() && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{meeting.venue.trim()}</span>
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatDurationHuman(meeting.duration)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{allSpeakerLabels.length} speakers</span>
              <span aria-hidden="true">·</span>
              <span>{STATUS_LABELS[meeting.status]}</span>
              {meeting.languagesDetected.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-blue-700 dark:text-blue-400 font-medium">
                    {meeting.languagesDetected.join(', ')}
                  </span>
                </>
              )}
            </div>
            {/* Attendance / Attendees Display & Inline Editor */}
            <div className="pt-1.5">
              {!editingAttendees ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      Attendees{meeting.attendees && meeting.attendees.length > 0 ? ` (${meeting.attendees.length})` : ''}:
                    </span>
                  </span>
                  {meeting.attendees && meeting.attendees.length > 0 ? (
                    <span>{meeting.attendees.join(', ')}</span>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500">None recorded</span>
                  )}
                  <button
                    type="button"
                    onClick={handleStartEditAttendees}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>
                      {meeting.attendees && meeting.attendees.length > 0 ? 'Edit Attendance' : 'Add Attendees'}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="mt-2 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3 max-w-2xl">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
                      Edit Attendance ({attendeeDrafts.length})
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Press Enter or Add · Comma-separated supported
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={240}
                      value={attendeeInput}
                      onChange={(e) => setAttendeeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddAttendeeDraft();
                        }
                      }}
                      placeholder="Add attendee name(s), e.g., Arjun, Priya, Rahul"
                      className="flex-1 px-3 py-1.5 text-xs sm:text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      onClick={handleAddAttendeeDraft}
                      disabled={!attendeeInput.trim() || attendeeDrafts.length >= 50}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>

                  {attendeeDrafts.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {attendeeDrafts.map((person, idx) =>
                        editingAttendeeIdx === idx ? (
                          <span
                            key={`${person}-${idx}`}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-blue-500"
                          >
                            <input
                              type="text"
                              autoFocus
                              maxLength={80}
                              value={editingAttendeeText}
                              onChange={(e) => setEditingAttendeeText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  setAttendeeDrafts((prev) => commitAttendeeRename(idx, prev));
                                  setEditingAttendeeIdx(null);
                                } else if (e.key === 'Escape') {
                                  setEditingAttendeeIdx(null);
                                }
                              }}
                              onBlur={() => {
                                setAttendeeDrafts((prev) => commitAttendeeRename(idx, prev));
                                setEditingAttendeeIdx(null);
                              }}
                              className="w-32 px-1 py-0.5 text-xs bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none"
                            />
                          </span>
                        ) : (
                          <span
                            key={`${person}-${idx}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAttendeeIdx(idx);
                                setEditingAttendeeText(person);
                              }}
                              title="Click to rename"
                              className="hover:text-blue-700 dark:hover:text-blue-400 cursor-pointer"
                            >
                              {person}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveAttendeeDraft(person)}
                              aria-label={`Remove ${person}`}
                              className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No attendees listed yet. Add names above and save.
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={savingAttendees}
                        onClick={() => void handleSaveAttendees()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                      >
                        {savingAttendees ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>{savingAttendees ? 'Saving...' : 'Save Attendance'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={savingAttendees}
                        onClick={() => {
                          setEditingAttendees(false);
                          setEditingAttendeeIdx(null);
                          setAttendeeInput('');
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    </div>
                    {attendeeDrafts.length > 0 && (
                      <span className="text-[11px] text-slate-400 hidden sm:inline">
                        Click any name to rename
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Real Working Report Actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Translate Report Selector */}
            <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200">
              {translatingReport ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
              ) : (
                <Languages className="w-3.5 h-3.5 text-slate-500" />
              )}
              <select
                aria-label="Translate report language"
                value={selectedReportLang}
                disabled={translatingReport}
                onChange={(e) => void handleTranslateReport(e.target.value)}
                className="bg-transparent focus:outline-none cursor-pointer"
              >
                {REPORT_TRANSLATION_LANGUAGES.map((l) => (
                  <option key={l} value={l} className="bg-white dark:bg-slate-900">
                    {l === 'English' ? 'English (Original)' : `Translate: ${l}`}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => void handleOpenFollowUpEmail()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Follow-Up Email</span>
            </button>

            {segments.length > 0 && (
              <button
                type="button"
                disabled={reanalyzing || !isOnline}
                onClick={() => void handleReanalyze()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} />
                <span>{reanalyzing ? 'Analyzing...' : 'Re-Analyze'}</span>
              </button>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPdfMenu((v) => !v)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>Export PDF</span>
              </button>
              {showPdfMenu && (
                <div className="absolute right-0 mt-2 w-64 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg z-30 space-y-3">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    PDF Report Options
                  </p>
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeTranscriptInPdf}
                      onChange={(e) => setIncludeTranscriptInPdf(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700"
                    />
                    Include full transcript appendix
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        exportMeetingReportPdf({
                          meeting,
                          decisions,
                          actionItems: meetingActions,
                          segments,
                          includeTranscript: includeTranscriptInPdf,
                        });
                        setShowPdfMenu(false);
                      }}
                      className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
                    >
                      Download PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPdfMenu(false)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {translatedReport && (
          <div className="px-3.5 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-center justify-between gap-2 text-xs text-blue-800 dark:text-blue-200">
            <span>
              Viewing translated report in <strong>{translatedReport.targetLanguage}</strong>. The original English report remains unchanged.
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedReportLang('English');
                setTranslatedReport(null);
              }}
              className="font-semibold underline cursor-pointer whitespace-nowrap"
            >
              Restore English
            </button>
          </div>
        )}

        {bannerError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
            {bannerError}
          </div>
        )}
      </div>

      {/* 10-Tab Navigation Strip */}
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const count =
              tab.id === 'decisions'
                ? decisions.length
                : tab.id === 'actions'
                ? meetingActions.length
                : tab.id === 'transcript'
                ? segments.length
                : tab.id === 'questions'
                ? displayQuestions.length
                : null;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span>{tab.label}</span>
                {count !== null && (
                  <span className="font-mono text-[11px] opacity-70 tabular-nums">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: Executive Summary + Missed Information Detector */}
      {activeTab === 'summary' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-6">
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
                Executive Summary
              </h2>
              <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                {displaySummary || 'No executive summary has been generated for this meeting yet.'}
              </p>

              {displayObjectives.length > 0 && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                    Meeting Objectives
                  </h3>
                  <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 list-disc pl-5">
                    {displayObjectives.map((obj, idx) => (
                      <li key={idx}>{obj}</li>
                    ))}
                  </ul>
                </div>
              )}

              {displayConclusion && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                    Meeting Conclusion
                  </h3>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    {displayConclusion}
                  </p>
                </div>
              )}
            </section>

            {/* AI Follow-Up Recommendations (Clearly Distinguished) */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                  Follow-Up Suggestions
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  AI Recommendations (not confirmed decisions)
                </span>
              </div>
              {displayFollowUps.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No follow-up suggestions generated.
                </p>
              ) : (
                <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300 list-disc pl-5">
                  {displayFollowUps.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Missed Information Detector */}
          <aside className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Missed Information Detector
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Potential follow-up gaps flagged from your transcript — review to verify.
              </p>
            </div>

            {missedIssues.length === 0 ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                No missing owners, unanswered questions, or ambiguous audio flagged.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {missedIssues.map((issue, idx) => (
                  <div key={idx} className="py-3 first:pt-0 last:pb-0 space-y-1">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {issue.category}
                    </p>
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {issue.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* TAB 2: Discussion Points */}
      {activeTab === 'discussion' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
            Discussion Points
          </h2>
          {displayDiscussion.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No discussion points extracted from this meeting.
            </p>
          ) : (
            <ol className="divide-y divide-slate-100 dark:divide-slate-800">
              {displayDiscussion.map((pt, idx) => (
                <li key={idx} className="py-3.5 first:pt-0 last:pb-0 flex items-start gap-3 text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                  <span className="font-mono text-xs text-slate-400 mt-0.5 tabular-nums">
                    {String(idx + 1).padStart(2, '0')}.
                  </span>
                  <span>{pt}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* TAB 3: Smart Decision Tracker */}
      {activeTab === 'decisions' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
                Smart Decision Tracker
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Proposals are separated from confirmed decisions. You can reclassify any item below.
              </p>
            </div>
          </div>

          {decisions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No decisions or proposals were extracted from this meeting.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {decisions.map((dec, idx) => {
                const translatedDec = translatedReport?.decisions?.[idx];
                return (
                  <div
                    key={dec.id}
                    className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                        {translatedDec?.decisionText || dec.decisionText}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {dec.speaker && <span>{dec.speaker}</span>}
                        {dec.speaker && dec.timestamp && <span aria-hidden="true">·</span>}
                        {dec.timestamp && <span className="font-mono tabular-nums">{dec.timestamp}</span>}
                        {dec.transcriptReference && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="italic">&ldquo;{dec.transcriptReference}&rdquo;</span>
                          </>
                        )}
                      </div>
                    </div>

                    <select
                      aria-label="Decision classification"
                      value={dec.decisionType}
                      onChange={(e) =>
                        void updateDecisionType(meeting.id, dec.id, e.target.value as DecisionType)
                      }
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border shrink-0 cursor-pointer ${
                        dec.decisionType === 'final'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                          : dec.decisionType === 'rejected'
                          ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                          : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      <option value="final">Final decision</option>
                      <option value="proposed">Proposed decision</option>
                      <option value="pending">Pending decision</option>
                      <option value="rejected">Rejected proposal</option>
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 4: Action Item Tracker */}
      {activeTab === 'actions' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
                Action Item Tracker
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Assign owners, add deadlines, edit details, or mark tasks completed.
              </p>
            </div>
            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-slate-800 self-start">
              {(['all', 'pending', 'completed'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActionFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer ${
                    actionFilter === f
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Add New Action Item Form */}
          <form
            onSubmit={handleAddActionItem}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800"
          >
            <input
              type="text"
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              placeholder="Add an action item manually..."
              className="sm:col-span-5 px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
            />
            <input
              type="text"
              value={newTaskOwner}
              onChange={(e) => setNewTaskOwner(e.target.value)}
              placeholder="Assignee (optional)"
              className="sm:col-span-2 px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
            />
            <input
              type="text"
              value={newTaskDeadline}
              onChange={(e) => setNewTaskDeadline(e.target.value)}
              placeholder="Deadline (e.g. Friday)"
              className="sm:col-span-2 px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
            />
            <select
              value={newTaskPriority}
              onChange={(e) => setNewTaskPriority(e.target.value as ActionPriority)}
              className="sm:col-span-1 px-2 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
            >
              <option value="low">Low</option>
              <option value="medium">Med</option>
              <option value="high">High</option>
            </select>
            <button
              type="submit"
              disabled={!newTaskText.trim()}
              className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" /> Add Task
            </button>
          </form>

          {filteredActions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No {actionFilter === 'all' ? '' : actionFilter} action items for this meeting.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredActions.map((item) => {
                const isEditing = editingActionId === item.id;
                return (
                  <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        void updateActionItem(item.id, {
                          status: item.status === 'pending' ? 'completed' : 'pending',
                        })
                      }
                      aria-label="Toggle action item completion"
                      className={`mt-0.5 cursor-pointer shrink-0 ${
                        item.status === 'completed'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400 hover:text-emerald-600'
                      }`}
                    >
                      {item.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Circle className="w-4 h-4" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editActionForm.task}
                            onChange={(e) =>
                              setEditActionForm((p) => ({ ...p, task: e.target.value }))
                            }
                            className="w-full px-3 py-1.5 text-sm rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={editActionForm.assignedTo}
                              onChange={(e) =>
                                setEditActionForm((p) => ({ ...p, assignedTo: e.target.value }))
                              }
                              placeholder="Assignee"
                              className="px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                            />
                            <input
                              type="text"
                              value={editActionForm.deadline}
                              onChange={(e) =>
                                setEditActionForm((p) => ({ ...p, deadline: e.target.value }))
                              }
                              placeholder="Deadline"
                              className="px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                            />
                            <select
                              value={editActionForm.priority}
                              onChange={(e) =>
                                setEditActionForm((p) => ({
                                  ...p,
                                  priority: e.target.value as ActionPriority,
                                }))
                              }
                              className="px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                            >
                              <option value="low">Low priority</option>
                              <option value="medium">Medium priority</option>
                              <option value="high">High priority</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSaveActionEdit(item.id)}
                              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-blue-700 text-white cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" /> Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingActionId(null)}
                              className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" /> Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p
                            className={`text-sm font-medium ${
                              item.status === 'completed'
                                ? 'line-through text-slate-400 dark:text-slate-500'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {item.task}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <span>Owner: {item.assignedTo || 'Unassigned'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                              <Clock className="w-3 h-3" />
                              {item.deadline || 'No deadline'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={`capitalize font-medium ${
                                item.priority === 'high'
                                  ? 'text-red-600 dark:text-red-400'
                                  : item.priority === 'medium'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-500'
                              }`}
                            >
                              {item.priority} priority
                            </span>
                            {item.transcriptReference && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="italic">&ldquo;{item.transcriptReference}&rdquo;</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingActionId(item.id);
                            setEditActionForm({
                              task: item.task,
                              assignedTo: item.assignedTo,
                              deadline: item.deadline,
                              priority: item.priority,
                            });
                          }}
                          aria-label="Edit task"
                          className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteActionItem(item.id)}
                          aria-label="Delete task"
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 5: Unresolved Questions */}
      {activeTab === 'questions' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
            Unresolved Questions &amp; Open Issues
          </h2>
          {displayQuestions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No unresolved questions were detected in this meeting.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {displayQuestions.map((q, idx) => (
                <li key={idx} className="py-3.5 first:pt-0 last:pb-0 text-sm text-slate-800 dark:text-slate-200">
                  {q}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* TAB 6: Risks */}
      {activeTab === 'risks' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
              Risks Identified
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Items raised by participants are listed directly; any AI-inferred risk is prefixed as a suggestion.
            </p>
          </div>
          {displayRisks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No explicit risks were raised during this meeting.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {displayRisks.map((risk, idx) => {
                const isSuggestion = risk.toLowerCase().includes('[ai suggestion]');
                return (
                  <li key={idx} className="py-3.5 first:pt-0 last:pb-0 space-y-1">
                    <span
                      className={`text-xs font-semibold ${
                        isSuggestion
                          ? 'text-blue-700 dark:text-blue-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {isSuggestion ? 'AI Risk Suggestion' : 'Participant-Raised Risk'}
                    </span>
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      {risk.replace(/^\[AI Suggestion\]\s*/i, '')}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* TAB 7: Speaker Analytics & Manual Name Assignment */}
      {activeTab === 'speakers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
                Speaker Analytics
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Speaking duration reflects estimated airtime only — never contribution quality.
              </p>
            </div>

            {speakerAnalytics.length === 0 ? (
              <p className="text-sm text-slate-500">No speaker segments recorded yet.</p>
            ) : (
              <>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={speakerAnalytics} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.4} />
                      <XAxis dataKey="displayName" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} unit="s" />
                      <Tooltip />
                      <Bar dataKey="speakingDurationSec" name="Speaking Time (s)" fill="#1D4ED8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="py-2.5 font-medium">Speaker</th>
                        <th className="py-2.5 font-medium text-right">Segments</th>
                        <th className="py-2.5 font-medium text-right">Duration</th>
                        <th className="py-2.5 font-medium pl-4">Languages Used</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {speakerAnalytics.map((row) => (
                        <tr key={row.speakerLabel}>
                          <td className="py-3 font-medium text-slate-900 dark:text-slate-100">
                            {row.displayName}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {row.segmentCount}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {formatDurationHuman(row.speakingDurationSec)}
                          </td>
                          <td className="py-3 pl-4 text-slate-600 dark:text-slate-300">
                            {row.languages.join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="font-display font-semibold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                Assign Speaker Names
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Diarization uses anonymous labels only. Assign participant names manually if desired.
              </p>
            </div>
            {allSpeakerLabels.length === 0 ? (
              <p className="text-xs text-slate-500">No anonymous speakers detected.</p>
            ) : (
              <div className="space-y-3">
                {meeting.attendees && meeting.attendees.length > 0 && (
                  <datalist id="meeting-attendees-datalist">
                    {meeting.attendees.map((person) => (
                      <option key={person} value={person} />
                    ))}
                  </datalist>
                )}
                {allSpeakerLabels.map((lbl) => (
                  <div key={lbl} className="space-y-1">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      {lbl}
                    </label>
                    <input
                      type="text"
                      list="meeting-attendees-datalist"
                      maxLength={80}
                      value={speakerDrafts[lbl] || ''}
                      onChange={(e) =>
                        setSpeakerDrafts((prev) => ({ ...prev, [lbl]: e.target.value }))
                      }
                      placeholder={`Assign name for ${lbl}`}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  disabled={savingSpeakers}
                  onClick={() => void handleSaveSpeakers()}
                  className="w-full px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  {savingSpeakers ? 'Saving Names...' : 'Save Speaker Names'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 8: Language Timeline */}
      {activeTab === 'timeline' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
              Chronological Language Timeline
            </h2>
            {languageTimeline.length === 0 ? (
              <p className="text-sm text-slate-500">No detected language intervals available.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {languageTimeline.map((entry, idx) => (
                  <div key={idx} className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-4 text-sm">
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums w-28 shrink-0">
                        {formatDuration(entry.startTime)}–{formatDuration(entry.endTime)}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {entry.language}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {entry.segmentCount} seg{entry.segmentCount === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h3 className="font-display font-semibold text-base text-slate-900 dark:text-white">
              Time by Language
            </h3>
            {languageChartData.length === 0 ? (
              <p className="text-xs text-slate-500">No language data yet.</p>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={languageChartData} layout="vertical" margin={{ top: 4, right: 16, left: 12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.4} />
                    <XAxis type="number" tick={{ fontSize: 11 }} unit="s" />
                    <YAxis dataKey="language" type="category" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip />
                    <Bar dataKey="seconds" name="Seconds" fill="#2563EB" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 9: Full Transcript (3 Modes + Inline Editing) */}
      {activeTab === 'transcript' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
                Full Multilingual Transcript
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {segments.length} segments · Click the edit icon to correct any transcription or speaker label
              </p>
            </div>
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
                  onClick={() => setTranscriptMode(m.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                    transcriptMode === m.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {segments.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No transcript segments recorded for this meeting.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {segments.map((seg) => {
                const isEditing = editingSegId === seg.id;
                return (
                  <div key={seg.id} className="p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {getSpeakerDisplayName(seg.speakerLabel, meeting.speakers)}
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
                          onClick={() => {
                            setEditingSegId(seg.id);
                            setEditSegForm({
                              speakerLabel: seg.speakerLabel,
                              originalText: seg.originalText,
                              englishTranslation: seg.englishTranslation,
                            });
                          }}
                          aria-label="Edit segment"
                          className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2 pt-1">
                        <input
                          type="text"
                          value={editSegForm.speakerLabel}
                          onChange={(e) =>
                            setEditSegForm((p) => ({ ...p, speakerLabel: e.target.value }))
                          }
                          className="w-full sm:w-52 px-2.5 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                        />
                        <textarea
                          rows={2}
                          value={editSegForm.originalText}
                          onChange={(e) =>
                            setEditSegForm((p) => ({ ...p, originalText: e.target.value }))
                          }
                          className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                        />
                        <textarea
                          rows={2}
                          value={editSegForm.englishTranslation}
                          onChange={(e) =>
                            setEditSegForm((p) => ({ ...p, englishTranslation: e.target.value }))
                          }
                          className="w-full px-3 py-2 text-sm rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveSegmentEdit(seg.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-700 text-white cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" /> Save Changes
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSegId(null)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {(transcriptMode === 'original' || transcriptMode === 'both') && (
                          <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                            {seg.originalText}
                          </p>
                        )}
                        {(transcriptMode === 'english' ||
                          (transcriptMode === 'both' &&
                            seg.englishTranslation.trim() !== seg.originalText.trim())) && (
                          <p
                            className={`text-sm leading-relaxed ${
                              transcriptMode === 'both'
                                ? 'text-slate-600 dark:text-slate-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {transcriptMode === 'both'
                              ? `English: ${seg.englishTranslation}`
                              : seg.englishTranslation}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 10: Ask Your Meeting — Grounded AI Chat */}
      {activeTab === 'chat' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display font-semibold text-lg text-slate-900 dark:text-white flex items-center gap-2">
              <MessageSquareText className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              Ask Your Meeting
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Answers are strictly grounded in this meeting&apos;s transcript and minutes with speaker &amp; timestamp citations.
            </p>
          </div>

          <div className="p-5 space-y-5 max-h-[460px] overflow-y-auto">
            {chatMessages.length === 0 ? (
              <div className="space-y-4 py-4">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Try asking a grounded question about this conversation:
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_CHAT_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={askingChat || !isOnline}
                      onClick={() => void handleAskQuestion(q)}
                      className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div key={msg.id} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-xl px-4 py-2.5 rounded-xl bg-blue-700 text-white text-sm">
                      {msg.question}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-2xl px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm leading-relaxed whitespace-pre-line">
                      {msg.answer}
                    </div>
                  </div>
                </div>
              ))
            )}

            {askingChat && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>Searching meeting transcript for grounded evidence...</span>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAskQuestion();
            }}
            className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2.5"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={askingChat || !isOnline}
              placeholder={
                isOnline
                  ? 'Ask about decisions, speaker statements, deadlines, or tasks...'
                  : 'Connect to the internet to query this meeting...'
              }
              className="flex-1 px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="submit"
              disabled={askingChat || !chatInput.trim() || !isOnline}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              <span>Ask</span>
            </button>
          </form>
        </section>
      )}

      {/* Smart Follow-Up Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-lg text-slate-900 dark:text-white">
                Smart Follow-Up Email Draft
              </h3>
              <button
                type="button"
                onClick={() => setShowEmailModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {draftingEmail ? (
              <div className="py-10 flex items-center justify-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>Drafting grounded follow-up email...</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Email Body (editable before copying)
                  </label>
                  <textarea
                    rows={12}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-sans leading-relaxed"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(`Subject: ${emailSubject}\n\n${emailBody}`);
                      setCopiedEmail(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
                  >
                    {copiedEmail ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedEmail ? 'Copied to Clipboard' : 'Copy Email'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(false)}
                    className="px-4 py-2 text-xs sm:text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
