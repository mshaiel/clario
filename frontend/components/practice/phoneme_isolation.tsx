import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { AICoPilotToggle } from '@/components/detection/AICoPilotToggle';
import { AIFeedbackBubble } from '@/components/detection/AIFeedbackBubble';
import { MicButton } from '@/components/practice/MicButton';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';
import { useAppTheme } from '@/theme-provider';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UAB_API } from '@/lib/api';
import { clarioAssistant } from '@/lib/clarioAssistant';
import { buildTargetsJson, deriveTestType, getDiagnosisInfo } from '@/lib/practiceUtils';
import type { Language, PhonemeMatch } from '@/lib/types';

// ─── Constants ───────────────────────────────────────────────────────────────
const PHONEME_ACCURACY_THRESHOLD = 80;
const WORD_ACCURACY_THRESHOLD = 70;
const SUCCESS_TRANSITION_MS = 1500;
const CUE_PLAY_DELAY_MS = 500;
const MIN_RECORDING_DURATION_MS = 500;
const MAX_FAILURES_BEFORE_HINT = 3;

type MicState = 'idle' | 'recording' | 'processing' | 'success' | 'failure';
type Stage = 1 | 2 | 3; // 1=phoneme, 2=nonsense bridge, 3=full word

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a theme hex color to an rgba() string with the given 0–1 alpha.
 *  Falls back gracefully if the hex is malformed. Always safe on Android. */
