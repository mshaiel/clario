import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { GradientGlow } from '@/components/ui/GradientGlow';
import { useAppTheme } from '@/theme-provider';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { AICoPilotToggle } from '@/components/detection/AICoPilotToggle';
import { AIFeedbackBubble } from '@/components/detection/AIFeedbackBubble';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { clarioAssistant } from '@/lib/clarioAssistant';
import type { Language } from '@/lib/types';

// ─── Constants ────────────────────────────────────────────────────────────────
const AMBER   = '#F59E0B';
const EMERALD = '#10B981';
const REPS    = 3;    // Repetitions per word
const GAP_MS  = 1500; // Time the word stays revealed on screen

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

// ─── Animated Waveform ────────────────────────────────────────────────────────
function Waveform({ active, color }: { active: boolean; color: string }) {
  const N = 13;
  // Stable animation values — created once
  const anims = useMemo(() => Array.from({ length: N }, () => new Animated.Value(0.2)), []);

  useEffect(() => {
    const loops = anims.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: active ? 0.7 + (i % 3) * 0.1 : 0.2, duration: 200 + i * 28, useNativeDriver: false }),
          Animated.timing(v, { toValue: active ? 0.2 + (i % 4) * 0.08 : 0.2, duration: 200 + i * 25, useNativeDriver: false }),
        ])
      )
    );

    if (active) {
      loops.forEach(l => l.start());
    } else {
      loops.forEach(l => l.stop());
      anims.forEach(v => Animated.timing(v, { toValue: 0.2, duration: 250, useNativeDriver: false }).start());
    }

    return () => loops.forEach(l => l.stop());
  }, [active]);

  return (
    <View style={styles.waveRow}>
      {anims.map((v, i) => (
        <Animated.View
          key={i}
          style={[styles.waveBar, {
            backgroundColor: active ? color : color + '44',
            height: v.interpolate({ inputRange: [0, 1], outputRange: [6, 52] }),
          }]}
        />
      ))}
    </View>
  );
}

