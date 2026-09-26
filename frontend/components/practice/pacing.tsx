import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
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
import { useAICoPilot } from '@/context/AICoPilotContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';
import { UAB_API } from '@/lib/api';
import { clarioAssistant } from '@/lib/clarioAssistant';
import { ttsService } from '@/lib/ttsService';
import type { Language } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Constants ────────────────────────────────────────────────────────────────
const PURPLE = '#A855F7';

type SessionState = 'idle' | 'recording' | 'processing' | 'result';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ─── Pendulum ─────────────────────────────────────────────────────────────────
function Pendulum({ bpmMs, color, isRecording }: { bpmMs: number; color: string; isRecording: boolean }) {
  const bobX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isRecording) {
      bobX.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(bobX, { toValue: -36, duration: bpmMs, useNativeDriver: true }),
        Animated.timing(bobX, { toValue: 36, duration: bpmMs, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [bobX, bpmMs, isRecording]);

  return (
    <View style={pendStyles.wrap}>
      <View style={[pendStyles.pivot, { backgroundColor: color + '60' }]} />
      <View style={[pendStyles.stem, { backgroundColor: color + '40' }]} />
      <Animated.View style={[pendStyles.bob, { backgroundColor: color, transform: [{ translateX: bobX }] }]}>
        <View style={[pendStyles.bobInner, { backgroundColor: color + '40' }]} />
      </Animated.View>
    </View>
  );
}

const pendStyles = StyleSheet.create({
  wrap: { width: 140, height: 72, alignItems: 'center', justifyContent: 'flex-start' },
  pivot: { width: 10, height: 10, borderRadius: 5, marginBottom: -1 },
  stem: { width: 2, height: 48, borderRadius: 1 },
  bob: { position: 'absolute', bottom: 2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bobInner: { width: 8, height: 8, borderRadius: 4 },
});

// ─── Beat Dots ────────────────────────────────────────────────────────────────
function BeatDots({ tick, color }: { tick: number; color: string }) {
  const idx = tick % 4;
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
      {[0, 1, 2, 3].map(i => (
        <View
          key={i}
          style={{
            width: i === idx ? 12 : 6,
            height: i === idx ? 12 : 6,
            borderRadius: 8,
            backgroundColor: i === idx ? color : color + '30',
          }}
        />
      ))}
    </View>
  );
}

// ─── Word Pill ────────────────────────────────────────────────────────────────
function WordPill({
  word, state, color, textC, subtle, onPress, disabled
}: {
  word: string; state: 'active' | 'done' | 'upcoming' | 'error';
  color: string; textC: string; subtle: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        wordPillStyles.pill,
        {
          backgroundColor:
            state === 'active' ? color + '22' :
              state === 'done' ? color + '0C' :
                state === 'error' ? '#EF444415' :
                  'transparent',
          borderColor:
            state === 'active' ? color + '88' :
              state === 'done' ? color + '30' :
                state === 'error' ? '#EF444450' :
                  subtle + '40',
        },
      ]}
    >
      <Text
        style={[
          wordPillStyles.text,
          {
            color:
              state === 'active' ? color :
                state === 'done' ? textC :
                  state === 'error' ? '#EF4444' :
                    subtle + '88',
            fontWeight:
              state === 'active' ? '800' :
                state === 'done' ? '600' :
                  state === 'error' ? '600' :
                    '500',
            fontSize: 15,
          },
        ]}
        adjustsFontSizeToFit
        numberOfLines={1}
      >
        {capitalize(word)}
      </Text>
    </TouchableOpacity>
  );
}

