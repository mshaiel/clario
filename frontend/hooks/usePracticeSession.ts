/**
 * usePracticeSession — Unified practice session state management
 *
 * Provides item-level navigation, progress tracking, attempt recording,
 * success criteria evaluation, and tensor updates for all 8 practice formats.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLanguage } from '@/context/LanguageContext';
import { auth } from '@/firebase';
import { UAB_API } from '@/lib/api';
import { onSentenceComplete } from '@/lib/gamificationService';
import { getActivePracticePlan, getExerciseItems, getPracticeCardById } from '@/lib/practiceSessionStore';
import type {
  CTMSuccessCriteria,
  PracticeExerciseCard,
} from '@/lib/practiceTypes';
import { deriveTestType, getDiagnosisInfo } from '@/lib/practiceUtils';
import { markSentenceComplete } from '@/lib/progressService';

type AttemptResult = 'correct' | 'incorrect' | 'skipped';

interface AttemptRecord {
  itemIndex: number;
  result: AttemptResult;
  timestamp: number;
  /** Optional rich details captured by the practice module (accuracy, disfluencies, etc.) */
  details?: Record<string, any>;
}

type SessionPhase = 'idle' | 'active' | 'complete';

interface PracticeSessionState {
  /** The resolved exercise card (null if exerciseId invalid) */
  card: PracticeExerciseCard | null;
  /** Raw payload from the card */
  payload: Record<string, any> | null;
  /** Extracted items array (works for all formats) */
  items: any[];
  /** Current item index */
  currentItemIndex: number;
  /** Total number of items */
  totalItems: number;
  /** Current item data */
  currentItem: any | null;
  /** Progress fraction 0–1 */
  progress: number;
  /** Human-readable progress label ("1 of 3") */
  progressLabel: string;
  /** Session phase */
  phase: SessionPhase;
  /** All attempt records */
  attempts: AttemptRecord[];
  /** Number of correct attempts for current item */
  currentItemCorrectStreak: number;
  /** Overall accuracy (0–1) */
  accuracy: number;
  /** Whether current level is complete (success criteria met) */
  isLevelComplete: boolean;
  /** Success criteria from the exercise */
  successCriteria: CTMSuccessCriteria;
  /** Exercise format key */
  format: string;
  /** Resolved target phoneme for the current session/item */
  targetPhoneme: string | null;
  /** Navigate to next item; returns false if at end */
  nextItem: () => boolean;
  /** Navigate to previous item */
  prevItem: () => void;
  /** Record an attempt on the current item, with optional module-specific detail payload */
  recordAttempt: (result: AttemptResult, details?: Record<string, any>) => void;
  /** Reset session to beginning */
  resetSession: () => void;
  /** Mark session as complete and trigger tensor update */
  completeSession: () => Promise<void>;
  /** Go to a specific item index */
  goToItem: (index: number) => void;
  /** Append an item to the end of the session */
  appendItem: (item: any) => void;
}

const DEFAULT_SUCCESS_CRITERIA: CTMSuccessCriteria = {
  accuracy_threshold: 0.8,
  consecutive_trials: 3,
};

