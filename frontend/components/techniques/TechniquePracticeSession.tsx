import Ionicons from '@expo/vector-icons/Ionicons';
import { auth } from '@/firebase';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useLanguage } from '@/context/LanguageContext';
import {
  ExerciseItem, ExerciseSession, ScoreResult,
  TechniqueAPI,
} from '@/lib/techniqueApi';
import { ttsService } from '@/lib/ttsService';
import { TechniqueGuide } from '@/lib/techniqueData';
import { TechniqueResultCard } from './TechniqueResultCard';
import { TechniqueSignalResultCard, SignalScoringMode } from './TechniqueSignalResultCard';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeInUp,
  useAnimatedStyle, useSharedValue, withRepeat,
  withSequence, withTiming,
} from 'react-native-reanimated';

type Phase = 'loading' | 'error' | 'practicing' | 'scoring' | 'result' | 'complete';

interface Props {
  visible: boolean;
  technique: TechniqueGuide;
  accentColor: string;
  onClose: () => void;
}

// ── Pulsing record ring ────────────────────────────────────────────────────
function PulseRing({ color, active }: { color: string; active: boolean }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);
  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(withTiming(1.35, { duration: 700, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 700 })), -1, false);
      opacity.value = withRepeat(withSequence(withTiming(0, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1, false);
    } else {
      scale.value = withTiming(1, { duration: 300 });
      opacity.value = withTiming(0, { duration: 300 });
    }
  }, [active]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <Animated.View style={[styles.pulseRing, { borderColor: color, width: 140, height: 140, borderRadius: 70 }, style]} />
  );
}

// ── Rep dots progress ──────────────────────────────────────────────────────
function RepDots({ total, current, color }: { total: number; current: number; color: string }) {
  return (
    <View style={styles.repDots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[
          styles.repDot,
          { backgroundColor: i < current ? color : color + '30', width: i < current ? 22 : 8 },
        ]} />
      ))}
    </View>
  );
}