const wordPillStyles = StyleSheet.create({
  pill: {
    height: 44,
    width: '46%', // Ensures a 2x2 grid layout
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { letterSpacing: -0.3 },
});

// ─── Mic Button with pulse ring ───────────────────────────────────────────────
function MicButton({
  sessionState, color, subtle, disabled, onPressIn, onPressOut,
}: {
  sessionState: SessionState; color: string; subtle: string; disabled?: boolean;
  onPressIn: () => void; onPressOut: () => void;
}) {
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (sessionState === 'recording') {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ringScale, { toValue: 1.18, duration: 700, useNativeDriver: true }),
            Animated.timing(ringOpacity, { toValue: 0.15, duration: 700, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ringScale, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(ringOpacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
          ]),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      ringScale.setValue(1);
      ringOpacity.setValue(0);
    }
  }, [sessionState, ringScale, ringOpacity]);

  const btnColor =
    sessionState === 'processing' || disabled ? color + '30' :
      sessionState === 'recording' ? '#EF4444' :
        color;

  const ringColor = sessionState === 'recording' ? '#EF4444' : color;

  return (
    <View style={micStyles.outer}>
      <Animated.View
        style={[
          micStyles.ring,
          {
            borderColor: ringColor + '60',
            transform: [{ scale: ringScale }],
            opacity: ringOpacity,
          },
        ]}
        pointerEvents="none"
      />
      <TouchableOpacity
        activeOpacity={0.88}
        style={[micStyles.button, { backgroundColor: btnColor }]}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={sessionState === 'processing' || disabled}
      >
        <Ionicons
          name={
            sessionState === 'processing' ? 'sync-outline' :
              sessionState === 'recording' ? 'stop' :
                'mic'
          }
          size={30}
          color="#FFF"
        />
      </TouchableOpacity>
      <Text style={[micStyles.hint, { color: subtle }]}>
        {sessionState === 'idle' && 'Hold to record'}
        {sessionState === 'recording' && 'Release to stop'}
        {sessionState === 'processing' && 'Analyzing…'}
      </Text>
    </View>
  );
}

