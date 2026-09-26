/**
 * Detection Session
 * Location: components/detection/DetectionSession.tsx
 *
 * Fixed:
 * 1. Intro audio (fresh / resume) now plays on session start.
 * 2. Full-sentence audio (s_101_full.mp3) now plays when a sentence loads.
 * 3. Completion audio plays before the session ends.
 * 4. assistant_text / assistant_audio_url are stripped from validated errors
 *    before batch submission (as per UAB spec).
 * 5. Each validated error now carries sentence_id (required by spec).
 * 6. overall_session_accuracy is calculated and sent in validateSession payload.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  InteractionManager,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import Animated, { FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAICoPilot } from '@/context/AICoPilotContext';
import { useLanguage } from '@/context/LanguageContext';
import { auth } from '@/firebase';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useRecordingTimer } from '@/hooks/useRecordingTimer';
import { UAB_API, USE_MOCK } from '@/lib/api';
import { TEST_TYPE_LABELS } from '@/lib/constants';
import { getSentenceById, getSentenceIdsByType } from '@/lib/dataMap';
import { onSentenceComplete, onSessionComplete } from '@/lib/gamificationService';
import { getResumeIndex, markSentenceComplete } from '@/lib/progressService';
import { ttsService } from '@/lib/ttsService';
import type {
  AnalysisResponse,
  FlaggedWord,
  ModuleAssistantLines,
  ModuleData,
  TestType,
  ValidatedError,
} from '@/lib/types';
import { useAppTheme } from '@/theme-provider';
const MOCK_MODE = USE_MOCK;

import { clarioAssistant } from '@/lib/clarioAssistant';
import { AICoPilotToggle, AI_ACCENT } from './AICoPilotToggle';
import { AIFeedbackBubble } from './AIFeedbackBubble';
import { AnalysingOverlay } from './AnalysingOverlay';
import { RecordButton } from './RecordButton';
import { ResultsDisplay } from './ResultsDisplay';
import { SegmentDots } from './SegmentDots';
import { SentenceDisplay } from './SentenceDisplay';
import { TimerDisplay } from './TimerDisplay';
import { ParagraphModeSession } from './ParagraphModeSession';


interface Props {
  moduleId: string;
  testType: TestType;
  onEnd: () => void;
  /**
   * Optional: sentence IDs pre-loaded from bundled JSON (mock mode).
   * When provided, DetectionSession skips the OTA zip read entirely and uses
   * getSentenceById() from dataMap.ts to resolve each sentence.
   */
  bundledSentenceIds?: string[];
  /**
   * Optional: whether the session should start in paragraph mode instead of individual mode.
   * This is decided in the pre-session modal and locked in for the duration of the session.
   */
  initialParagraphMode?: boolean;
}

// ── Helper: strip dynamic coaching keys before batch submission ───────────────
// Per UAB spec: assistant_text and assistant_audio_url must be omitted.
// Per UAB spec: sentence_id must be added to each validated error.
function stripToValidatedError(
  error: FlaggedWord,
  sentenceId: string,
  sentenceLength: number
): ValidatedError {
  const position: 'initial' | 'medial' | 'final' =
    error.index_in_sentence === 0
      ? 'initial'
      : error.index_in_sentence >= sentenceLength - 1
      ? 'final'
      : 'medial';

  // Build a base stripped object
  const base = {
    sentence_id: sentenceId,
    word: error.word,
    index_in_sentence: error.index_in_sentence,
    position,
    error_category: error.error_category,
    error_type: error.error_type,
  };

  if (error.error_category === 'phonology') {
    return {
      ...base,
      error_category: 'phonology',
      error_type: error.error_type as any,
      expected_phoneme: (error as any).expected_phoneme,
      heard_phoneme: (error as any).heard_phoneme,
    };
  }

  if (error.error_type === 'prolongation') {
    return {
      ...base,
      error_category: 'fluency',
      error_type: 'prolongation',
      phoneme_prolonged: (error as any).phoneme_prolonged,
      duration_ms: (error as any).duration_ms,
    };
  }

  if (error.error_type === 'stutter') {
    return {
      ...base,
      error_category: 'fluency',
      error_type: 'stutter',
      phonemes_stuttered: (error as any).phonemes_stuttered,
      repetition_count: (error as any).repetition_count,
    };
  }

  // block
  return {
    ...base,
    error_category: 'fluency',
    error_type: 'block',
    block_duration_ms: (error as any).block_duration_ms,
    preceding_phoneme: (error as any).preceding_phoneme ?? null,
  };
}