// ── Main component ─────────────────────────────────────────────────────────
export function TechniquePracticeSession({ visible, technique, accentColor, onClose }: Props) {
  const { language } = useLanguage();
  const { isRecording, startRecording, stopRecording, clearRecording } = useAudioRecorder();
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<ExerciseSession | null>(null);
  const [itemIdx, setItemIdx] = useState(0);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [allScores, setAllScores] = useState<number[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const startTime = useRef(Date.now());
  const uid = auth.currentUser?.uid ?? 'anon';

  const currentItem: ExerciseItem | null = session?.items[itemIdx] ?? null;
  const totalItems = session?.items.length ?? 5;

  // Load exercise
  useEffect(() => {
    if (!visible) return;
    setPhase('loading');
    setItemIdx(0);
    setAllScores([]);
    setAudioUri(null);
    setScoreResult(null);
    startTime.current = Date.now();

    TechniqueAPI.getExercise(technique.backendReady.techniqueId, uid, language)
      .then(s => { setSession(s); setPhase('practicing'); })
      .catch(e => { setErrorMsg(String(e)); setPhase('error'); });
  }, [visible]);

  // Cleanup on close
  useEffect(() => {
    if (!visible) { ttsService.stopPlayback(); clearRecording(); }
  }, [visible]);

  const handleListen = async () => {
    if (!currentItem) return;
    try { await ttsService.synthesizeAndPlay(currentItem.sentence, language); }
    catch { /* ignore */ }
  };

  const handleStartRecord = async () => {
    setAudioUri(null);
    clearRecording();
    ttsService.stopPlayback();
    await startRecording();
  };

  const handleStopRecord = async () => {
    const uri = await stopRecording();
    if (uri) setAudioUri(uri);
  };

  const handleScore = useCallback(async () => {
    if (!audioUri || !currentItem || !session) return;
    setPhase('scoring');
    try {
      const result = await TechniqueAPI.scoreRecording(
        audioUri,
        session.technique_id,
        currentItem.sentence_id,
        currentItem.sentence,
        currentItem.cam_sentence_id ?? null,
        session.scoring_mode,
        session.scoring_config,
        language,
      );
      setScoreResult(result);
      setAllScores(prev => [...prev, result.score]);
      setPhase('result');
    } catch {
      // On scoring error, give a default "try again" result
      setScoreResult({
        success: false, technique_id: session.technique_id,
        sentence_id: currentItem.sentence_id, score: 0,
        grade: 'try_again', feedback_en: 'Could not reach scoring service. Please try again.',
        feedback_ur: '', feedback_audio_b64: '', details: {},
      });
      setPhase('result');
    }
  }, [audioUri, currentItem, session, language]);

  const handleNext = useCallback(() => {
    const next = itemIdx + 1;
    if (next >= totalItems) {
      const avg = allScores.length
        ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
        : null;
      const duration = Math.round((Date.now() - startTime.current) / 1000);
      TechniqueAPI.logProgress(uid, technique.backendReady.techniqueId, avg, duration,
        { scores: allScores, technique_name: technique.title });
      setPhase('complete');
    } else {
      setItemIdx(next);
      setAudioUri(null);
      setScoreResult(null);
      clearRecording();
      setPhase('practicing');
    }
  }, [itemIdx, totalItems, allScores]);

  const handleRetry = () => {
    setAudioUri(null);
    clearRecording();
    setPhase('practicing');
  };

  const avgScore = allScores.length
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;

  const statusBarHeight = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: statusBarHeight }]}>
        {/* Accent glow background blob */}
        <View style={[styles.glowBlob, { backgroundColor: accentColor + '18' }]} />

        {/* ── HEADER ────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 50 : 16 }]}>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-down" size={22} color="#FFFFFF99" />
          </Pressable>
          <View style={styles.headerCenter}>
            <View style={[styles.modeBadge, { backgroundColor: accentColor + '22', borderColor: accentColor + '55' }]}>
              <Ionicons name="barbell-outline" size={11} color={accentColor} />
              <Text style={[styles.modeBadgeText, { color: accentColor }]}>TECHNIQUE PRACTICE</Text>
            </View>
            <Text style={styles.headerName} numberOfLines={1}>{technique.title}</Text>
          </View>
          <RepDots total={totalItems} current={phase === 'complete' ? totalItems : itemIdx} color={accentColor} />
        </View>

        {/* ── DIVIDER ───────────────────────────────────────────────── */}
        <View style={[styles.accentLine, { backgroundColor: accentColor }]} />

        {/* ── PHASES ────────────────────────────────────────────────── */}
        {phase === 'loading' && (
          <View style={styles.centerFill}>
            <ActivityIndicator size="large" color={accentColor} />
            <Text style={styles.loadingText}>Preparing your session…</Text>
            <Text style={styles.loadingSub}>Loading sentences and instructions</Text>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.centerFill}>
            <View style={[styles.errorIcon, { backgroundColor: '#EF444422' }]}>
              <Ionicons name="cloud-offline-outline" size={36} color="#EF4444" />
            </View>
            <Text style={styles.errorTitle}>Session Unavailable</Text>
            <Text style={styles.errorSub}>{errorMsg}</Text>
            <Pressable onPress={onClose} style={[styles.retryBtn, { backgroundColor: accentColor }]}>
              <Text style={styles.retryBtnText}>Go Back</Text>
            </Pressable>
          </View>
        )}

        {(phase === 'practicing' || phase === 'scoring') && currentItem && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.practiceArea}>

            {/* ── TOP: sentence + tip + listen ── */}
            <View style={styles.practiceTop}>
              <Text style={[styles.repLabel, { color: accentColor }]}>
                Rep {itemIdx + 1} of {totalItems}
              </Text>

              <View style={[styles.sentenceCard, { borderColor: accentColor + '45', shadowColor: accentColor }]}>
                <View style={[styles.sentenceStripe, { backgroundColor: accentColor }]} />
                <Text style={styles.sentenceText}>{currentItem.sentence}</Text>
              </View>

              <View style={[styles.tipCard, { backgroundColor: accentColor + '10', borderColor: accentColor + '30' }]}>
                <Ionicons name="bulb-outline" size={15} color={accentColor} />
                <Text style={[styles.tipText, { color: accentColor + 'CC' }]} numberOfLines={3}>
                  {currentItem.instruction}
                </Text>
              </View>

              <Pressable onPress={handleListen} style={[styles.listenBtn, { borderColor: accentColor + '60' }]}>
                <Ionicons name="volume-medium-outline" size={16} color={accentColor} />
                <Text style={[styles.listenText, { color: accentColor }]}>Listen to Model</Text>
              </Pressable>
            </View>

            {/* ── BOTTOM: mic pinned to bottom ── */}
            <View style={styles.practiceBottom}>
              <Text style={styles.hintText}>
                {isRecording ? 'Release to stop' : audioUri ? 'Tap Analyse or retake' : 'Hold mic to record'}
              </Text>

              {audioUri && !isRecording && phase !== 'scoring' && (
                <Animated.View entering={FadeInUp.duration(250)} style={styles.submitRow}>
                  <Pressable onPress={handleScore} style={[styles.submitBtn, { backgroundColor: accentColor }]}>
                    <Ionicons name="analytics-outline" size={16} color="#FFF" />
                    <Text style={styles.submitText}>Analyse</Text>
                  </Pressable>
                  <Pressable onPress={() => { setAudioUri(null); clearRecording(); }}>
                    <Text style={styles.retakeText}>Retake</Text>
                  </Pressable>
                </Animated.View>
              )}

              <View style={styles.recordArea}>
                <PulseRing color={accentColor} active={isRecording} />
                <Pressable
                  onPressIn={handleStartRecord}
                  onPressOut={handleStopRecord}
                  disabled={phase === 'scoring'}
                  style={[styles.micBtn, { backgroundColor: isRecording ? accentColor : accentColor + '22', borderColor: accentColor }]}
                >
                  {phase === 'scoring'
                    ? <ActivityIndicator color="#FFF" size="small" />
                    : <Ionicons name={isRecording ? 'stop' : 'mic'} size={36} color={isRecording ? '#FFF' : accentColor} />}
                </Pressable>
              </View>
            </View>

          </Animated.View>
        )}

        {phase === 'result' && scoreResult && (
          <Animated.View entering={FadeInDown.duration(350)} style={styles.resultArea}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.resultScroll}
            >
              {(session?.scoring_mode === 'cam' || !session?.scoring_mode) ? (
                <TechniqueResultCard
                  accentColor={accentColor}
                  score={scoreResult.score}
                  grade={scoreResult.grade}
                  feedbackText={
                    language === 'urdu' && scoreResult.feedback_ur
                      ? scoreResult.feedback_ur
                      : scoreResult.feedback_en
                  }
                  wordResults={scoreResult.details?.word_results ?? []}
                  expectedSentence={currentItem?.sentence ?? ''}
                  transcript={scoreResult.details?.transcript ?? ''}
                />
              ) : (
                <TechniqueSignalResultCard
                  accentColor={accentColor}
                  score={scoreResult.score}
                  grade={scoreResult.grade}
                  feedbackText={
                    language === 'urdu' && scoreResult.feedback_ur
                      ? scoreResult.feedback_ur
                      : scoreResult.feedback_en
                  }
                  scoringMode={session.scoring_mode as SignalScoringMode}
                  details={scoreResult.details ?? {}}
                />
              )}
            </ScrollView>

            {/* ── Action buttons pinned to bottom ── */}
            <View style={styles.resultActions}>
              {scoreResult.grade === 'try_again' && (
                <Pressable onPress={handleRetry} style={[styles.retryBtnOutline, { borderColor: accentColor }]}>
                  <Ionicons name="refresh-outline" size={16} color={accentColor} />
                  <Text style={[styles.retryBtnOutlineText, { color: accentColor }]}>Try Again</Text>
                </Pressable>
              )}
              <Pressable onPress={handleNext} style={[styles.nextBtn, { backgroundColor: accentColor }]}>
                <Text style={styles.nextBtnText}>
                  {itemIdx + 1 >= totalItems ? 'Finish Session' : 'Next Sentence'}
                </Text>
                <Ionicons
                  name={itemIdx + 1 >= totalItems ? 'checkmark-circle' : 'arrow-forward'}
                  size={18}
                  color="#FFF"
                />
              </Pressable>
            </View>
          </Animated.View>
        )}

        {phase === 'complete' && (
          <Animated.View entering={FadeIn.duration(400)} style={styles.completeArea}>
            <View style={[styles.completeIcon, { backgroundColor: accentColor + '20' }]}>
              <Ionicons name="trophy-outline" size={48} color={accentColor} />
            </View>
            <Text style={styles.completeTitle}>Session Complete!</Text>
            <Text style={[styles.completeSub, { color: '#FFFFFF88' }]}>
              You practiced {totalItems} sentences of {technique.title}
            </Text>

            <View style={[styles.avgCard, { borderColor: accentColor + '40' }]}>
              <Text style={[styles.avgLabel, { color: '#FFFFFF66' }]}>Session Average</Text>
              <Text style={[styles.avgScore, { color: accentColor }]}>{avgScore}<Text style={styles.avgOf}>/100</Text></Text>
            </View>

            {/* Per-sentence mini scores */}
            <View style={styles.scorePills}>
              {allScores.map((s, i) => (
                <View key={i} style={[styles.scorePill, { backgroundColor: s >= 75 ? '#22C55E22' : s >= 50 ? '#F59E0B22' : '#EF444422' }]}>
                  <Text style={[styles.scorePillText, { color: s >= 75 ? '#22C55E' : s >= 50 ? '#F59E0B' : '#EF4444' }]}>
                    {s}
                  </Text>
                </View>
              ))}
            </View>

            <Pressable onPress={onClose} style={[styles.doneBtn, { backgroundColor: accentColor }]}>
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
            <Pressable onPress={() => {
              setPhase('loading');
              setItemIdx(0);
              setAllScores([]);
              setAudioUri(null);
              setScoreResult(null);
              startTime.current = Date.now();
              TechniqueAPI.getExercise(technique.backendReady.techniqueId, uid, language)
                .then(s => { setSession(s); setPhase('practicing'); })
                .catch(e => { setErrorMsg(String(e)); setPhase('error'); });
            }}>
              <Text style={[styles.practiceAgainText, { color: accentColor }]}>Practice Again</Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070B12' },
  glowBlob: { position: 'absolute', top: -100, right: -80, width: 280, height: 280, borderRadius: 140 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 3 },
  modeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  modeBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  headerName: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },
  accentLine: { height: 1.5, marginHorizontal: 20, borderRadius: 1, opacity: 0.5, marginBottom: 6 },

  // Rep dots
  repDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  repDot: { height: 8, borderRadius: 4 },

  // Center states
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  loadingText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginTop: 8 },
  loadingSub: { fontSize: 13, color: '#FFFFFF55', textAlign: 'center' },
  errorIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  errorTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  errorSub: { fontSize: 14, color: '#FFFFFF66', textAlign: 'center', lineHeight: 21 },
  retryBtn: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 28, marginTop: 8 },
  retryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },

  // Practice phase
  practiceArea: { flex: 1, paddingHorizontal: 20, flexDirection: 'column' },
  practiceTop: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 16,
  },
  practiceBottom: {
    paddingBottom: 44,
    alignItems: 'center',
    gap: 14,
  },
  repLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.0, textAlign: 'center', marginBottom: 14, opacity: 0.7 },
  sentenceCard: {
    backgroundColor: '#0F1520', borderWidth: 1.5, borderRadius: 24,
    marginBottom: 12, flexDirection: 'row', overflow: 'hidden', minHeight: 80,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 18, elevation: 8,
  },
  sentenceStripe: { width: 4, flexShrink: 0, borderTopLeftRadius: 24, borderBottomLeftRadius: 24 },
  sentenceText: { flex: 1, fontSize: 21, fontWeight: '700', color: '#FFFFFF', lineHeight: 30, letterSpacing: -0.4, textAlign: 'center', padding: 22, paddingLeft: 18 },
  tipCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 18 },
  listenBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 22, borderWidth: 1 },
  listenText: { fontSize: 13, fontWeight: '600' },

  // Record
  recordArea: { alignItems: 'center', justifyContent: 'center', position: 'relative', width: 110, height: 110 },
  pulseRing: { position: 'absolute', borderWidth: 2 },
  micBtn: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5 },
  submitRow: { alignItems: 'center', gap: 10 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 24 },
  submitText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  retakeText: { color: '#FFFFFF55', fontSize: 13, fontWeight: '500' },
  hintText: { textAlign: 'center', color: '#FFFFFF44', fontSize: 12, fontWeight: '400' },

  // Result phase
  resultArea: { flex: 1, flexDirection: 'column' },
  resultScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },

  resultActions: { paddingHorizontal: 20, paddingBottom: 36, paddingTop: 10, gap: 10 },
  retryBtnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1.5, borderRadius: 16, paddingVertical: 13 },
  retryBtnOutlineText: { fontSize: 14, fontWeight: '700' },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 16 },
  nextBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  // Complete phase
  completeArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  completeIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  completeTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  completeSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  avgCard: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 40, paddingVertical: 18, alignItems: 'center', gap: 4 },
  avgLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  avgScore: { fontSize: 52, fontWeight: '900', letterSpacing: -2 },
  avgOf: { fontSize: 17, fontWeight: '500' },
  scorePills: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', justifyContent: 'center' },
  scorePill: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  scorePillText: { fontSize: 12, fontWeight: '700' },
  doneBtn: { width: '100%', paddingVertical: 15, borderRadius: 18, alignItems: 'center' },
  doneBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  practiceAgainText: { fontSize: 14, fontWeight: '600', paddingVertical: 6 },
});