const micStyles = StyleSheet.create({
  outer: { alignItems: 'center', gap: 10, paddingTop: 4, paddingBottom: 6 },
  ring: {
    position: 'absolute',
    width: 96, height: 96,
    borderRadius: 48,
    borderWidth: 2,
    top: -14,
  },
  button: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, fontWeight: '500' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export function PacingScreen() {
  const { resolvedTheme } = useAppTheme();
  const { aiEnabled, setAiEnabled } = useAICoPilot();
  const router = useRouter();
  const session = usePracticeSession();
  const tts = useTTSPlayback();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; language?: string }>();

  const isDark = resolvedTheme.dark;
  const bg = isDark ? '#080C12' : '#F4F7FB';
  const textC = resolvedTheme.colors.text;
  const subtle = isDark ? '#5A7294' : '#8A9BB0';
  const border = isDark ? '#1C2840' : '#E4EAF2';
  const cardBg = isDark ? '#101928' : '#FFFFFF';
  const STATUSBAR_H = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [showBubble, setShowBubble] = useState(true);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [activeWordIdx, setActiveWordIdx] = useState(-1);
  const [wordStates, setWordStates] = useState<('done' | 'error')[]>([]);
  const [actualWpm, setActualWpm] = useState(0);
  const [isPaceGood, setIsPaceGood] = useState(true);
  const [isOverallGood, setIsOverallGood] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);

  const recordingStartRef = useRef<number>(0);
  const recordingEndRef = useRef<number>(0);
  const hasPlayedIntroRef = useRef<boolean>(false);
  const waitingPromiseRef = useRef<Promise<void> | null>(null);
  const wordAudioCacheRef = useRef<Map<string, string>>(new Map());

  const playWordAudio = async (word: string) => {
    try {
      if (wordAudioCacheRef.current.has(word)) {
        await ttsService.playFromUrl(wordAudioCacheRef.current.get(word)!);
      } else {
        const url = await ttsService.synthesizeOnly(word, (params.language as Language) ?? 'english', 'm');
        wordAudioCacheRef.current.set(word, url);
        await ttsService.playFromUrl(url);
      }
    } catch (e) {
      console.warn("TTS failed", e);
    }
  };

  const handleWordPress = (w: string, state: string) => {
    if (state === 'error') {
      Alert.alert(
        "Word Missed",
        "We couldn't hear you say this word clearly. Make sure to articulate each word on the beat."
      );
    }
    playWordAudio(w);
  };

  const backendBpm = Number(session.payload?.items?.beats_per_minute) || 0;
  const targetRateWpm = Number(session.payload?.items?.target_rate_wpm ?? 130);
  const pacingUnit = String(session.payload?.items?.pacing_unit ?? 'syllable');
  const difficulty = session.card?.difficulty ?? 1;

  const bpm = useMemo(() => {
    if (Number.isFinite(backendBpm) && backendBpm > 0) return Math.min(200, Math.max(30, backendBpm));
    return Math.round(40 + (difficulty - 1) * 15);
  }, [backendBpm, difficulty]);
  const bpmMs = useMemo(() => Math.round((60_000 / bpm) * 0.5), [bpm]);

  const rounds = useMemo(() => {
    const items = session.items;
    let distinctWords: string[] = [];
    if (!Array.isArray(items) || items.length === 0) {
      distinctWords = ['Cat', 'Key', 'Cake', 'Car'];
    } else {
      distinctWords = Array.from(new Set(items.map((item: any) => String(item?.word ?? '')).filter(Boolean)));
    }
    if (distinctWords.length === 0) distinctWords = ['Cat', 'Key', 'Cake', 'Car'];

    const N = distinctWords.length;
    const windowSize = 4;
    const step = 2;
    const repsPerItem = 3;

    let windows: string[][] = [];
    if (N <= windowSize) {
      windows.push(distinctWords);
    } else {
      const numItems = Math.ceil((N - windowSize) / step) + 1;
      for (let L = 0; L < numItems; L++) {
        const start = Math.min(L * step, N - windowSize);
        windows.push(distinctWords.slice(start, start + windowSize));
      }
    }

    const shuffle = (array: string[]) => {
      const arr = [...array];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    const generatedRounds: { itemIndex: number; repIndex: number; words: string[] }[] = [];
    windows.forEach((win, itemIdx) => {
      for (let r = 0; r < repsPerItem; r++) {
        generatedRounds.push({
          itemIndex: itemIdx + 1,
          repIndex: r + 1,
          words: shuffle(win),
        });
      }
    });

    return generatedRounds;
  }, [session.items]);

  const currentRound = rounds[currentRoundIndex] ?? rounds[0];
  const words = currentRound.words;
  const totalItemsCount = Math.ceil(Math.max(0, rounds.length / 3));

  useEffect(() => {
    if (sessionState !== 'recording') {
      setTickCount(0);
      return;
    }
    const id = setInterval(() => setTickCount(p => p + 1), bpmMs);
    return () => clearInterval(id);
  }, [bpmMs, sessionState]);

  useEffect(() => {
    if (sessionState !== 'recording') { setActiveWordIdx(-1); return; }
    setActiveWordIdx(0);
    const id = setInterval(() => {
      setActiveWordIdx(prev => {
        const next = prev + 1;
        if (next >= words.length) { setTimeout(() => setSessionState('processing'), 300); return prev; }
        return next;
      });
    }, bpmMs * 2);
    return () => clearInterval(id);
  }, [sessionState, bpmMs, words.length]);

  useEffect(() => () => clarioAssistant.stop(), []);
  useEffect(() => {
    if (!aiEnabled || !session.payload?.assistantLines || hasPlayedIntroRef.current) return;
    hasPlayedIntroRef.current = true;
    setIsAssistantSpeaking(true);
    clarioAssistant.playIntro(
      session.payload.assistantLines,
      session.payload.moduleDir ?? '',
      session.currentItemIndex > 0 ? 'resume' : 'fresh',
      (params.language as Language) ?? 'english',
      (t) => setAiMsg(t)
    ).finally(() => setIsAssistantSpeaking(false));
  }, [aiEnabled, session.payload?.assistantLines, session.currentItemIndex, session.payload?.moduleDir, params.language]);

  const [feedbackMsg, setFeedbackMsg] = useState("");
  const { startRecording, stopRecording } = useAudioRecorder();

  useEffect(() => {
    if (sessionState !== 'processing') return;
    if (aiEnabled && session.payload?.assistantLines) {
      setIsAssistantSpeaking(true);
      waitingPromiseRef.current = clarioAssistant.playWaiting(
        session.payload.assistantLines,
        session.payload.moduleDir ?? '',
        (params.language as Language) ?? 'english',
        (t) => setAiMsg(t)
      );
      waitingPromiseRef.current.finally(() => setIsAssistantSpeaking(false));
    }
    (async () => {
      const uri = await stopRecording();
      if (!uri) { setSessionState('idle'); clarioAssistant.stop(); return; }

      const fullSentence = words.join(' ');
      let success = false;

      try {
        const response = await UAB_API.analyzePacing(
          uri,
          fullSentence,
          bpm,
          (params.language as Language) ?? 'english'
        );

        if (response && response.success) {
          const transcribedWords = (response.words || []).map((w: any) => String(w.word || '').toLowerCase());
          const newWordStates = words.map(w => {
            const target = w.toLowerCase().replace(/[^\w]/g, '');
            return transcribedWords.some((tw: string) => tw.replace(/[^\w]/g, '') === target) ? 'done' : 'error';
          });
          
          setWordStates(newWordStates);
          const missedWords = newWordStates.includes('error');

          const { actual_active_wpm, is_pace_good, is_rhythm_consistent } = response.metrics;
          setActualWpm(Math.round(actual_active_wpm));
          setIsPaceGood(is_pace_good);
          setIsOverallGood(is_pace_good && is_rhythm_consistent && !missedWords);
          setFeedbackMsg(missedWords ? "You missed some words!" : (response.feedback || ""));
          
          // User request: "We only fail when the user underperforms not overperforms."
          // Rhythm jitter from whisper shouldn't cause an AI error or mark the attempt incorrect.
          success = is_pace_good && !missedWords;
        } else {
          setIsPaceGood(false);
          setIsOverallGood(false);
          setActualWpm(0);
          setFeedbackMsg("Analysis failed.");
        }
      } catch (e) {
        console.error("Pacing analysis failed", e);
        setIsPaceGood(false);
        setIsOverallGood(false);
        setActualWpm(0);
        setFeedbackMsg("Network error.");
      }

      if (waitingPromiseRef.current) {
        await waitingPromiseRef.current;
        waitingPromiseRef.current = null;
      }
      
      setSessionState('result');
      session.recordAttempt(success ? 'correct' : 'incorrect');

      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        clarioAssistant.playValidation(
          session.payload.assistantLines,
          session.payload.moduleDir ?? '',
          success ? 0 : 1,
          (params.language as Language) ?? 'english',
          (t) => setAiMsg(t)
        ).finally(() => setIsAssistantSpeaking(false));
      }
    })();
  }, [sessionState]);

  const onMicPressIn = useCallback(async () => {
    if (sessionState !== 'idle') return;
    setWordStates([]);
    recordingStartRef.current = Date.now();
    setSessionState('recording');
    await startRecording();
  }, [sessionState, startRecording]);

  const onMicPressOut = useCallback(async () => {
    if (sessionState !== 'recording') return;
    recordingEndRef.current = Date.now();
    setSessionState('processing');
  }, [sessionState]);

  const onRetry = useCallback(() => {
    setSessionState('idle');
    setActiveWordIdx(-1);
  }, []);

  const onContinue = useCallback(async () => {
    if (isNavigating) return;
    setIsNavigating(true);
    clarioAssistant.stop();
    
    if (currentRoundIndex < rounds.length - 1) {
      setCurrentRoundIndex(prev => prev + 1);
      setSessionState('idle');
      setActiveWordIdx(-1);
      setIsNavigating(false);
      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        clarioAssistant.playTransition(
          session.payload.assistantLines,
          session.payload.moduleDir ?? '',
          (params.language as Language) ?? 'english',
          (t) => setAiMsg(t)
        ).finally(() => setIsAssistantSpeaking(false));
      }
    } else {
      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        await clarioAssistant.playCompletion(
          session.payload.assistantLines,
          session.payload.moduleDir ?? '',
          (params.language as Language) ?? 'english'
        );
        setIsAssistantSpeaking(false);
      }
      session.completeSession();
      setTimeout(() => router.back(), 500);
    }
  }, [session, router, aiEnabled, params.language, isNavigating, currentRoundIndex, rounds.length]);

  const wordLabel = totalItemsCount > 0
    ? `Item ${currentRound.itemIndex} of ${totalItemsCount} • Repetition ${currentRound.repIndex} of 3`
    : '';

  const bpmDiffLabel = (() => {
    if (difficulty <= 1) return 'Slow (Learning)';
    if (difficulty <= 2) return 'Moderate';
    if (difficulty <= 3) return 'Natural';
    if (difficulty <= 4) return 'Fast';
    return 'Challenge';
  })();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: STATUSBAR_H + 12 }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: isDark ? '#141E2E' : '#FFF', borderColor: border }]}
          onPress={() => { tts.stop(); router.back(); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={18} color={textC} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: textC }]}>Pacing Exercise</Text>
          <Text style={[styles.headerSub, { color: subtle }]}>{wordLabel}</Text>
        </View>

        <AICoPilotToggle state={aiEnabled ? 'idle' : 'off'} onToggle={() => setAiEnabled(!aiEnabled)} />
      </View>

      <View style={[styles.progressTrack, { backgroundColor: isDark ? '#1C2840' : '#E4EAF2' }]}>
        <View style={[styles.progressFill, { width: `${(currentRoundIndex / Math.max(1, rounds.length - 1)) * 100}%` as any, backgroundColor: PURPLE }]} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom + 32, 48) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: PURPLE + '14', borderColor: PURPLE + '30' }]}>
            <Ionicons name="mic-outline" size={13} color={PURPLE} />
            <Text style={[styles.chipText, { color: PURPLE }]}>Expressive</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: isDark ? '#1A2535' : '#EEF1F8', borderColor: border }]}>
            <Ionicons name="pulse-outline" size={13} color={subtle} />
            <Text style={[styles.chipText, { color: subtle }]}>
              {pacingUnit === 'syllable' ? 'Syllable-timed' : 'Word-timed'}
            </Text>
          </View>
          <View style={[styles.chip, { backgroundColor: isDark ? '#1A2535' : '#EEF1F8', borderColor: border }]}>
            <Ionicons name="speedometer-outline" size={13} color={subtle} />
            <Text style={[styles.chipText, { color: subtle }]}>{bpmDiffLabel}</Text>
          </View>
        </View>

        <View style={[styles.card, {
          backgroundColor: cardBg,
          borderColor: sessionState === 'recording' ? PURPLE + '99' : border,
          shadowColor: PURPLE,
          shadowOpacity: sessionState === 'recording' ? 0.22 : 0.07,
          shadowRadius: sessionState === 'recording' ? 24 : 12,
          elevation: 8,
        }]}>
          <View style={[styles.cardGlow, { backgroundColor: PURPLE + '0A' }]} />

          <View style={[styles.bpmBadge, { backgroundColor: PURPLE + '14', borderColor: PURPLE + '30' }]}>
            <Ionicons name="musical-notes-outline" size={13} color={PURPLE} />
            <Text style={[styles.bpmBadgeText, { color: PURPLE }]}>{bpm} BPM</Text>
            <View style={[styles.bpmBadgeDot, { backgroundColor: PURPLE }]} />
            <Text style={[styles.bpmBadgeText, { color: subtle }]}>Target: {targetRateWpm} WPM</Text>
          </View>

          <ScrollView
            style={styles.wordsScroll}
            contentContainerStyle={styles.wordsGrid}
            scrollEnabled={words.length > 6}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.wordsRowWrap}>
              {words.map((w, i) => {
                let state: 'active' | 'done' | 'upcoming' | 'error' = 'upcoming';
                if (sessionState === 'result') {
                  state = wordStates[i] || 'done';
                } else {
                  state = i === activeWordIdx ? 'active' : i < activeWordIdx ? 'done' : 'upcoming';
                }

                return (
                  <WordPill
                    key={i}
                    word={w}
                    state={state}
                    color={PURPLE}
                    textC={textC}
                    subtle={subtle}
                    onPress={() => handleWordPress(w, state)}
                    disabled={sessionState === 'recording'}
                  />
                );
              })}
            </View>
          </ScrollView>

          <View style={[styles.pendulumSection, { borderTopColor: border }]}>
            <Pendulum bpmMs={bpmMs} color={PURPLE} isRecording={sessionState === 'recording'} />
            <BeatDots tick={tickCount} color={PURPLE} />
            <Text style={[styles.rhythmHint, { color: subtle }]}>
              {sessionState === 'processing'
                ? 'Analyzing rhythm…'
                : sessionState === 'recording'
                  ? 'Stay on beat!'
                  : `Hold mic to start pendulum`}
            </Text>
          </View>

          {/* FIX: Result panel always rendered but disabled when not in result state */}
          <View style={[
            styles.resultPanel, 
            { 
              backgroundColor: isDark ? '#0C1520' : '#F5F8FF', 
              borderColor: border,
              opacity: sessionState === 'result' ? 1 : 0.4
            }
          ]}>
            <View style={styles.resultRow}>
              <View style={styles.resultStatBox}>
                <Text style={[styles.resultStatNum, { color: textC }]}>
                  {bpm}
                </Text>
                <Text style={[styles.resultStatLabel, { color: subtle }]}>Target BPM</Text>
              </View>
              <View style={[styles.resultSeparator, { backgroundColor: border }]} />
              <View style={styles.resultStatBox}>
                <Text style={[
                  styles.resultStatNum, 
                  { color: sessionState === 'result' ? (isPaceGood ? '#10B981' : '#F59E0B') : textC }
                ]}>
                  {sessionState === 'result' ? actualWpm : '--'}
                </Text>
                <Text style={[
                  styles.resultStatLabel, 
                  { color: sessionState === 'result' ? (isPaceGood ? '#10B98188' : '#F59E0B88') : subtle }
                ]}>Your WPM</Text>
              </View>
            </View>
            <View style={[
              styles.paceStatusBadge,
              { 
                backgroundColor: sessionState === 'result' ? (isOverallGood ? '#10B98115' : '#F59E0B15') : 'transparent', 
                borderColor: sessionState === 'result' ? (isOverallGood ? '#10B98140' : '#F59E0B40') : border 
              },
            ]}>
              <Ionicons
                name={sessionState === 'result' ? (isOverallGood ? 'checkmark-circle' : 'alert-circle') : 'information-circle'}
                size={14}
                color={sessionState === 'result' ? (isOverallGood ? '#10B981' : '#F59E0B') : subtle}
              />
              <Text style={[
                styles.paceStatusText, 
                { color: sessionState === 'result' ? (isOverallGood ? '#10B981' : '#F59E0B') : subtle }
              ]}>
                {sessionState === 'result' ? (feedbackMsg || (isOverallGood ? 'Great rhythm!' : 'Pacing needs improvement')) : 'Match the pendulum speed'}
              </Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.cardActions}>
            {sessionState === 'result' ? (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: isDark ? '#1C2840' : '#EEF1F8', borderColor: border }]}
                  onPress={onRetry}
                >
                  <Ionicons name="refresh" size={16} color={textC} />
                  <Text style={[styles.actionBtnText, { color: textC }]}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.actionBtn, 
                    styles.actionBtnPrimary, 
                    { backgroundColor: wordStates.includes('error') ? PURPLE + '40' : PURPLE }
                  ]}
                  onPress={onContinue}
                  disabled={wordStates.includes('error')}
                >
                  <Text style={[styles.actionBtnText, { color: wordStates.includes('error') ? '#FFF8' : '#FFF' }]}>Continue</Text>
                  <Ionicons name="arrow-forward" size={16} color={wordStates.includes('error') ? '#FFF8' : '#FFF'} />
                </TouchableOpacity>
              </>
            ) : (
              /* FIX: MicButton extracted with pulse-ring animation */
              <MicButton
                sessionState={sessionState}
                color={PURPLE}
                subtle={subtle}
                disabled={isAssistantSpeaking}
                onPressIn={onMicPressIn}
                onPressOut={onMicPressOut}
              />
            )}
          </View>
        </View>

        {/* FIX: AI bubble sits outside the card — card height never hides it.
            maxHeight + scroll for long messages. */}
        {aiEnabled && showBubble && (
          <View style={styles.bubbleWrap}>
            <AIFeedbackBubble
              message={aiMsg || `Follow the pendulum rhythm. One ${pacingUnit} per beat.`}
              isSpeaking={isAssistantSpeaking}
              onDismiss={() => setShowBubble(false)}
              style={{ marginHorizontal: 0, marginBottom: 0 }}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, gap: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, marginTop: 2, fontWeight: '500' },

  // FIX: Progress bar height 3 → 5px
  progressTrack: { height: 5, marginHorizontal: 24, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%', borderRadius: 3 },

  // Scroll
  scroll: { paddingHorizontal: 20, paddingTop: 14, gap: 14 },

  // Chips — FIX: consistent 13px icons, slightly more padding
  chipRow: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1,
  },
  chipText: { fontSize: 11, fontWeight: '600' },

  // Card
  card: {
    borderRadius: 24, borderWidth: 1,
    paddingTop: 0, overflow: 'hidden',
    shadowOffset: { width: 0, height: 6 },
  },
  cardGlow: { height: 4 },

  // BPM badge
  bpmBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
    marginTop: 18, marginBottom: 18,
  },
  bpmBadgeText: { fontSize: 13, fontWeight: '700' },
  bpmBadgeDot: { width: 4, height: 4, borderRadius: 2, marginHorizontal: 2 },

  // FIX: Words scroll container — constrained height, scrollable for long sentences
  wordsScroll: { maxHeight: 140 },
  wordsGrid: { paddingHorizontal: 16, paddingBottom: 8 },
  wordsRowWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },

  processingArea: { height: 100, justifyContent: 'center', alignItems: 'center', gap: 12 },
  processingText: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },

  // Pendulum section
  pendulumSection: {
    marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 18, paddingBottom: 20, alignItems: 'center', gap: 4,
  },
  rhythmHint: { fontSize: 12, fontWeight: '500', marginTop: 4 },

  // FIX: Result panel — no divider hack, clean flex layout
  resultPanel: {
    margin: 16, borderRadius: 16, borderWidth: 1,
    paddingVertical: 16, paddingHorizontal: 14, gap: 12,
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0 },
  resultStatBox: { alignItems: 'center', flex: 1 },
  resultStatNum: { fontSize: 28, fontWeight: '800', letterSpacing: -1 },
  resultStatLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  // FIX: thin separator as a real 1px View, not a faux-divider with fixed height
  resultSeparator: { width: 1, height: 44, marginHorizontal: 12 },
  paceStatusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8,
  },
  paceStatusText: { fontSize: 12, fontWeight: '600', flex: 1 },

  // Actions
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

  // AI Bubble — FIX: anchored below card, independent of card height
  bubbleWrap: { marginTop: 4 },
});