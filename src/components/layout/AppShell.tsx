import React from 'react';
import {
  LayoutDashboard,
  Mic,
  History,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  RefreshCw,
  Sun,
  Moon,
  Plus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConnectivity } from '../../context/ConnectivityContext';
import type { AppRoute } from '../../types';

interface AppShellProps {
  route: AppRoute;
  onNavigate: (next: AppRoute) => void;
  breadcrumb: string;
  children: React.ReactNode;
}

export function AppShell({ route, onNavigate, breadcrumb, children }: AppShellProps) {
  const { profile, user, theme, setTheme, logout } = useAuth();
  const {
    isOnline,
    pendingChunksCount,
    syncingQueue,
    syncProgressText,
    syncPendingQueue,
  } = useConnectivity();

  const navItems: Array<{ id: AppRoute['view']; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'new-meeting', label: 'New Meeting', icon: Mic },
    { id: 'history', label: 'History', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const isNavActive = (viewId: AppRoute['view']) => {
    if (viewId === 'history' && route.view === 'results') return true;
    if (viewId === 'new-meeting' && route.view === 'live-room') return true;
    return route.view === viewId;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-30">
        <div className="h-16 px-6 flex items-center border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => onNavigate({ view: 'dashboard' })}
            className="flex items-center gap-2.5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
          >
            <div className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center font-display font-bold text-sm tracking-tight shrink-0">
              M
            </div>
            <span className="font-display font-bold text-lg tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              MisMinutez
            </span>
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate({ view: item.id } as AppRoute)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Real Connectivity & Offline Queue Status */}
        <div className="px-4 py-3 mx-3 mb-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  Connected
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  Offline mode
                </>
              )}
            </span>
            {pendingChunksCount > 0 && (
              <span className="font-mono text-xs text-amber-700 dark:text-amber-400 tabular-nums">
                {pendingChunksCount} queued
              </span>
            )}
          </div>
          {pendingChunksCount > 0 && (
            <button
              type="button"
              disabled={!isOnline || syncingQueue}
              onClick={() => void syncPendingQueue()}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingQueue ? 'animate-spin' : ''}`} />
              {syncingQueue ? 'Syncing queue...' : isOnline ? 'Sync local audio' : 'Waiting for internet'}
            </button>
          )}
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {profile?.name || user?.displayName || 'Workspace User'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {profile?.email || user?.email || ''}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label="Sign out"
              className="p-2 rounded-lg text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Contextual Top Header */}
        <header className="sticky top-0 z-20 h-14 lg:h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate({ view: 'dashboard' })}
              className="lg:hidden w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center font-display font-bold text-sm shrink-0"
            >
              M
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 dark:text-slate-500">Workspace</span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
              <span className="font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                {breadcrumb}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {!isOnline && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
                <WifiOff className="w-3.5 h-3.5" />
                Offline — Recording locally
              </span>
            )}
            <button
              type="button"
              onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {route.view !== 'new-meeting' && route.view !== 'live-room' && (
              <button
                type="button"
                onClick={() => onNavigate({ view: 'new-meeting' })}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg bg-blue-700 text-white hover:bg-blue-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Start Meeting</span>
              </button>
            )}
          </div>
        </header>

        {/* Active Offline Queue Sync Banner */}
        {syncProgressText && (
          <div className="bg-blue-50 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-900 px-4 sm:px-8 py-2.5 flex items-center gap-2.5 text-xs sm:text-sm text-blue-800 dark:text-blue-200">
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <span>{syncProgressText}</span>
          </div>
        )}

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 pb-24 lg:pb-12">
          {children}
        </main>
      </div>

      {/* Compact Mobile Bottom Nav (strictly <= 60px, well under 15% mobile sticky cap) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 h-14 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 z-30">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate({ view: item.id } as AppRoute)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
