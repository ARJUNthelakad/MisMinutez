import React, { useMemo, useState } from 'react';
import {
  Mic,
  Search,
  CheckCircle2,
  Circle,
  Clock,
  ArrowRight,
  WifiOff,
  RefreshCw,
  FileText,
  MapPin,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConnectivity } from '../../context/ConnectivityContext';
import { updateActionItem } from '../../lib/firestore';
import { formatDurationHuman, formatMeetingDate, STATUS_LABELS } from '../../lib/format';
import type { ActionItem, AppRoute, Meeting } from '../../types';

interface DashboardPageProps {
  meetings: Meeting[];
  actionItems: ActionItem[];
  loading: boolean;
  onNavigate: (route: AppRoute) => void;
}

export function DashboardPage({
  meetings,
  actionItems,
  loading,
  onNavigate,
}: DashboardPageProps) {
  const { profile, user } = useAuth();
  const {
    isOnline,
    offlineMeetings,
    pendingChunksCount,
    syncingQueue,
    syncPendingQueue,
  } = useConnectivity();

  const [searchQuery, setSearchQuery] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const totalDuration = meetings.reduce((sum, m) => sum + (m.duration || 0), 0);
    const pendingTasks = actionItems.filter((a) => a.status === 'pending').length;
    const completedReports = meetings.filter((m) => m.status === 'completed').length;
    const uniqueLanguages = new Set<string>();
    meetings.forEach((m) => m.languagesDetected?.forEach((l) => uniqueLanguages.add(l)));
    return {
      totalMeetings: meetings.length,
      totalDuration,
      pendingTasks,
      completedReports,
      languageCount: uniqueLanguages.size,
    };
  }, [meetings, actionItems]);

  const filteredMeetings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return meetings.slice(0, 6);
    return meetings
      .filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.meetingType.toLowerCase().includes(q) ||
          (m.venue || '').toLowerCase().includes(q) ||
          (m.attendees || []).some((a) => a.toLowerCase().includes(q)) ||
          m.executiveSummary.toLowerCase().includes(q) ||
          m.languagesDetected.some((l) => l.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [meetings, searchQuery]);

  const pendingActionItems = useMemo(
    () => actionItems.filter((a) => a.status === 'pending').slice(0, 6),
    [actionItems]
  );

  const handleToggleTask = async (item: ActionItem) => {
    setTogglingId(item.id);
    try {
      await updateActionItem(item.id, {
        status: item.status === 'pending' ? 'completed' : 'pending',
      });
    } finally {
      setTogglingId(null);
    }
  };

  const firstName = (profile?.name || user?.displayName || 'there').split(' ')[0];

  return (
    <div className="space-y-8">
      {/* Welcome & Primary CTA */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white">
            Welcome back, {firstName}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Capture face-to-face multilingual discussions and turn them into structured minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate({ view: 'new-meeting' })}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Mic className="w-4 h-4" />
          <span>Start New Meeting</span>
        </button>
      </div>

      {/* Offline Pending Recordings Recovery Banner */}
      {(offlineMeetings.length > 0 || pendingChunksCount > 0) && (
        <div className="p-4 sm:p-5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>
                {isOnline
                  ? 'Offline audio ready to sync and process'
                  : 'Saved Locally — Waiting for Internet'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-300/90">
              {pendingChunksCount} audio chunk{pendingChunksCount === 1 ? '' : 's'} stored safely in
              IndexedDB{offlineMeetings.length > 0 ? ` across ${offlineMeetings.length} local session(s)` : ''}.
            </p>
          </div>
          <button
            type="button"
            disabled={!isOnline || syncingQueue}
            onClick={() => void syncPendingQueue()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${syncingQueue ? 'animate-spin' : ''}`} />
            <span>{syncingQueue ? 'Processing Queue...' : isOnline ? 'Upload & Process Now' : 'Waiting for Network'}</span>
          </button>
        </div>
      )}

      {/* Real Database Statistics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Meetings</p>
          <p className="font-display font-bold text-2xl sm:text-3xl text-slate-900 dark:text-white mt-2 tabular-nums">
            {loading ? '—' : stats.totalMeetings}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {stats.completedReports} reports finalized
          </p>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Recording Time</p>
          <p className="font-display font-bold text-2xl sm:text-3xl text-slate-900 dark:text-white mt-2 tabular-nums">
            {loading ? '—' : formatDurationHuman(stats.totalDuration)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Captured across sessions
          </p>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Pending Action Items</p>
          <p className="font-display font-bold text-2xl sm:text-3xl text-slate-900 dark:text-white mt-2 tabular-nums">
            {loading ? '—' : stats.pendingTasks}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {actionItems.length} total tracked
          </p>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Languages Detected</p>
          <p className="font-display font-bold text-2xl sm:text-3xl text-slate-900 dark:text-white mt-2 tabular-nums">
            {loading ? '—' : stats.languageCount}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Across recorded rooms
          </p>
        </div>
      </div>

      {/* Main Content Split: Recent Meetings + Pending Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Recent Meetings & Quick Search */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
              Recent Meetings &amp; Reports
            </h2>
            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Quick search meetings..."
                className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-14 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          ) : filteredMeetings.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {searchQuery ? 'No meetings match your search' : 'No meetings recorded yet'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                {searchQuery
                  ? 'Try searching by a different title, meeting type, or spoken language.'
                  : 'Start your first physical room recording or upload multilingual audio to generate structured minutes.'}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={() => onNavigate({ view: 'new-meeting' })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 transition-colors cursor-pointer"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>Record First Meeting</span>
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredMeetings.map((mtg) => (
                <button
                  key={mtg.id}
                  type="button"
                  onClick={() =>
                    onNavigate(
                      mtg.status === 'recording'
                        ? { view: 'live-room', meetingId: mtg.id }
                        : { view: 'results', meetingId: mtg.id }
                    )
                  }
                  className="w-full text-left px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-4 cursor-pointer"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {mtg.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>{mtg.meetingType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatMeetingDate(mtg.startedAt)}</span>
                      {mtg.venue?.trim() && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{mtg.venue.trim()}</span>
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatDurationHuman(mtg.duration)}</span>
                      {mtg.languagesDetected.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-blue-700 dark:text-blue-400">
                            {mtg.languagesDetected.slice(0, 3).join(', ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs font-medium whitespace-nowrap ${
                        mtg.status === 'completed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : mtg.status === 'error'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {STATUS_LABELS[mtg.status]}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {meetings.length > 6 && (
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => onNavigate({ view: 'history' })}
                className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                View all {meetings.length} meetings in History →
              </button>
            </div>
          )}
        </section>

        {/* Pending Action Items */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
              Pending Action Items
            </h2>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {stats.pendingTasks} open
            </span>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          ) : pendingActionItems.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <CheckCircle2 className="w-7 h-7 text-emerald-600/60 dark:text-emerald-400/60 mx-auto" />
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                All caught up
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Action items extracted from your meetings will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {pendingActionItems.map((item) => (
                <div key={item.id} className="px-5 py-3.5 flex items-start gap-3">
                  <button
                    type="button"
                    disabled={togglingId === item.id}
                    onClick={() => void handleToggleTask(item)}
                    aria-label={`Mark "${item.task}" complete`}
                    className="mt-0.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
                  >
                    <Circle className="w-4 h-4" />
                  </button>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm text-slate-900 dark:text-slate-100 leading-snug">
                      {item.task}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <button
                        type="button"
                        onClick={() => onNavigate({ view: 'results', meetingId: item.meetingId })}
                        className="text-blue-700 dark:text-blue-400 hover:underline truncate max-w-[160px] cursor-pointer"
                      >
                        {item.meetingTitle || 'Meeting'}
                      </button>
                      <span aria-hidden="true">·</span>
                      <span>{item.assignedTo || 'Unassigned'}</span>
                      {item.deadline && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                            <Clock className="w-3 h-3" />
                            {item.deadline}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
