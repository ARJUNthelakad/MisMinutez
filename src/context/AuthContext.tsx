import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { getOrCreateUserProfile, updateUserProfile } from '../lib/firestore';
import type { UserProfile } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  theme: 'light' | 'dark';
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  setTheme: (next: 'light' | 'dark') => Promise<void>;
  refreshProfileUpdates: (
    updates: Partial<
      Pick<
        UserProfile,
        'name' | 'defaultReportLanguage' | 'preferredLanguages' | 'theme' | 'autoDeleteAudio' | 'chunkDurationSec'
      >
    >
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    try {
      const saved = window.localStorage.getItem('misminutez_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // Ignore storage access errors
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem('misminutez_theme', theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthError(null);

      if (!firebaseUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        const userProf = await getOrCreateUserProfile({
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'MisMinutez User',
          email: firebaseUser.email || '',
        });
        setProfile(userProf);
        if (userProf.theme === 'dark' || userProf.theme === 'light') {
          setThemeState(userProf.theme);
        }
      } catch (err) {
        console.error('Failed to load user profile:', err);
        // Fallback in-memory profile so offline usage still works smoothly
        setProfile({
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || 'MisMinutez User',
          email: firebaseUser.email || '',
          defaultReportLanguage: 'English',
          preferredLanguages: ['English', 'Malayalam', 'Hindi', 'Tamil'],
          theme,
          autoDeleteAudio: true,
          chunkDurationSec: 20,
        });
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError(msg);
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setProfile(null);
  }, []);

  const setTheme = useCallback(
    async (next: 'light' | 'dark') => {
      setThemeState(next);
      if (user) {
        setProfile((prev) => (prev ? { ...prev, theme: next } : prev));
        try {
          await updateUserProfile(user.uid, { theme: next });
        } catch (err) {
          console.warn('Could not persist theme preference while offline:', err);
        }
      }
    },
    [user]
  );

  const refreshProfileUpdates = useCallback(
    async (
      updates: Partial<
        Pick<
          UserProfile,
          'name' | 'defaultReportLanguage' | 'preferredLanguages' | 'theme' | 'autoDeleteAudio' | 'chunkDurationSec'
        >
      >
    ) => {
      if (!user) return;
      if (updates.theme) setThemeState(updates.theme);
      setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
      await updateUserProfile(user.uid, updates);
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authError,
        theme,
        signInWithGoogle,
        logout,
        setTheme,
        refreshProfileUpdates,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