export function usePracticeSession(): PracticeSessionState {
  const params = useLocalSearchParams<{ exerciseId?: string; resumeIndex?: string }>();
  const router = useRouter();
  const { language } = useLanguage();
  const user = auth.currentUser;

  // Resolve card and items
  const card = useMemo(() => {
    if (typeof params.exerciseId !== 'string') return null;
    return getPracticeCardById(params.exerciseId);
  }, [params.exerciseId]);

  const payload = card?.payload ?? null;

  const items = useMemo(() => {
    if (!card) return [];
    return getExerciseItems(card.id);
  }, [card]);

  const format = useMemo(() => {
    return String(payload?.items?.format ?? card?.backendFormat ?? '').toLowerCase().replace(/\s+/g, '_');
  }, [payload, card]);

  const successCriteria: CTMSuccessCriteria = useMemo(() => {
    const sc = payload?.items?.success_criteria ?? payload?.level?.success_criteria;
    if (sc && typeof sc.accuracy_threshold === 'number') return sc;
    return DEFAULT_SUCCESS_CRITERIA;
  }, [payload]);

  // Session state
  const initialIndex = useMemo(() => {
    const idx = parseInt(params.resumeIndex ?? '0', 10);
    return isNaN(idx) ? 0 : idx;
  }, [params.resumeIndex]);

  const [currentItemIndex, setCurrentItemIndex] = useState(initialIndex);
  
  useEffect(() => {
    setCurrentItemIndex(initialIndex);
  }, [initialIndex]);

  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [extraItems, setExtraItems] = useState<any[]>([]);
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const completedRef = useRef(false);

  // Computed values
  const allItems = useMemo(() => [...items, ...extraItems], [items, extraItems]);
  const totalItems = allItems.length;
  const currentItem = allItems[currentItemIndex] ?? null;

  const progress = totalItems > 0 ? (currentItemIndex + 1) / totalItems : 0;
  const progressLabel = totalItems > 0 ? `${currentItemIndex + 1} of ${totalItems}` : '0 of 0';

  const targetPhoneme = useMemo(() => {
    return String(
      currentItem?.target_phoneme ??
      payload?.items?.target_phoneme ??
      payload?.level?.target_phoneme ??
      payload?.target_phoneme ??
      payload?.setDiagnosis?.active_phonemes?.[0] ??
      ''
    ).trim() || null;
  }, [currentItem, payload]);

  // Accuracy computation
  const accuracy = useMemo(() => {
    if (attempts.length === 0) return 0;
    const correct = attempts.filter((a) => a.result === 'correct').length;
    return correct / attempts.length;
  }, [attempts]);

  // Current item consecutive correct streak
  const currentItemCorrectStreak = useMemo(() => {
    const itemAttempts = attempts
      .filter((a) => a.itemIndex === currentItemIndex)
      .map((a) => a.result);

    let streak = 0;
    for (let i = itemAttempts.length - 1; i >= 0; i--) {
      if (itemAttempts[i] === 'correct') {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }, [attempts, currentItemIndex]);

  // Level completion check
  const isLevelComplete = useMemo(() => {
    if (attempts.length === 0) return false;

    // Check if accuracy threshold is met
    if (accuracy < successCriteria.accuracy_threshold) return false;

    // Check consecutive trials across all items
    const recentResults = attempts.slice(-successCriteria.consecutive_trials).map((a) => a.result);
    if (recentResults.length < successCriteria.consecutive_trials) return false;

    return recentResults.every((r) => r === 'correct');
  }, [accuracy, attempts, successCriteria]);

  // Navigation
  const nextItem = useCallback((): boolean => {
    if (currentItemIndex >= totalItems - 1) return false;
    setCurrentItemIndex((prev) => prev + 1);
    if (phase === 'idle') setPhase('active');
    return true;
  }, [currentItemIndex, totalItems, phase]);

  const prevItem = useCallback(() => {
    setCurrentItemIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const goToItem = useCallback(
    (index: number) => {
      if (index >= 0 && index < totalItems) {
        setCurrentItemIndex(index);
      }
    },
    [totalItems]
  );

  const appendItem = useCallback((item: any) => {
    setExtraItems((prev) => [...prev, item]);
  }, []);

  // Record attempt
  const recordAttempt = useCallback(
    (result: AttemptResult, details?: Record<string, any>) => {
      if (phase === 'idle') setPhase('active');

      setAttempts((prev) => [
        ...prev,
        {
          itemIndex: currentItemIndex,
          result,
          timestamp: Date.now(),
          ...(details ? { details } : {}),
        },
      ]);

      if (result === 'correct' || result === 'incorrect') {
        const uid = user?.uid;
        if (uid) {
          const attemptAccuracy = result === 'correct' ? 100 : 0;
          // Record gamification stats (grants XP, records accuracy, increments exercise count)
          onSentenceComplete(uid, language, attemptAccuracy, false).catch((err) => {
             console.warn('[usePracticeSession] Gamification failed:', err);
          });
        }
      }

      if (result === 'correct') {
        const plan = getActivePracticePlan();
        const item = items[currentItemIndex];
        const sentenceId = item?.item_id || item?.id || item?.word;
        if (plan?.sessionId && sentenceId) {
          markSentenceComplete(plan.sessionId, sentenceId).catch((err) => {
            console.warn('[usePracticeSession] Failed to mark sentence complete:', err);
          });
        }
      }
    },
    [currentItemIndex, items, language, phase, user?.uid]
  );

  // Reset
  const resetSession = useCallback(() => {
    setCurrentItemIndex(0);
    setAttempts([]);
    setExtraItems([]);
    setPhase('idle');
    completedRef.current = false;
  }, []);

  // Complete session — batch-validate and update tensor via CUA
  const completeSession = useCallback(async () => {
    if (completedRef.current) return;
    setPhase('complete');

    const uid = user?.uid;
    // Guard: auth must be settled and there must be something to submit
    if (!uid || attempts.length === 0) return;

    // Only flip the gate AFTER guards pass — keeps the hook retryable on transient auth failures
    completedRef.current = true;

    try {
      const { errorName, majorType } = getDiagnosisInfo(card?.diagnosis, payload?.setDiagnosis);
      const position = String(card?.payload?.setDiagnosis?.position ?? 'Initial').toLowerCase() as 'initial' | 'medial' | 'final';
      const testId = String(card?.id ?? 'unknown');

      // Derive test_type from error_name — shared logic with usePracticeAnalysis
      const testType = deriveTestType(errorName, majorType) as any;

      // Accuracy: correct / total across session
      const correctCount = attempts.filter(a => a.result === 'correct').length;
      const overallAccuracy = Math.round((correctCount / attempts.length) * 100);

      // Build validated_errors from incorrect attempts that carry analysis details
      const validated_errors: any[] = [];
      const correct_phonemes: string[] = [];

      for (const attempt of attempts) {
        if (attempt.result === 'correct') {
          // Only emit a correct_phoneme when we have a real manifest phoneme — never a default 'k'
          if (targetPhoneme) correct_phonemes.push(targetPhoneme);
        } else {
          const d = attempt.details ?? {};

          if (d.flagged_words && Array.isArray(d.flagged_words) && d.flagged_words.length > 0) {
            // SODA/phonology errors from CAM analysis — most reliable source
            for (const fw of d.flagged_words as any[]) {
              validated_errors.push({
                sentence_id: d.sentence_id ?? testId,
                error_category: fw.error_category ?? 'phonology',
                error_type: fw.error_type ?? 'substitution',
                word: fw.word ?? '',
                index_in_sentence: fw.index_in_sentence ?? 0,
                expected_phoneme: fw.expected_phoneme ?? targetPhoneme ?? '?',
                heard_phoneme: fw.heard_phoneme ?? '?',
                position,
              });
            }
          } else if (d.disfluency_events && Array.isArray(d.disfluency_events) && d.disfluency_events.length > 0) {
            // Fluency/shadowing clinician-tagged disfluency events
            for (const ev of d.disfluency_events as { label: string; wordIndex?: number }[]) {
              const errType = ev.label === 'Block' ? 'block' : ev.label === 'Prolongation' ? 'prolongation' : 'stutter';
              validated_errors.push({
                sentence_id: d.sentence_id ?? testId,
                error_category: 'fluency',
                error_type: errType,
                word: '',
                index_in_sentence: ev.wordIndex ?? 0,
                block_duration_ms: 0,
                preceding_phoneme: null,
              });
            }
          }
          // No else-fallback: an incorrect attempt with no detail payload (e.g. a listening-mode
          // discrimination tap with no audio) is simply counted in overallAccuracy but does not
          // emit a fabricated error entry into the tensor.
        }
      }

      if (validated_errors.length === 0 && correct_phonemes.length === 0) {
        console.log('[usePracticeSession] Skipping validate-session: no phonology/fluency validation payload');
        return;
      }

      await UAB_API.validateSession({
        user_id: uid,
        test_id: testId,
        test_type: testType,
        overall_session_accuracy: overallAccuracy,
        validated_errors,
        correct_phonemes,
      });

      console.log(`[usePracticeSession] ✅ validate-session fired — accuracy=${overallAccuracy}% errors=${validated_errors.length}`);
    } catch (error) {
      // Reset gate so caller can retry on transient network failures
      completedRef.current = false;
      console.warn('[usePracticeSession] completeSession batch-validation failed:', error);
    }
  }, [user?.uid, language, attempts, payload, card]);



  return {
    card,
    payload,
    items: allItems,
    currentItemIndex,
    totalItems,
    currentItem,
    progress,
    progressLabel,
    phase,
    attempts,
    currentItemCorrectStreak,
    accuracy,
    isLevelComplete,
    successCriteria,
    format,
    nextItem,
    prevItem,
    recordAttempt,
    resetSession,
    completeSession,
    goToItem,
    appendItem,
    targetPhoneme,
  };
}
