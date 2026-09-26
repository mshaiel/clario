/**
 * Onboarding Context
 * Location: context/OnboardingContext.tsx
 *
 * ── Key fixes ────────────────────────────────────────────────────────────────
 *
 * FIX 1 — Per-language completion keys (solves the questionnaire loop).
 *
 *   Root cause: a single 'has_completed_onboarding' key was shared across both
 *   languages. resetForLanguageChange cleared it → switching BACK to English
 *   found no key → showed triage again even though English was already done.
 *
 *   Solution: two independent keys per user:
 *     'has_completed_onboarding_english'
 *     'has_completed_onboarding_urdu'
 *
 *   - completeOnboarding writes to the CURRENT language's key only.
 *   - resetForLanguageChange clears ONLY the NEW language's key.
 *     The other language's key is untouched → switching back skips triage.
 *   - initializeProfile reads the CURRENT language's key.
 *   - resetProfile (debug wipe) clears both keys.
 *
 * FIX 2 — `language` removed from initializeProfile deps.
 *   Any language state change in LanguageContext used to re-trigger
 *   initializeProfile, overwriting whatever resetForLanguageChange just set.
 *   Now it only runs on first load and uid changes. Current language is read
 *   via languageRef.current (always fresh via a sync side-effect).
 *
 * FIX 3 — langChangeInProgressRef guard.
 *   Prevents any in-flight initializeProfile from applying results after
 *   resetForLanguageChange has already committed new state.
 */

import { auth, db } from '@/firebase';
import { Language, QuestionnaireSelection, TargetPersona, TestType } from '@/lib/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, deleteDoc, getDocs } from 'firebase/firestore';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLanguage } from './LanguageContext';

export interface ClinicalProfile {
  targetLanguage: Language;
  target_persona: TargetPersona | null;
  primaryConcern: 'fluency' | 'phonology' | 'both' | 'unsure' | null;
  selections: QuestionnaireSelection[];
  completed: boolean;
}

export type OnboardingStep = 'language' | 'sound-check' | 'persona' | 'triage' | null;

interface OnboardingState {
  profile: ClinicalProfile;
  isLoading: boolean;
  isInitialized: boolean;
  isSyncing: boolean;
  onboardingStep: OnboardingStep;
}

interface OnboardingActions {
  setTargetPersona: (persona: TargetPersona) => void;
  setPrimaryConcern: (concern: ClinicalProfile['primaryConcern']) => void;
  toggleSubtype: (subtypeId: string) => void;
  togglePhonemeConstraint: (subtypeId: string, phoneme: string) => void;
  addAvoidanceWord: (subtypeId: string, word: string) => void;
  removeAvoidanceWord: (subtypeId: string, word: string) => void;
  resetProfile: () => Promise<void>;
  resetForLanguageChange: (newLanguage: Language) => Promise<{ needsQuestionnaire: boolean }>;
  completeOnboarding: () => void;
  saveProgress: () => Promise<void>;
  confirmLanguageAndProceed: (lang: Language) => void;
  confirmPersonaAndProceed: () => void;
  goBackToLanguage: () => void;
  addSelectionsFromWeights: (weightMap: Record<string, number>) => void;
  clearSelections: () => void;
  setPhaseASelections: (ids: string[]) => void;
}

const OnboardingStateContext = createContext<OnboardingState | undefined>(undefined);
const OnboardingDispatchContext = createContext<OnboardingActions | undefined>(undefined);

const DEFAULT_PROFILE: ClinicalProfile = {
  targetLanguage: 'english',
  target_persona: null,
  primaryConcern: null,
  selections: [],
  completed: false,
};

/** Per-language, per-user completion key — scoped to both UID and language so
 *  different accounts on the same device never share completion state. */