// ── Main Session ──────────────────────────────────────────────────

export function DetectionSession({ moduleId, testType, onEnd, bundledSentenceIds, initialParagraphMode = false }: Props) {
  const { resolvedTheme } = useAppTheme();
  const { aiEnabled, setAiEnabled } = useAICoPilot();
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg = aiEnabled
    ? (isDark ? '#0D0B18' : '#ECE8FD')
    : (isDark ? '#0C0F14' : '#F2F5F9');
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#59677A';
  const surface = isDark ? '#1A2030' : '#FFFFFF';
  const border  = isDark ? '#2A3448' : '#D1D8E2';

  // ── State ─────────────────────────────────────────────────────────────────
  const [isLoadingManifest, setIsLoadingManifest] = useState(true);
  const [moduleUri, setModuleUri] = useState('');
  const [sentenceIds, setSentenceIds] = useState<string[]>([]);
  const [assistantLines, setAssistantLines] = useState<ModuleAssistantLines | null>(null);
  // Store sentence-level audio map: sentenceId → full_sentence audio path
  const [sentenceAudioMap, setSentenceAudioMap] = useState<Record<string, string>>({});
  // Store word-level audio map: "sentenceId:wordIndex" → audio path
  const [wordAudioMap, setWordAudioMap] = useState<Record<string, string>>({});
  // Store full sentence objects from OTA zip's data.json (for text/targets lookup in real mode)
  const [otaSentences, setOtaSentences] = useState<Record<string, import('@/lib/types').Sentence>>({});

  const [currentIndex, setCurrentIndex] = useState(0);
  // Assessment display mode: individual (existing) or paragraph (new)
  const [assessmentMode] = useState<'individual' | 'paragraph'>(
    initialParagraphMode ? 'paragraph' : 'individual'
  );
  const [isAnalyzeLoading, setIsAnalyzeLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [isSilentResult, setIsSilentResult] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [paragraphSessionKey, setParagraphSessionKey] = useState(0);

  // Reactive TTS playback state — subscribes to ttsService via listener so
  // the "Tap to interrupt" button actually disappears when audio stops.
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  useEffect(() => {
    const unsub = ttsService.onPlaybackChange((playing) => setIsAssistantSpeaking(playing));
    return unsub;
  }, []);

  // Stop all audio immediately when the session unmounts (back navigation,
  // session end, or any other exit path).
  useEffect(() => {
    return () => {
      ttsService.stopPlayback();
      clarioAssistant.stop();
    };
  }, []);

  // AI bubble — message shown under the sentence after analysis lands
  const [aiBubbleMessage, setAiBubbleMessage] = useState<string | null>(null);
  const [aiBubbleAudioUrl, setAiBubbleAudioUrl] = useState<string | null>(null);

  // Waiting bubble — shown inside AnalysingOverlay while analysis is in-flight
  const [waitingBubbleMessage, setWaitingBubbleMessage] = useState<string | null>(null);

  // Track whether this is a fresh start or resume (for intro audio selection)
  const isResumeRef = useRef(false);

  // Clear the bubble when AI mode is toggled off
  useEffect(() => {
    if (!aiEnabled) {
      setAiBubbleMessage(null);
    }
  }, [aiEnabled]);

  // Accumulation of validated errors across sentences (for batch submission)
  // Each entry is already stripped and carries sentence_id
  const [accumulatedErrors, setAccumulatedErrors] = useState<ValidatedError[]>([]);
  const [accumulatedCorrectPhonemes, setAccumulatedCorrectPhonemes] = useState<string[]>([]);

  // Running accuracy sum for overall_session_accuracy calculation
  const accuracyRunningRef = useRef<number[]>([]);

  // Guard against double-tap on Continue (prevents duplicate sentence advance)
  const isContinuingRef = useRef(false);

  // Shimmer animation for progress bar
  const shimmerX = useSharedValue(-200);
  useEffect(() => {
    shimmerX.value = withRepeat(
      withSequence(
        withTiming(400, { duration: 1600 }),
        withTiming(-200, { duration: 0 })
      ),
      -1
    );
  }, []);
  const shimmerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shimmerX.value }] }));

  const { isRecording, metering, startRecording, stopRecording, clearRecording } =
    useAudioRecorder();

  // ── 1. Load Module Data (OTA zip OR bundled JSON fallback) ─────────────────
  useEffect(() => {
    const initModule = async () => {
      try {
        // ── MOCK / BUNDLED PATH ──────────────────────────────────────────────────
        // When bundledSentenceIds is provided (mock mode), skip the OTA zip
        // read entirely and use the pre-loaded bundled sentence IDs.
        if (bundledSentenceIds && bundledSentenceIds.length > 0) {
          setSentenceIds(bundledSentenceIds);
          // No moduleUri, no audio maps — audio features are silent in mock mode
          setModuleUri('');
          setSentenceAudioMap({});
          setWordAudioMap({});
          setOtaSentences({});
          setAssistantLines(null);
          // Resume from the first incomplete sentence
          const resumeIdx = await getResumeIndex(moduleId, bundledSentenceIds);
          if (resumeIdx > 0) {
            setCurrentIndex(resumeIdx);
            isResumeRef.current = true;
          } else {
            isResumeRef.current = false;
          }
          setIsLoadingManifest(false);
          return;
        }

        // ── OTA ZIP PATH ─────────────────────────────────────────────────────────
        const FS: any = FileSystem;
        const docDir = FS.documentDirectory;
        if (!docDir) throw new Error('File system unavailable');

        // Path must be user-scoped to match DownloadContext's modulePath()
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error('No authenticated user');
        const targetUri = `${docDir}modules/${currentUser.uid}/${moduleId}/`;
        setModuleUri(targetUri);

        const dataJson = await FileSystem.readAsStringAsync(`${targetUri}data.json`);
        const parsedData = JSON.parse(dataJson) as ModuleData;

        setAssistantLines(parsedData.assistant_lines);

        const ids = parsedData.sentences.map((s: any) => s.sentence_id || (s as any).id || '');
        setSentenceIds(ids);

        // Resume: jump to the first sentence the user hasn't completed yet
        const resumeIdx = await getResumeIndex(moduleId, ids);
        if (resumeIdx > 0) {
          setCurrentIndex(resumeIdx);
          isResumeRef.current = true;
        }

        // Build audio lookup maps from the data.json sentences.
        // Strip any absolute prefix (file://…/modules/{uid}/{moduleId}/) that the
        // backend ZIP may have baked into the paths — we always want relative paths
        // so that `${moduleUri}${path}` never double-prefixes.
        const sentAudio: Record<string, string> = {};
        const wordAudio: Record<string, string> = {};

        const stripAbsolutePrefix = (p: string): string => {
          // If the path starts with 'file://' or '/' it is absolute — extract
          // only the part after the moduleId folder so it becomes relative.
          if (!p) return p;
          // e.g. "file:///data/.../modules/uid/moduleId/audio/sentence/x.wav"
          //   or "/data/.../modules/uid/moduleId/audio/sentence/x.wav"
          const marker = `${moduleId}/`;
          const idx = p.indexOf(marker);
          if (idx !== -1) return p.slice(idx + marker.length);
          // Already relative (no absolute prefix found)
          return p;
        };

        parsedData.sentences.forEach((sentence: any) => {
          const sid = sentence.sentence_id || (sentence as any).id || '';
          if (sentence.audio?.full_sentence) {
            sentAudio[sid] = stripAbsolutePrefix(sentence.audio.full_sentence);
          }
          sentence.audio?.words?.forEach((w: any, idx: number) => {
            // Backend data.json uses audio_path (not audio_url) for word-level audio
            const wordPath = w.audio_path ?? w.audio_url; // audio_path is canonical; audio_url kept as fallback
            if (wordPath) {
              wordAudio[`${sid}:${idx}`] = stripAbsolutePrefix(wordPath);
            }
          });
        });

        setSentenceAudioMap(sentAudio);
        setWordAudioMap(wordAudio);

        // Store full sentence objects for text/targets lookup (avoids relying on bundled JSON)
        const sentObjMap: Record<string, import('@/lib/types').Sentence> = {};
        parsedData.sentences.forEach((s: any) => {
          const sid = s.sentence_id || s.id || '';
          if (sid) sentObjMap[sid] = s;
        });
        setOtaSentences(sentObjMap);

      } catch (e) {
        console.error('[DetectionSession] Failed to load OTA module data, trying bundled fallback:', e);
        // OTA zip not found — fall back to bundled sentence IDs for this test type + current language
        const fallbackIds = getSentenceIdsByType(testType, language);
        if (fallbackIds.length > 0) {
          setSentenceIds(fallbackIds);
        }
        setModuleUri('');
      } finally {
        setIsLoadingManifest(false);
      }
    };
    initModule();
  }, [moduleId, bundledSentenceIds, language]);

  // ── 2. Play Intro Audio Once Module is Ready ──────────────────────────────
  // After the intro finishes, play the first sentence audio so they are
  // sequenced (intro → sentence 0) rather than overlapping.
  useEffect(() => {
    if (isLoadingManifest || !assistantLines || !moduleUri) return;

    if (!aiEnabled) return;

    const playIntro = async () => {
      // Only play intro when starting from the very first sentence.
      // If the user is resuming mid-set (currentIndex > 0), skip intro entirely.
      if (!isResumeRef.current) {
        await clarioAssistant.playIntro(
          assistantLines, moduleUri, 'fresh', language,
          (text) => setAiBubbleMessage(text)  // bubble appears the moment audio starts
        );
      }
      // Sentence audio is NOT auto-played — user taps "Listen" when ready.
    };

    playIntro();
  }, [isLoadingManifest, moduleUri]); // Only trigger once when module first loads


  const currentSentenceId = sentenceIds[currentIndex];
  // OTA path: use sentence objects stored from zip's data.json
  // Bundled path (mock/fallback): use getSentenceById from dataMap
  const currentSentence = currentSentenceId
    ? (otaSentences[currentSentenceId] ?? getSentenceById(currentSentenceId))
    : null;

  // Build word audio lookup for SentenceDisplay
  const currentWordAudioPaths: Record<number, string> = currentSentenceId
    ? Object.fromEntries(
        Object.entries(wordAudioMap)
          .filter(([k]) => k.startsWith(`${currentSentenceId}:`))
          .map(([k, v]) => [parseInt(k.split(':')[1], 10), v])
      ) as Record<number, string>
    : {};

  // ── Timer ─────────────────────────────────────────────────────────────────
  const handleTimeUp = async () => {
    if (isRecording) {
      const uri = await stopRecording();
      if (uri) setRecordedUri(uri);
    }
  };

  const { startTimer, stopTimer, resetTimer, remainingTime } = useRecordingTimer({
    duration: 15,
    onTimeUp: handleTimeUp,
  });

  const handleStartRecord = async () => {
    setAnalysisResult(null);
    setIsSilentResult(false);
    setRecordedUri(null);
    clearRecording();
    ttsService.stopPlayback();
    // Start the timer immediately (visual feedback on press-down) and
    // kick off the async recording in parallel — no await here so the
    // UI isn't blocked waiting for mic initialisation.
    startTimer();
    await startRecording();
  };

  const handleStopRecord = async () => {
    stopTimer();
    const uri = await stopRecording();
    if (uri) setRecordedUri(uri);
  };

  // ── 4. Stateless Analysis & Hybrid Audio Loop ────────────────────────────
  const handleAnalyze = async () => {
    if (!currentSentenceId || !recordedUri) return;
    setIsAnalyzeLoading(true);
    setAiBubbleMessage(null);
    setAiBubbleAudioUrl(null);
    setWaitingBubbleMessage(null);

    // Phase 2: play waiting filler immediately (fire-and-forget).
    // onStart fires the moment audio begins so the bubble appears in the overlay.
    if (aiEnabled && assistantLines) {
      clarioAssistant.playWaiting(
        assistantLines,
        moduleUri,
        language,
        (text) => setWaitingBubbleMessage(text)
      );
    }

    try {
      const mode = aiEnabled ? 'assistant' : 'efficient';
      const result = await UAB_API.analyzeAudio(
        recordedUri,
        currentSentenceId,
        testType,
        mode,
        language
      );

      // Track accuracy for overall_session_accuracy
      accuracyRunningRef.current.push(result.sentence_accuracy);

      // ── Detect all-skipped (silent recording) ─────────────────────────────
      const allSkipped =
        result.word_results.length > 0 &&
        result.word_results.every((w: { status: string }) => w.status === 'skipped');

      // ── FLIP TO RESULTS SCREEN FIRST ─────────────────────────────────────
      // 1. Stop the waiting audio immediately so it doesn't bleed into results
      ttsService.stopPlayback();
      // 2. Clear waiting bubble, hide overlay, and show results — all in one batch
      setWaitingBubbleMessage(null);
      setIsAnalyzeLoading(false);   // ← hide overlay NOW, not after playValidation

      if (allSkipped) {
        // Nothing was heard — don't advance, force the user to retry
        accuracyRunningRef.current.pop(); // remove the 0% from the running average
        setIsSilentResult(true);
        return;
      }

      setAnalysisResult(result);

      if (aiEnabled) {
        // 3. Wait for React to paint the results screen before starting audio.
        //    InteractionManager fires after all pending animations/renders settle.
        //    An extra rAF ensures the native layer has also committed the frame.
        await new Promise<void>((resolve) =>
          InteractionManager.runAfterInteractions(() =>
            requestAnimationFrame(() => resolve())
          )
        );

        // Phase 3: play validation audio — onStart fires the moment audio begins
        // so the bubble typewriter runs IN PARALLEL with the voice, not after.
        const validationText = await clarioAssistant.playValidation(
          assistantLines ?? ({} as any),
          moduleUri,
          result.flagged_words.length,
          language,
          (text) => {
            // Bubble appears as soon as audio starts — typewriter syncs with voice
            setAiBubbleMessage(text);
            setAiBubbleAudioUrl(null);
          }
        );

        // Validation audio has played and the bubble was already set via onStart.
        // Per-error coaching detail is surfaced in the ErrorDetailSheet, not here.
      }
    } catch (e: any) {
      // Log the full error so we can see backend rejection details in the console
      console.error('[DetectionSession] handleAnalyze failed:', e?.message ?? e);
      setWaitingBubbleMessage(null);
      setIsAnalyzeLoading(false);   // hide overlay on error path
      // Only show mock bubble in mock mode — in real mode show a proper error message
      if (aiEnabled && MOCK_MODE) {
        const fallback = clarioAssistant.getMockBubble();
        setAiBubbleMessage(fallback.message);
        setAiBubbleAudioUrl(null);
      } else {
        Alert.alert(
          'Analysis unavailable',
          'The speech analysis service is busy or sleeping. Please wait 30 seconds and try again.'
        );
      }
    }
  };

  const handleRetake = () => {
    setRecordedUri(null);
    clearRecording();
    resetTimer();
    setAnalysisResult(null);
    setIsSilentResult(false);
    setAiBubbleMessage(null);
    setAiBubbleAudioUrl(null);
    setWaitingBubbleMessage(null);
    clarioAssistant.stop();
  };

  const handleParagraphRetry = useCallback(() => {
    setParagraphSessionKey((prev) => prev + 1);
  }, []);

  // ── 5. Sanitize → Accumulate → Continue ─────────────────────────────────
  const handleContinue = useCallback(
    async (validatedFlaggedWords: FlaggedWord[] = []) => {
      // Guard: prevent double-tap from running this twice concurrently
      if (isContinuingRef.current) return;
      isContinuingRef.current = true;

      clarioAssistant.stop();
      setAiBubbleMessage(null);
      setAiBubbleAudioUrl(null);

      // ✅ FIX: Strip assistant_text / assistant_audio_url and inject sentence_id
      const sentenceWordCount = currentSentence?.text.split(' ').length ?? 10;
      const strippedForBatch = validatedFlaggedWords.map((err) =>
        stripToValidatedError(err, currentSentenceId, sentenceWordCount)
      );

      const newAccumulation = [...accumulatedErrors, ...strippedForBatch];
      setAccumulatedErrors(newAccumulation);

      // ✅ FIX: Calculate correctly produced phonemes for this sentence
      let correctPhonemesForThisSentence: string[] = [];
      if (currentSentence?.targets) {
        // Words that had a confirmed error
        const errorWordsLower = new Set(validatedFlaggedWords.map((err) => err.word.toLowerCase()));

        for (const target of currentSentence.targets) {
          const targetWordLower = target.word.toLowerCase();
          const wordAnalysis = analysisResult?.word_results.find(w => w.word.toLowerCase() === targetWordLower);
          const wasSkipped = wordAnalysis?.status === 'skipped';

          // If it wasn't skipped and the user didn't make an error, they succeeded on its target phonemes
          if (!wasSkipped && !errorWordsLower.has(targetWordLower)) {
            correctPhonemesForThisSentence.push(...target.expected_ipa);
          }
        }
      }

      const newCorrectPhonemes = [...accumulatedCorrectPhonemes, ...correctPhonemesForThisSentence];
      setAccumulatedCorrectPhonemes(newCorrectPhonemes);

      // Fire-and-forget: Firestore write happens in background (non-blocking)
      markSentenceComplete(moduleId, currentSentenceId).catch((e: unknown) =>
        console.error('[DetectionSession] markSentenceComplete failed:', e)
      );

      const isLastSentence = currentIndex + 1 >= sentenceIds.length;

      // Only clear the UI for mid-session advances.
      // On the last sentence we go straight to onEnd() — no need to reset state
      // that's about to be unmounted anyway, and clearing it causes the recording
      // screen to flash for ~4 seconds while async calls complete.
      if (!isLastSentence) {
        setAnalysisResult(null);
        setRecordedUri(null);
        clearRecording();
        resetTimer();
      }

      // ── Gamification: award XP + check badges ─────────────────────────────
      const latestAccuracy =
        accuracyRunningRef.current.length > 0
          ? accuracyRunningRef.current[accuracyRunningRef.current.length - 1]
          : 0;
      const uid = auth.currentUser?.uid;
      if (uid) {
        // Both branches are now fire-and-forget — never block navigation
        onSentenceComplete(uid, language, latestAccuracy, isLastSentence).catch(() => {});
      }
      // ── End gamification ───────────────────────────────────────────────────

      if (isLastSentence) {
        // Phase 5: play completion audio before ending
        // Fire all background work without awaiting any of it
        if (aiEnabled && assistantLines) {
          clarioAssistant.playCompletion(assistantLines, moduleUri).catch(() => {});
        }

        const runningAccuracy = accuracyRunningRef.current;
        const overallAccuracy =
          runningAccuracy.length > 0
            ? Math.round(
                runningAccuracy.reduce((a: number, b: number) => a + b, 0) / runningAccuracy.length
              )
            : 0;

        UAB_API.validateSession({
          user_id: auth.currentUser?.uid ?? '',
          test_id: moduleId,
          test_type: testType,
          overall_session_accuracy: overallAccuracy,
          validated_errors: newAccumulation,
          correct_phonemes: newCorrectPhonemes,
        }).catch((e) => console.error('Batch validation failed', e));

        // ── Gamification: session complete ──────────────────────────────────────
        // Placed OUTSIDE the validateSession try/catch so it always runs,
        // even when the backend is unreachable. Session count is a local
        // user metric that must not depend on a network call succeeding.
        if (uid) {
          onSessionComplete(uid, language).catch(() => {});
        }
        // ─────────────────────────────────────────────────────────────────

        isContinuingRef.current = false;
        onEnd();
      } else {
        // Phase 4: advance to next sentence, then play transition audio.
        setCurrentIndex((prev: number) => prev + 1);

        if (aiEnabled && assistantLines) {
          // Wait for the next sentence screen to paint before starting audio/bubble
          await new Promise<void>((resolve) =>
            InteractionManager.runAfterInteractions(() =>
              requestAnimationFrame(() => resolve())
            )
          );
          await clarioAssistant.playTransition(
            assistantLines,
            moduleUri,
            language,
            (text) => setAiBubbleMessage(text)
          );
          setAiBubbleMessage(null);
          // Sentence audio is NOT auto-played — user taps "Listen" when ready.
        }
        isContinuingRef.current = false;
      }
    },
    [
      accumulatedErrors,
      accumulatedCorrectPhonemes,
      aiEnabled,
      assistantLines,
      currentIndex,
      currentSentenceId,
      language,
      moduleId,
      moduleUri,
      sentenceIds.length,
      testType,
      onEnd,
    ]
  );

  // ── Loading State ─────────────────────────────────────────────────────────
  if (isLoadingManifest || !currentSentence) {
    return (
      <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent
        />
        <View style={styles.loadingWrap}>
          <View style={[styles.loadingCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={[styles.loadingIconWrap, { backgroundColor: PRIMARY + '14' }]}>
              <Ionicons name="mic-outline" size={26} color={PRIMARY} />
            </View>
            <Text style={[styles.loadingText, { color: text }]}>Loading session…</Text>
            <Text style={[styles.loadingSub, { color: subtle }]}>Preparing your assessment</Text>
          </View>
        </View>
      </View>
    );
  }

  const totalSentences = sentenceIds.length || 10;
  const progressPct = ((currentIndex) / totalSentences) * 100;
  const accentColor = aiEnabled ? AI_ACCENT : PRIMARY;

  return (
    <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />
      {analysisResult ? (
        <ResultsDisplay
          result={analysisResult}
          expectedSentence={currentSentence.text}
          recordedAudioUri={recordedUri}
          moduleUri={moduleUri}
          modelAudioPath={
            currentSentenceId ? sentenceAudioMap[currentSentenceId] : undefined
          }
          aiBubbleMessage={aiEnabled ? aiBubbleMessage : null}
          onContinue={(validated) =>
            handleContinue(validated ?? analysisResult.flagged_words)
          }
          onRetake={handleRetake}
          onReportError={() => {}}
          onUpdateResults={() => {}}
          isAIMode={aiEnabled}
          disabled={isContinuingRef.current}
          isLastSentence={currentIndex + 1 >= sentenceIds.length}
        />
      ) : assessmentMode === 'paragraph' ? (
        // ── Paragraph Mode ─────────────────────────────────────────────────
        <ParagraphModeSession
          key={paragraphSessionKey}
          sentenceIds={sentenceIds}
          otaSentences={otaSentences}
          sentenceAudioMap={sentenceAudioMap}
          wordAudioMap={wordAudioMap}
          moduleUri={moduleUri}
          moduleId={moduleId}
          testType={testType}
          language={language}
          assistantLines={assistantLines}
          onEnd={onEnd}
          onRetry={handleParagraphRetry}
          theme={{ bg, surface, border, text, subtle, primary: PRIMARY }}
          isDark={isDark}
        />
      ) : (
        // ── Individual Mode (existing) ──────────────────────────────────────
        <>
          {/* ── Header ──────────────────────────── */}
          <View style={[styles.header, { borderBottomColor: border }]}>
            <TouchableOpacity
              onPress={onEnd}
              style={[styles.headerBtn, { backgroundColor: isDark ? '#1A2030' : '#E8EDF2' }]}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={18} color={subtle} />
            </TouchableOpacity>

            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: text }]} numberOfLines={1}>
                {TEST_TYPE_LABELS[testType] || 'Assessment'}
              </Text>
              <View style={styles.headerMeta}>
                <Text style={[styles.headerCount, { color: subtle }]}>
                  {currentIndex + 1} of {totalSentences}
                </Text>
              </View>
            </View>

            {isRecording ? (
              <TimerDisplay remaining={remainingTime} color={accentColor} subtle={subtle} isDark={isDark} />
            ) : (
              <AICoPilotToggle
                state={aiEnabled ? 'idle' : 'off'}
                onToggle={() => setAiEnabled(!aiEnabled)}
              />
            )}
          </View>

          {/* ── AI glow strip ───────────────────── */}
          {aiEnabled && (
            <View style={[styles.aiGlowStrip, { backgroundColor: AI_ACCENT + '28' }]} />
          )}

          {/* ── Progress bar ────────────────────── */}
          <View
            style={[
              styles.progressTrack,
              { backgroundColor: isDark ? '#1A2030' : '#E8EDF2' },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progressPct}%` as any,
                  backgroundColor: accentColor,
                },
              ]}
            >
              {/* Shimmer sweep */}
              <Animated.View style={[styles.progressShimmer, shimmerStyle]} />
            </View>
          </View>

          {/* ── Content ─────────────────────────── */}
          <View style={styles.contentArea}>
            {/* Sentence counter chip */}
            <View style={styles.sentenceChipRow}>
              <View style={[styles.sentenceChip, { backgroundColor: accentColor + (isDark ? '18' : '12'), borderColor: accentColor + '25', borderWidth: 1 }]}>
                <Ionicons name="chatbubble-outline" size={12} color={accentColor} />
                <Text style={[styles.sentenceChipText, { color: accentColor }]}>
                  Sentence {currentIndex + 1}
                </Text>
              </View>
              {aiEnabled && (
                <View style={[styles.sentenceChip, { backgroundColor: AI_ACCENT + (isDark ? '18' : '12'), borderColor: AI_ACCENT + '25', borderWidth: 1 }]}>
                  <Ionicons name="sparkles" size={11} color={AI_ACCENT} />
                  <Text style={[styles.sentenceChipText, { color: AI_ACCENT }]}>AI Assisted</Text>
                </View>
              )}
            </View>

            <SentenceDisplay
              sentence={currentSentence}
              moduleUri={moduleUri}
              wordAudioPaths={currentWordAudioPaths}
              aiTargetWordIndex={null}
              ambientAI={aiEnabled}
              isResultPhase={false}
              language={language}
              fullSentenceAudioPath={
                currentSentenceId ? sentenceAudioMap[currentSentenceId] : undefined
              }
            />

            {/* AI bubble — always occupies reserved space when AI is on to prevent layout shift */}
            {aiEnabled && (
              <View style={styles.aiBubbleSlot}>
                {aiBubbleMessage && (
                  <AIFeedbackBubble
                    message={aiBubbleMessage}
                    isSpeaking={isAssistantSpeaking}
                    onDismiss={() => {
                      setAiBubbleMessage(null);
                      setAiBubbleAudioUrl(null);
                    }}
                    style={styles.aiBubbleWrap}
                  />
                )}
              </View>
            )}

            {/* Segment dots (secondary visual) */}
            <View style={styles.dotsWrap}>
              <SegmentDots
                current={currentIndex}
                total={totalSentences}
                color={accentColor}
                subtle={subtle}
              />
            </View>

            {/* Silent recording banner — shown when all words were skipped */}
            {isSilentResult && (
              <Animated.View
                entering={FadeInUp.duration(300)}
                style={[styles.silentBanner, { backgroundColor: isDark ? '#1E2A38' : '#FFF8EC', borderColor: '#F59E0B50' }]}
              >
                <Ionicons name="mic-off-outline" size={20} color="#F59E0B" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.silentBannerTitle, { color: '#F59E0B' }]}>We couldn't hear you</Text>
                  <Text style={[styles.silentBannerBody, { color: isDark ? '#94A3B8' : '#6B7280' }]}>
                    Please speak clearly and try again.
                  </Text>
                </View>
              </Animated.View>
            )}
          </View>

          {/* ── Footer ──────────────────────────── */}
          <View style={[styles.footer, { borderTopColor: border, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={[styles.hintLabel, { color: subtle }]}>
              {isRecording
                ? 'Release to stop recording'
                : recordedUri
                ? 'Tap Analyse to get your results'
                : 'Hold the mic button and read aloud'}
            </Text>

            <RecordButton
              isRecording={isRecording}
              metering={metering}
              hasRecording={!!recordedUri}
              onStart={handleStartRecord}
              onStop={handleStopRecord}
              onAnalyze={handleAnalyze}
              onRetry={handleRetake}
              disabled={isAnalyzeLoading}
              aiSpeaking={aiEnabled && isAssistantSpeaking && !!aiBubbleMessage}
              onInterrupt={() => {
                ttsService.stopPlayback();
                setAiBubbleMessage(null);
                setAiBubbleAudioUrl(null);
              }}
              isAIMode={aiEnabled}
            />
          </View>
        </>
      )}

      {isAnalyzeLoading && (
        <AnalysingOverlay
          accentColor={accentColor}
          surface={surface}
          border={border}
          text={text}
          subtle={subtle}
          isDark={isDark}
          isAIMode={aiEnabled}
          waitingMessage={aiEnabled ? waitingBubbleMessage : null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Loading
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingCard: {
    alignItems: 'center',
    padding: 36,
    borderRadius: 26,
    borderWidth: 1,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  loadingIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  loadingText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  loadingSub: { fontSize: 13, fontWeight: '400' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerCount: { fontSize: 12, fontWeight: '500' },

  // Progress
  progressTrack: { height: 6, marginHorizontal: 24, marginTop: 0, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6, overflow: 'hidden', position: 'relative' },
  progressShimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: 'rgba(255,255,255,0.35)',
    transform: [{ skewX: '-20deg' }],
  },

  // AI glow strip
  aiGlowStrip: {
    height: 3,
    marginHorizontal: 0,
  },

  // Content
  contentArea: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    justifyContent: 'center',
  },
  sentenceChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sentenceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  sentenceChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  dotsWrap: {
    alignItems: 'center',
    marginTop: 18,
  },
  aiBubbleSlot: {
    minHeight: 96,
    justifyContent: 'flex-start',
  },
  aiBubbleWrap: {
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  silentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    marginHorizontal: 0,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  silentBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  silentBannerBody: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },

  // Footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
  },
  hintLabel: { fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 19 },
});
