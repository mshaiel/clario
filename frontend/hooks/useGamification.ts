/**
 * useGamification Hook
 * Location: hooks/useGamification.ts
 *
 * Fetches gamification data for the currently active language.
 * Re-fetches automatically on language change (no stale data cross-contamination).
 *
 * Performance Update:
 * - refetch() no longer sets isLoading:true — it silently updates the snapshot
 *   so the progress tab doesn't blink/flash a spinner on every focus event.
 * - isLoading is only true on the very first fetch (or after a language change).
 */

import { auth } from '@/firebase';
import { useLanguage } from '@/context/LanguageContext';
import { getGamificationSnapshot } from '@/lib/gamificationService';
import { DEFAULT_SNAPSHOT, GamificationSnapshot } from '@/lib/gamificationTypes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';

export interface UseGamificationResult {
  snapshot: GamificationSnapshot;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useGamification(): UseGamificationResult {
  const { language } = useLanguage();
  const [user, setUser] = useState(auth.currentUser);
  
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return unsub;
  }, []);

  const [snapshot, setSnapshot] = useState<GamificationSnapshot>(DEFAULT_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);

  // Track whether the very first fetch has completed
  const hasFetchedOnce = useRef(false);

  // Track the previously-fetched language so we can clear stale data on switch
  const prevLanguageRef = useRef(language);

  const fetchSnapshot = useCallback(async () => {
    if (!user) {
      setSnapshot(DEFAULT_SNAPSHOT);
      setIsLoading(false);
      hasFetchedOnce.current = true;
      return;
    }

    // Only show the loading spinner on the very first fetch (or after a language
    // change which resets hasFetchedOnce). Subsequent refetch() calls silently
    // update the snapshot so the UI doesn't blink on every tab focus.
    if (!hasFetchedOnce.current) {
      setIsLoading(true);
    }

    try {
      const data = await getGamificationSnapshot(user.uid, language);
      setSnapshot(data);
    } catch {
      setSnapshot(DEFAULT_SNAPSHOT);
    } finally {
      setIsLoading(false);
      hasFetchedOnce.current = true;
    }
  }, [user, language]);

  // Clear stale data immediately on language change, then re-fetch
  useEffect(() => {
    if (prevLanguageRef.current !== language) {
      prevLanguageRef.current = language;
      hasFetchedOnce.current = false; // force loading spinner on lang switch
      setSnapshot(DEFAULT_SNAPSHOT);
      setIsLoading(true);
    }
    fetchSnapshot();
  }, [language, fetchSnapshot]);

  return { snapshot, isLoading, refetch: fetchSnapshot };
}
