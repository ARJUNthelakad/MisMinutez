import React, { useState } from 'react';
import {
  Mic,
  Languages,
  FileCheck2,
  WifiOff,
  ShieldCheck,
  ArrowRight,
  Users,
  MessageSquareText,
  FileDown,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const HERO_IMAGE_PATH = '/src/assets/images/hero_meeting_room_1795355939847.jpg';

const MULTILINGUAL_SAMPLE = [
  {
    speaker: 'Speaker 1',
    language: 'English',
    time: '00:04',
    original: 'We need to finalize the API contract before Friday afternoon.',
    english: 'We need to finalize the API contract before Friday afternoon.',
  },
  {
    speaker: 'Speaker 2',
    language: 'Malayalam + English',
    time: '00:11',
    original: 'നമുക്ക് ആദ്യം backend development തീർക്കണം, then run tests.',
    english: 'We need to finish backend development first, then run tests.',
  },
  {
    speaker: 'Speaker 3',
    language: 'Hindi',
    time: '00:19',
    original: 'लेकिन database integration अभी बाकी है।',
    english: 'But database integration is still pending.',
  },
  {
    speaker: 'Speaker 4',
    language: 'Tamil',
    time: '00:26',
    original: 'நான் நாளை மாலைக்குள் schema முடித்துவிடுகிறேன்.',
    english: 'I will finish the schema by tomorrow evening.',
  },
];

const SUPPORTED_LANGUAGES = [
  { name: 'English', script: 'English', region: 'Global' },
  { name: 'Malayalam', script: 'മലയാളം', region: 'South India' },
  { name: 'Hindi', script: 'हिन्दी', region: 'India' },
  { name: 'Tamil', script: 'தமிழ்', region: 'South India' },
  { name: 'Kannada', script: 'ಕನ್ನಡ', region: 'South India' },
  { name: 'Telugu', script: 'తెలుగు', region: 'South India' },
  { name: 'Arabic', script: 'العربية', region: 'MENA' },
];

export function LandingPage() {
  const { signInWithGoogle, authError } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const handleAuth = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch {
      // Error surfaced via authError
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display font-bold text-lg tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            MisMinutez
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a href="#how-it-works" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#languages" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Languages
            </a>
            <a href="#capabilities" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#privacy-offline" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Offline &amp; Privacy
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleAuth}
              disabled={signingIn}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {signingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="top" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 lg:pt-20 lg:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
              Built for physical, face-to-face meetings
            </p>
            <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-slate-900 dark:text-white leading-[1.1] [text-wrap:balance]">
              Every Language. Every Voice. One Clear Meeting Summary.
            </h1>
            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
              Place your laptop or phone on the table. MisMinutez captures room audio through the built-in microphone, separates anonymous speakers, detects multilingual code-switching, translates to English, and writes structured minutes automatically.
            </p>

            {authError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
                {authError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                type="button"
                onClick={handleAuth}
                disabled={signingIn}
                className="inline-flex items-center gap-2.5 px-6 py-3 text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>{signingIn ? 'Opening workspace...' : 'Start a Meeting with Google'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-900 transition-colors whitespace-nowrap"
              >
                See How It Works
              </a>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>Built-in mic capture</span>
              <span aria-hidden="true">·</span>
              <span>Offline IndexedDB recovery</span>
              <span aria-hidden="true">·</span>
              <span>No Zoom or Meet bot required</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[300px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
              {!imgFailed ? (
                <img
                  src={HERO_IMAGE_PATH}
                  alt="Diverse team collaborating around a physical table with a laptop recording their meeting"
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center p-8 text-center bg-slate-100 dark:bg-slate-900">
                  <Mic className="w-10 h-10 text-blue-700 dark:text-blue-400 mb-3" />
                  <p className="font-display font-semibold text-slate-800 dark:text-slate-200">
                    Physical Room Audio Capture
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                    One device microphone in the center of the room captures every speaker and language.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 py-16 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white">
              From multilingual room conversation to signed-off minutes
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mt-3 text-base">
              Designed for real meeting rooms where participants naturally switch between regional languages and English.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                step: '01',
                title: 'Capture Room Audio',
                body: 'Record directly from your laptop or phone built-in mic with pre-meeting audio testing, waveform level meter, and local IndexedDB chunk backup.',
              },
              {
                step: '02',
                title: 'Detect Languages & Speakers',
                body: 'Each speech segment is diarized with anonymous labels (Speaker 1, Speaker 2) and tagged with its detected language or code-switched pair.',
              },
              {
                step: '03',
                title: 'Translate & Extract Minutes',
                body: 'Original scripts are preserved alongside faithful English translations. Gemini extracts summaries, classified decisions, tasks, risks, and open questions.',
              },
              {
                step: '04',
                title: 'Query, Translate & Export',
                body: 'Ask grounded questions with speaker timestamps, translate the finished report into regional languages, draft follow-up emails, or download a PDF.',
              },
            ].map((item) => (
              <div key={item.step} className="space-y-2.5">
                <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                  {item.step}
                </span>
                <h3 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                  {item.title}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported Languages & Code-Switching Preview */}
      <section id="languages" className="py-16 lg:py-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-5 space-y-6">
            <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white">
              Built for code-switching conversations
            </h2>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              MisMinutez never assumes a room speaks only one language. Speakers can move seamlessly between Malayalam, Hindi, Tamil, Kannada, Telugu, Arabic, and English — even mid-sentence.
            </p>
            <div className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <div key={lang.name} className="py-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{lang.name}</span>
                  <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                    <span>{lang.script}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-xs">{lang.region}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                  Example Multilingual Transcript Output
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Original spoken script preserved beside unified English translation
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                4 speakers · 4 languages
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {MULTILINGUAL_SAMPLE.map((row, idx) => (
                <div key={idx} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{row.speaker}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-blue-700 dark:text-blue-400 font-medium">{row.language}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{row.time}</span>
                  </div>
                  <p className="text-sm text-slate-900 dark:text-slate-100">{row.original}</p>
                  {row.original !== row.english && (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      English: {row.english}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Feature Highlights */}
      <section id="capabilities" className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 py-16 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-white mb-10">
            Structured meeting intelligence, grounded in evidence
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: FileCheck2,
                title: 'Decision Classification',
                desc: 'Separates confirmed final decisions from proposals, pending items, and rejected ideas with transcript references.',
              },
              {
                icon: Users,
                title: 'Anonymous Speaker Diarization',
                desc: 'Assigns Speaker 1, Speaker 2 labels without voice biometric profiling. Assign real names manually whenever you choose.',
              },
              {
                icon: MessageSquareText,
                title: 'Ask Your Meeting AI Chat',
                desc: 'Query any past meeting with strict grounding. Every answer cites speakers and timestamps — or states clearly when something was not discussed.',
              },
              {
                icon: Languages,
                title: 'Multilingual Report Translation',
                desc: 'Generate minutes in English and translate the full report into Malayalam, Hindi, Tamil, Kannada, Telugu, or Arabic while keeping the English original.',
              },
              {
                icon: WifiOff,
                title: 'Offline-First Audio Queue',
                desc: 'Keep recording if campus or office Wi-Fi drops. Audio chunks save locally in IndexedDB and resume processing automatically when reconnected.',
              },
              {
                icon: FileDown,
                title: 'PDF Export & Follow-Up Email',
                desc: 'Export a clean formatted PDF report (with optional full transcript appendix) and generate editable follow-up emails.',
              },
            ].map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
                >
                  <Icon className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                  <h3 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                    {feat.title}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {feat.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Privacy & Offline Section */}
      <section id="privacy-offline" className="py-16 lg:py-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>Privacy-first &amp; transparent offline handling</span>
            </div>
            <h2 className="font-display font-bold text-2xl tracking-tight text-slate-900 dark:text-white">
              Your room recordings stay private and under your control
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              MisMinutez requests explicit microphone permission and notifies everyone in the room while recording is active. Audio chunks captured offline are stored locally in your browser&apos;s IndexedDB and sent to the cloud AI pipeline only after you are online. API keys remain strictly server-side, meeting records are locked to your authenticated account, and local audio chunks can be auto-deleted after server confirmation or cleared anytime in Settings.
            </p>
          </div>
          <div className="lg:col-span-4 flex lg:justify-end">
            <button
              type="button"
              onClick={handleAuth}
              disabled={signingIn}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>Open MisMinutez</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-display font-semibold text-slate-700 dark:text-slate-300">
            MisMinutez — Every Language. Every Voice. One Clear Meeting Summary.
          </span>
          <span>Built for physical multilingual meetings</span>
        </div>
      </footer>
    </div>
  );
}