const completionKey  = (uid: string, lang: Language) => `@onboarding_done_${uid}_${lang}`;
/** WIP key scoped to the user so different accounts on the same device don't clash. */
const wipKey         = (uid: string) => `@onboarding_wip_${uid}`;
/** Persists the user's subtype selections AFTER onboarding completes, per language. */
const selectionsKey  = (uid: string, lang: Language) => `@onboarding_selections_${uid}_${lang}`;

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { language, isLanguageLoaded } = useLanguage();

  const [profile, setProfile] = useState<ClinicalProfile>(DEFAULT_PROFILE);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSyncing] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(null);

  const prevUidRef = useRef<string | null | undefined>(undefined);
  const [currentUid, setCurrentUid] = useState<string | null | undefined>(undefined);

  // Always-fresh ref — lets initializeProfile read current language without
  // needing `language` in the effect dependency array.
  const languageRef = useRef<Language>(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // Guard: raised during resetForLanguageChange to block any concurrent
  // initializeProfile from overriding the state we're setting.
  const langChangeInProgressRef = useRef(false);

  // ── Auth state tracking ───────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const newUid = user?.uid ?? null;
      if (prevUidRef.current === newUid) return;
      prevUidRef.current = newUid;
      setIsInitialized(false);
      setIsLoading(true);
      setProfile(DEFAULT_PROFILE);
      setOnboardingStep(null);
      setCurrentUid(newUid);
    });
    return unsubscribe;
  }, []);

  // ── Profile initialization ────────────────────────────────────────────────
  //
  // `language` is deliberately NOT in the dependency array — see FIX 2 above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isLanguageLoaded || currentUid === undefined) return;
    if (langChangeInProgressRef.current) return;

    const initializeProfile = async () => {
      setIsLoading(true);
      const lang = languageRef.current;

      if (!currentUid) {
        // No user logged in — reset to defaults. Step will be set to 'language'
        // once a user actually starts a fresh sign-up flow. For sign-out, the
        // root _layout.tsx routes to /login based on user===null, so step
        // doesn't matter here.
        setProfile({ ...DEFAULT_PROFILE, targetLanguage: lang });
        setOnboardingStep(null);
        setIsLoading(false);
        setIsInitialized(true);
        return;
      }

      try {
        // One-time migration: port old unscoped keys to the new uid-scoped key.
        // Old key 1 (pre-language): 'has_completed_onboarding'
        // Old key 2 (pre-uid-scope): 'has_completed_onboarding_english' / '_urdu'
        const oldKey1 = 'has_completed_onboarding';
        const oldKey2english = `has_completed_onboarding_english`;
        const oldKey2urdu    = `has_completed_onboarding_urdu`;
        const [old1, old2en, old2ur] = await Promise.all([
          AsyncStorage.getItem(oldKey1),
          AsyncStorage.getItem(oldKey2english),
          AsyncStorage.getItem(oldKey2urdu),
        ]);
        if (old1 === 'true') {
          await AsyncStorage.setItem(completionKey(currentUid, lang), 'true');
          await AsyncStorage.removeItem(oldKey1);
        }
        if (old2en === 'true') {
          await AsyncStorage.setItem(completionKey(currentUid, 'english'), 'true');
          await AsyncStorage.removeItem(oldKey2english);
        }
        if (old2ur === 'true') {
          await AsyncStorage.setItem(completionKey(currentUid, 'urdu'), 'true');
          await AsyncStorage.removeItem(oldKey2urdu);
        }

        // Read the CURRENT language's completion key (uid-scoped)
        const isCompleted = await AsyncStorage.getItem(completionKey(currentUid, lang));
        if (langChangeInProgressRef.current) return;

        if (isCompleted === 'true') {
          // Restore saved selections for this language so useTechniques can filter correctly
          let savedSelections: QuestionnaireSelection[] = [];
          try {
            const raw = await AsyncStorage.getItem(selectionsKey(currentUid, lang));
            if (raw) savedSelections = JSON.parse(raw);
          } catch (_) {}
          setProfile({ ...DEFAULT_PROFILE, targetLanguage: lang, completed: true, selections: savedSelections });
          setOnboardingStep(null);
          setIsLoading(false);
          setIsInitialized(true);
          return;
        }

        const wipData = await AsyncStorage.getItem(wipKey(currentUid));
        if (langChangeInProgressRef.current) return;

        if (wipData) {
          const parsed = JSON.parse(wipData);
          // Validate field types to reject corrupted WIP data from older app versions.
          const VALID_LANGUAGES = ['english', 'urdu'];
          const VALID_PERSONAS = ['child', 'teen', 'adult'];
          const safeLanguage = VALID_LANGUAGES.includes(parsed.targetLanguage) ? parsed.targetLanguage : lang;
          const safePersona = VALID_PERSONAS.includes(parsed.target_persona) ? parsed.target_persona : null;
          const safeSelections = Array.isArray(parsed.selections) ? parsed.selections : [];
          setProfile({
            ...DEFAULT_PROFILE,
            ...parsed,
            targetLanguage: safeLanguage as Language,
            target_persona: safePersona,
            selections: safeSelections,
          });
          setOnboardingStep('triage');
        } else {
          setProfile({ ...DEFAULT_PROFILE, targetLanguage: lang });
          setOnboardingStep('language');
        }
      } catch (error) {
        if (langChangeInProgressRef.current) return;
        setProfile({ ...DEFAULT_PROFILE, targetLanguage: languageRef.current });
        setOnboardingStep(currentUid ? 'language' : null);
      } finally {
        if (!langChangeInProgressRef.current) {
          setIsLoading(false);
          setIsInitialized(true);
        }
      }
    };

    initializeProfile();
  }, [isLanguageLoaded, currentUid]); // `language` intentionally excluded

  // ── Actions ───────────────────────────────────────────────────────────────

  const confirmLanguageAndProceed = useCallback((lang: Language) => {
    setProfile((prev) => ({ ...prev, targetLanguage: lang }));
    setOnboardingStep('sound-check');
  }, []);
  const confirmPersonaAndProceed  = useCallback(() => setOnboardingStep('triage'), []);
  const goBackToLanguage          = useCallback(() => setOnboardingStep('language'), []);

  const setTargetPersona = useCallback(
    (persona: TargetPersona) => setProfile((p) => ({ ...p, target_persona: persona })),
    []
  );

  const setPrimaryConcern = useCallback(
    (concern: ClinicalProfile['primaryConcern']) => setProfile((p) => ({ ...p, primaryConcern: concern })),
    []
  );

  const toggleSubtype = useCallback((subtypeId: string) => {
    setProfile((prev) => {
      const exists = prev.selections.some((s) => s.subtype === subtypeId);
      if (exists) {
        return { ...prev, selections: prev.selections.filter((s) => s.subtype !== subtypeId) };
      }
      const newSelection: QuestionnaireSelection = {
        primary_concern: prev.primaryConcern || 'phonology',
        subtype: subtypeId as TestType,
        focus_phonemes: [],
        danger_words: [],
      };
      return { ...prev, selections: [...prev.selections, newSelection] };
    });
  }, []);

  const togglePhonemeConstraint = useCallback((subtypeId: string, phoneme: string) => {
    setProfile((prev) => ({
      ...prev,
      selections: prev.selections.map((s) => {
        if (s.subtype !== subtypeId) return s;
        const exists = s.focus_phonemes.includes(phoneme);
        return {
          ...s,
          focus_phonemes: exists
            ? s.focus_phonemes.filter((p) => p !== phoneme)
            : [...s.focus_phonemes, phoneme],
        };
      }),
    }));
  }, []);

  const addAvoidanceWord = useCallback((subtypeId: string, word: string) => {
    setProfile((prev) => ({
      ...prev,
      selections: prev.selections.map((s) =>
        s.subtype !== subtypeId ? s : { ...s, danger_words: [...s.danger_words, word] }
      ),
    }));
  }, []);

  const removeAvoidanceWord = useCallback((subtypeId: string, word: string) => {
    setProfile((prev) => ({
      ...prev,
      selections: prev.selections.map((s) =>
        s.subtype !== subtypeId ? s : { ...s, danger_words: s.danger_words.filter((w) => w !== word) }
      ),
    }));
  }, []);

  const clearSelections = useCallback(() => {
    setProfile((prev) => ({ ...prev, selections: [] }));
  }, []);

  const setPhaseASelections = useCallback((ids: string[]) => {
    setProfile((prev) => ({
      ...prev,
      selections: ids.map((id) => ({
        primary_concern: (prev.primaryConcern === 'fluency' || prev.primaryConcern === 'phonology')
          ? prev.primaryConcern
          : 'both',
        subtype: id as TestType,
        focus_phonemes: [],
        danger_words: [],
      })),
    }));
  }, []);

  const addSelectionsFromWeights = useCallback((weightMap: Record<string, number>) => {
    const THRESHOLD = 1;
    setProfile((prev) => {
      const existingIds = new Set(prev.selections.map((s) => s.subtype));
      const qualifying = Object.entries(weightMap)
        .filter(([, w]) => w >= THRESHOLD)
        .map(([id]) => id)
        .filter((id) => !existingIds.has(id as any));
      if (qualifying.length === 0) return prev;
      const newSelections: QuestionnaireSelection[] = qualifying.map((id) => ({
        primary_concern: prev.primaryConcern || 'phonology',
        subtype: id as any,
        focus_phonemes: [],
        danger_words: [],
      }));
      return { ...prev, selections: [...prev.selections, ...newSelections] };
    });
  }, []);

  const saveProgress = useCallback(async () => {
    if (!currentUid) return;
    try {
      await AsyncStorage.setItem(wipKey(currentUid), JSON.stringify(profile));
    } catch (e) {
      console.error('Failed to save WIP profile:', e);
    }
  }, [profile, currentUid]);

  /** Full debug reset — clears ALL language completion keys. */
  const resetProfile = useCallback(async () => {
    setProfile({ ...DEFAULT_PROFILE, targetLanguage: languageRef.current, completed: false });
    setOnboardingStep('language');
    if (currentUid) {
      try {
        await AsyncStorage.removeItem(wipKey(currentUid));
        await AsyncStorage.removeItem(completionKey(currentUid, 'english'));
        await AsyncStorage.removeItem(completionKey(currentUid, 'urdu'));
        await AsyncStorage.removeItem(selectionsKey(currentUid, 'english'));
        await AsyncStorage.removeItem(selectionsKey(currentUid, 'urdu'));
      } catch (e) {
        console.error('Failed to reset local storage', e);
      }

      // Delete Firestore assessment data for this user
      const SUBCOLLECTIONS = ['assessment_plans', 'user_assessments', 'assessment_progress'];
      for (const sub of SUBCOLLECTIONS) {
        try {
          const col = collection(db, 'users', currentUid, sub);
          const snap = await getDocs(col);
          await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
        } catch (e) {
          console.error(`Failed to delete Firestore ${sub} for user ${currentUid}:`, e);
        }
      }
    }
  }, [currentUid]);

  /**
   * resetForLanguageChange
   *
   * Called from Settings when the user switches language.
   *
   * - If the target language was ALREADY completed: just switch context
   *   (set completed=true, clear step) — no questionnaire shown.
   * - If the target language is NEW / incomplete: reset questionnaire
   *   state and set onboardingStep='triage' (skip language/mic/persona).
   *
   * - Keeps:   target_persona (child/teen/adult) in both paths
   * - Leaves:  the OTHER language's completion key untouched
   */
  const resetForLanguageChange = useCallback(async (newLanguage: Language) => {
    // Raise guard FIRST — blocks any concurrent initializeProfile
    langChangeInProgressRef.current = true;

    // Check if the target language was already completed
    let alreadyCompleted = false;
    try {
      const val = currentUid
        ? await AsyncStorage.getItem(completionKey(currentUid, newLanguage))
        : null;
      alreadyCompleted = val === 'true';
    } catch (e) {
      console.error('Failed to read completion key:', e);
    }

    if (alreadyCompleted) {
      // Switching BACK to a completed language — no questionnaire needed
      let savedSelections: QuestionnaireSelection[] = [];
      try {
        if (currentUid) {
          const raw = await AsyncStorage.getItem(selectionsKey(currentUid, newLanguage));
          if (raw) savedSelections = JSON.parse(raw);
        }
      } catch (_) {}
      setProfile((prev) => ({
        ...prev,
        targetLanguage: newLanguage,
        primaryConcern: null,
        selections: savedSelections,
        completed: true,
      }));
      setOnboardingStep(null);
    } else {
      // Switching to a language that hasn't been completed yet
      setProfile((prev) => ({
        ...prev,
        targetLanguage: newLanguage,
        primaryConcern: null,
        selections: [],
        completed: false,
        // target_persona intentionally kept
      }));
      setOnboardingStep('triage');

      if (currentUid) {
        try {
          // Only clear the new language's key — the other stays intact
          await AsyncStorage.removeItem(completionKey(currentUid, newLanguage));
          await AsyncStorage.removeItem(wipKey(currentUid));
        } catch (e) {
          console.error('Failed to clear storage on language change:', e);
        }
      }
    }

    setIsLoading(false);
    setIsInitialized(true);
    langChangeInProgressRef.current = false;
    return { needsQuestionnaire: !alreadyCompleted };
  }, [currentUid]);

  /**
   * completeOnboarding
   *
   * Writes completion to the CURRENT language's key.
   * Other languages' keys are not affected.
   */
  const completeOnboarding = useCallback(async () => {
    const lang = languageRef.current;
    setProfile((prev) => ({ ...prev, completed: true }));
    setOnboardingStep(null);
    if (currentUid) {
      try {
        await AsyncStorage.setItem(completionKey(currentUid, lang), 'true');
        await AsyncStorage.removeItem(wipKey(currentUid));
        // Snapshot current selections so they survive app restarts
        setProfile((prev) => {
          AsyncStorage.setItem(
            selectionsKey(currentUid, lang),
            JSON.stringify(prev.selections)
          ).catch(() => {});
          return prev;
        });
      } catch (e) {
        console.error('Failed to persist completion:', e);
      }
    }
  }, [currentUid]);

  // ── Memoized context ──────────────────────────────────────────────────────

  const stateValue = useMemo(
    () => ({ profile, isLoading, isInitialized, isSyncing, onboardingStep }),
    [profile, isLoading, isInitialized, isSyncing, onboardingStep]
  );

  const dispatchValue = useMemo(
    () => ({
      setTargetPersona,
      setPrimaryConcern,
      toggleSubtype,
      togglePhonemeConstraint,
      addAvoidanceWord,
      removeAvoidanceWord,
      resetProfile,
      resetForLanguageChange,
      completeOnboarding,
      saveProgress,
      confirmLanguageAndProceed,
      confirmPersonaAndProceed,
      goBackToLanguage,
      addSelectionsFromWeights,
      clearSelections,
      setPhaseASelections,
    }),
    [
      setTargetPersona, setPrimaryConcern, toggleSubtype, togglePhonemeConstraint,
      addAvoidanceWord, removeAvoidanceWord, resetProfile, resetForLanguageChange,
      completeOnboarding, saveProgress, confirmLanguageAndProceed, confirmPersonaAndProceed, goBackToLanguage,
      addSelectionsFromWeights, clearSelections, setPhaseASelections,
    ]
  );

  return (
    <OnboardingStateContext.Provider value={stateValue}>
      <OnboardingDispatchContext.Provider value={dispatchValue}>
        {children}
      </OnboardingDispatchContext.Provider>
    </OnboardingStateContext.Provider>
  );
}

export function useOnboardingState() {
  const ctx = useContext(OnboardingStateContext);
  if (!ctx) throw new Error('useOnboardingState must be used within OnboardingProvider');
  return ctx;
}

export function useOnboardingActions() {
  const ctx = useContext(OnboardingDispatchContext);
  if (!ctx) throw new Error('useOnboardingActions must be used within OnboardingProvider');
  return ctx;
}

export function useOnboarding() {
  return { ...useOnboardingState(), ...useOnboardingActions() };
}
