import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AICoPilotToggle, AI_ACCENT } from '@/components/detection/AICoPilotToggle';
import { AIFeedbackBubble } from '@/components/detection/AIFeedbackBubble';
import { MicButton } from '@/components/practice/MicButton';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';
import { useAppTheme } from '@/theme-provider';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UAB_API } from '@/lib/api';
import { clarioAssistant } from '@/lib/clarioAssistant';
import type { Language, PhonemeDetectResponse, PhonemeMatch } from '@/lib/types';

const CORAL = '#1FB7BC';

type SessionState = 'idle' | 'recording' | 'processing' | 'result';
type NodeState = 'hidden' | 'idle' | 'active' | 'correct' | 'wrong';

// ─── Chunk Error Modal ────────────────────────────────────────────────────────
function ChunkErrorModal({
  visible,
  syllable,
  phonemeMatches,
  onRetry,
  onSkip,
  showSkip,
  surface,
  text: textColor,
  subtle,
  border,
}: {
  visible: boolean;
  syllable: string;
  phonemeMatches: PhonemeMatch[];
  onRetry: () => void;
  onSkip: () => void;
  showSkip: boolean;
  surface: string;
  text: string;
  subtle: string;
  border: string;
}) {
  const incorrectMatches = phonemeMatches.filter((m) => !m.correct);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onRetry}>
      <View style={modalStyles.backdrop}>
        <TouchableOpacity style={modalStyles.backdropTap} activeOpacity={1} onPress={onRetry} />
        <View style={[modalStyles.sheet, { backgroundColor: surface, borderColor: border }]}>
          {/* Icon */}
          <View style={[modalStyles.iconCircle, { backgroundColor: CORAL + '1A' }]}>
            <Ionicons name="close-circle" size={32} color={CORAL} />
          </View>
          {/* Title */}
          <Text style={[modalStyles.title, { color: textColor }]}>Pronunciation Error</Text>
          <Text style={[modalStyles.subtitle, { color: subtle }]}>
            {syllable ? `"${syllable}" didn't match the target` : 'Phoneme mismatch detected'}
          </Text>
          {/* Phoneme rows */}
          {incorrectMatches.length > 0 && (
            <View style={[modalStyles.matchesBox, { borderColor: border }]}>
              {incorrectMatches.slice(0, 4).map((m, i) => (
                <View key={i} style={modalStyles.matchRow}>
                  <View style={[modalStyles.pill, { backgroundColor: '#10B98114' }]}>
                    <Text style={[modalStyles.pillText, { color: '#10B981' }]}>/{m.expected}/</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={12} color={subtle} />
                  <View style={[modalStyles.pill, { backgroundColor: CORAL + '14' }]}>
                    <Text style={[modalStyles.pillText, { color: CORAL }]}>/{m.detected || '?'}/</Text>
                  </View>
                  <Text style={[modalStyles.heardLabel, { color: subtle }]}>heard instead</Text>
                </View>
              ))}
            </View>
          )}
          {/* Retry button */}
          <TouchableOpacity
            style={[modalStyles.retryBtn, { backgroundColor: CORAL }]}
            onPress={onRetry}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={16} color="#FFF" />
            <Text style={modalStyles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
          {/* Skip button — appears after 4 consecutive failures */}
          {showSkip && (
            <TouchableOpacity
              style={[modalStyles.skipBtn, { borderColor: subtle + '44' }]}
              onPress={onSkip}
              activeOpacity={0.75}
            >
              <Text style={[modalStyles.skipBtnText, { color: subtle }]}>Skip this word</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ChunkNode({
  label,
  state,
  isStrong,
  nodeSize,
  nodeFontSize,
  isDark,
  borderColor,
  onPress,
}: {
  label: string;
  state: NodeState;
  isStrong: boolean;
  nodeSize: number;
  nodeFontSize: number;
  isDark: boolean;
  borderColor: string;
  onPress?: () => void;
}) {
  // Bug 1 fix: use nodeSize from props (computed dynamically based on chunk count)
  if (state === 'hidden') {
    return (
      <View
        style={[
          styles.nodeHidden,
          { width: nodeSize, height: nodeSize, borderRadius: nodeSize / 2, borderColor: isDark ? '#D1D5DB44' : '#B8C8D880' },
        ]}
      />
    );
  }

  const isCorrect = state === 'correct';
  const isWrong = state === 'wrong';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.85}
      style={[
        styles.node,
        {
          width: nodeSize,
          height: nodeSize,
          borderRadius: nodeSize / 2,
          borderWidth: 2.5,
          borderColor: isDark ? 'rgba(255,255,255,0.16)' : '#D6E0EB',
          backgroundColor: isDark ? '#162033' : '#FFFFFF',
          shadowColor: CORAL,
        },
        state === 'active' && { backgroundColor: CORAL },
        isCorrect && { backgroundColor: '#10B981' },
        isWrong && { backgroundColor: '#EF4444' },
      ]}
    >
      <Text
        style={[
          styles.nodeText,
          { fontSize: nodeFontSize, fontWeight: isStrong ? '900' : '700', color: isDark ? '#FFFFFF' : '#000000' },
          (state === 'active' || isCorrect || isWrong) && { color: '#FFFFFF' },
        ]}
        adjustsFontSizeToFit
        numberOfLines={1}
        minimumFontScale={0.6}
      >
        {label}
      </Text>

      {isCorrect && (
        <View style={[styles.badge, { backgroundColor: '#10B981' }]}>
          <Ionicons name="checkmark" size={10} color="#FFF" />
        </View>
      )}
      {isWrong && (
        <View style={[styles.badge, { backgroundColor: '#EF4444' }]}>
          <Ionicons name="close" size={10} color="#FFF" />
        </View>
      )}
    </TouchableOpacity>
  );
}

export function SyllableChainingScreen() {
  const { resolvedTheme } = useAppTheme();
  const { aiEnabled, setAiEnabled } = useAICoPilot();
  const router = useRouter();
  const session = usePracticeSession();
  const tts = useTTSPlayback();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; language?: string }>();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg = isDark ? '#0A1020' : '#F4F7FB';
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#8EA4BC' : '#6E7F95';
  const surface = isDark ? '#111A2B' : '#FFFFFF';
  const border = isDark ? '#263246' : '#D8E2EC';

  const [aiBubbleMessage, setAiBubbleMessage] = useState<string | null>(null);
  const [showBubble, setShowBubble] = useState(true);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [revealedCount, setRevealedCount] = useState(0);
  // Bug 7: feedback for recordings that are too short
  const [tooShortWarning, setTooShortWarning] = useState(false);
  // Bug 8: track when the AI assistant is speaking
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  // Bug 2 fix: track pass/fail as a single state so modal and checkmark use the same truth
  const [isPerfect, setIsPerfect] = useState<boolean | null>(null);
  // Bug 3 fix: track consecutive failures for adaptive easification
  const [retryCount, setRetryCount] = useState(0);

  const hasPlayedIntroRef = useRef(false);
  const waitingPromiseRef = useRef<Promise<void> | null>(null);

  const lang = (params.language as Language) ?? 'english';
  const mode = (params.mode === 'assistant' ? 'assistant' : 'efficient') as 'efficient' | 'assistant';

  // Analysis result from analyzePhonemesOnly (cleared on retry/continue)
  const [lastAnalysis, setLastAnalysis] = useState<PhonemeDetectResponse | null>(null);
  const [failedSyllable, setFailedSyllable] = useState('');
  // Animated value for the action panel that slides above the footer
  const resultFadeAnim = useRef(new Animated.Value(0)).current;

  // Stop all audio on unmount
  useEffect(() => {
    return () => { clarioAssistant.stop(); tts.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play intro — also drive the `isAssistantSpeaking` indicator
  useEffect(() => {
    // Support both camelCase (practiceMapper) and snake_case (raw data.json) keys
    const assistantLines = session.payload?.assistantLines ?? (session.payload as any)?.assistant_lines;
    if (!aiEnabled || !assistantLines || hasPlayedIntroRef.current) return;
    hasPlayedIntroRef.current = true;

    const introLines = (assistantLines as any)?.intro;
    if (!Array.isArray(introLines) || introLines.length === 0) {
      console.warn('[SyllableChaining] assistantLines.intro is empty or missing — skipping intro');
      return;
    }

    console.log('[SyllableChaining] 🎬 Playing intro for item 0');
    setIsAssistantSpeaking(true);
    clarioAssistant.playIntro(
      assistantLines,
      session.payload?.moduleDir ?? '',
      session.currentItemIndex > 0 ? 'resume' : 'fresh',
      lang,
      (text) => setAiBubbleMessage(text)
    ).finally(() => setIsAssistantSpeaking(false));
  }, [aiEnabled, session.payload?.assistantLines, (session.payload as any)?.assistant_lines, session.currentItemIndex, session.payload?.moduleDir, lang]);

  const [nodeStates, setNodeStates] = useState<NodeState[]>([]);
  const [resultMask, setResultMask] = useState<boolean[] | null>(null);

  const shimmerX = useRef(new Animated.Value(-40)).current;
  const recordStartRef = useRef<number>(0);

  const { startRecording, stopRecording, clearRecording, metering } = useAudioRecorder();


  // Extract item data
  const chainingDirection = String(session.payload?.items?.chaining_direction ?? 'forward');
  const isForward = chainingDirection === 'forward';

  const visualChunks = useMemo<string[]>(() => {
    const fromChunks = session.currentItem?.visual_chunks ?? session.currentItem?.phonemic_chunks;
    if (!Array.isArray(fromChunks) || fromChunks.length === 0) return ['Ba', 'Na', 'Na'];
    return fromChunks.map((c: unknown) => String(c));
  }, [session.currentItem]);

  const phonemicChunks = useMemo<string[]>(() => {
    const fromChunks = session.currentItem?.phonemic_chunks;
    if (!Array.isArray(fromChunks) || fromChunks.length === 0) return visualChunks;
    return fromChunks.map((c: unknown) => String(c));
  }, [session.currentItem, visualChunks]);

  const stressPattern = String(session.currentItem?.stress_pattern ?? 'SWW');
  const stressMap = useMemo(() => stressPattern.split('').map((c) => c === 'S'), [stressPattern]);

  const targetWord = String(session.currentItem?.word ?? 'banana');

  // Initialize node states based on direction
  useEffect(() => {
    const count = visualChunks.length;
    // Bug 3 fix: reset easification counters on each new word
    setRetryCount(0);
    setIsPerfect(null);

    if (isForward) {
      // Forward: reveal left to right, first chunk visible
      setNodeStates(visualChunks.map((_, i) => (i === 0 ? 'idle' : 'hidden')));
      setRevealedCount(1);
    } else {
      // Backward: reveal right to left, last chunk visible
      setNodeStates(visualChunks.map((_, i) => (i === count - 1 ? 'idle' : 'hidden')));
      setRevealedCount(1);
    }
    setResultMask(null);
    setSessionState('idle');
  }, [session.currentItemIndex, visualChunks, isForward]);

  // Display order for backward chaining
  const displayOrder = useMemo(() => {
    const indices = visualChunks.map((_, i) => i);
    return isForward ? indices : [...indices].reverse();
  }, [visualChunks, isForward]);

  const activeIndices = useMemo(() => {
    return isForward 
      ? Array.from({ length: revealedCount }, (_, i) => i)
      : Array.from({ length: revealedCount }, (_, i) => visualChunks.length - revealedCount + i);
  }, [isForward, revealedCount, visualChunks.length]);

  const recognizedCount = useMemo(() => {
    if (!resultMask) return 0;
    return resultMask.filter(Boolean).length;
  }, [resultMask]);

  // Bug 1 fix: dynamic node sizes — shrink proportionally for 4+ chunks to prevent row overflow
  const nodeSize = useMemo(() => {
    const count = visualChunks.length;
    return count <= 3 ? 64 : Math.max(44, 64 - (count - 3) * 8);
  }, [visualChunks.length]);
  const nodeFontSize = useMemo(() => Math.round(nodeSize * 0.3), [nodeSize]);
  const connectorWidth = useMemo(() => {
    const count = visualChunks.length;
    return count <= 3 ? 20 : Math.max(8, 20 - (count - 3) * 4);
  }, [visualChunks.length]);

  // Animate the action panel above the footer
  // Bug 2 fix: use isPerfect (same gate as pass/fail) instead of !hasErrors (any wrong phoneme)
  useEffect(() => {
    Animated.timing(resultFadeAnim, {
      toValue: sessionState === 'result' && isPerfect === true ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [sessionState, isPerfect, resultFadeAnim]);

  // Handle chunk tap to hear audio
  const onChunkTap = useCallback(async (index: number) => {
    if (nodeStates[index] === 'hidden') return;
    await tts.playPhoneme(phonemicChunks[index] ?? visualChunks[index]);
  }, [nodeStates, phonemicChunks, visualChunks, tts]);

  // Recording and processing
  useEffect(() => {
    if (sessionState !== 'recording') return;
    setNodeStates((prev) => prev.map((s) => (s !== 'hidden' ? 'active' : s)));
  }, [sessionState]);

  useEffect(() => {
    if (sessionState !== 'processing') return;

    // Stop any in-flight assistant audio before starting waiting audio
    if (sessionState !== 'processing') return;

    const assistantLines = session.payload?.assistantLines ?? (session.payload as any)?.assistant_lines;
    if (aiEnabled && assistantLines) {
      setIsAssistantSpeaking(true);
      waitingPromiseRef.current = clarioAssistant.playWaiting(
        assistantLines,
        session.payload?.moduleDir ?? '',
        lang,
        (text) => setAiBubbleMessage(text)
      );
      waitingPromiseRef.current.finally(() => setIsAssistantSpeaking(false));
    }

    shimmerX.setValue(-40);
    const loop = Animated.loop(
      Animated.timing(shimmerX, { toValue: 340, duration: 900, useNativeDriver: true })
    );
    loop.start();

    (async () => {
      const uri = await stopRecording();
      if (uri) {
        const indices = activeIndices;

        // Build space-separated IPA for all active chunks (used by Allosaurus directly)
        const expectedIpa = indices.map(i => phonemicChunks[i] ?? visualChunks[i]).join(' ');

        if (!expectedIpa.trim()) {
          console.warn('[SyllableChaining] No IPA targets available; skipping analysis');
          loop.stop();
          setSessionState('idle');
          clarioAssistant.stop();
          return;
        }

        let analysis: PhonemeDetectResponse | undefined;
        try {
          console.log(`[SyllableChaining] 🔍 analyzePhonemesOnly → expectedIpa="${expectedIpa}"`);
          analysis = await UAB_API.analyzePhonemesOnly(uri, expectedIpa, lang);
        } catch (e) {
          console.warn('[SyllableChaining] Analysis error:', e);
        }
        console.log(`[SyllableChaining] ✅ accuracy=${analysis?.accuracy_score ?? 'N/A'}% | matches=${analysis?.phoneme_matches.length ?? 0}`);

        setLastAnalysis(analysis ?? null);

        // Bug 3 fix: adaptive easification — lower threshold after repeated failures
        const baseThreshold =
          ((session.payload?.items as any)?.success_criteria?.accuracy_threshold ?? 0.85) * 100;
        // Efficient mode: leniency kicks in 1 failure earlier than assistant mode
        const leniencyStart = mode === 'efficient' ? 1 : 2;
        const retryLeniency =
          retryCount >= leniencyStart + 2 ? 20 :
          retryCount >= leniencyStart     ? 10 : 0;
        // Long words (4+ chunks) are inherently harder — apply a baseline reduction
        const chunkLeniency = visualChunks.length >= 4 ? 5 : 0;
        const THRESHOLD_FLOOR = 60;  // never drop below 60%
        const effectiveThreshold = Math.max(
          THRESHOLD_FLOOR,
          baseThreshold - chunkLeniency - retryLeniency,
        );

        // Bug 2 fix: derive pass/fail from the same gate used everywhere
        const perfect = (analysis?.accuracy_score ?? 0) >= effectiveThreshold;

        loop.stop();
        const newestIndex = isForward ? indices[indices.length - 1] : indices[0];
        const mask = visualChunks.map((_, i) =>
          indices.includes(i) ? (perfect || i !== newestIndex) : false
        );
        setFailedSyllable(visualChunks[newestIndex] ?? '');
        setResultMask(mask);
        setIsPerfect(perfect);
        setSessionState('result');

        // Bug 3 fix: update retry counter so next recording gets correct leniency
        if (perfect) {
          setRetryCount(0);
        } else {
          setRetryCount((prev) => prev + 1);
        }

        setNodeStates(visualChunks.map((_, i) => (indices.includes(i) ? 'idle' : 'hidden')));
        mask.forEach((ok, index) => {
          if (indices.includes(index)) {
            setTimeout(() => {
              setNodeStates((prev) => {
                const next = [...prev];
                next[index] = ok ? 'correct' : 'wrong';
                return next;
              });
            }, index * 220);
          }
        });

        if (perfect) {
          session.recordAttempt('correct');
        } else {
          session.recordAttempt('incorrect');
        }

        if (waitingPromiseRef.current) {
          await waitingPromiseRef.current;
          waitingPromiseRef.current = null;
        }

        if (aiEnabled && assistantLines) {
          // Stop the 'waiting' audio before playing the result validation
          clarioAssistant.stop();
          setIsAssistantSpeaking(true);
          clarioAssistant.playValidation(
            assistantLines,
            session.payload?.moduleDir ?? '',
            perfect ? 0 : 1,
            lang,
            (text) => setAiBubbleMessage(text)
          ).finally(() => setIsAssistantSpeaking(false));
        }
      } else {
        loop.stop();
        setSessionState('idle');
        clarioAssistant.stop();
      }
    })();

    return () => { loop.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState, shimmerX, visualChunks, stopRecording, session, aiEnabled, lang, phonemicChunks, isForward, activeIndices, retryCount, mode]);

  const onMicPressIn = useCallback(async () => {
    if (sessionState === 'idle') {
      setResultMask(null);
      setSessionState('recording');
      recordStartRef.current = Date.now();
      await startRecording();
    }
  }, [sessionState, startRecording]);

  const onMicPressOut = useCallback(async () => {
    if (sessionState === 'recording') {
      const duration = Date.now() - recordStartRef.current;
      if (duration < 500) {
        // Bug 7 fix: give the user visible feedback instead of silently discarding
        setSessionState('idle');
        await stopRecording();
        setTooShortWarning(true);
        setTimeout(() => setTooShortWarning(false), 2000);
        console.warn('[SyllableChaining] Recording too short, ignoring');
        return;
      }
      setSessionState('processing');
    }
  }, [sessionState, stopRecording]);

  const onRetry = useCallback(() => {
    setResultMask(null);
    setLastAnalysis(null);
    setFailedSyllable('');
    setIsPerfect(null);
    setNodeStates((prev) => prev.map((s) => (s !== 'hidden' ? 'idle' : 'hidden')));
    setSessionState('idle');
  }, []);

  // Bug 3 fix: skip to the next word after too many failed attempts
  const onSkip = useCallback(() => {
    setRetryCount(0);
    setResultMask(null);
    setLastAnalysis(null);
    setIsPerfect(null);
    setFailedSyllable('');
    setSessionState('idle');
    const hasNext = session.nextItem();
    if (!hasNext) {
      session.completeSession();
      setTimeout(() => router.back(), 500);
    }
  }, [session, router]);

  const onContinue = useCallback(async () => {
    clarioAssistant.stop();
    tts.stop();
    // Support both camelCase (practiceMapper) and snake_case (raw data.json) keys
    const assistantLines = session.payload?.assistantLines ?? (session.payload as any)?.assistant_lines;
    // If not all chunks revealed yet, reveal next chunk
    if (revealedCount < visualChunks.length) {
      const nextCount = revealedCount + 1;
      setRevealedCount(nextCount);
      setNodeStates((prev) => {
        const next = [...prev];
        if (isForward) {
          for (let i = 0; i < nextCount; i++) next[i] = 'idle';
        } else {
          for (let i = visualChunks.length - 1; i >= visualChunks.length - nextCount; i--) next[i] = 'idle';
        }
        return next;
      });
      setResultMask(null);
      setLastAnalysis(null);
      setFailedSyllable('');
      setSessionState('idle');

      if (aiEnabled && assistantLines) {
        setIsAssistantSpeaking(true);
        clarioAssistant.playTransition(
          assistantLines,
          session.payload?.moduleDir ?? '',
          lang,
          (text) => setAiBubbleMessage(text)
        ).finally(() => setIsAssistantSpeaking(false));
      }
      return;
    }

    // All chunks revealed and correct — play full word as reward
    await tts.playWord(targetWord);
    setLastAnalysis(null);
    setFailedSyllable('');

    // Next item
    const hasNext = session.nextItem();
    if (!hasNext) {
      if (aiEnabled && assistantLines) {
        setIsAssistantSpeaking(true);
        await clarioAssistant.playCompletion(
          assistantLines,
          session.payload?.moduleDir ?? '',
          lang
        );
        setIsAssistantSpeaking(false);
      }
      session.completeSession();
      setTimeout(() => router.back(), 1000);
    } else {
      if (aiEnabled && assistantLines) {
        setIsAssistantSpeaking(true);
        clarioAssistant.playTransition(
          assistantLines,
          session.payload?.moduleDir ?? '',
          lang,
          (text) => setAiBubbleMessage(text)
        ).finally(() => setIsAssistantSpeaking(false));
      }
    }
  }, [revealedCount, visualChunks, isForward, targetWord, tts, session, router, aiEnabled, lang]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <GradientGlow color={CORAL} isDark={isDark} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View style={[styles.header, { borderBottomColor: border, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 4 : 8 }]}> 
        <TouchableOpacity onPress={() => { tts.stop(); router.back(); }} style={[styles.closeBtn, { backgroundColor: isDark ? '#152034' : '#EEF4F7' }]}> 
          <Ionicons name="close" size={18} color={subtle} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: text }]}>Syllable Chaining</Text>
          <Text style={[styles.headerMeta, { color: subtle }]}>{session.progressLabel}</Text>
        </View>

        <AICoPilotToggle state={aiEnabled ? 'idle' : 'off'} onToggle={() => setAiEnabled(!aiEnabled)} />
      </View>

      {aiEnabled && <View style={[styles.aiGlowStrip, { backgroundColor: AI_ACCENT + '28' }]} />}

      <View style={[styles.progressTrack, { backgroundColor: isDark ? '#162033' : '#E4EBF2' }]}> 
        <View style={[styles.progressFill, { width: `${session.progress * 100}%`, backgroundColor: CORAL }]} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom + 32, 48) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.chipRow}>
          <View style={[styles.modeChip, { backgroundColor: CORAL + '12', borderColor: CORAL + '26' }]}> 
            <Ionicons name="mic-outline" size={13} color={CORAL} />
            <Text style={[styles.modeChipText, { color: CORAL }]}>
              {isForward ? 'Forward Chain' : 'Backward Chain'}
            </Text>
          </View>
          <View style={[styles.modeChip, { backgroundColor: isDark ? '#162033' : '#F1F5FA', borderColor: border }]}> 
            <Text style={[styles.modeChipText, { color: subtle }]}>
              Chunk {revealedCount}/{visualChunks.length}
            </Text>
          </View>
        </View>

        <View style={[
          styles.card, 
          { 
            backgroundColor: surface, 
            borderColor: sessionState === 'recording' ? CORAL + '70' : border,
            shadowColor: CORAL,
            shadowOpacity: sessionState === 'recording' ? 0.22 : 0.07,
            shadowRadius: sessionState === 'recording' ? 24 : 12,
            elevation: 8,
          }
        ]}>
          <View style={[styles.cardGlow, { backgroundColor: CORAL + '10' }]} />

          <View style={styles.chainArea}>
            <View style={styles.chainRow}>
              {visualChunks.map((syllable, index) => (
                <React.Fragment key={`${syllable}-${index}`}>
                  <ChunkNode
                    label={syllable}
                    state={nodeStates[index] ?? 'hidden'}
                    isStrong={stressMap[index] ?? false}
                    nodeSize={nodeSize}
                    nodeFontSize={nodeFontSize}
                    isDark={isDark}
                    borderColor={isDark ? '#2A364B' : '#D6E0EB'}
                    onPress={
                      nodeStates[index] !== 'hidden' && sessionState === 'idle'
                        ? () => onChunkTap(index)
                        : undefined
                    }
                  />
                  {index < visualChunks.length - 1 && (
                    <View
                      style={[
                        styles.connector,
                        {
                          width: connectorWidth,
                          backgroundColor: nodeStates[index] === 'correct' ? CORAL : (isDark ? '#30405A' : '#CBD7E4'),
                        },
                      ]}
                    />
                  )}
                </React.Fragment>
              ))}

              {sessionState === 'processing' && (
                <Animated.View
                  style={[styles.shimmer, { transform: [{ translateX: shimmerX }] }]}
                />
              )}
            </View>

            {/* Stress pattern legend */}
            <View style={styles.stressRow}>
              {stressPattern.split('').map((c, i) => (
                <Text
                  key={i}
                  style={[
                    styles.stressChar,
                    { color: c === 'S' ? CORAL : subtle, fontWeight: c === 'S' ? '900' : '400' },
                  ]}
                >
                  {c === 'S' ? '●' : '○'}
                </Text>
              ))}
            </View>

            <Text style={[styles.targetLine, { color: CORAL }]}>
              {visualChunks.filter((_, i) => nodeStates[i] !== 'hidden').join(' · ')}
            </Text>
            
            <View style={styles.helperZone}>
              <Text style={[styles.helperLine, { color: subtle }]}>
                {tooShortWarning ? '⏱ Hold the mic a little longer!' :
                 sessionState === 'idle' ? 'Tap chunks to hear, then record' :
                 sessionState === 'recording' ? 'Release to stop' :
                 sessionState === 'processing' ? 'Analysing chain…' :
                 resultMask?.some((ok, i) => activeIndices.includes(i) && !ok) === false ? 'Excellent!' : 'Try again for this chunk'}
              </Text>
            </View>

            {sessionState === 'result' && (
              <Text style={[styles.scoreLine, { color: resultMask?.slice(0, revealedCount).every(Boolean) ? '#10B981' : subtle }]}>
                <Text style={{ color: CORAL, fontWeight: '800' }}>{recognizedCount} / {revealedCount}</Text>
                {resultMask?.slice(0, revealedCount).every(Boolean)
                  ? ' · Perfect chain!'
                  : ' syllables recognized'}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.listenBtn, { borderColor: CORAL + '40', backgroundColor: CORAL + '12' }]}
              onPress={() => tts.playWord(targetWord)}
            >
              <Ionicons name="volume-medium-outline" size={15} color={CORAL} />
              <Text style={[styles.listenText, { color: CORAL }]}>Hear full word</Text>
            </TouchableOpacity>
          </View>

          {/* Action buttons inside the card */}
          <View style={styles.cardActions}>
            {sessionState === 'result' ? (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: isDark ? '#162033' : '#F1F5FA', borderColor: border }]}
                  onPress={onRetry}
                >
                  <Ionicons name="refresh" size={16} color={text} />
                  <Text style={[styles.actionBtnText, { color: text }]}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.actionBtn, 
                    styles.actionBtnPrimary, 
                    { backgroundColor: isPerfect === true ? CORAL : CORAL + '30' }
                  ]}
                  onPress={onContinue}
                  disabled={isPerfect !== true}
                >
                  <Text style={[styles.actionBtnText, { color: isPerfect === true ? '#FFF' : '#FFF8' }]}>
                    {revealedCount < visualChunks.length ? 'Add next chunk' : 'Continue'}
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color={isPerfect === true ? '#FFF' : '#FFF8'} />
                </TouchableOpacity>
              </>
            ) : (
              <MicButton
                sessionState={sessionState}
                color={CORAL}
                subtle={subtle}
                disabled={isAssistantSpeaking}
                onPressIn={onMicPressIn}
                onPressOut={onMicPressOut}
              />
            )}
          </View>
        </View>

        {aiEnabled && showBubble && (
          <View style={styles.bubbleWrap}>
            <AIFeedbackBubble
              message={aiBubbleMessage || "Listen to the syllable chunks and repeat them back."}
              isSpeaking={isAssistantSpeaking}
              onDismiss={() => setShowBubble(false)}
              style={{ marginHorizontal: 0, marginBottom: 0 }}
            />
          </View>
        )}
      </ScrollView>

      {/* Error modal — appears only when this attempt failed (Bug 2 fix: use isPerfect not hasErrors) */}
      <ChunkErrorModal
        visible={sessionState === 'result' && isPerfect === false}
        syllable={failedSyllable}
        phonemeMatches={lastAnalysis?.phoneme_matches ?? []}
        onRetry={onRetry}
        onSkip={onSkip}
        showSkip={retryCount >= 4}
        surface={surface}
        text={text}
        subtle={subtle}
        border={border}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerMeta: { fontSize: 12, marginTop: 2, fontWeight: '500' },
  aiGlowStrip: { height: 3 },
  progressTrack: { height: 5, marginHorizontal: 24, marginTop: 12, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  scroll: { paddingHorizontal: 20, paddingTop: 14, gap: 14 },

  chipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  modeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1,
  },
  modeChipText: { fontSize: 11, fontWeight: '600' },

  card: {
    borderRadius: 28,
    borderWidth: 1,
    paddingTop: 0,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  cardGlow: { height: 4 },

  chainArea: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 32,
    paddingBottom: 24,
    minHeight: 280,
    justifyContent: 'space-between',
  },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    position: 'relative',
    overflow: 'hidden',
  },
  node: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 3, height: 3 },
    elevation: 4,
  },
  nodeHidden: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  nodeText: { fontSize: 20, fontWeight: '700' },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: { width: 20, height: 1.4 },
  shimmer: {
    position: 'absolute',
    width: 20,
    height: 86,
    borderRadius: 10,
    backgroundColor: CORAL + '40',
  },
  stressRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  stressChar: {
    fontSize: 14,
  },
  targetLine: { fontSize: 24, fontWeight: '700', letterSpacing: 4, marginBottom: 4 },
  helperZone: { height: 20, justifyContent: 'center', alignItems: 'center' },
  helperLine: { fontSize: 13, fontWeight: '500' },
  scoreLine: { marginTop: 14, fontSize: 14, fontWeight: '600' },

  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 20,
  },
  listenText: { fontSize: 12, fontWeight: '700' },

  cardActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, paddingBottom: 20, paddingTop: 4, gap: 10,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 13,
  },
  actionBtnPrimary: { borderWidth: 0 },
  actionBtnText: { fontSize: 14, fontWeight: '700' },

  bubbleWrap: { marginTop: 4 },
});

// ─── Modal styles (separate stylesheet for ChunkErrorModal) ───────────────────
const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 44,
    alignItems: 'center',
  },
  iconCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  matchesBox: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    marginBottom: 24,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  pillText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  heardLabel: {
    fontSize: 11,
    flex: 1,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 27,
    shadowColor: CORAL,
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  retryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  // Bug 3 fix: skip button styles
  skipBtn: {
    alignSelf: 'stretch',
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  skipBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