function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── SpeakingBars ─────────────────────────────────────────────────────────────
function SpeakingBars({ active, color }: { active: boolean; color: string }) {
  if (!active) {
    return <Ionicons name="ear-outline" size={16} color={color} />;
  }
  return (
    <View style={speakingBarsStyles.container}>
      {[0, 1, 2].map((bar) => (
        <View
          key={bar}
          style={[speakingBarsStyles.bar, { height: 8 + (bar % 2) * 6, backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

const speakingBarsStyles = StyleSheet.create({
  container: {
    width: 16,
    height: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
});

// ─── StageIndicator ───────────────────────────────────────────────────────────
/**
 * Fixes:
 * - Dots are now 28px tall (accessible tap target with padding)
 * - Active dot scales width, all others remain pill-shaped
 * - Completed dots show a checkmark icon
 */
function StageIndicator({
  current,
  primary,
}: {
  current: Stage;
  primary: string;
}) {
  const DONE_COLOR = '#10B981';
  const IDLE_COLOR = '#D1D5DB';

  return (
    <View style={stageStyles.row} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 3, now: current }}>
      {([1, 2, 3] as Stage[]).map((stage) => {
        const isDone = stage < current;
        const isActive = stage === current;
        return (
          <View
            key={stage}
            accessibilityLabel={`Stage ${stage}${isDone ? ', completed' : isActive ? ', current' : ''}`}
            style={[
              stageStyles.dot,
              {
                width: isActive ? 36 : 10,
                backgroundColor: isDone ? DONE_COLOR : isActive ? primary : IDLE_COLOR,
              },
            ]}
          >
            {isDone && <Ionicons name="checkmark" size={8} color="#FFF" />}
          </View>
        );
      })}
    </View>
  );
}

const stageStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
    // Generous vertical padding so the hit area meets 44pt even when dots are small
    paddingVertical: 10,
  },
  dot: {
    height: 10,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    // Expand tap area to 44pt minimum
    minHeight: 10,
  },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────
export function PhonemeIsolationScreen() {
  const { resolvedTheme } = useAppTheme();
  const { aiEnabled, setAiEnabled } = useAICoPilot();
  const router = useRouter();
  const session = usePracticeSession();
  const tts = useTTSPlayback();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; language?: string }>();

  const [aiBubbleMessage, setAiBubbleMessage] = useState<string | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<any>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [micState, setMicState] = useState<MicState>('idle');
  const [remainingTime, setRemainingTime] = useState(5);

  const hasPlayedIntroRef = useRef(false);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const lang = (params.language as Language) ?? 'english';
  const mode = (params.mode === 'assistant' ? 'assistant' : 'efficient') as 'efficient' | 'assistant';

  const isDark = resolvedTheme.dark;
  const primary = resolvedTheme.colors.primary;
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#7A8FA3' : '#8D9FAE';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const bg = isDark ? '#080A10' : '#F0F4F8';
  const border = isDark ? '#252D3A' : '#E2E8EF';
  const trackBg = isDark ? '#1A2030' : '#E6EBF0';

  useEffect(() => {
    return () => {
      clarioAssistant.stop();
      tts.stop();
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!aiEnabled || !session.payload?.assistantLines || hasPlayedIntroRef.current) return;
    hasPlayedIntroRef.current = true;
    setIsAssistantSpeaking(true);
    clarioAssistant
      .playIntro(
        session.payload.assistantLines,
        session.payload.moduleDir ?? '',
        session.currentItemIndex > 0 ? 'resume' : 'fresh',
        lang,
        (t) => setAiBubbleMessage(t)
      )
      .finally(() => setIsAssistantSpeaking(false));
  }, [aiEnabled, session.payload?.assistantLines, session.currentItemIndex, session.payload?.moduleDir, lang]);

  const [isCuePlaying, setIsCuePlaying] = useState(false);
  const [currentStage, setCurrentStage] = useState<Stage>(1);
  const [failureCount, setFailureCount] = useState<Record<Stage, number>>({ 1: 0, 2: 0, 3: 0 });
  const [detectedStr, setDetectedStr] = useState<string | null>(null);

  const recordStartRef = useRef<number>(0);
  const { startRecording, stopRecording, metering } = useAudioRecorder();

  const { errorName, majorType } = getDiagnosisInfo(
    session.card?.diagnosis,
    session.payload?.setDiagnosis
  );
  const testType = deriveTestType(errorName, majorType) as any;

  const targetPhoneme = session.targetPhoneme ?? 'k';
  const productionMode = String(
    session.currentItem?.production_mode ?? session.payload?.level?.production_mode ?? 'imitation'
  );
  const nonsenseBridge = String(session.currentItem?.nonsense_bridge ?? `${targetPhoneme}a`);
  const targetWord = String(session.currentItem?.word ?? 'cat');
  const targetIpa = String(session.currentItem?.ipa ?? `${targetPhoneme} a t`);
  const highlightIndices: number[] = session.currentItem?.highlight_ipa_indices ?? [];

  const nonsenseIpa = useMemo(() => {
    if (session.currentItem?.nonsense_ipa) return String(session.currentItem.nonsense_ipa);
    const tokens = targetIpa.split(' ').filter(Boolean);
    const cleanBridge = nonsenseBridge.replace(/\s+/g, '');
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j <= tokens.length; j++) {
        const slice = tokens.slice(i, j);
        if (slice.join('') === cleanBridge) return slice.join(' ');
      }
    }
    return `${targetPhoneme} ʌ`;
  }, [session.currentItem, targetIpa, nonsenseBridge, targetPhoneme]);

  const ipaSegments = useMemo(() => {
    const chars = targetIpa.split(' ').filter(Boolean);
    return chars.map((char, idx) => ({
      char,
      highlighted:
        highlightIndices.length > 0
          ? idx >= highlightIndices[0] && idx <= (highlightIndices[1] ?? highlightIndices[0])
          : false,
    }));
  }, [targetIpa, highlightIndices]);

  const stageConfig = useMemo(
    () => ({
      1: {
        title: 'Isolated Phoneme',
        displayText: `/${targetPhoneme}/`,
        description: 'Pronounce the sound',
        ttsText: targetPhoneme,
      },
      2: {
        title: 'Nonsense Bridge',
        displayText: `/${nonsenseBridge}/`,
        description: 'Pronounce the syllable',
        ttsText: nonsenseBridge,
      },
      3: {
        title: 'Target Word',
        displayText: targetWord,
        description: 'Say the word',
        ttsText: targetWord,
      },
    }),
    [targetPhoneme, nonsenseBridge, targetWord]
  );

  const current = stageConfig[currentStage];

  useEffect(() => {
    if (aiEnabled) return; 

    const t = setTimeout(() => {
      onListenCue();
    }, 500);
    return () => clearTimeout(t);
  }, [currentStage, session.currentItemIndex, aiEnabled]);

  useEffect(() => {
    if (micState !== 'recording') return;

    const countdown = setInterval(() => {
      setRemainingTime((prev) => {
        if (prev <= 1) {
          clearInterval(countdown);
          setMicState((s) => (s === 'recording' ? 'processing' : s));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdown);
  }, [micState]);

  const onListenCue = useCallback(async () => {
    if (isCuePlaying) return;
    setIsCuePlaying(true);
    await tts.playPhoneme(current.ttsText);
    setIsCuePlaying(false);
  }, [isCuePlaying, current.ttsText, tts]);

  const handleProcessing = useCallback(async () => {
    if (aiEnabled) {
      setAiBubbleMessage('Analyzing…');
      tts.synthesizeOnly('Analyzing…').then((url) => {
        if (url) tts.playFromUrl(url);
      });
    }

    const uri = await stopRecording();
    if (!uri) {
      setMicState('idle');
      clarioAssistant.stop();
      return;
    }

    const rawIpa =
      currentStage === 1 ? targetPhoneme : currentStage === 3 ? targetIpa : nonsenseIpa;

    const targetsJson = buildTargetsJson(current.displayText, rawIpa);
    if (!targetsJson) {
      console.warn('[PhonemeIsolation] Missing IPA targets; skipping analysis');
      setMicState('idle');
      clarioAssistant.stop();
      return;
    }

    let success = false;
    let analysisScore = 0;
    let flaggedWords: any[] = [];
    let detected: string | null = null;

    try {
      const res = await UAB_API.analyzePhonemesOnly(uri, rawIpa, lang);
      
      if (currentStage === 3) {
        success = res.accuracy_score >= WORD_ACCURACY_THRESHOLD;
      } else {
        success = res.accuracy_score >= PHONEME_ACCURACY_THRESHOLD;
      }
      
      analysisScore = res.accuracy_score;
      setLastAnalysis(res);
      if (!success && res.detected_phonemes?.length) {
        detected = `Expected /${rawIpa.trim()}/ · Heard /${res.detected_phonemes.join(' ')}/`;
      }
    } catch (e) {
      console.warn('[PhonemeIsolation] Analysis error:', e);
    }

    setDetectedStr(detected);
    setMicState(success ? 'success' : 'failure');

    session.recordAttempt(success ? 'correct' : 'incorrect', {
      stage: currentStage,
      word: current.displayText,
      accuracy_score: analysisScore,
      flagged_words: flaggedWords,
    });

    if (success) {
      setFailureCount((prev) => ({ ...prev, [currentStage]: 0 }));
      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        clarioAssistant
          .playValidation(
            session.payload.assistantLines,
            session.payload.moduleDir ?? '',
            0,
            lang,
            (t) => setAiBubbleMessage(t)
          )
          .finally(() => setIsAssistantSpeaking(false));
      }
    } else {
      setFailureCount((prev) => {
        const newCount = prev[currentStage] + 1;
        if (newCount >= MAX_FAILURES_BEFORE_HINT) {
          const timeoutId = setTimeout(() => onListenCue(), CUE_PLAY_DELAY_MS);
          timeoutsRef.current.add(timeoutId);
          return { ...prev, [currentStage]: 0 };
        }
        return { ...prev, [currentStage]: newCount };
      });
      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        clarioAssistant
          .playValidation(
            session.payload.assistantLines,
            session.payload.moduleDir ?? '',
            1,
            lang,
            (t) => setAiBubbleMessage(t)
          )
          .finally(() => setIsAssistantSpeaking(false));
      }
    }
  }, [
    currentStage,
    targetPhoneme,
    targetIpa,
    nonsenseIpa,
    current.displayText,
    lang,
    testType,
    mode,
    aiEnabled,
    session,
    stopRecording,
    onListenCue,
    tts,
  ]);

  useEffect(() => {
    if (micState === 'processing') {
      handleProcessing();
    }
  }, [micState, handleProcessing]);

  useEffect(() => {
    if (micState !== 'success' && micState !== 'failure') return;

    const reset = setTimeout(async () => {
      if (micState === 'success') {
        if (currentStage < 3) {
          setCurrentStage((prev) => (prev + 1) as Stage);
          if (aiEnabled && session.payload?.assistantLines) {
            setIsAssistantSpeaking(true);
            clarioAssistant
              .playTransition(
                session.payload.assistantLines,
                session.payload.moduleDir ?? '',
                lang,
                (t) => setAiBubbleMessage(t)
              )
              .finally(() => setIsAssistantSpeaking(false));
          }
        } else {
          const hasNext = session.nextItem();
          if (hasNext) {
            setCurrentStage(1);
            if (aiEnabled && session.payload?.assistantLines) {
              setIsAssistantSpeaking(true);
              clarioAssistant
                .playTransition(
                  session.payload.assistantLines,
                  session.payload.moduleDir ?? '',
                  lang,
                  (t) => setAiBubbleMessage(t)
                )
                .finally(() => setIsAssistantSpeaking(false));
            }
          } else {
            if (aiEnabled && session.payload?.assistantLines) {
              setIsAssistantSpeaking(true);
              await clarioAssistant.playCompletion(
                session.payload.assistantLines,
                session.payload.moduleDir ?? '',
                lang
              );
              setIsAssistantSpeaking(false);
            }
            await session.completeSession();
            router.back();
          }
        }
        setMicState('idle');
        setRemainingTime(5);
      }
    }, SUCCESS_TRANSITION_MS);
    timeoutsRef.current.add(reset);

    return () => {
      clearTimeout(reset);
      timeoutsRef.current.delete(reset);
    };
  }, [micState, currentStage, session, router, aiEnabled, lang]);

  const onRetry = useCallback(() => {
    setLastAnalysis(null);
    setMicState('idle');
    setDetectedStr(null);
  }, []);

  const onSkip = useCallback(() => {
    setLastAnalysis(null);
    setDetectedStr(null);
    setFailureCount((prev) => ({ ...prev, [currentStage]: 0 }));
    
    if (currentStage < 3) {
      setCurrentStage((prev) => (prev + 1) as Stage);
      setMicState('idle');
    } else {
      const hasNext = session.nextItem();
      if (!hasNext) {
        session.completeSession();
        setTimeout(() => router.back(), 500);
      } else {
        setCurrentStage(1);
        setMicState('idle');
      }
    }
  }, [currentStage, session, router]);

  const onMicPressIn = useCallback(async () => {
    if (micState === 'idle') {
      setDetectedStr(null);
      setRemainingTime(5);
      setMicState('recording');
      recordStartRef.current = Date.now();
      await startRecording();
    }
  }, [micState, startRecording]);

  const onMicPressOut = useCallback(async () => {
    if (micState === 'recording') {
      const duration = Date.now() - recordStartRef.current;
      if (duration < MIN_RECORDING_DURATION_MS) {
        setMicState('idle');
        await stopRecording();
        console.warn('[PhonemeIsolation] Recording too short, ignoring');
        return;
      }
      setMicState('processing');
    }
  }, [micState, stopRecording]);

  const micDisabled =
    micState === 'processing' || micState === 'success' || micState === 'failure';
  const listenDisabled = isCuePlaying;
  const listenLabel =
    currentStage === 3
      ? `Listen to "${targetWord}"`
      : `Listen to /${currentStage === 2 ? nonsenseBridge : targetPhoneme}/`;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View
        style={[
          styles.header,
          {
            borderBottomColor: border,
            paddingTop:
              Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 4 : 8,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => {
            tts.stop();
            router.back();
          }}
          style={[styles.closeBtn, { backgroundColor: trackBg }]}
          accessibilityLabel="Close practice session"
          accessibilityRole="button"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Ionicons name="close" size={18} color={subtle} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: text }]}>Phoneme Practice</Text>
          <Text style={[styles.headerMeta, { color: subtle }]}>{session.progressLabel}</Text>
        </View>

        <AICoPilotToggle
          state={aiEnabled ? 'idle' : 'off'}
          onToggle={() => setAiEnabled(!aiEnabled)}
          accessibilityLabel={aiEnabled ? 'Disable AI co-pilot' : 'Enable AI co-pilot'}
        />
      </View>

      {aiEnabled && (
        <View
          style={[styles.aiGlowStrip, { backgroundColor: withAlpha(primary, 0.18) }]}
        />
      )}

      <View
        style={[styles.progressTrack, { backgroundColor: trackBg }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(session.progress * 100) }}
        accessibilityLabel={`Progress: ${Math.round(session.progress * 100)}%`}
      >
        <View
          style={[
            styles.progressFill,
            { width: `${session.progress * 100}%`, backgroundColor: primary },
          ]}
        />
      </View>

      <View style={styles.chipRow}>
        <View
          style={[
            styles.modeChip,
            { backgroundColor: withAlpha(primary, 0.08), borderColor: withAlpha(primary, 0.2) },
          ]}
        >
          <Ionicons name="mic-outline" size={12} color={primary} />
          <Text style={[styles.modeChipText, { color: primary }]}>
            Stage {currentStage}: {current.title}
          </Text>
        </View>
      </View>

      <StageIndicator current={currentStage} primary={primary} />

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom + 32, 48) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: surface,
              borderColor:
                micState === 'recording' ? withAlpha(primary, 0.6) : border,
              shadowColor: primary,
              shadowOpacity: micState === 'recording' ? 0.22 : 0.07,
              shadowRadius: micState === 'recording' ? 24 : 12,
              elevation: 8,
            },
          ]}
        >
          <View style={styles.topZone}>
            <View
              style={[
                styles.phonemeGlow,
                {
                  backgroundColor: withAlpha(primary, isDark ? 0.14 : 0.07),
                },
              ]}
            />

            <View
              style={[
                styles.phonemeCircle,
                {
                  borderColor: withAlpha(primary, 0.28),
                  backgroundColor: surface,
                },
              ]}
            >
              {currentStage === 3 ? (
                <View style={styles.wordWithIpa}>
                  <Text style={[styles.stageWord, { color: primary }]}>
                    {current.displayText}
                  </Text>
                  <View style={styles.ipaRow}>
                    {ipaSegments.map((seg, i) => (
                      <Text
                        key={i}
                        style={[
                          styles.ipaChar,
                          {
                            color: seg.highlighted ? primary : subtle,
                            backgroundColor: seg.highlighted
                              ? withAlpha(primary, 0.1)
                              : 'transparent',
                            fontWeight: seg.highlighted ? '700' : '500',
                          },
                        ]}
                      >
                        {seg.char}
                      </Text>
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  <Text
                    style={[styles.ipa, { color: primary }]}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    minimumFontScale={0.5}
                    allowFontScaling
                  >
                    {current.displayText}
                  </Text>
                  <Text style={[styles.cueText, { color: subtle }]}>{current.description}</Text>
                </>
              )}
            </View>
          </View>

          <View style={styles.bottomZone}>
            <TouchableOpacity
              style={[
                styles.listenBtn,
                {
                  backgroundColor: withAlpha(primary, listenDisabled ? 0.04 : 0.08),
                  borderColor: withAlpha(primary, listenDisabled ? 0.15 : 0.28),
                  opacity: listenDisabled ? 0.55 : 1,
                },
              ]}
              onPress={onListenCue}
              disabled={listenDisabled}
              accessibilityLabel={listenLabel}
              accessibilityRole="button"
              accessibilityState={{ disabled: listenDisabled, busy: isCuePlaying }}
            >
              <SpeakingBars active={isCuePlaying} color={primary} />
              <Text style={[styles.listenBtnText, { color: primary }]}>{listenLabel}</Text>
            </TouchableOpacity>

            <View style={styles.cardActions}>
              <MicButton
                sessionState={micState}
                color={primary}
                subtle={subtle}
                error={micState === 'failure' ? detectedStr : null}
                disabled={micDisabled || isAssistantSpeaking}
                onPressIn={onMicPressIn}
                onPressOut={onMicPressOut}
              />
            </View>
          </View>
        </View>

        {aiEnabled && aiBubbleMessage && (
          <View style={styles.bubbleWrap}>
            <AIFeedbackBubble
              message={aiBubbleMessage}
              isSpeaking={isAssistantSpeaking}
              onDismiss={() => {
                setAiBubbleMessage(null);
                clarioAssistant.stop();
                setIsAssistantSpeaking(false);
              }}
              style={{ marginHorizontal: 0, marginBottom: 0 }}
            />
          </View>
        )}
      </ScrollView>
      <PhonemeErrorModal
        visible={micState === 'failure'}
        phonemeMatches={lastAnalysis?.phoneme_matches ?? []}
        detectedStr={detectedStr}
        onRetry={onRetry}
        onSkip={onSkip}
        showSkip={(failureCount[currentStage] ?? 0) >= MAX_FAILURES_BEFORE_HINT}
        surface={surface}
        text={text}
        subtle={subtle}
        border={border}
      />
    </SafeAreaView>
  );
}

// ─── Phoneme Error Modal ────────────────────────────────────────────────────────
function PhonemeErrorModal({
  visible,
  phonemeMatches,
  detectedStr,
  onRetry,
  onSkip,
  showSkip,
  surface,
  text: textColor,
  subtle,
  border,
}: {
  visible: boolean;
  phonemeMatches: PhonemeMatch[];
  detectedStr: string | null;
  onRetry: () => void;
  onSkip: () => void;
  showSkip: boolean;
  surface: string;
  text: string;
  subtle: string;
  border: string;
}) {
  const incorrectMatches = phonemeMatches.filter((m) => !m.correct);
  const CORAL = '#F97316';
  
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onRetry}>
      <View style={modalStyles.backdrop}>
        <TouchableOpacity style={modalStyles.backdropTap} activeOpacity={1} onPress={onRetry} />
        <View style={[modalStyles.sheet, { backgroundColor: surface, borderColor: border }]}>
          <View style={[modalStyles.iconCircle, { backgroundColor: CORAL + '1A' }]}>
            <Ionicons name="close-circle" size={32} color={CORAL} />
          </View>
          <Text style={[modalStyles.title, { color: textColor }]}>Pronunciation Error</Text>
          <Text style={[modalStyles.subtitle, { color: subtle }]}>
            {detectedStr ? 'Sound mismatch detected' : 'Please try speaking a bit clearer.'}
          </Text>
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
          <TouchableOpacity
            style={[modalStyles.retryBtn, { backgroundColor: CORAL }]}
            onPress={onRetry}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={16} color="#FFF" />
            <Text style={modalStyles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
          {showSkip && (
            <TouchableOpacity
              style={[modalStyles.skipBtn, { borderColor: subtle + '44' }]}
              onPress={onSkip}
              activeOpacity={0.75}
            >
              <Text style={[modalStyles.skipBtnText, { color: subtle }]}>Skip to next</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
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
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerMeta: { fontSize: 12, marginTop: 2, fontWeight: '500' },
  aiGlowStrip: { height: 3 },
  progressTrack: {
    height: 6,
    marginHorizontal: 24,
    marginTop: 12,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 2,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  modeChipText: { fontSize: 11, fontWeight: '500' },
  scrollContainer: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 6 },
    marginBottom: 20,
  },
  topZone: {
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 28,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  phonemeGlow: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
  },
  phonemeCircle: {
    width: 150,
    maxWidth: '80%',
    aspectRatio: 1,
    borderRadius: 75,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  ipa: {
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 2,
    textAlign: 'center',
  },
  cueText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  wordWithIpa: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  stageWord: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  ipaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  ipaChar: {
    fontSize: 14,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bottomZone: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 8,
  },
  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 20,
    minHeight: 44,
  },
  listenBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },

  // Actions
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingBottom: 4,
  },

  // AI Bubble anchored below card
  bubbleWrap: {
    marginTop: 4,
  },
});

// ─── Modal Styles ───────────────────────────────────────────────────────────
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
    shadowColor: '#F97316',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  retryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
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