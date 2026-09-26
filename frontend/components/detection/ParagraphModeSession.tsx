/**
 * ParagraphModeSession
 * Location: components/detection/ParagraphModeSession.tsx
 *
 * Premium paragraph-mode assessment session.
 * All sentences render as one continuous flowing paragraph inside a reading card.
 * The active sentence is highlighted; all others are dimmed gray.
 *
 * Recording: press-and-hold the mic button (same as individual mode).
 * Analysis: fires silently in the background after each sentence — no blocking
 * overlay between sentences. The user moves straight to the next sentence.
 * When the last sentence recording stops, we wait for all pending analyses to
 * resolve, then show the full ParagraphResultsScreen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useRecordingTimer } from '@/hooks/useRecordingTimer';
import { UAB_API } from '@/lib/api';
import { getSentenceById } from '@/lib/dataMap';

import { auth } from '@/firebase';
import { onSentenceComplete, onSessionComplete } from '@/lib/gamificationService';
import { markSentenceComplete } from '@/lib/progressService';
import { ttsService } from '@/lib/ttsService';
import { haptics } from '@/lib/haptics';
import type {
  AnalysisResponse,
  FlaggedWord,
  ModuleAssistantLines,
  TestType,
  ValidatedError,
} from '@/lib/types';
import type { Sentence } from '@/lib/types';

import { SentenceDetailSheet } from './SentenceDetailSheet';
import { ParagraphTextView, SentencePhase, SentenceState } from './ParagraphTextView';
import { VoiceVisualizer } from './VoiceVisualizer';
import { ParagraphResultsScreen } from './ParagraphResultsScreen';
import { containsUrduScript } from '@/lib/textDirection';

// ─── Helper ───────────────────────────────────────────────────────────────────

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
    return { ...base, error_category: 'fluency', error_type: 'prolongation', phoneme_prolonged: (error as any).phoneme_prolonged, duration_ms: (error as any).duration_ms };
  }
  if (error.error_type === 'stutter') {
    return { ...base, error_category: 'fluency', error_type: 'stutter', phonemes_stuttered: (error as any).phonemes_stuttered, repetition_count: (error as any).repetition_count };
  }
  return { ...base, error_category: 'fluency', error_type: 'block', block_duration_ms: (error as any).block_duration_ms, preceding_phoneme: (error as any).preceding_phoneme ?? null };
}

// ─── Pulsing mic ring ─────────────────────────────────────────────────────────

function PulseRing({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(withSequence(withTiming(1.55, { duration: 800 }), withTiming(1, { duration: 800 })), -1);
    opacity.value = withRepeat(withSequence(withTiming(0, { duration: 800 }), withTiming(0.5, { duration: 800 })), -1);
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: color,
  }));

  return <Animated.View style={style} />;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  sentenceIds: string[];
  otaSentences: Record<string, Sentence>;
  sentenceAudioMap: Record<string, string>;
  wordAudioMap: Record<string, string>;
  moduleUri: string;
  moduleId: string;
  testType: TestType;
  language: string;
  assistantLines: ModuleAssistantLines | null;
  onEnd: () => void;
  onRetry: () => void;
  theme: {
    bg: string;
    surface: string;
    border: string;
    text: string;
    subtle: string;
    primary: string;
  };
  isDark: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ParagraphModeSession({
  sentenceIds,
  otaSentences,
  sentenceAudioMap,
  wordAudioMap,
  moduleUri,
  moduleId,
  testType,
  language,
  assistantLines,
  onEnd,
  onRetry,
  theme,
  isDark,
}: Props) {
  const insets = useSafeAreaInsets();

  const sentences: Sentence[] = sentenceIds.map(
    (id) => otaSentences[id] ?? getSentenceById(id) ?? { text: id, sentence_id: id, targets: [] }
  );

  // ── State ─────────────────────────────────────────────────────────────────
  const [sentenceStates, setSentenceStates] = useState<SentenceState[]>(
    sentenceIds.map(() => ({ phase: 'pending' as SentencePhase, errors: [], dismissedWords: new Set<string>(), accuracy: 0 }))
  );
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(0);
  /** 'idle' = waiting to record, 'recording' = mic is held down */
  const [recordPhase, setRecordPhase] = useState<'idle' | 'recording'>('idle');
  /** True after last sentence recording stops — waiting for all analyses to resolve */
  const [isWaitingForResults, setIsWaitingForResults] = useState(false);
  /** True once all background analyses have settled — triggers results screen */
  const [isAllDone, setIsAllDone] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  const [activeSheetSentence, setActiveSheetSentence] = useState<Sentence | null>(null);
  const [isSentenceSheetVisible, setIsSentenceSheetVisible] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const scrollRef = useRef<ScrollView>(null);
  const sentenceYPositions = useRef<number[]>([]);
  /** Per-sentence analysis results, populated as background tasks resolve */
  const sentenceResults = useRef<Record<number, AnalysisResponse | null>>({});
  /** All in-flight analysis promises — awaited together after last sentence */
  const pendingAnalyses = useRef<Promise<void>[]>([]);
  /** Guards hold-to-record: only fire onStop if a valid onStart was registered */
  const pressInActiveRef = useRef(false);
  const accumulatedErrors = useRef<ValidatedError[]>([]);
  const accuracyRunning = useRef<number[]>([]);

  const { isRecording, metering, startRecording, stopRecording, clearRecording } = useAudioRecorder();

  // ── Timer ─────────────────────────────────────────────────────────────────
  const handleTimeUp = async () => {
    if (isRecording) {
      stopTimer();
      const uri = await stopRecording();
      setRecordPhase('idle');
      if (uri) fireBackgroundAnalysis(uri);
    }
  };

  const { startTimer, stopTimer, resetTimer, remainingTime } = useRecordingTimer({
    duration: 20,
    onTimeUp: handleTimeUp,
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setSentenceStates((prev) => {
      const next = [...prev];
      if (next[0]) next[0] = { ...next[0], phase: 'active' };
      return next;
    });
    return () => {
      ttsService.stopPlayback();
    };
  }, []);

  // Auto-scroll to active sentence
  useEffect(() => {
    const y = sentenceYPositions.current[activeSentenceIndex];
    if (y !== undefined) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 40), animated: true });
    }
  }, [activeSentenceIndex]);

  // ── Recording handlers ────────────────────────────────────────────────────
  const handleStartRecord = async () => {
    setRecordPhase('recording');
    ttsService.stopPlayback();
    clearRecording();
    startTimer();
    await startRecording();
  };

  /**
   * Called when the user releases the mic button (or timer fires).
   * Immediately advances to the next sentence, then fires analysis silently
   * in the background. On the last sentence, waits for all analyses before
   * showing the results screen.
   */
  const handleStopRecord = async () => {
    stopTimer();
    setRecordPhase('idle');
    const uri = await stopRecording();
    if (!uri) return;
    fireBackgroundAnalysis(uri);
  };

  /**
   * Advances the UI to the next sentence (or triggers result-wait state if last),
   * then fires the analysis promise and tracks it.
   */
  const fireBackgroundAnalysis = (uri: string) => {
    const capturedIndex = activeSentenceIndex;
    const sentenceId = sentenceIds[capturedIndex];
    if (!sentenceId) return;

    const isLastSentence = capturedIndex + 1 >= sentenceIds.length;

    // Mark current sentence as recorded (dim it in the paragraph view)
    setSentenceStates((prev) => {
      const next = [...prev];
      if (next[capturedIndex]) next[capturedIndex] = { ...next[capturedIndex], phase: 'done' };
      return next;
    });

    if (!isLastSentence) {
      // Advance immediately so user can record the next sentence now
      const nextIdx = capturedIndex + 1;
      setSentenceStates((prev) => {
        const next = [...prev];
        if (next[nextIdx]) next[nextIdx] = { ...next[nextIdx], phase: 'active' };
        return next;
      });
      setActiveSentenceIndex(nextIdx);
      resetTimer();
    } else {
      // Last sentence — show a brief waiting indicator
      setIsWaitingForResults(true);
    }

    // Kick off analysis in background
    const promise = analyzeInBackground(uri, capturedIndex, sentenceId, isLastSentence);
    pendingAnalyses.current.push(promise);

    if (isLastSentence) {
      // Wait for ALL in-flight analyses (previous sentences may still be running)
      Promise.all(pendingAnalyses.current).then(() => {
        setIsWaitingForResults(false);
        setIsAllDone(true);
      });
    }
  };

  /**
   * Silent background analysis — never blocks the recording UI.
   * Stores result in sentenceResults ref; populates accumulatedErrors ref.
   */
  const analyzeInBackground = useCallback(async (
    audioUri: string,
    sentenceIdx: number,
    sentenceId: string,
    isLast: boolean,
  ): Promise<void> => {
    try {
      const result = await UAB_API.analyzeAudio(audioUri, sentenceId, testType, 'efficient', language as any);

      const allSkipped =
        result.word_results.length > 0 &&
        result.word_results.every((w: { status: string }) => w.status === 'skipped');

      // Store result regardless (results screen shows "not heard" for silent)
      sentenceResults.current[sentenceIdx] = result;

      if (!allSkipped) {
        accuracyRunning.current.push(result.sentence_accuracy);

        const wordCount = sentences[sentenceIdx]?.text.split(' ').length ?? 10;
        const stripped = result.flagged_words.map((err: FlaggedWord) =>
          stripToValidatedError(err, sentenceId, wordCount)
        );
        accumulatedErrors.current.push(...stripped);

        const uid = auth.currentUser?.uid;
        if (uid) {
          onSentenceComplete(uid, language as any, result.sentence_accuracy, isLast).catch(() => { });
        }
        markSentenceComplete(moduleId, sentenceId).catch(() => { });
      }
    } catch (e: any) {
      console.error('[ParagraphModeSession] Background analysis error:', e?.message ?? e);
      // null signals "analysis failed" — results screen shows a warning for that sentence
      sentenceResults.current[sentenceIdx] = null;
    }
  }, [testType, language, sentences, moduleId]);

  // ── Finish / submit ───────────────────────────────────────────────────────
  const handleFinish = async () => {
    if (isFinishing) return;
    setIsFinishing(true);

    const uid = auth.currentUser?.uid ?? '';
    const runningAccuracy = accuracyRunning.current;
    const overallAccuracy =
      runningAccuracy.length > 0
        ? Math.round(runningAccuracy.reduce((a, b) => a + b, 0) / runningAccuracy.length)
        : 0;

    const finalErrors = accumulatedErrors.current.filter((e) => {
      const idx = sentenceIds.indexOf(e.sentence_id);
      if (idx < 0) return true;
      return !(sentenceStates[idx]?.dismissedWords.has(e.word) ?? false);
    });

    try {
      await UAB_API.validateSession({
        user_id: uid,
        test_id: moduleId,
        test_type: testType,
        overall_session_accuracy: overallAccuracy,
        validated_errors: finalErrors,
        correct_phonemes: [],
      });
    } catch (e) {
      console.error('[ParagraphModeSession] validateSession failed:', e);
    }

    if (uid) onSessionComplete(uid, language as any).catch(() => { });
    onEnd();
  };

  const handleDismissWord = (word: string, sentenceIdx: number) => {
    setSentenceStates((prev) => {
      const next = [...prev];
      const entry = next[sentenceIdx];
      if (entry) {
        const newDismissed = new Set(entry.dismissedWords);
        newDismissed.add(word);
        next[sentenceIdx] = { ...entry, dismissedWords: newDismissed };
      }
      return next;
    });
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const isCurrentlyRecording = recordPhase === 'recording';
  const doneSentences = sentenceStates.filter((s) => s.phase === 'done').length;
  const progressPct = (doneSentences / sentenceIds.length) * 100;

  const pageBg = isDark ? '#0C0F14' : '#EEF2F7';
  const isParagraphRTL = sentences.some((sentence) => containsUrduScript(sentence.text));

  // ── Results screen (replaces everything once all analyses are done) ────────
  if (isAllDone) {
    return (
      <ParagraphResultsScreen
        sentences={sentences}
        sentenceResults={sentenceResults.current}
        sentenceStates={sentenceStates}
        onDismissWord={handleDismissWord}
        onFinish={handleFinish}
        isFinishing={isFinishing}
        onRetry={onRetry}
        theme={theme}
        isDark={isDark}
      />
    );
  }

  // ── Main recording view ───────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: pageBg, paddingTop: insets.top }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: theme.border + '50' }]}>
        <TouchableOpacity
          onPress={onEnd}
          style={[styles.closeBtn, { backgroundColor: isDark ? '#1E2535' : '#E2E8F0' }]}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={18} color={theme.subtle} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Paragraph Mode</Text>
        </View>

        {/* Progress pill */}
        <View style={[styles.counterPill, { backgroundColor: theme.primary + '16', borderColor: theme.primary + '28' }]}>
          <Text style={[styles.counterText, { color: theme.primary }]}>
            {doneSentences}/{sentenceIds.length}
          </Text>
        </View>
      </View>

      {/* ── Progress strip ──────────────────────────────────────────────────── */}
      <View style={[styles.progressTrack, { backgroundColor: isDark ? '#1A2030' : '#E2E8F0' }]}>
        <Animated.View
          style={[
            styles.progressFill,
            { backgroundColor: theme.primary, width: `${progressPct}%` as any },
          ]}
        />
      </View>

      {/* ── Scroll area ─────────────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Reading card */}
        <Animated.View
          entering={FadeInDown.duration(400).springify()}
          style={[
            styles.card,
            { backgroundColor: theme.surface, borderColor: theme.border + '70' },
          ]}
        >
          {/* Hint text */}
          <View style={[styles.cardMetaPill, { backgroundColor: theme.primary + '12', borderColor: theme.primary + '20' }]}>
            <Ionicons name="book-outline" size={14} color={theme.primary} />
            <Text style={[styles.cardMetaText, { color: theme.subtle }]}>
              {isWaitingForResults
                ? 'Processing results…'
                : isCurrentlyRecording
                  ? `Recording sentence ${activeSentenceIndex + 1}…`
                  : `Sentence ${activeSentenceIndex + 1} of ${sentenceIds.length} — read it aloud`}
            </Text>
          </View>

          {/* Paragraph text */}
          <ParagraphTextView
            sentences={sentences}
            sentenceStates={sentenceStates}
            activeSentenceIndex={activeSentenceIndex}
            onWordPress={() => { }}
            onActiveSentencePress={(sentence) => {
              setActiveSheetSentence(sentence);
              setIsSentenceSheetVisible(true);
            }}
            onSentenceLayout={(idx, y) => {
              sentenceYPositions.current[idx] = y;
            }}
            isDark={isDark}
            isRTL={isParagraphRTL}
            theme={theme}
          />
        </Animated.View>
      </ScrollView>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: pageBg,
            borderTopColor: theme.border + '40',
            paddingBottom: Math.max(insets.bottom + 8, 24),
          },
        ]}
      >
        {isWaitingForResults ? (
          /* Brief loading state while last analyses resolve */
          <Animated.View entering={FadeIn.duration(200)} style={styles.waitingFooter}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={[styles.waitingText, { color: theme.subtle }]}>
              Processing results…
            </Text>
          </Animated.View>
        ) : (
          /* Recording controls */
          <View style={styles.recordFooter}>
            {isCurrentlyRecording && (
              <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
                <VoiceVisualizer metering={metering} isRecording={true} isAIMode={false} />
              </Animated.View>
            )}

            {isCurrentlyRecording && (
              <Animated.View entering={FadeIn.duration(150)} style={styles.timerRow}>
                <View style={styles.timerDot} />
                <Text style={[styles.timerText, { color: '#EF4444' }]}>{remainingTime}s</Text>
              </Animated.View>
            )}

            {/* Hold-to-record mic button */}
            <View style={styles.micBtnWrap}>
              {isCurrentlyRecording && <PulseRing color="#EF4444" />}
              {!isCurrentlyRecording && <PulseRing color={theme.primary} />}
              <Pressable
                style={[
                  styles.micBtn,
                  {
                    backgroundColor: isCurrentlyRecording ? '#EF4444' : theme.primary,
                    shadowColor: isCurrentlyRecording ? '#EF4444' : theme.primary,
                  },
                ]}
                onPressIn={() => {
                  pressInActiveRef.current = true;
                  haptics.medium();
                  handleStartRecord();
                }}
                onPressOut={() => {
                  if (!pressInActiveRef.current) return;
                  pressInActiveRef.current = false;
                  haptics.light();
                  handleStopRecord();
                }}
                android_ripple={null}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={isCurrentlyRecording ? 'stop' : 'mic'}
                  size={28}
                  color="#FFF"
                />
              </Pressable>
            </View>

            <Text style={[styles.micHint, { color: theme.subtle }]}>
              {isCurrentlyRecording ? 'Release to stop' : 'Hold to record'}
            </Text>
          </View>
        )}
      </View>

      {/* ── Sentence TTS Sheet ─────────────────────────────────────────────── */}
      <SentenceDetailSheet
        visible={isSentenceSheetVisible}
        sentence={activeSheetSentence}
        moduleUri={moduleUri}
        language={language}
        sentenceAudioPath={activeSheetSentence ? sentenceAudioMap[activeSheetSentence.sentence_id] : undefined}
        wordAudioMap={wordAudioMap}
        onClose={() => setIsSentenceSheetVisible(false)}
        isDark={isDark}
        accentColor={theme.primary}
        text={theme.text}
        subtle={theme.subtle}
        surface={theme.surface}
        border={theme.border}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  counterPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    flexShrink: 0,
  },
  counterText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },

  // Progress
  progressTrack: { height: 3 },
  progressFill: { height: 3, borderRadius: 2 },

  // Scroll
  scrollArea: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60, flexGrow: 1, justifyContent: 'center' },
  card: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 20,
    borderRadius: 28,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  cardMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'center',
    marginBottom: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  cardMetaText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Footer
  footer: {
    borderTopWidth: 1,
    paddingTop: 14,
    paddingHorizontal: 20,
  },

  // Waiting state
  waitingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  waitingText: { fontSize: 14, fontWeight: '500' },

  // Recording controls
  recordFooter: { alignItems: 'center', gap: 8 },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  timerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  timerText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  micBtnWrap: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  micBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  micHint: { fontSize: 13, fontWeight: '500', letterSpacing: 0.2 },
});