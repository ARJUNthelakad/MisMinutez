import React, { useState } from 'react';
import {
  Check,
  Trash2,
  RefreshCw,
  LogOut,
  HardDrive,
  ShieldCheck,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConnectivity } from '../../context/ConnectivityContext';
import { clearAllLocalRecordings } from '../../lib/offlineDb';
import { formatBytes } from '../../lib/format';
import { PRIORITY_LANGUAGES, REPORT_TRANSLATION_LANGUAGES } from '../../types';

export function SettingsPage() {
  const { user, profile, theme, setTheme, refreshProfileUpdates, logout } = useAuth();
  const {
    isOnline,
    aiProvider,
    selfHostedConfigured,
    pendingChunksCount,
    localBytesUsed,
    syncingQueue,
    syncPendingQueue,
    refreshLocalQueueStats,
  } = useConnectivity();

  const [name, setName] = useState(profile?.name || user?.displayName || '');
  const [defaultReportLanguage, setDefaultReportLanguage] = useState(
    profile?.defaultReportLanguage || 'English'
  );
  const [preferredLanguages, setPreferredLanguages] = useState<string[]>(
    profile?.preferredLanguages || ['English', 'Malayalam', 'Hindi', 'Tamil']
  );
  const [autoDeleteAudio, setAutoDeleteAudio] = useState(profile?.autoDeleteAudio ?? true);
  const [chunkDurationSec, setChunkDurationSec] = useState(profile?.chunkDurationSec || 20);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [clearingLocal, setClearingLocal] = useState(false);
  const [clearedMsg, setClearedMsg] = useState<string | null>(null);

  const toggleLanguage = (lang: string) => {
    setPreferredLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await refreshProfileUpdates({
        name: name.trim() || 'MisMinutez User',
        defaultReportLanguage,
        preferredLanguages,
        autoDeleteAudio,
        chunkDurationSec,
        theme,
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleClearLocalAudio = async () => {
    if (!user) return;
    setClearingLocal(true);
    try {
      const removed = await clearAllLocalRecordings(user.uid);
      await refreshLocalQueueStats();
      setClearedMsg(`Removed ${removed} local audio chunk${removed === 1 ? '' : 's'} from IndexedDB.`);
    } finally {
      setClearingLocal(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="pb-6 border-b border-slate-200 dark:border-slate-800">
        <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white">
          Settings
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Manage your profile, multilingual defaults, audio capture intervals, and local offline storage.
        </p>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Profile & Preferences */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
            Profile &amp; Report Defaults
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pref-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Display Name
              </label>
              <input
                id="pref-name"
                type="text"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Account Email
              </label>
              <input
                type="email"
                disabled
                value={profile?.email || user?.email || ''}
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-slate-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pref-lang" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Default Report Language
              </label>
              <select
                id="pref-lang"
                value={defaultReportLanguage}
                onChange={(e) => setDefaultReportLanguage(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                {REPORT_TRANSLATION_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Appearance Theme
              </label>
              <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-slate-800 w-full">
                <button
                  type="button"
                  onClick={() => void setTheme('light')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    theme === 'light'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" /> Light
                </button>
                <button
                  type="button"
                  onClick={() => void setTheme('dark')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    theme === 'dark'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" /> Dark
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
              Preferred Meeting Languages
            </p>
            <div className="flex flex-wrap gap-2">
              {PRIORITY_LANGUAGES.map((lang) => {
                const active = preferredLanguages.includes(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-600 text-blue-700 dark:text-blue-300'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {lang}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Audio Recording & Retention Settings */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
            Audio Recording &amp; Privacy
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label htmlFor="chunk-interval" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Live Audio Chunk Interval
              </label>
              <select
                id="chunk-interval"
                value={chunkDurationSec}
                onChange={(e) => setChunkDurationSec(Number(e.target.value))}
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <option value={15}>15 seconds (faster live transcript updates)</option>
                <option value={20}>20 seconds (recommended balance)</option>
                <option value={30}>30 seconds (better speaker continuity)</option>
                <option value={45}>45 seconds (lowest request overhead)</option>
              </select>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={autoDeleteAudio}
                onChange={(e) => setAutoDeleteAudio(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Automatically delete local IndexedDB audio chunks after server transcription confirmation
              </span>
            </label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
            {savedNotice && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </section>
      </form>

      {/* Local Offline Storage Management */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            Local Recording Storage (IndexedDB)
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {formatBytes(localBytesUsed)} · {pendingChunksCount} queued chunk{pendingChunksCount === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Audio recorded offline or awaiting retry is stored privately in your browser&apos;s IndexedDB. Once internet returns, chunks upload securely to the server-side Gemini transcription pipeline.
        </p>

        {clearedMsg && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">{clearedMsg}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!isOnline || syncingQueue || pendingChunksCount === 0}
            onClick={() => void syncPendingQueue()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingQueue ? 'animate-spin' : ''}`} />
            <span>{syncingQueue ? 'Syncing...' : 'Sync Queued Audio Now'}</span>
          </button>

          <button
            type="button"
            disabled={clearingLocal || localBytesUsed === 0}
            onClick={() => void handleClearLocalAudio()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{clearingLocal ? 'Clearing...' : 'Clear Local Audio Cache'}</span>
          </button>
        </div>
      </section>

      {/* Read-Only Backend AI Engine Status */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
            AI Processing Backend
          </h2>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
              aiProvider === 'self_hosted'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300'
            }`}
          >
            {aiProvider === 'self_hosted' ? 'Self-Hosted AI API Active' : 'Gemini Cloud Active'}
          </span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          {selfHostedConfigured
            ? 'Connected to your self-hosted Whisper + Ollama AI API server configured via server environment secrets. All transcription, minutes, chat, and translation requests route through your private backend.'
            : 'MisMinutez supports running your own zero-quota Self-Hosted AI API (Whisper + Ollama via /self-hosted-ai). Start the included server and set SELF_HOSTED_BASE_URL in your server environment secrets to switch automatically.'}
        </p>
      </section>

      {/* Privacy Notice & Sign Out */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Data Isolation &amp; AI Processing Transparency</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
            Audio chunks and transcripts are transmitted over HTTPS to your authenticated server endpoints for Gemini transcription and analysis. Voice biometrics are never used to identify real-world people.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-red-600 hover:border-red-300 dark:hover:border-red-800 cursor-pointer whitespace-nowrap shrink-0"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </section>
    </div>
  );
}
