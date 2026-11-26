import React, { useMemo, useState } from 'react';
import { Search, Trash2, ArrowRight, FileText, Mic, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { deleteMeetingCascade } from '../../lib/firestore';
import { deleteChunksForMeeting, deleteOfflineMeetingMeta } from '../../lib/offlineDb';
import { formatDurationHuman, formatMeetingDate, STATUS_LABELS } from '../../lib/format';
import { MEETING_TYPES, type AppRoute, type Meeting } from '../../types';

interface MeetingHistoryPageProps {
  meetings: Meeting[];
  loading: boolean;
  onNavigate: (route: AppRoute) => void;
}

export function MeetingHistoryPage({
  meetings,
  loading,
  onNavigate,
}: MeetingHistoryPageProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const availableTypes = useMemo(() => {
    const set = new Set<string>(MEETING_TYPES);
    meetings.forEach((m) => {
      if (m.meetingType?.trim()) set.add(m.meetingType.trim());
    });
    return Array.from(set);
  }, [meetings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();

    return meetings
      .filter((m) => {
        if (q) {
          const matchesTitle = m.title.toLowerCase().includes(q);
          const matchesDesc = m.description.toLowerCase().includes(q);
          const matchesType = (m.meetingType || '').toLowerCase().includes(q);
          const matchesVenue = (m.venue || '').toLowerCase().includes(q);
          const matchesAttendee = (m.attendees || []).some((a) => a.toLowerCase().includes(q));
          if (!matchesTitle && !matchesDesc && !matchesType && !matchesVenue && !matchesAttendee) {
            return false;
          }
        }
        if (typeFilter !== 'all' && m.meetingType !== typeFilter) return false;
        if (dateFilter !== 'all') {
          const ts = new Date(m.startedAt).getTime();
          if (Number.isNaN(ts)) return false;
          const diffDays = (now - ts) / (1000 * 60 * 60 * 24);
          if (dateFilter === 'today' && diffDays > 1) return false;
          if (dateFilter === '7d' && diffDays > 7) return false;
          if (dateFilter === '30d' && diffDays > 30) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp = (a.startedAt || '').localeCompare(b.startedAt || '');
        return sortOrder === 'newest' ? -cmp : cmp;
      });
  }, [meetings, search, typeFilter, dateFilter, sortOrder]);

  const handleConfirmDelete = async () => {
    if (!user || !confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteMeetingCascade(user.uid, confirmDeleteId);
      await deleteChunksForMeeting(confirmDeleteId);
      await deleteOfflineMeetingMeta(confirmDeleteId);
      setConfirmDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-6 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white">
            Meeting History
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Search, filter, revisit reports, or permanently delete past meetings and recordings.
          </p>
        </div>
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          {filtered.length} of {meetings.length} meetings
        </span>
      </div>

      {/* Filters Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
        <div className="relative lg:col-span-5">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, venue, attendee, or meeting type..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <select
          aria-label="Filter by meeting type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="lg:col-span-3 px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        >
          <option value="all">All meeting types</option>
          {availableTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as 'all' | 'today' | '7d' | '30d')}
          className="lg:col-span-2 px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        >
          <option value="all">Any date</option>
          <option value="today">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>

        <select
          aria-label="Sort meetings"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
          className="lg:col-span-2 px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Results List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-16 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No meetings found
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {meetings.length === 0
                ? 'Start your first physical meeting recording to build your searchable archive.'
                : 'Adjust your search term or filters to view matching meetings.'}
            </p>
            {meetings.length === 0 && (
              <button
                type="button"
                onClick={() => onNavigate({ view: 'new-meeting' })}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" /> Start New Meeting
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filtered.map((mtg) => (
              <div
                key={mtg.id}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="min-w-0 space-y-1 flex-1">
                  <button
                    type="button"
                    onClick={() => onNavigate({ view: 'results', meetingId: mtg.id })}
                    className="text-left text-sm sm:text-base font-semibold text-slate-900 dark:text-white hover:text-blue-700 dark:hover:text-blue-400 truncate block max-w-full cursor-pointer"
                  >
                    {mtg.title}
                  </button>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
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
                    <span aria-hidden="true">·</span>
                    <span>{STATUS_LABELS[mtg.status]}</span>
                    {mtg.languagesDetected.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-blue-700 dark:text-blue-400">
                          {mtg.languagesDetected.join(', ')}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigate({ view: 'results', meetingId: mtg.id })}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    <span>View Report</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(mtg.id)}
                    aria-label={`Delete ${mtg.title}`}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h3 className="font-display font-semibold text-base text-slate-900 dark:text-white">
              Delete Meeting Permanently?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              This removes the meeting minutes, transcript segments, decisions, action items, AI chat history, and any local IndexedDB audio chunks for this session. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-xs sm:text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Delete Meeting'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
