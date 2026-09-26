import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AICoPilotToggle, AI_ACCENT } from '@/components/detection/AICoPilotToggle';
import { AIFeedbackBubble } from '@/components/detection/AIFeedbackBubble';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePracticeAnalysis } from '@/hooks/usePracticeAnalysis';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';
import { useAppTheme } from '@/theme-provider';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UAB_API } from '@/lib/api';
import { clarioAssistant } from '@/lib/clarioAssistant';
import { getDiagnosisInfo } from '@/lib/practiceUtils';
import type { Language } from '@/lib/types';

type SessionState = 'idle' | 'recording' | 'processing' | 'result' | 'resting';
type WordStatus = 'idle' | 'correct' | 'miss' | 'skipped';

type DrillWord = {
  text: string;
  status: WordStatus;
  syllables: number;
  ipa?: string;
};

type PacingMetrics = {
  targetWpm: number;
  actualActiveWpm: number;
  rhythmVariance: number;
  isPaceGood: boolean;
  isRhythmConsistent: boolean;
};

const RED = '#EF4444';
const ORANGE = '#F97316';
const ROSE = '#F43F5E';

function WordCell({
  index,
  item,
  isRecording,
  isScanned,
  textColor,
  subtle,
  surface,
  border,
  onPress,
}: {
  index: number;
  item: DrillWord;
  isRecording: boolean;
  isScanned: boolean;
  textColor: string;
  subtle: string;
  surface: string;
  border: string;
  onPress: () => void;
}) {
  const isMiss = item.status === 'miss';
  const baseColor =
    item.status === 'correct' ? '#10B981'
    : item.status === 'miss' ? RED
    : item.status === 'skipped' ? '#F59E0B'
    : textColor;

  const cellBg =
    item.status === 'correct' ? '#10B98114'
    : item.status === 'miss' ? '#EF444414'
    : item.status === 'skipped' ? '#F59E0B14'
    : isRecording && isScanned ? '#F59E0B10'
    : surface;

  const cellBorder =
    item.status === 'correct' ? '#10B98166'
    : item.status === 'miss' ? '#EF444466'
    : item.status === 'skipped' ? '#F59E0B66'
    : border;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={!isMiss}
      style={[styles.wordCell, { backgroundColor: cellBg, borderColor: cellBorder }]}
    >
      <Text style={[styles.wordIndex, { color: subtle }]}>{String(index + 1).padStart(2, '0')}</Text>
      <View style={styles.wordRow}>
        <Text
          style={[
            styles.wordText,
            { color: baseColor, textDecorationLine: isMiss ? 'line-through' : 'none' },
          ]}
        >
          {item.text}
        </Text>
        {isMiss && (
          <View style={styles.errorBadge}>
            <Ionicons name="alert-circle" size={12} color={RED} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function SpeedDrillsScreen() {
  const { resolvedTheme } = useAppTheme();
  const { aiEnabled, setAiEnabled } = useAICoPilot();
  const router = useRouter();
  const session = usePracticeSession();
  const tts = useTTSPlayback();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; language?: string }>();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg = isDark ? '#080A10' : '#F0F4F8';
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#7A8FA3' : '#8D9FAE';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const border = isDark ? '#252D3A' : '#E2E8EF';

  const { startRecording, stopRecording } = useAudioRecorder();

  const { errorName, majorType } = getDiagnosisInfo(session.card?.diagnosis, session.payload?.setDiagnosis);
  const lang = (params.language as Language) ?? 'english';
  const { analyzeRecording } = usePracticeAnalysis(
    String(session.card?.id ?? ''),
    errorName,
    majorType,
    lang,
    (params.mode as any) ?? 'efficient'
  );

  // Payload data
  const rawDrillDuration = session.payload?.items?.drill_duration_seconds;
  const drillDuration = Number(rawDrillDuration) > 0 ? Number(rawDrillDuration) : 30;
  const restInterval = Number(session.payload?.items?.rest_interval_seconds ?? 15);
  const targetRateWpm = Number(session.payload?.items?.target_rate_wpm ?? 120);
  const baselineRateWpm = Number(session.payload?.items?.baseline_rate_wpm ?? 70);
  const accuracyThreshold = Number(session.payload?.items?.accuracy_threshold ?? 0.8);

  const sourceWords = useMemo<DrillWord[]>(() => {
    const backendItems = session.items;
    if (!Array.isArray(backendItems) || backendItems.length === 0) {
      return ['Key', 'Tape', 'Cloud', 'Bridge', 'Sea', 'Pocket', 'Glass', 'Moon', 'Train', 'Map']
        .map((w) => ({ text: w, status: 'idle' as const, syllables: 1, ipa: '' }));
    }
    return backendItems.map((item: any) => ({
      text: String(item?.word || item?.display_text || '').trim(),
      status: 'idle' as const,
      syllables: Number(item?.syllable_count ?? 1),
      ipa: String(item?.ipa ?? ''),
    }));
  }, [session.items]);

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [showBubble, setShowBubble] = useState(true);
  const [aiBubbleMessage, setAiBubbleMessage] = useState<string | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pacingMetrics, setPacingMetrics] = useState<PacingMetrics | null>(null);
  const [pacingFeedback, setPacingFeedback] = useState('');

  const hasPlayedIntroRef = useRef(false);
  const waitingPromiseRef = useRef<Promise<void> | null>(null);

  const handleAIBubbleMessage = useCallback((message: string) => {
    setShowBubble(true);
    setAiBubbleMessage(message);
  }, []);

  const dismissAIBubble = useCallback(() => {
    clarioAssistant.stop();
    setIsAssistantSpeaking(false);
    setAiBubbleMessage(null);
    setShowBubble(false);
  }, []);

  // Stop assistant audio on unmount
  useEffect(() => {
    return () => clarioAssistant.stop();
  }, []);

  // Play intro
  useEffect(() => {
    if (!aiEnabled || !session.payload?.assistantLines || hasPlayedIntroRef.current) return;
    hasPlayedIntroRef.current = true;
    setIsAssistantSpeaking(true);
    clarioAssistant.playIntro(
      session.payload.assistantLines,
      session.payload.moduleDir ?? '',
      session.currentItemIndex > 0 ? 'resume' : 'fresh',
      lang,
      handleAIBubbleMessage
    ).finally(() => setIsAssistantSpeaking(false));
  }, [aiEnabled, session.payload?.assistantLines, session.currentItemIndex, session.payload?.moduleDir, lang, handleAIBubbleMessage]);

  const [scanIndex, setScanIndex] = useState(-1);
  const [words, setWords] = useState<DrillWord[]>(sourceWords);
  const [selectedMissWord, setSelectedMissWord] = useState<string | null>(null);
  const [drillRound, setDrillRound] = useState(1);
  const [restCountdown, setRestCountdown] = useState(restInterval);
  const [drillHistory, setDrillHistory] = useState<{ round: number; correct: number; total: number; time: number; passed: boolean }[]>([]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recordingStartRef = useRef<number>(0);
  const recordingEndRef = useRef<number>(0);

  // Reset when items change
  useEffect(() => {
    setWords(sourceWords);
    setElapsedSeconds(0);
    setScanIndex(-1);
    setSessionState('idle');
    setDrillRound(1);
    setDrillHistory([]);
    setPacingMetrics(null);
    setPacingFeedback('');
    setShowBubble(true);
  }, [sourceWords]);

  // Recording timer (Task-boxed, no auto-stop or scanner)
  useEffect(() => {
    if (sessionState !== 'recording') return;

    // Fast timer just for UI rendering
    const timer = setInterval(() => {
      const ms = Date.now() - recordingStartRef.current;
      setElapsedSeconds(Number((ms / 1000).toFixed(1)));
    }, 100);

    // Visual pace guide
    const msPerWord = Math.round(60000 / (targetRateWpm > 0 ? targetRateWpm : 120));
    const scanner = setInterval(() => {
      setScanIndex((prev: number) => prev + 1);
    }, msPerWord);

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 360, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 360, useNativeDriver: true }),
      ])
    ).start();

    return () => {
      clearInterval(timer);
      clearInterval(scanner);
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    };
  }, [pulseAnim, sessionState, targetRateWpm]);

  // Processing
  useEffect(() => {
    if (sessionState !== 'processing') return;

    if (aiEnabled && session.payload?.assistantLines) {
      setIsAssistantSpeaking(true);
      waitingPromiseRef.current = clarioAssistant.playWaiting(
        session.payload.assistantLines,
        session.payload.moduleDir ?? '',
        lang,
        handleAIBubbleMessage
      );
      waitingPromiseRef.current.finally(() => setIsAssistantSpeaking(false));
    }

    (async () => {
      const uri = await stopRecording();
      if (uri) {
        const fullSentence = sourceWords.map(w => w.text).join(' ');
        const pacing = await UAB_API.analyzePacing(uri, fullSentence, targetRateWpm, lang);

        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z']/g, '').trim();
        const transcribedWords = pacing?.words?.map((w: any) => w.word.toLowerCase()) || [];
        
        const next = sourceWords.map((item) => {
          const normalizedTarget = normalize(item.text);
          const isHeard = transcribedWords.some((tw: string) => normalize(tw) === normalizedTarget);
          return { ...item, status: isHeard ? 'correct' as const : 'miss' as const };
        });
        setWords(next);

        const correct = next.filter((w) => w.status === 'correct').length;
        const pronunciationRatio = next.length ? correct / next.length : 0;
        const metrics = pacing?.metrics ?? {};
        const nextPacingMetrics: PacingMetrics = {
          targetWpm: Number(metrics.target_wpm ?? targetRateWpm),
          actualActiveWpm: Number(metrics.actual_active_wpm ?? 0),
          rhythmVariance: Number(metrics.rhythm_variance ?? 0),
          isPaceGood: Boolean(metrics.is_pace_good),
          isRhythmConsistent: Boolean(metrics.is_rhythm_consistent),
        };
        const isRoundPass =
          pronunciationRatio >= accuracyThreshold &&
          nextPacingMetrics.isPaceGood &&
          nextPacingMetrics.isRhythmConsistent;

        setPacingMetrics(nextPacingMetrics);
        setPacingFeedback(String(pacing?.feedback ?? ''));
        setDrillHistory((prev) => [
          ...prev,
          {
            round: drillRound,
            correct,
            total: next.length,
            time: elapsedSeconds,
            passed: isRoundPass,
          },
        ]);
        setSessionState('result');
        setScanIndex(-1);

        session.recordAttempt(isRoundPass ? 'correct' : 'incorrect', {
          mode: 'speed_drills',
          accuracy_score: Math.round(pronunciationRatio * 100),
          correct_words: correct,
          total_words: next.length,
          pacing_metrics: {
            target_wpm: nextPacingMetrics.targetWpm,
            actual_active_wpm: nextPacingMetrics.actualActiveWpm,
            rhythm_variance: nextPacingMetrics.rhythmVariance,
            is_pace_good: nextPacingMetrics.isPaceGood,
            is_rhythm_consistent: nextPacingMetrics.isRhythmConsistent,
          },
        });

        if (waitingPromiseRef.current) {
          await waitingPromiseRef.current;
          waitingPromiseRef.current = null;
        }

        if (aiEnabled && session.payload?.assistantLines) {
          setIsAssistantSpeaking(true);
          clarioAssistant.playValidation(
            session.payload.assistantLines,
            session.payload.moduleDir ?? '',
            isRoundPass ? 0 : 1,
            lang,
            handleAIBubbleMessage
          ).finally(() => setIsAssistantSpeaking(false));
        }
      } else {
        setSessionState('idle');
        clarioAssistant.stop();
      }
    })();
  }, [sessionState, sourceWords, drillRound, elapsedSeconds, accuracyThreshold, stopRecording, analyzeRecording, session, aiEnabled, targetRateWpm, lang, handleAIBubbleMessage]);

  // Rest countdown
  useEffect(() => {
    if (sessionState !== 'resting') return;
    setRestCountdown(restInterval);

    const countdown = setInterval(() => {
      setRestCountdown((prev: number) => {
        if (prev <= 1) {
          clearInterval(countdown);
          // Auto start next round
          setDrillRound((prev) => prev + 1);
          setWords(sourceWords);
          setElapsedSeconds(0);
          setScanIndex(-1);
          setSessionState('recording');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdown);
  }, [sessionState, restInterval, sourceWords]);

  const correctCount = useMemo(() => words.filter((item) => item.status === 'correct').length, [words]);
  const totalSyllables = useMemo(() => words.reduce((sum, w) => sum + w.syllables, 0), [words]);
  const sps = elapsedSeconds > 0 ? (totalSyllables / elapsedSeconds).toFixed(1) : '0.0';

  const pronunciationRatio = words.length ? correctCount / words.length : 0;

  const isCurrentRoundPass =
    sessionState === 'result' &&
    !!pacingMetrics &&
    pronunciationRatio >= accuracyThreshold &&
    pacingMetrics.isPaceGood &&
    pacingMetrics.isRhythmConsistent;

  const scoreColor =
    sessionState !== 'result'
      ? pronunciationRatio >= accuracyThreshold
        ? '#10B981'
        : pronunciationRatio >= Math.max(0.6, accuracyThreshold - 0.15)
        ? '#F59E0B'
        : RED
      : isCurrentRoundPass
      ? '#10B981'
      : RED;

  const timeProgress = Math.min(elapsedSeconds / drillDuration, 1);
  
  const liveWpm =
    sessionState === 'result' && pacingMetrics
      ? pacingMetrics.actualActiveWpm
      : sessionState === 'recording'
      ? baselineRateWpm
      : baselineRateWpm;
      
  const rateProgress = Math.min(Math.max(liveWpm / targetRateWpm, 0), 1);
  const isBubbleVisible = aiEnabled && showBubble && !!aiBubbleMessage;
  const showMicButton = !isBubbleVisible && sessionState !== 'result';

  const onMicPressIn = useCallback(async () => {
    if (sessionState === 'idle') {
      setSelectedMissWord(null);
      setWords(sourceWords);
      setElapsedSeconds(0);
      setScanIndex(-1);
      setSessionState('recording');
      recordingStartRef.current = Date.now();
      await startRecording();
    }
  }, [sessionState, sourceWords, startRecording]);

  const onMicPressOut = useCallback(async () => {
    if (sessionState === 'recording') {
      recordingEndRef.current = Date.now();
      const ms = recordingEndRef.current - recordingStartRef.current;
      setElapsedSeconds(Number((ms / 1000).toFixed(1)));
      setSessionState('processing');
    }
  }, [sessionState]);

  const onNextRound = useCallback(() => {
    // Enter enforced rest before next round
    setSessionState('resting');
  }, []);

  const onRetry = useCallback(() => {
    setSelectedMissWord(null);
    setWords(sourceWords);
    setElapsedSeconds(0);
    setScanIndex(-1);
    setPacingMetrics(null);
    setPacingFeedback('');
    setDrillHistory([]);
    setDrillRound(1);
    setShowBubble(true);
    setSessionState('idle');
  }, [sourceWords]);

  const onFinish = useCallback(async () => {
    clarioAssistant.stop();
    if (aiEnabled && session.payload?.assistantLines) {
      setIsAssistantSpeaking(true);
      await clarioAssistant.playCompletion(
        session.payload.assistantLines,
        session.payload.moduleDir ?? '',
        lang
      );
      setIsAssistantSpeaking(false);
    }
    session.completeSession();
    setTimeout(() => router.back(), 500);
  }, [session, router, aiEnabled, lang]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View style={[styles.header, { borderBottomColor: border, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 4 : 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.closeBtn, { backgroundColor: isDark ? '#1A2030' : '#EEF1F5' }]}>
          <Ionicons name="close" size={18} color={subtle} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: text }]}>Speed Drills</Text>
          <Text style={[styles.headerMeta, { color: subtle }]}>Round {drillRound}</Text>
        </View>

        <AICoPilotToggle state={aiEnabled ? 'idle' : 'off'} onToggle={() => setAiEnabled(!aiEnabled)} />
      </View>

      {aiEnabled && <View style={[styles.aiGlowStrip, { backgroundColor: AI_ACCENT + '28' }]} />}

      <View style={[styles.progressTrack, { backgroundColor: isDark ? '#1A2030' : '#E6EBF0' }]}>
        <View style={[styles.progressFill, { width: `${timeProgress * 100}%`, backgroundColor: ROSE }]} />
      </View>

      {/* Resting overlay */}
      {sessionState === 'resting' && (
        <View style={[styles.restOverlay, { backgroundColor: bg }]}>
          <View style={[styles.restCard, { backgroundColor: surface, borderColor: border }]}>
            <Ionicons name="hourglass-outline" size={36} color={ORANGE} />
            <Text style={[styles.restTitle, { color: text }]}>Rest Break</Text>
            <Text style={[styles.restCountdown, { color: ORANGE }]}>{restCountdown}s</Text>
            <Text style={[styles.restSubtext, { color: subtle }]}>Next round starts automatically</Text>

            <View style={[styles.restProgress, { backgroundColor: isDark ? '#1A2030' : '#EDF0F3' }]}>
              <View style={[styles.restFill, { width: `${((restInterval - restCountdown) / restInterval) * 100}%`, backgroundColor: ORANGE }]} />
            </View>
          </View>
        </View>
      )}

      <View style={styles.content}>
        <View style={styles.chipRow}>
          <View style={[styles.modeChip, { backgroundColor: RED + '14' }]}>
            <Ionicons name="flash-outline" size={12} color={RED} />
            <Text style={[styles.modeChipText, { color: RED }]}>Expressive</Text>
          </View>
          <View style={[styles.modeChip, { backgroundColor: isDark ? '#1A2030' : '#EEF1F5' }]}>
            <Text style={[styles.modeChipText, { color: subtle }]}>Speed Drill · {accuracyThreshold * 100}% gate</Text>
          </View>
        </View>

        {/* Timer + Speed ladder */}
        <View style={styles.timerRow}>
          <Animated.View
            style={[
              styles.timerRing,
              {
                borderColor: RED + '66',
                backgroundColor: isDark ? '#141B27' : '#FFFFFF',
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <Text style={[styles.timerValue, { color: RED }]}>{elapsedSeconds}</Text>
            <Text style={[styles.timerUnit, { color: subtle }]}>sec</Text>
          </Animated.View>

          {/* Speed ladder */}
          <View style={styles.speedLadder}>
            <Text style={[styles.ladderLabel, { color: subtle }]}>Speed Ladder</Text>
            <View style={[styles.ladderTrack, { backgroundColor: isDark ? '#1A2030' : '#EDF0F3' }]}>
              <View style={[styles.ladderFill, { height: `${rateProgress * 100}%`, backgroundColor: ORANGE }]} />
            </View>
            <Text style={[styles.ladderTarget, { color: ORANGE }]}>{targetRateWpm}</Text>
            <Text style={[styles.ladderBaseline, { color: subtle }]}>{baselineRateWpm}</Text>
            <Text style={[styles.ladderUnit, { color: subtle }]}>WPM</Text>
          </View>

          {/* Live accuracy */}
          <View style={styles.liveStats}>
            <Text style={[styles.liveValue, { color: scoreColor }]}>
              {correctCount}/{words.length}
            </Text>
            <Text style={[styles.liveLabel, { color: subtle }]}>correct</Text>
            <Text style={[styles.spsValue, { color: RED }]}>{sps}</Text>
            <Text style={[styles.liveLabel, { color: subtle }]}>SPS</Text>
          </View>
        </View>

        <View style={[styles.gridCard, { backgroundColor: surface, borderColor: border }]}>
          <View style={styles.wordGrid}>
            {words.map((item, index) => (
              <WordCell
                key={`${item.text}-${index}`}
                index={index}
                item={item}
                isRecording={sessionState === 'recording'}
                isScanned={index <= scanIndex}
                textColor={text}
                subtle={subtle}
                surface={surface}
                border={border}
                onPress={() => setSelectedMissWord(item.status === 'miss' ? item.text : null)}
              />
            ))}
          </View>
        </View>

        {sessionState === 'result' && (
          <>
            {pacingMetrics && (
              <View style={[styles.missInfo, { backgroundColor: isDark ? '#141D2A' : '#F6FAFF', borderColor: isCurrentRoundPass ? '#10B98144' : ORANGE + '55' }]}>
                <Text style={[styles.missInfoTitle, { color: isCurrentRoundPass ? '#10B981' : ORANGE }]}>Pacing {pacingMetrics.actualActiveWpm.toFixed(1)} / {pacingMetrics.targetWpm.toFixed(0)} WPM · variance {pacingMetrics.rhythmVariance.toFixed(3)}</Text>
                <Text style={[styles.missInfoBody, { color: subtle }]}>
                  {pacingFeedback || (isCurrentRoundPass
                    ? 'Great pacing consistency.'
                    : 'Adjust tempo and keep rhythm more even.')}
                </Text>
              </View>
            )}

            {selectedMissWord && (
              <View style={[styles.missInfo, { backgroundColor: isDark ? '#2A171A' : '#FFF3F4', borderColor: RED + '44' }]}>
                <Text style={[styles.missInfoTitle, { color: RED }]}>{selectedMissWord} needs cleanup</Text>
                <Text style={[styles.missInfoBody, { color: subtle }]}>Focus initial consonant release on the next pass.</Text>
              </View>
            )}

            {/* Drill history */}
            {drillHistory.length > 0 && (
              <View style={[styles.historyCard, { backgroundColor: surface, borderColor: border }]}>
                <Text style={[styles.historyTitle, { color: text }]}>Drill History</Text>
                {drillHistory.map((entry, index) => (
                  <View key={`hist-${entry.round}-${index}`} style={styles.historyRow}>
                    <Text style={[styles.historyRound, { color: subtle }]}>R{entry.round}</Text>
                    <View style={[styles.historyBar, { backgroundColor: isDark ? '#1A2030' : '#EDF0F3' }]}>
                      <View style={[styles.historyFill, { width: `${(entry.correct / entry.total) * 100}%`, backgroundColor: entry.passed ? '#10B981' : RED }]} />
                    </View>
                    <Text style={[styles.historyScore, { color: entry.passed ? '#10B981' : RED }]}> 
                      {entry.correct}/{entry.total}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={[styles.resultActions, { backgroundColor: surface, borderColor: border }]}>
              <TouchableOpacity style={[styles.actionBtnGhost, { borderColor: border }]} onPress={onRetry}>
                <Text style={[styles.actionGhostText, { color: text }]}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtnGhost, { borderColor: ORANGE }]} onPress={onNextRound}>
                <Text style={[styles.actionGhostText, { color: ORANGE }]}>Next round</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtnSolid, { backgroundColor: PRIMARY }]} onPress={onFinish}>
                <Text style={styles.actionSolidText}>Finish</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {sessionState === 'processing' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bg + 'DD', alignItems: 'center', justifyContent: 'center', zIndex: 100 }]}>
          <ActivityIndicator size="large" color={RED} />
          <Text style={{ marginTop: 16, color: text, fontSize: 18, fontWeight: 'bold' }}>Analyzing Speech & Speed...</Text>
        </View>
      )}

      {sessionState !== 'result' && sessionState !== 'resting' && (
        <View style={[styles.footer, { borderTopColor: border, paddingBottom: Math.max(insets.bottom + 14, 24) }]}>
          {isBubbleVisible ? (
            <View style={styles.micDock}>
              <AIFeedbackBubble
                message={aiBubbleMessage}
                isSpeaking={isAssistantSpeaking}
                onDismiss={dismissAIBubble}
                style={{ marginHorizontal: 0, marginBottom: 6, width: '100%' }}
              />
            </View>
          ) : null}

          {showMicButton ? (
            <View style={styles.micDock}>
              <TouchableOpacity
                activeOpacity={0.86}
                style={[
                  styles.drillButton,
                  sessionState === 'recording'
                    ? { backgroundColor: isDark ? '#2D1316' : '#4A171D', borderColor: RED }
                    : { backgroundColor: RED, borderColor: ORANGE },
                ]}
                onPressIn={onMicPressIn}
                onPressOut={onMicPressOut}
                disabled={sessionState === 'processing' || isAssistantSpeaking}
              >
                <Ionicons name={sessionState === 'recording' ? 'stop' : 'mic'} size={18} color="#FFF" />
                <Text style={styles.drillButtonText}>
                  {sessionState === 'idle' && 'HOLD TO START'}
                  {sessionState === 'recording' && 'RELEASE TO STOP'}
                  {sessionState === 'processing' && 'ANALYZING…'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={[styles.footerLabel, { color: subtle }]}>
            {sessionState === 'idle' && 'Hold mic, read all words rapidly, release'}
            {sessionState === 'recording' && 'Read all words exactly once as fast as you can'}
            {sessionState === 'processing' && 'Calculating speed and pronunciation…'}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  closeBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerMeta: { fontSize: 12, marginTop: 2, fontWeight: '500' },
  aiGlowStrip: { height: 3 },
  progressTrack: { height: 8, marginHorizontal: 24, marginTop: 12, borderRadius: 6, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  chipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  modeChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },

  // Rest overlay
  restOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 100, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  restCard: { width: '100%', borderWidth: 1, borderRadius: 28, padding: 28, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  restTitle: { fontSize: 22, fontWeight: '800', marginTop: 12 },
  restCountdown: { fontSize: 56, fontWeight: '900', letterSpacing: -2 },
  restSubtext: { fontSize: 13, fontWeight: '500', marginTop: 4, marginBottom: 14 },
  restProgress: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  restFill: { height: '100%', borderRadius: 3 },

  // Timer row
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 12 },
  timerRing: { width: 90, height: 90, borderRadius: 45, borderWidth: 5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  timerValue: { fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  timerUnit: { fontSize: 10, marginTop: -2, fontWeight: '700' },

  // Speed ladder
  speedLadder: { alignItems: 'center', height: 90 },
  ladderLabel: { fontSize: 9, fontWeight: '700', marginBottom: 4 },
  ladderTrack: { width: 8, flex: 1, borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
  ladderFill: { width: '100%', borderRadius: 4 },
  ladderTarget: { fontSize: 10, fontWeight: '800', marginTop: 2 },
  ladderBaseline: { fontSize: 9, fontWeight: '500' },
  ladderUnit: { fontSize: 8, fontWeight: '600' },

  // Live stats
  liveStats: { alignItems: 'center' },
  liveValue: { fontSize: 22, fontWeight: '900' },
  liveLabel: { fontSize: 10, fontWeight: '600', marginBottom: 4 },
  spsValue: { fontSize: 18, fontWeight: '800' },

  gridCard: { borderWidth: 1, borderRadius: 18, padding: 10 },
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  wordCell: { flexBasis: '48%', flexGrow: 1, maxWidth: '49%', minHeight: 62, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'space-between' },
  wordIndex: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  wordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  wordText: { fontSize: 17, fontWeight: '700' },
  errorBadge: { marginLeft: 8 },
  missInfo: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 10 },
  missInfoTitle: { fontSize: 13, fontWeight: '800' },
  missInfoBody: { marginTop: 4, fontSize: 12, lineHeight: 17 },

  // Drill history
  historyCard: { borderWidth: 1, borderRadius: 14, padding: 10, marginTop: 10 },
  historyTitle: { fontSize: 12, fontWeight: '800', marginBottom: 6 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  historyRound: { fontSize: 11, fontWeight: '700', width: 24 },
  historyBar: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  historyFill: { height: '100%', borderRadius: 4 },
  historyScore: { fontSize: 11, fontWeight: '800', width: 30, textAlign: 'right' },

  resultActions: { marginTop: 10, borderWidth: 1, borderRadius: 14, padding: 8, flexDirection: 'row', gap: 8 },
  actionBtnGhost: { flex: 1, borderWidth: 1, borderRadius: 11, height: 42, alignItems: 'center', justifyContent: 'center' },
  actionGhostText: { fontSize: 13, fontWeight: '700' },
  actionBtnSolid: { flex: 1.2, borderRadius: 11, height: 42, alignItems: 'center', justifyContent: 'center' },
  actionSolidText: { color: '#FFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 14, borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  micDock: { alignSelf: 'stretch', alignItems: 'center', marginBottom: 6 },
  drillButton: { width: '100%', height: 60, borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  drillButtonText: { color: '#FFF', fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  footerLabel: { marginTop: 10, fontSize: 12, textAlign: 'center', fontWeight: '500' },
});