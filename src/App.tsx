import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ConnectivityProvider } from './context/ConnectivityContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/landing/LandingPage';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { NewMeetingPage } from './components/meeting/NewMeetingPage';
import { LiveMeetingRoom } from './components/meeting/LiveMeetingRoom';
import { MeetingResultsPage } from './components/reports/MeetingResultsPage';
import { MeetingHistoryPage } from './components/history/MeetingHistoryPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { subscribeUserActionItems, subscribeUserMeetings } from './lib/firestore';
import type { ActionItem, AppRoute, Meeting, MeetingType } from './types';

interface LiveSessionConfig {
  selectedDeviceId: string;
  expectedLanguages: string[];
  title: string;
  description: string;
  meetingType: MeetingType;
  attendees: string[];
  venue: string;
  startedAt: string;
  preferredOutputLanguage: string;
}

function MisMinutezWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const [route, setRoute] = useState<AppRoute>({ view: 'dashboard' });
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [liveConfigs, setLiveConfigs] = useState<Record<string, LiveSessionConfig>>({});

  useEffect(() => {
    if (!user) {
      setMeetings([]);
      setActionItems([]);
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    let meetingsReady = false;
    let actionsReady = false;

    const checkReady = () => {
      if (meetingsReady && actionsReady) setDataLoading(false);
    };

    const unsubMeetings = subscribeUserMeetings(
      user.uid,
      (rows) => {
        setMeetings(rows);
        meetingsReady = true;
        checkReady();
      },
      (err) => {
        console.error('Meetings subscription error:', err);
        meetingsReady = true;
        checkReady();
      }
    );

    const unsubActions = subscribeUserActionItems(
      user.uid,
      (rows) => {
        setActionItems(rows);
        actionsReady = true;
        checkReady();
      },
      (err) => {
        console.error('Action items subscription error:', err);
        actionsReady = true;
        checkReady();
      }
    );

    return () => {
      unsubMeetings();
      unsubActions();
    };
  }, [user]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-700 text-white flex items-center justify-center font-display font-bold text-base">
            M
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Loading MisMinutez...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  const getBreadcrumb = (): string => {
    switch (route.view) {
      case 'dashboard':
        return 'Dashboard';
      case 'new-meeting':
        return 'New Meeting';
      case 'live-room':
        return 'Live Meeting Room';
      case 'results':
        return 'Meeting Report';
      case 'history':
        return 'Meeting History';
      case 'settings':
        return 'Settings';
      default:
        return 'Workspace';
    }
  };

  return (
    <AppShell route={route} onNavigate={setRoute} breadcrumb={getBreadcrumb()}>
      {route.view === 'dashboard' && (
        <DashboardPage
          meetings={meetings}
          actionItems={actionItems}
          loading={dataLoading}
          onNavigate={setRoute}
        />
      )}

      {route.view === 'new-meeting' && (
        <NewMeetingPage
          onNavigate={setRoute}
          onStartLiveRoom={(meetingId, config) => {
            setLiveConfigs((prev) => ({ ...prev, [meetingId]: config }));
            setRoute({ view: 'live-room', meetingId });
          }}
        />
      )}

      {route.view === 'live-room' && (
        <LiveMeetingRoom
          meetingId={route.meetingId}
          initialConfig={liveConfigs[route.meetingId]}
          onNavigate={setRoute}
        />
      )}

      {route.view === 'results' && (
        <MeetingResultsPage
          meetingId={route.meetingId}
          allActionItems={actionItems}
          onNavigate={setRoute}
        />
      )}

      {route.view === 'history' && (
        <MeetingHistoryPage
          meetings={meetings}
          loading={dataLoading}
          onNavigate={setRoute}
        />
      )}

      {route.view === 'settings' && <SettingsPage />}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConnectivityProvider>
          <MisMinutezWorkspace />
        </ConnectivityProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