// ─── Icon Button (spring press) ───────────────────────────────────────────────
function IconBtn({
  icon, label, onPress, bg, color, size = 14, disabled = false, accent = false,
}: {
  icon: string; label: string; onPress: () => void;
  bg: string; color: string; size?: number; disabled?: boolean; accent?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const press   = () => Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 40 }).start();
  const release = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 30 }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={press}
        onPressOut={release}
        disabled={disabled}
        activeOpacity={1}
        style={[styles.iconBtn, { backgroundColor: bg, opacity: disabled ? 0.45 : 1 }]}
      >
        <Ionicons name={icon as any} size={size} color={color} />
        <Text style={[styles.iconBtnLabel, { color }]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export function AuditoryBombardmentScreen() {
  const { resolvedTheme } = useAppTheme();
  const { aiEnabled, setAiEnabled } = useAICoPilot();
  const router   = useRouter();
  const session  = usePracticeSession();
  const tts      = useTTSPlayback();
  const insets   = useSafeAreaInsets();
  const params   = useLocalSearchParams<{ language?: string }>();

  // ── UI state ─────────────────────────────────────────────────────────────
  const [hasStarted,     setHasStarted]     = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [currentRep,     setCurrentRep]     = useState(1);
  const [showWord,       setShowWord]       = useState(false);
  const [isCompleted,    setIsCompleted]    = useState(false);
  const [isPaused,       setIsPaused]       = useState(false);
  const [amplified,      setAmplified]      = useState(false);
  const [showBubble,     setShowBubble]     = useState(true);
  const [aiMsg,          setAiMsg]          = useState<string | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const progressAnim   = useRef(new Animated.Value(0)).current;
  const startBtnScale  = useRef(new Animated.Value(1)).current;
  // Generation counter: increment to abort any in-flight auto-play loop
  const playGenRef     = useRef(0);
  // Ref mirrors of state so async closures see live values
  const isPausedRef = useRef(true);
  const isCompletedRef = useRef(false);
  const hasPlayedIntroRef = useRef(false);

  useEffect(() => { isPausedRef.current    = isPaused;    }, [isPaused]);
  useEffect(() => { isCompletedRef.current = isCompleted; }, [isCompleted]);

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#080C12' : '#F4F7FB';
  const textC   = resolvedTheme.colors.text;
  const subtle  = isDark ? '#5A7294' : '#8A9BB0';
  const surface = isDark ? '#0F1724' : '#FFFFFF';
  const border  = isDark ? '#1C2840' : '#E4EAF2';
  const cardBg  = isDark ? '#101928' : '#FFFFFF';
  const ctrlBg  = isDark ? '#182030' : '#EEF3FB';

  // ── Derived ───────────────────────────────────────────────────────────────
  const targetPhoneme = String(session.targetPhoneme ?? '');
  const currentWord   = useMemo(
    () => String(session.currentItem?.word ?? '').toUpperCase(),
    [session.currentItem]
  );
  const currentCue = useMemo(() => {
    if (!session.currentItem) return '';
    const cat = session.currentItem.metadata?.category ?? '';
    if (targetPhoneme) return `/${targetPhoneme}/`;
    return cat || '';
  }, [session.currentItem, targetPhoneme]);

  // Show actual word number, not progress fraction
  const wordLabel = session.totalItems > 0
    ? `Word ${session.currentItemIndex + 1} of ${session.totalItems}`
    : '';

  // ── AI intro ──────────────────────────────────────────────────────────────
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

  // ── Core auto-play loop ───────────────────────────────────────────────────
  // Uses a generation token (playGenRef) so only one loop runs at a time.
  // Synthesises TTS ONCE per word, replays the cached URL for each rep.
  const startAutoPlay = useCallback(async (gen: number) => {
    if (!session.currentItem?.word) return;
    const word = String(session.currentItem.word);

    // Synthesise once — get audio URL (base64 data URI from TTS server)
    let audioUrl: string | null = null;
    try {
      audioUrl = await tts.synthesizeOnly(word);
    } catch {
      // No-op: will fall back to playWord (which makes a new request) on each rep
    }

    // Check gen and pause after async synthesize
    if (playGenRef.current !== gen || isPausedRef.current || isCompletedRef.current) return;

    // Play REPS times
    for (let rep = 1; rep <= REPS; rep++) {
      if (playGenRef.current !== gen || isPausedRef.current || isCompletedRef.current) return;

      setCurrentRep(rep);
      
      // Hide word only on the first repetition. It stays revealed for the rest.
      if (rep === 1) {
        setShowWord(false);
      }
      
      setIsAudioPlaying(true);

      // Animate the thin playback progress bar
      progressAnim.setValue(0);
      Animated.timing(progressAnim, { toValue: 1, duration: 1800, useNativeDriver: false }).start();

      // Play cached audio (one synthesis → reuse URL for all reps)
      if (audioUrl) {
        await tts.playFromUrl(audioUrl);
      } else {
        await tts.playWord(word);
      }

      if (playGenRef.current !== gen || isCompletedRef.current) return;

      // Word reveal happens IMMEDIATELY after TTS finishes
      setShowWord(true);
      setIsAudioPlaying(false);

      // Wait so the user can read the revealed word
      await sleep(GAP_MS);
    }

    if (playGenRef.current !== gen || isPausedRef.current || isCompletedRef.current) return;

    // ── All reps done — advance to next word ──────────────────────────────
    setShowWord(false);
    setCurrentRep(1);
    session.recordAttempt('correct');

    const hasNext = session.nextItem();
    if (!hasNext) {
      isCompletedRef.current = true;
      setIsCompleted(true);
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
      setTimeout(() => router.back(), 2500);
    }
  }, [session, tts, progressAnim, router, aiEnabled, params.language]);

  // Trigger auto-play whenever: session starts, word changes, or pause resumes
  useEffect(() => {
    if (!hasStarted || isCompleted || isPaused || session.totalItems === 0) return;
    playGenRef.current++; // Abort any running loop
    const gen = playGenRef.current;
    const t = setTimeout(() => startAutoPlay(gen), 350);
    return () => clearTimeout(t);
  }, [hasStarted, session.currentItemIndex, isCompleted, isPaused]);

  // Cleanup on unmount
  useEffect(() => () => { playGenRef.current++; tts.stop(); }, []);

  // ── Manual controls ───────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    clarioAssistant.stop();
    setHasStarted(true);
  }, []);

  const handlePause = useCallback(() => {
    playGenRef.current++;       // Abort auto-play loop
    isPausedRef.current = true;
    setIsPaused(true);
    tts.stop();
    progressAnim.stopAnimation();
  }, [tts, progressAnim]);

  const handleResume = useCallback(() => {
    isPausedRef.current = false;
    setIsPaused(false);
    // isPaused → false will re-trigger the effect → new startAutoPlay
  }, []);

  const handleReplay = useCallback(() => {
    // Restart repetitions for the current word
    if (isCompleted || !session.currentItem?.word) return;
    
    playGenRef.current++;       // Abort current loop
    isPausedRef.current = false;
    setIsPaused(false);
    setCurrentRep(1);
    setShowWord(false);
    
    // Auto-play effect will trigger since playGenRef changed and isPaused is false
  }, [isCompleted, session.currentItem]);

  const handleNextWord = useCallback(() => {
    if (isCompleted) return;
    tts.stop();
    playGenRef.current++;       // Abort current loop
    setShowWord(false);
    setCurrentRep(1);
    setIsPaused(false);
    isPausedRef.current = false;
    
    // Roll word to the end of the list
    session.recordAttempt('skipped');
    session.appendItem(session.currentItem);
    
    const hasNext = session.nextItem();
    if (!hasNext) {
      isCompletedRef.current = true;
      setIsCompleted(true);
      session.completeSession();
      setTimeout(() => router.back(), 2500);
    }
    // session.currentItemIndex change triggers effect → new startAutoPlay
  }, [isCompleted, tts, session, router]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <GradientGlow color={AMBER} isDark={isDark} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={[styles.header, {
        borderBottomColor: border,
        paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 4 : 8,
      }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: ctrlBg, borderColor: border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={18} color={subtle} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: textC }]}>Auditory Bombardment</Text>
          <Text style={[styles.headerSub,   { color: subtle }]}>{wordLabel}</Text>
        </View>

        <AICoPilotToggle state={aiEnabled ? 'idle' : 'off'} onToggle={() => setAiEnabled(!aiEnabled)} />
      </View>

      {aiEnabled && <View style={[styles.aiStrip, { backgroundColor: PRIMARY + '22' }]} />}

      {/* ── Slim progress bar (whole session) ───────────────────────────── */}
      <View style={[styles.progTrack, { backgroundColor: isDark ? '#182030' : '#E4EAF2' }]}>
        <View style={[styles.progFill, {
          width: `${session.progress * 100}%`,
          backgroundColor: AMBER,
        }]} />
      </View>

      {/* ── Mode chips ──────────────────────────────────────────────────── */}
      <View style={styles.chipRow}>
        <View style={[styles.chip, { backgroundColor: AMBER + '16' }]}>
          <Ionicons name="ear-outline" size={12} color={AMBER} />
          <Text style={[styles.chipText, { color: AMBER }]}>Receptive</Text>
        </View>
        <TouchableOpacity
          style={[styles.chip, {
            backgroundColor: amplified ? AMBER + '22' : ctrlBg,
            borderWidth: amplified ? 1 : 0,
            borderColor: AMBER + '80',
          }]}
          onPress={() => setAmplified(p => !p)}
          activeOpacity={0.75}
        >
          <Ionicons
            name={amplified ? 'volume-high' : 'volume-medium-outline'}
            size={12} color={amplified ? AMBER : subtle}
          />
          <Text style={[styles.chipText, { color: amplified ? AMBER : subtle }]}>
            {amplified ? 'Amplified' : 'Normal'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <View style={[styles.content, { paddingBottom: Math.max(insets.bottom + 16, 16) }]}>

        {/* PRE-START ──────────────────────────────────────────────────────── */}
        {!hasStarted ? (
          <View style={styles.centered}>
            <View style={[styles.startCard, { backgroundColor: cardBg, borderColor: border }]}>
              <View style={[styles.bigIcon, { backgroundColor: AMBER + '15' }]}>
                <Ionicons name="ear" size={44} color={AMBER} />
              </View>
              <Text style={[styles.startTitle, { color: textC }]}>Ready to Listen?</Text>
              <Text style={[styles.startSub, { color: subtle }]}>
                Each word plays {REPS} times. Focus on the sound — no speaking needed.
              </Text>
              <Animated.View style={{ transform: [{ scale: startBtnScale }], width: '100%' }}>
                <TouchableOpacity
                  style={[styles.startBtn, { backgroundColor: AMBER, shadowColor: AMBER }]}
                  onPress={handleStart}
                  onPressIn={() => Animated.spring(startBtnScale, { toValue: 0.95, useNativeDriver: true, speed: 40 }).start()}
                  onPressOut={() => Animated.spring(startBtnScale, { toValue: 1,    useNativeDriver: true, speed: 30 }).start()}
                  activeOpacity={1}
                >
                  <Ionicons name="play" size={18} color="#FFF" />
                  <Text style={styles.startBtnLabel}>Begin Exercise</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>

            {/* ── AI bubble in pre-start ── */}
            {aiEnabled && showBubble && (
              <View style={[styles.bubbleWrap, { marginTop: 16 }]}>
                <AIFeedbackBubble
                  message={aiMsg || "I'll play each word clearly. Just listen — no speaking needed yet."}
                  isSpeaking={isAssistantSpeaking}
                  onDismiss={() => setShowBubble(false)}
                  style={{ marginHorizontal: 0, marginBottom: 0 }}
                />
              </View>
            )}
          </View>

        ) : !isCompleted ? (
          /* ACTIVE SESSION ─────────────────────────────────────────────────── */
          <View style={styles.session}>

            {/* ── Listening card — ALWAYS at top, never shifts ── */}
            <View style={[styles.card, {
              backgroundColor: cardBg,
              borderColor: isAudioPlaying ? AMBER + '88' : border,
              shadowColor:   isAudioPlaying ? AMBER : '#6366F1',
              shadowOpacity: isAudioPlaying ? 0.22 : 0.08,
              shadowRadius:  isAudioPlaying ? 24 : 12,
              elevation: 8,
            }]}>
              {/* Ambient top tint */}
              <View style={[styles.cardGlow, { backgroundColor: AMBER + '0C' }]} />

              {/* Waveform (always visible, animates when playing & not paused) */}
              <Waveform active={isAudioPlaying && !isPaused} color={AMBER} />

              {/* Word or listening placeholder */}
              {showWord ? (
                <View style={styles.wordArea}>
                  <Text style={[styles.wordText, { color: textC }]} adjustsFontSizeToFit numberOfLines={1}>
                    {currentWord}
                  </Text>
                  {currentCue ? (
                    <View style={[styles.cuePill, { backgroundColor: AMBER + '18' }]}>
                      <Text style={[styles.cueText, { color: AMBER }]}>{currentCue}</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.placeholderArea}>
                  <Text style={[styles.placeholderText, { color: subtle }]}>
                    {isPaused ? 'Paused' : isAudioPlaying ? 'Listening…' : 'Preparing…'}
                  </Text>
                </View>
              )}

              {/* Thin playback progress bar */}
              <View style={[styles.pbTrack, { backgroundColor: isDark ? '#1E2D42' : '#EEF2FA' }]}>
                <Animated.View style={[styles.pbFill, {
                  backgroundColor: AMBER,
                  width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                }]} />
              </View>

              {/* Controls: Pause | Replay | Next Word */}
              <View style={styles.ctrlRow}>
                <IconBtn
                  icon={isPaused ? 'play' : 'pause'}
                  label={isPaused ? 'Resume' : 'Pause'}
                  bg={ctrlBg}
                  color={subtle}
                  onPress={isPaused ? handleResume : handlePause}
                />
                <IconBtn
                  icon="refresh"
                  label="Replay"
                  bg={ctrlBg}
                  color={subtle}
                  onPress={handleReplay}
                  disabled={isAudioPlaying && !isPaused}
                />
                <IconBtn
                  icon="play-skip-forward"
                  label="Next Word"
                  bg={AMBER + '1C'}
                  color={AMBER}
                  onPress={handleNextWord}
                  disabled={false}
                  accent
                />
              </View>
            </View>

            {/* ── Repetition tracker ── */}
            <View style={[styles.repBar, { backgroundColor: surface, borderColor: border }]}>
              <Text style={[styles.repBarLabel, { color: subtle }]}>Repetition</Text>
              <View style={styles.repPips}>
                {Array.from({ length: REPS }).map((_, i) => (
                  <View key={i} style={[styles.pip, {
                    backgroundColor: i < currentRep ? AMBER : (isDark ? '#1E2D42' : '#D8E1EE'),
                    transform: [{ scale: i === currentRep - 1 && isAudioPlaying ? 1.35 : 1 }],
                  }]} />
                ))}
              </View>
              <Text style={[styles.repCount, { color: AMBER }]}>{currentRep}/{REPS}</Text>
            </View>

            {/* ── Item progress dots ── */}
            <View style={styles.dots}>
              {session.items.map((_: any, i: number) => (
                <View key={i} style={[styles.dot, {
                  width: i === session.currentItemIndex ? 20 : 6,
                  backgroundColor:
                    i < session.currentItemIndex  ? EMERALD :
                    i === session.currentItemIndex ? AMBER :
                    subtle + '30',
                }]} />
              ))}
            </View>

          </View>

        ) : (
          /* COMPLETE ─────────────────────────────────────────────────────── */
          <View style={styles.centered}>
            <View style={[styles.doneCard, { backgroundColor: cardBg, borderColor: EMERALD + '55' }]}>
              <View style={[styles.doneIcon, { backgroundColor: EMERALD + '18' }]}>
                <Ionicons name="checkmark-circle" size={42} color={EMERALD} />
              </View>
              <Text style={[styles.doneTitle, { color: textC }]}>
                All {session.totalItems} words absorbed!
              </Text>
              <Text style={[styles.doneSub, { color: subtle }]}>
                Great listening. Moving to the next exercise…
              </Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, paddingBottom: 12,
    gap: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  headerSub:    { fontSize: 11, marginTop: 2, fontWeight: '600' },

  aiStrip: { height: 2 },

  // Session progress
  progTrack: { height: 4, marginHorizontal: 20, marginTop: 12, borderRadius: 999, overflow: 'hidden' },
  progFill:  { height: '100%', borderRadius: 999 },

  // Chips
  chipRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 10, gap: 8,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  chipText: { fontSize: 11, fontWeight: '600' },

  // Layout
  content:  { flex: 1, paddingTop: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  session:  { flex: 1, alignItems: 'center', paddingHorizontal: 18, paddingTop: 4, gap: 12 },

  // Main card
  card: {
    width: '100%', borderRadius: 24, borderWidth: 1.5,
    paddingHorizontal: 22, paddingTop: 20, paddingBottom: 16,
    alignItems: 'center', overflow: 'hidden', position: 'relative',
    shadowOffset: { width: 0, height: 8 },
  },
  cardGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 110 },

  // Waveform
  waveRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center',
    gap: 3, height: 60, marginBottom: 12,
  },
  waveBar: { width: 5, borderRadius: 3 },

  // Word
  wordArea:  { alignItems: 'center', gap: 6, marginBottom: 4 },
  wordText:  { fontSize: 48, fontWeight: '900', letterSpacing: -1.5 },
  cuePill:   { paddingHorizontal: 12, paddingVertical: 3, borderRadius: 99 },
  cueText:   { fontSize: 12, fontWeight: '700' },

  // Placeholder
  placeholderArea: { alignItems: 'center', justifyContent: 'center', height: 58, marginBottom: 4 },
  placeholderText: { fontSize: 14, fontWeight: '600', fontStyle: 'italic' },

  // Playback progress
  pbTrack: { width: '100%', height: 3, borderRadius: 999, overflow: 'hidden', marginTop: 14 },
  pbFill:  { height: '100%', borderRadius: 999 },

  // Control buttons
  ctrlRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginTop: 12,
  },
  iconBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 13, paddingVertical: 9,
    borderRadius: 20, gap: 5,
  },
  iconBtnLabel: { fontSize: 12, fontWeight: '700' },

  // Repetition tracker
  repBar: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 99,
    paddingHorizontal: 18, paddingVertical: 9, gap: 10,
  },
  repBarLabel: { fontSize: 11, fontWeight: '600' },
  repPips:     { flexDirection: 'row', gap: 7, flex: 1, justifyContent: 'center' },
  pip:         { width: 9, height: 9, borderRadius: 5 },
  repCount:    { fontSize: 11, fontWeight: '800' },

  // Item dots
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  dot:  { height: 5, borderRadius: 99 },

  // AI bubble
  bubbleWrap: { width: '100%' },

  // Start card
  startCard: {
    width: '100%', borderRadius: 26, borderWidth: 1,
    paddingHorizontal: 26, paddingVertical: 34,
    alignItems: 'center', gap: 12,
    shadowColor: '#6366F1', shadowOpacity: 0.07,
    shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 5,
  },
  bigIcon:      { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  startTitle:   { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  startSub:     { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, width: '100%', paddingVertical: 16, borderRadius: 999,
    shadowOpacity: 0.30, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  startBtnLabel: { color: '#FFF', fontSize: 16, fontWeight: '800' },

  // Done card
  doneCard: {
    width: '100%', borderRadius: 26, borderWidth: 1,
    paddingVertical: 38, paddingHorizontal: 28,
    alignItems: 'center', gap: 10,
    shadowColor: EMERALD, shadowOpacity: 0.10,
    shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 5,
  },
  doneIcon:  { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  doneTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  doneSub:   { fontSize: 14, textAlign: 'center', lineHeight: 21 },
});
