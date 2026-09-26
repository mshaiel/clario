import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AICoPilotToggle } from '@/components/detection/AICoPilotToggle';
import { AIFeedbackBubble } from '@/components/detection/AIFeedbackBubble';
import { MicButton } from '@/components/practice/MicButton';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';
import { UAB_API } from '@/lib/api';
import { clarioAssistant } from '@/lib/clarioAssistant';
import { ttsService } from '@/lib/ttsService';
import { useAppTheme } from '@/theme-provider';

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionState = 'idle' | 'countdown' | 'listening' | 'shadowing' | 'analyzing' | 'result' | 'cooldown';
type ShadowLevel = 'simultaneous' | 'delayed' | 'whispered' | 'mouthed' | 'independent';

interface DetectedEvent {
  type: 'block' | 'stutter' | 'prolongation';
  label: string;
  word: string;
  wordIndex: number;
  assistantText?: string | null;
  assistantAudioUrl?: string | null;
}

type ShadowAttempt = {
  itemIndex: number;
  result: 'correct' | 'incorrect' | 'skipped';
  details?: Record<string, any>;
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const TAIL_MS = 1800; // recording buffer after sentence ends

// ─── Constants ────────────────────────────────────────────────────────────────

const DANGER_COLOR = '#EF4444';

const SHADOW_LEVELS: {
  id: ShadowLevel;
  label: string;
  icon: string;
  wpm: number;
  /** ms gap between end of TTS and start of recording */
  shadowGapMs: number;
  /** if true, skip TTS entirely — user reads independently */
  skipTTS: boolean;
}[] = [
  { id: 'simultaneous', label: 'Simultaneous', icon: 'sync-outline',               wpm: 130, shadowGapMs: 0,    skipTTS: false },
  { id: 'delayed',      label: 'Delayed',      icon: 'time-outline',               wpm: 120,  shadowGapMs: 800,  skipTTS: false },
  { id: 'whispered',    label: 'Whispered',      icon: 'volume-low-outline',         wpm: 110,  shadowGapMs: 800,  skipTTS: false },
  { id: 'mouthed',      label: 'Mouthed',        icon: 'chatbubble-ellipses-outline',wpm: 110,  shadowGapMs: 800,  skipTTS: false },
  { id: 'independent',  label: 'Independent',    icon: 'person-outline',             wpm: 130, shadowGapMs: 0,    skipTTS: true  },
];

const LEVEL_INDEX: Record<ShadowLevel, number> = {
  simultaneous: 0, delayed: 1, whispered: 2, mouthed: 3, independent: 4,
};

/** Advance level when session accuracy ≥ 80% across at least 3 attempts */
const ADVANCE_ACCURACY   = 0.80;
const ADVANCE_MIN_TRIALS = 3;

// ─── Component ────────────────────────────────────────────────────────────────

export function ShadowingScreen() {
  const { resolvedTheme } = useAppTheme();
  const { aiEnabled, setAiEnabled } = useAICoPilot();
  const router = useRouter();
  const session = usePracticeSession();
  const tts = useTTSPlayback();
  const insets = useSafeAreaInsets();
  const { startRecording, stopRecording, clearRecording } = useAudioRecorder();
  const { language } = useLanguage();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text = resolvedTheme.colors.text;

  // Design tokens
  const bg = isDark ? '#080C14' : '#F0F4F8';
  const surface = isDark ? '#111827' : '#FFFFFF';
  const surfaceAlt = isDark ? '#1A2333' : '#F7FAFC';
  const border = isDark ? '#1E2A3A' : '#E2E8F0';
  const subtle = isDark ? '#64748B' : '#94A3B8';
  const muted = isDark ? '#1E2A3A' : '#CBD5E1';

  // ─── State ──────────────────────────────────────────────────────────────────

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [shadowLevel, setShadowLevel] = useState<ShadowLevel>('simultaneous');
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [detectedEvents, setDetectedEvents] = useState<DetectedEvent[]>([]);
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const [countdownVal, setCountdownVal] = useState<number | string>(3);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiBubbleMsg, setAiBubbleMsg] = useState<string | null>(null);
  const [actualWpmState, setActualWpmState] = useState<number | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPaceGood, setIsPaceGood] = useState(true);

  const hasPlayedIntroRef = useRef(false);
  const waitingPromiseRef = useRef<Promise<void> | null>(null);

  const currentLevelConfig = SHADOW_LEVELS.find(l => l.id === shadowLevel) || SHADOW_LEVELS[0];

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const cancelledRef = useRef(false);
  const autoStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shadowPaceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const recordingEndRef = useRef<number>(0);
  const isManualStopRef = useRef<boolean>(false);

  // ─── Animated values ────────────────────────────────────────────────────────

  const cdScale = useRef(new Animated.Value(0.4)).current;
  const cdOpacity = useRef(new Animated.Value(0)).current;
  const micPulse = useRef(new Animated.Value(1)).current;
  const breathe = useRef(new Animated.Value(1)).current;
  // 0 → 1 over sentence duration; mapped to 0%→100% via interpolate
  const timelineAnim = useRef(new Animated.Value(0)).current;

  // ─── Derived ────────────────────────────────────────────────────────────────

  const sentenceWords = useMemo(() => {
    const raw = String(session.currentItem?.display_text ?? '').trim();
    return (raw || 'The cat sat on the mat').split(/\s+/).filter(Boolean);
  }, [session.currentItem]);

  const ttsWords = useMemo(() => {
    return sentenceWords.map((word: string) => {
      const cleaned = word.replace(/[^\w\u0600-\u06FF'-]/g, '').trim();
      return cleaned || word;
    });
  }, [sentenceWords]);

  // Reset timeline when sentence changes
  useEffect(() => { timelineAnim.setValue(0); }, [session.currentItem]);

  const disfluencyCount = detectedEvents.length;
  const msPerWord = Math.round((60 / currentLevelConfig.wpm) * 1000);
  const sentenceDurationMs = sentenceWords.length * msPerWord;
  const fluencyScore = disfluencyCount === 0 ? 100 : Math.max(0, 100 - disfluencyCount * 20);

  const syncQuality = isPaceGood ? 'Good Pace' : 'Needs Work';

  const syncColor = isPaceGood ? '#22C55E' : DANGER_COLOR;

  const prefetchWordAudio = useCallback(async (): Promise<string[] | null> => {
    if (ttsWords.length === 0) return null;
    const cacheKey = `${language}:${ttsWords.join('|')}`;
    const cached = wordAudioCacheRef.current.get(cacheKey);
    if (cached) return cached;

    try {
      const urls = await Promise.all(ttsWords.map((word: string) => tts.synthesizeOnly(word, 'f')));
      if (urls.some((url: string | null) => !url)) return null;
      const resolved = urls.filter(Boolean) as string[];
      wordAudioCacheRef.current.set(cacheKey, resolved);
      return resolved;
    } catch (e) {
      console.warn('[Shadowing] Word TTS prefetch failed:', e);
      return null;
    }
  }, [language, ttsWords, tts.synthesizeOnly]);

  // AI Intro
  useEffect(() => {
    const assistantLines = session.payload?.assistantLines || session.payload?.level?.assistant_lines || session.payload?.assistant_lines;
    if (aiEnabled && assistantLines && !hasPlayedIntroRef.current) {
      hasPlayedIntroRef.current = true;
      setIsAssistantSpeaking(true);
      clarioAssistant.playIntro(
        assistantLines,
        session.payload?.moduleDir || '',
        session.attempts.length > 0 ? 'resume' : 'fresh',
        language,
        setAiBubbleMsg
      ).finally(() => setIsAssistantSpeaking(false));
    }
  }, [aiEnabled]);

  const wordAudioCacheRef = useRef<Map<string, string[]>>(new Map());

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => () => {
    cancelledRef.current = true;
    tts.stop();
    if (autoStopTimer.current) clearTimeout(autoStopTimer.current);
    clarioAssistant.stop();
  }, []);

  // ─── Mic pulse during shadowing ──────────────────────────────────────────────

  useEffect(() => {
    if (sessionState === 'shadowing') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulse, { toValue: 1.14, duration: 550, useNativeDriver: true }),
          Animated.timing(micPulse, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => { loop.stop(); micPulse.setValue(1); };
    }
    micPulse.setValue(1);
  }, [sessionState]);

  // ─── Breathing circle for cooldown ──────────────────────────────────────────

  useEffect(() => {
    if (sessionState === 'cooldown') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, { toValue: 1.28, duration: 1100, useNativeDriver: true }),
          Animated.timing(breathe, { toValue: 1, duration: 1100, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => { loop.stop(); breathe.setValue(1); };
    }
  }, [sessionState, breathe]);

  // ─── Cooldown timer ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (sessionState !== 'cooldown') return;
    if (cooldownSecs > 0) {
      const t = setTimeout(() => setCooldownSecs((p: number) => p - 1), 1000);
      return () => clearTimeout(t);
    }
    setSessionState('idle');
  }, [sessionState, cooldownSecs]);

  // ─── Fluency analysis (direct API — usePracticeAnalysis rejects empty IPA) ────

  const finishAndAnalyze = useCallback(async () => {
    cancelledRef.current = true;
    if (autoStopTimer.current) { clearTimeout(autoStopTimer.current); autoStopTimer.current = null; }
    if (shadowPaceTimerRef.current) { clearInterval(shadowPaceTimerRef.current); shadowPaceTimerRef.current = null; }
    timelineAnim.stopAnimation();
    tts.stop();

    recordingEndRef.current = Date.now();

    if (shadowLevel === 'mouthed') {
      setIsAnalyzing(false);
      setSessionState('result');
      setDetectedEvents([]);
      return;
    }

    const uri = await stopRecording();
    let durationMs = recordingEndRef.current - recordingStartRef.current;
    
    // If it auto-stopped, it recorded TAIL_MS of silence. Subtract it.
    if (!isManualStopRef.current && durationMs > TAIL_MS) {
       durationMs -= TAIL_MS; 
    }

    if (durationMs > 0 && sentenceWords.length > 0) {
      setActualWpmState(Math.round(sentenceWords.length / (durationMs / 60000)));
    }

    setIsAnalyzing(true);
    setSessionState('analyzing');
    const assistantLines = session.payload?.assistantLines || session.payload?.level?.assistant_lines || session.payload?.assistant_lines;

    if (aiEnabled && assistantLines) {
      setIsAssistantSpeaking(true);
      waitingPromiseRef.current = clarioAssistant.playWaiting(assistantLines, session.payload?.moduleDir || '', language, setAiBubbleMsg);
      waitingPromiseRef.current.finally(() => setIsAssistantSpeaking(false));
    }
    try {
      if (uri) {
        const text = sentenceWords.join(' ');
        const targetWpm = currentLevelConfig.wpm;
        
        // Shadowing uses the dedicated pacing endpoint which evaluates rhythm and speed via Whisper word timestamps
        const response = await UAB_API.analyzePacing(uri, text, targetWpm, language);

        const paceGood = response?.metrics?.is_pace_good ?? true;
        const actualWpm = response?.metrics?.actual_active_wpm ?? targetWpm;

        setActualWpmState(Math.round(actualWpm));
        setIsPaceGood(paceGood);
        setDetectedEvents([]); // Pacing does not use fluency events

        if (!paceGood) {
          setErrorMessage(response?.feedback || `Your pacing was off. Target was ${targetWpm} WPM, but you spoke at ${Math.round(actualWpm)} WPM.`);
          setShowErrorModal(true);
        } else {
          setShowErrorModal(false);
        }

        if (waitingPromiseRef.current) {
          await waitingPromiseRef.current;
          waitingPromiseRef.current = null;
        }

        // Validation line
        if (aiEnabled && assistantLines) {
          setIsAssistantSpeaking(true);
          await clarioAssistant.playValidation(
            assistantLines,
            session.payload?.moduleDir || '',
            paceGood ? 0 : 1, // 0 errors if pace is good
            language,
            setAiBubbleMsg
          );
          setIsAssistantSpeaking(false);
        }
      } else {
        setDetectedEvents([]);
      }
    } catch (e) {
      console.warn('[Shadowing] Analysis error:', e);
      setDetectedEvents([]);
    } finally {
      setIsAnalyzing(false);
      setSessionState('result');
    }
  }, [stopRecording, sentenceWords, language, timelineAnim, tts, aiEnabled, session.payload, shadowLevel]);

  // ─── TTS listen phase — single synthesis request + timer highlights ──────────
  //
  // ONE network round-trip for the full sentence. While audio plays we drive
  // the word highlight and the synchrony timeline with a setInterval keyed to
  // the target WPM. This gives us exact, network-latency-free pacing control.

  const playModelSentence = useCallback(
    async (wordAudioUrls: string[] | null, allowRecording: boolean): Promise<void> => {
      if (cancelledRef.current) return;

      const wordsLen = sentenceWords.length;
      const msPerW = Math.round((60 / currentLevelConfig.wpm) * 1000);
      const totalMs = wordsLen * msPerW;

      timelineAnim.setValue(0);
      Animated.timing(timelineAnim, {
        toValue: 1,
        duration: totalMs,
        useNativeDriver: false,
      }).start();

      for (let i = 0; i < wordsLen; i += 1) {
        if (cancelledRef.current) break;
        setHighlightIndex(i);

        const ttsWord = ttsWords[i] ?? sentenceWords[i];
        const audioUrl = wordAudioUrls?.[i];
        const start = Date.now();

        if (audioUrl) {
          await ttsService.playFromUrl(audioUrl, { allowRecording });
        } else {
          await ttsService.synthesizeAndPlay(ttsWord, language, 'f', { allowRecording });
        }

        const elapsed = Date.now() - start;
        if (elapsed < msPerW) {
          await sleep(msPerW - elapsed);
        }
      }

      setHighlightIndex(-1);
    },
    [sentenceWords, ttsWords, currentLevelConfig.wpm, timelineAnim, language]
  );

  // ─── Begin session ────────────────────────────────────────────────────────────

  const onBegin = useCallback(async () => {
    if (sessionState !== 'idle') return;
    cancelledRef.current = false;
    timelineAnim.setValue(0);
    setDetectedEvents([]);
    setAiBubbleMsg(null);
    const prefetchPromise = currentLevelConfig.skipTTS ? Promise.resolve(null) : prefetchWordAudio();

    // Countdown
    setSessionState('countdown');
    const pulse = (val: number | string) => {
      cdScale.setValue(0.4); cdOpacity.setValue(0); setCountdownVal(val);
      Animated.parallel([
        Animated.spring(cdScale, { toValue: 1, useNativeDriver: true, damping: 11, stiffness: 200 }),
        Animated.timing(cdOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
    };
    for (const tick of [3, 2, 1, currentLevelConfig.skipTTS ? 'Go!' : 'Listen!']) {
      if (cancelledRef.current) return;
      pulse(tick);
      await sleep(['Listen!', 'Go!'].includes(String(tick)) ? 380 : 750);
    }
    if (cancelledRef.current) return;

    let wordAudioUrls: string[] | null = null;
    if (!currentLevelConfig.skipTTS) {
      setCountdownVal('Preparing');
      wordAudioUrls = await prefetchPromise;
      if (cancelledRef.current) return;
    }

    // Listen phase — TTS word by word (skipped for 'independent' level)
    if (!currentLevelConfig.skipTTS) {
      if (shadowLevel === 'simultaneous') {
        setSessionState('shadowing');
        recordingStartRef.current = Date.now();
        isManualStopRef.current = false;
        await startRecording();
        await playModelSentence(wordAudioUrls, true);
        if (cancelledRef.current) return;
        autoStopTimer.current = setTimeout(finishAndAnalyze, TAIL_MS);
        return;
      }

      setSessionState('listening');
      await playModelSentence(wordAudioUrls, false);
      if (cancelledRef.current) return;
    }

    // Per-level gap: simultaneous=150ms (near-instant), delayed/whispered=800ms, independent=0ms
    if (currentLevelConfig.shadowGapMs > 0) {
      await sleep(currentLevelConfig.shadowGapMs);
      if (cancelledRef.current) return;
    }

    // Shadow phase — auto-stops after sentence duration + tail buffer
    setSessionState('shadowing');
    if (shadowLevel !== 'mouthed') {
      recordingStartRef.current = Date.now();
      isManualStopRef.current = false;
      await startRecording();
    }

    if (shadowLevel === 'simultaneous' || shadowLevel === 'independent') {
      timelineAnim.setValue(0);
      Animated.timing(timelineAnim, {
        toValue: 1, duration: sentenceDurationMs + TAIL_MS, useNativeDriver: false,
      }).start();

      let shadowIndex = 0;
      setHighlightIndex(0);
      shadowPaceTimerRef.current = setInterval(() => {
        shadowIndex++;
        if (shadowIndex >= sentenceWords.length) {
          if (shadowPaceTimerRef.current) clearInterval(shadowPaceTimerRef.current);
          setHighlightIndex(-1);
        } else {
          setHighlightIndex(shadowIndex);
        }
      }, msPerWord);
    } else {
      setHighlightIndex(-1);
    }

    autoStopTimer.current = setTimeout(finishAndAnalyze, sentenceDurationMs + TAIL_MS);
  }, [sessionState, playModelSentence, currentLevelConfig, shadowLevel, startRecording,
      timelineAnim, sentenceDurationMs, finishAndAnalyze, cdScale, cdOpacity, prefetchWordAudio]);

  // ─── Manual stop during shadow phase ─────────────────────────────────────────

  const onMicPress = useCallback(async () => {
    if (sessionState === 'idle') onBegin();
    else if (sessionState === 'shadowing') {
       isManualStopRef.current = true;
       finishAndAnalyze();
    }
  }, [sessionState, onBegin, finishAndAnalyze]);


  // ─── Navigation ──────────────────────────────────────────────────────────────

  const onReset = useCallback(() => {
    cancelledRef.current = true;
    tts.stop();
    if (autoStopTimer.current) clearTimeout(autoStopTimer.current);
    if (shadowPaceTimerRef.current) clearInterval(shadowPaceTimerRef.current);
    clearRecording();
    timelineAnim.setValue(0);
    setDetectedEvents([]);
    setHighlightIndex(-1);
    setSessionState('cooldown');
    setCooldownSecs(3);
    setShowErrorModal(false);
  }, [tts, clearRecording, timelineAnim]);

  const onNext = useCallback(async () => {
    // Log attempt before advancing
    const fluent = isPaceGood;
    session.recordAttempt(fluent ? 'correct' : 'incorrect', {
      sentence_id: (session.currentItem?.display_text ?? sentenceWords.join(' ')).toLowerCase().replace(/\s+/g, '_').slice(0, 40),
      shadow_level: shadowLevel,
      model_rate_wpm: currentLevelConfig.wpm,
      actual_rate_wpm: actualWpmState,
    });

    const assistantLines = session.payload?.assistantLines || session.payload?.level?.assistant_lines || session.payload?.assistant_lines;
    
    // We instantly advance if they are fluent!
    const canAdvance = fluent;

    if (canAdvance) {
      const idx = SHADOW_LEVELS.findIndex(l => l.id === shadowLevel);
      if (idx < SHADOW_LEVELS.length - 1) {
        // Advance level, stay on same item
        setShadowLevel(SHADOW_LEVELS[idx + 1].id);
        setSessionState('cooldown'); setCooldownSecs(3); setDetectedEvents([]); timelineAnim.setValue(0); setAiBubbleMsg(null);
        if (aiEnabled && assistantLines) {
          setIsAssistantSpeaking(true);
          clarioAssistant.playTransition(assistantLines, session.payload?.moduleDir || '', language, setAiBubbleMsg)
            .finally(() => setIsAssistantSpeaking(false));
        }
      } else {
        // Mastered independent level! Advance item.
        const hasNext = session.nextItem();
        if (hasNext) {
          setShadowLevel(SHADOW_LEVELS[0].id); // reset level
          setSessionState('cooldown'); setCooldownSecs(3); setDetectedEvents([]); timelineAnim.setValue(0); setAiBubbleMsg(null);
          if (aiEnabled && assistantLines) {
            setIsAssistantSpeaking(true);
            clarioAssistant.playTransition(assistantLines, session.payload?.moduleDir || '', language, setAiBubbleMsg)
              .finally(() => setIsAssistantSpeaking(false));
          }
        } else {
          if (aiEnabled && assistantLines) {
            setIsAssistantSpeaking(true);
            await clarioAssistant.playCompletion(assistantLines, session.payload?.moduleDir || '', language);
            setIsAssistantSpeaking(false);
          }
          await session.completeSession();
          router.back();
        }
      }
    } else {
      // Retry same item and level
      setSessionState('cooldown'); setCooldownSecs(3); setDetectedEvents([]); timelineAnim.setValue(0); setAiBubbleMsg(null);
      if (aiEnabled && assistantLines) clarioAssistant.playTransition(assistantLines, session.payload?.moduleDir || '', language, setAiBubbleMsg);
    }
  }, [session, router, detectedEvents, shadowLevel, currentLevelConfig.wpm, sentenceWords, timelineAnim, aiEnabled, language]);

  // ─── Render: Level Progression Arc (Read Only) ──────────────────────────────

  const renderLevelArc = () => {
    const currentIdx = LEVEL_INDEX[shadowLevel as ShadowLevel];
    return (
      <View style={styles.levelTrack}>
        {SHADOW_LEVELS.map((lvl, i) => {
          const isActive = i === currentIdx;
          const isDone = i < currentIdx;
          return (
            <React.Fragment key={lvl.id}>
              <View
                style={[
                  styles.levelNode,
                  { borderColor: isActive ? PRIMARY : isDone ? PRIMARY + '50' : border },
                  isActive && { backgroundColor: PRIMARY + '18' },
                ]}
              >
                <Ionicons
                  name={lvl.icon as any}
                  size={14}
                  color={isActive ? PRIMARY : isDone ? PRIMARY + '70' : subtle}
                />
                <Text
                  style={[
                    styles.levelNodeLabel,
                    { color: isActive ? PRIMARY : isDone ? subtle : muted },
                    isActive && { fontWeight: '800' },
                  ]}
                  numberOfLines={2}
                >
                  {lvl.label}
                </Text>
              </View>
              {i < SHADOW_LEVELS.length - 1 && (
                <View style={[styles.levelConnector, { backgroundColor: isDone ? PRIMARY + '50' : border }]} />
              )}
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  // ─── Render: Progress & Disfluency Markers ────────────────────────────────────

  const renderProgressTimeline = () => (
    <View style={[styles.waveformBox, { 
      backgroundColor: isDark ? '#111827E6' : '#FFFFFFE6', 
      borderColor: border,
      shadowColor: PRIMARY,
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3
    }]}>
      {/* Bars area */}
      <View style={styles.waveArea}>
        {/* Divider */}
        <View style={[styles.waveCenterLine, { backgroundColor: border }]} />

        {/* Animated Progress Bar — driven by timelineAnim (0→1) */}
        <Animated.View
          style={[
            styles.progressBar,
            {
              backgroundColor: sessionState === 'shadowing' ? PRIMARY : PRIMARY + '55',
              width: timelineAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }
          ]}
        />

        {/* Disfluency event markers */}
        {sessionState === 'result' && detectedEvents.map((ev: DetectedEvent, i: number) => {
          const pct = sentenceWords.length > 0 ? (ev.wordIndex / sentenceWords.length) * 100 : 50;
          return (
            <View key={i} style={[styles.eventMarker, { left: `${pct}%` }]}>
              <View style={[styles.eventLine, { backgroundColor: DANGER_COLOR }]} />
              <View style={[styles.eventLabelBox, { backgroundColor: DANGER_COLOR + '22' }]}>
                <Text style={[styles.eventLabelText, { color: DANGER_COLOR }]}>{ev.label}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );

  // ─── Render: Result Summary Card ─────────────────────────────────────────────

  const renderResultCard = () => (
    <View style={[styles.resultCard, { 
      backgroundColor: isDark ? '#111827E6' : '#FFFFFFE6', 
      borderColor: border,
      shadowColor: PRIMARY,
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3
    }]}>
      {/* Score row */}
      <View style={[styles.scoreRow, { borderBottomColor: border }]}>
        <View style={[styles.scoreBadge, { backgroundColor: syncColor + '15', borderColor: syncColor + '40' }]}>
          <Text style={[styles.scoreNum, { color: syncColor }]}>{fluencyScore}</Text>
          <Text style={[styles.scoreLabel, { color: syncColor }]}>{syncQuality}</Text>
        </View>
        <View style={styles.scoreMeta}>
          <Text style={[styles.scoreTitle, { color: text }]}>
            {isPaceGood ? 'Great pace and synchrony!' : 'Pacing needs work'}
          </Text>
          <Text style={[styles.scoreSubtitle, { color: subtle }]}>
            Target: {currentLevelConfig.wpm} WPM · Actual: {actualWpmState} WPM
          </Text>
        </View>
      </View>
      {detectedEvents.length > 0 && (
        <View style={styles.eventList}>
          {detectedEvents.map((ev: DetectedEvent, i: number) => {
            const evIcon = ev.type === 'block' ? 'stop-circle-outline' : ev.type === 'stutter' ? 'repeat-outline' : 'timer-outline';
            const evColor = ev.type === 'block' ? '#EF4444' : ev.type === 'stutter' ? '#F59E0B' : '#3B82F6';
            return (
              <View key={i} style={[styles.eventRow, { borderTopColor: border }]}>
                <View style={[styles.eventIconBox, { backgroundColor: evColor + '18' }]}>
                  <Ionicons name={evIcon as any} size={16} color={evColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventWord, { color: text }]}>{ev.word}</Text>
                  <Text style={[styles.eventDetail, { color: subtle }]}>{ev.label}</Text>
                  {aiEnabled && ev.assistantText ? (
                    <View style={[styles.coachBubble, { backgroundColor: PRIMARY + '12', borderColor: PRIMARY + '30' }]}>
                      <Ionicons name="sparkles-outline" size={11} color={PRIMARY} />
                      <Text style={[styles.coachText, { color: PRIMARY }]}>{ev.assistantText}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  // ─── Render: Countdown Overlay ───────────────────────────────────────────────

  const renderCountdown = () => {
    if (sessionState !== 'countdown') return null;
    const countdownHint = currentLevelConfig.skipTTS
      ? 'Get ready to speak'
      : shadowLevel === 'simultaneous'
        ? 'Shadow the model as it plays'
        : 'Speak when you hear the model';
    return (
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(8, 12, 20, 0.85)' : 'rgba(240, 244, 248, 0.85)' }]}>
        <Animated.Text
          style={[
            styles.countdownNum,
            { color: PRIMARY, transform: [{ scale: cdScale }], opacity: cdOpacity },
          ]}
        >
          {countdownVal}
        </Animated.Text>
        <Text style={[styles.countdownSub, { color: subtle }]}>
          {countdownHint}
        </Text>
      </View>
    );
  };

  // ─── Render: Cooldown / Rest Overlay ─────────────────────────────────────────

  const renderCooldown = () => {
    if (sessionState !== 'cooldown') return null;
    return (
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(8, 12, 20, 0.90)' : 'rgba(240, 244, 248, 0.90)' }]}>
        <Animated.View
          style={[
            styles.breatheRing,
            { borderColor: PRIMARY, transform: [{ scale: breathe }] },
          ]}
        />
        <Text style={[styles.restTitle, { color: text }]}>Rest</Text>
        <Text style={[styles.restSecs, { color: subtle }]}>{cooldownSecs}s</Text>
      </View>
    );
  };

  // ─── Mic button props ────────────────────────────────────────────────────────

  const micBg = sessionState === 'shadowing' ? DANGER_COLOR : PRIMARY;
  const micIcon = sessionState === 'shadowing' ? 'stop' : 'mic';
  const micDisabled = ['cooldown', 'countdown', 'listening', 'analyzing'].includes(sessionState) || isAnalyzing;
  
  const getMicState = () => {
    if (sessionState === 'listening') return 'playing_audio';
    if (sessionState === 'shadowing') return 'recording';
    if (sessionState === 'analyzing') return 'processing';
    if (sessionState === 'result') return 'result';
    return 'idle';
  };
  
  const levelAttempts = useMemo(() => {
    return session.attempts.filter((attempt: ShadowAttempt) => (
      attempt.itemIndex === session.currentItemIndex &&
      attempt.details?.shadow_level === shadowLevel
    ));
  }, [session.attempts, session.currentItemIndex, shadowLevel]);

  const projectedTrials = sessionState === 'result' ? levelAttempts.length + 1 : levelAttempts.length;
  const projectedCorrect = sessionState === 'result'
    ? levelAttempts.filter((a: ShadowAttempt) => a.result === 'correct').length + (detectedEvents.length === 0 ? 1 : 0)
    : levelAttempts.filter((a: ShadowAttempt) => a.result === 'correct').length;
  const projectedAccuracy = projectedTrials > 0 ? projectedCorrect / projectedTrials : 0;

  const isFluent = sessionState === 'result' && isPaceGood;
  const canAdvanceLevel = isFluent;
  const isMaxLevel = shadowLevel === 'independent';
  const nextBtnText = isFluent
    ? (canAdvanceLevel ? (isMaxLevel ? 'Next Sentence' : 'Next Level') : 'Keep Practicing')
    : 'Retry';

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <GradientGlow color={PRIMARY} isDark={isDark} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: border, paddingTop: Math.max(insets.top, 14) }]}>
        <TouchableOpacity
          style={[styles.closeBtn, { backgroundColor: surface, borderColor: border }]}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={20} color={text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: text }]}>Shadowing</Text>
          <Text style={[styles.headerMeta, { color: subtle }]}>{session.progressLabel || 'FLUENCY SYNCHRONY'}</Text>
        </View>
        <AICoPilotToggle
          state={aiEnabled ? 'idle' : 'off'}
          onToggle={() => setAiEnabled(!aiEnabled)}
        />
      </View>

      {/* AI Bubble */}
      {aiBubbleMsg && (
        <AIFeedbackBubble
          message={aiBubbleMsg}
          isSpeaking={isAssistantSpeaking}
          onDismiss={() => setAiBubbleMsg(null)}
          style={{ marginHorizontal: 20, marginTop: 14 }}
        />
      )}

      {/* ── Scrollable body ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Fading level arc */}
        <View style={[styles.levelCard, { 
          backgroundColor: isDark ? '#111827E6' : '#FFFFFFE6', 
          borderColor: border,
          shadowColor: PRIMARY,
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3
        }]}>
          <Text style={[styles.sectionLabel, { color: subtle }]}>Current Level</Text>
          {renderLevelArc()}
        </View>

        {/* Sentence display */}
        <View style={[styles.sentenceBox, { 
          backgroundColor: isDark ? '#111827E6' : '#FFFFFFE6', 
          borderColor: border,
          shadowColor: PRIMARY,
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3
        }]}>
          {sessionState === 'idle' && (
            <Text style={[styles.sentencePrompt, { color: PRIMARY }]}>Target Sentence:</Text>
          )}
          {['countdown', 'listening', 'shadowing', 'analyzing', 'cooldown'].includes(sessionState) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <View style={[styles.phaseDot, { backgroundColor: PRIMARY }]} />
              <Text style={[styles.phaseLabel, { color: PRIMARY }]}>{sessionState}</Text>
            </View>
          )}

          <Text style={styles.sentenceInner}>
            {sentenceWords.map((word: string, i: number) => {
              const isActive = highlightIndex === i;
              const isPast = ['listening', 'shadowing'].includes(sessionState) && highlightIndex > i;
              return (
                <Text
                  key={i}
                  style={[
                    styles.wordText,
                    { color: isPast ? muted : text },
                    isActive && { color: PRIMARY, fontWeight: '800' },
                  ]}
                >
                  {word}{' '}
                </Text>
              );
            })}
          </Text>
        </View>

        {/* Progress Timeline */}
        {['shadowing', 'analyzing', 'result'].includes(sessionState) && (
          <>
            <View style={styles.waveHeader}>
              <Text style={[styles.sectionLabel, { color: subtle }]}>Synchrony Timeline</Text>
              {disfluencyCount > 0 && sessionState === 'result' && (
                <View style={[styles.disfluencyPill, { backgroundColor: syncColor + '1A' }]}>
                  <Text style={[styles.disfluencyPillText, { color: syncColor }]}>
                    {disfluencyCount} detected
                  </Text>
                </View>
              )}
            </View>
            {renderProgressTimeline()}
          </>
        )}

        {/* Result summary */}
        {sessionState === 'result' && renderResultCard()}
      </ScrollView>

      {/* ── Footer ── */}
      <View style={[styles.footer, { borderTopColor: border, paddingBottom: Math.max(insets.bottom + 12, 24) }]}>
        {sessionState === 'result' ? (
          <View style={styles.resultBtns}>
            <TouchableOpacity
              style={[styles.ghostBtn, { borderColor: border, backgroundColor: surface }]}
              onPress={onReset}
            >
              <Ionicons name="refresh-outline" size={15} color={text} />
              <Text style={[styles.ghostBtnText, { color: text }]}>Reset & Rest</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.solidBtn, { backgroundColor: PRIMARY }]} onPress={onNext}>
              <Text style={styles.solidBtnText}>{nextBtnText}</Text>
              <Ionicons name={isFluent ? 'arrow-forward' : 'refresh'} size={15} color="#FFF" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ alignItems: 'center' }}>
            <MicButton
              sessionState={getMicState() as any}
              color={PRIMARY}
              subtle={subtle}
              disabled={micDisabled}
              onPressIn={onMicPress}
              onPressOut={() => {}}
            />
          </View>
        )}

        <Text style={[styles.footerHint, { color: subtle }]}>
          {sessionState === 'idle' && (
            currentLevelConfig.skipTTS
              ? 'Tap mic — read the sentence aloud'
              : shadowLevel === 'simultaneous'
                ? 'Tap mic — shadow along with the model'
                : 'Tap mic — listen to the model, then shadow'
          )}
          {sessionState === 'countdown' && (
            currentLevelConfig.skipTTS
              ? 'Get ready to speak...'
              : 'Get ready to listen...'
          )}
          {sessionState === 'listening' && 'Listen carefully to the model'}
          {sessionState === 'shadowing' && (
            currentLevelConfig.skipTTS
              ? 'Speak the sentence now — tap to stop early'
              : 'Shadow the model — tap to stop early'
          )}
          {sessionState === 'analyzing' && 'Analyzing your fluency...'}
          {sessionState === 'result' && 'Tap “Next” or try again'}
          {sessionState === 'cooldown' && 'Rest before the next attempt'}
        </Text>
      </View>

      {/* ── Overlays ── */}
      {renderCountdown()}
      {renderCooldown()}

      <Modal visible={showErrorModal} transparent animationType="slide" onRequestClose={() => setShowErrorModal(false)}>
        <View style={modalStyles.backdrop}>
          <TouchableOpacity style={modalStyles.backdropTap} onPress={() => setShowErrorModal(false)} activeOpacity={1} />
          <View style={[modalStyles.sheet, { backgroundColor: isDark ? '#111827' : '#FFFFFF', borderColor: border }]}>
            <View style={[modalStyles.iconCircle, { backgroundColor: '#EF444415' }]}>
              <Ionicons name="timer-outline" size={32} color="#EF4444" />
            </View>
            <Text style={[modalStyles.title, { color: text }]}>Pacing Error</Text>
            <Text style={[modalStyles.subtitle, { color: subtle }]}>{errorMessage}</Text>
            
            <TouchableOpacity style={[modalStyles.retryBtn, { backgroundColor: '#EF4444' }]} onPress={() => { setShowErrorModal(false); onReset(); }}>
              <Ionicons name="refresh" size={18} color="#FFF" />
              <Text style={modalStyles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {sessionState === 'analyzing' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bg + 'DD', alignItems: 'center', justifyContent: 'center', zIndex: 100 }]}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={{ marginTop: 16, color: text, fontSize: 18, fontWeight: 'bold' }}>Analyzing Fluency...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  headerMeta: {
    fontSize: 9, marginTop: 2, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, gap: 14 },

  // Section label
  sectionLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.9 },

  // Level arc
  levelCard: {
    borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
    padding: 16, gap: 12,
  },
  levelTrack: { flexDirection: 'row', alignItems: 'center' },
  levelNode: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 2,
    borderRadius: 10, borderWidth: 1,
    gap: 4, minHeight: 54,
  },
  levelNodeLabel: { fontSize: 9, fontWeight: '600', textAlign: 'center', lineHeight: 12 },
  levelConnector: { width: 8, height: 1.5 },

  // Sentence box
  sentenceBox: {
    borderRadius: 20, borderWidth: StyleSheet.hairlineWidth,
    padding: 22, gap: 6, minHeight: 120, justifyContent: 'center',
  },
  sentencePrompt: { fontSize: 11, fontWeight: '500', marginBottom: 4 },
  phaseLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  phaseDot: { width: 7, height: 7, borderRadius: 4 },
  sentenceInner: { flexDirection: 'row', flexWrap: 'wrap' },
  wordText: { fontSize: 30, fontWeight: '500', lineHeight: 44, letterSpacing: -0.3 },

  // Waveform header
  waveHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  disfluencyPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99 },
  disfluencyPillText: { fontSize: 11, fontWeight: '700' },

  // Waveform/Timeline
  waveformBox: {
    borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
    height: 80, overflow: 'hidden', justifyContent: 'center',
    paddingHorizontal: 16,
  },
  waveArea: { position: 'relative', height: 40, width: '100%', justifyContent: 'center' },
  waveCenterLine: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  progressBar: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },

  // Disfluency markers
  eventMarker: { position: 'absolute', top: -20, bottom: -20, width: 40, alignItems: 'center', marginLeft: -20 },
  eventLine: { position: 'absolute', top: '20%', bottom: '20%', width: 2, borderRadius: 1 },
  eventLabelBox: { position: 'absolute', top: 0, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
  eventLabelText: { fontSize: 9, fontWeight: '800' },

  // Result card (rich)
  resultCard: {
    borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  scoreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 18, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scoreBadge: {
    width: 70, height: 70, borderRadius: 35, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  scoreNum: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  scoreLabel: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  scoreMeta: { flex: 1, gap: 3 },
  scoreTitle: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  scoreSubtitle: { fontSize: 12, fontWeight: '500' },
  eventList: { paddingHorizontal: 16, paddingBottom: 8 },
  eventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  eventIconBox: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  eventWord: { fontSize: 13, fontWeight: '700' },
  eventDetail: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  coachBubble: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    marginTop: 6, padding: 8, borderRadius: 8, borderWidth: 1,
  },
  coachText: { fontSize: 11, fontWeight: '500', flex: 1, lineHeight: 16 },
  // Legacy stat styles (kept for reference)
  resultStat: { flex: 1, alignItems: 'center', gap: 5 },
  resultNum: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  resultStatLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  resultDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },

  // Footer
  footer: {
    paddingHorizontal: 24, paddingTop: 16,
    alignItems: 'center', gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  micBtn: {
    width: 74, height: 74, borderRadius: 37,
    alignItems: 'center', justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.22,
    shadowRadius: 14, shadowOffset: { width: 0, height: 5 },
  },
  footerHint: { fontSize: 12, fontWeight: '500', textAlign: 'center', lineHeight: 18 },

  resultBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  ghostBtn: {
    flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14,
    height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  ghostBtnText: { fontSize: 14, fontWeight: '700' },
  solidBtn: {
    flex: 1, borderRadius: 14,
    height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  solidBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },

  // Overlays
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  countdownNum: { fontSize: 120, fontWeight: '900', fontVariant: ['tabular-nums'] },
  countdownSub: { fontSize: 16, fontWeight: '600', marginTop: 10 },
  breatheRing: { width: 140, height: 140, borderRadius: 70, borderWidth: 4, position: 'absolute' },
  restTitle: { fontSize: 24, fontWeight: '800', marginTop: 40 },
  restSecs: { fontSize: 18, fontWeight: '600', marginTop: 8 },
});

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
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 27,
    shadowColor: '#EF4444',
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
});