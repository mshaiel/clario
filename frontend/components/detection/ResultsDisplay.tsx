/**
 * ResultsDisplay — REDESIGN
 * Location: components/detection/ResultsDisplay.tsx
 *
 * - Single-screen layout (no scroll), flex-budgeted sections
 * - Compact accuracy header strip with retry + continue inline
 * - Sentence: flagged words highlighted, tap → bottom-sheet with substitution detail
 * - Error chips row: compact pills, tap same sheet
 * - Minimal dual playback row (your recording + model)
 * - AI bubble area reserved only when isAIMode (placeholder, real bubble added later)
 * - "Not my error" replaces checkbox pattern — turns grey + "noted"
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { AI_ACCENT } from './AICoPilotToggle';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/theme-provider';
import { useLanguage } from '@/context/LanguageContext';
import { AnalysisResponse, FlaggedWord, PhonologyError, WordResult } from '@/lib/types';
import { ttsService } from '@/lib/ttsService';
import { AIFeedbackBubble } from './AIFeedbackBubble';
import { ErrorDetailSheet, getErrorColor, getErrorLabel } from './ErrorDetailSheet';


interface Props {
  result: AnalysisResponse;
  expectedSentence: string;
  recordedAudioUri: string | null;
  moduleUri?: string;
  modelAudioPath?: string;
  onContinue: (validatedErrors: FlaggedWord[]) => void;
  onRetake: () => void;
  onReportError?: (index: number, isReal: boolean) => void;
  onUpdateResults?: (newResult: any) => void;
  isAIMode?: boolean;
  /** Coaching message to show in the AI bubble (from clarioAssistant) */
  aiBubbleMessage?: string | null;
  /** Disables the Continue button while a continuation is already in flight */
  disabled?: boolean;
  /** Whether this is the last sentence in the session */
  isLastSentence?: boolean;
}

// getErrorColor, getErrorLabel, and ErrorDetailSheet are imported from ./ErrorDetailSheet

// ─────────────────────────────────────────────────────────────────────────────
// ResultsDisplay — main component
// ─────────────────────────────────────────────────────────────────────────────

export function ResultsDisplay({
  result,
  expectedSentence,
  recordedAudioUri,
  moduleUri,
  modelAudioPath,
  onContinue,
  onRetake,
  isAIMode = false,
  aiBubbleMessage: initialBubbleMessage = null,
  disabled = false,
  isLastSentence = false,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const { isRTL } = useLanguage();
  const insets = useSafeAreaInsets();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const accentColor = isAIMode ? AI_ACCENT : PRIMARY;
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#7A8FA3' : '#59677A';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const border = isDark ? '#252D3A' : '#D1D8E2';
  const bg = isDark ? '#0C0F14' : '#F2F5F9';

  // "Not my error" dismissed set
  const [dismissedWords, setDismissedWords] = useState<Set<string>>(new Set());

  // AI bubble — local dismissible state seeded from prop
  const [bubbleMessage, setBubbleMessage] = useState<string | null>(initialBubbleMessage);
  // Sync if parent sets the message after initial render
  useEffect(() => {
    if (initialBubbleMessage) setBubbleMessage(initialBubbleMessage);
  }, [initialBubbleMessage]);

  // Bottom-sheet state
  const [sheetError, setSheetError] = useState<FlaggedWord | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  // Playback state
  const [isPlayingUser, setIsPlayingUser] = useState(false);
  const [isPlayingModel, setIsPlayingModel] = useState(false);
  const [userProgress, setUserProgress] = useState(0);
  const userSoundRef = useRef<Audio.Sound | null>(null);

  const flaggedWords = result.flagged_words || [];
  const validatedErrors = flaggedWords.filter((e: FlaggedWord) => !dismissedWords.has(e.word));

  // Build skipped-word set from word_results (word was not heard at all)
  const skippedWords = new Set<string>(
    (result.word_results ?? []).filter((w: WordResult) => w.status === 'skipped').map((w: WordResult) => w.word.toLowerCase())
  );

  const accuracy = Math.round(result.sentence_accuracy);
  const scoreColor =
    accuracy >= 80 ? '#10B981' : accuracy >= 50 ? '#F59E0B' : '#EF4444';
  const scoreLabel =
    accuracy >= 80 ? 'Great work!' : accuracy >= 50 ? 'Good progress' : 'Keep practising';

  // Total visible issues = phonology/fluency errors + skipped words
  const totalIssueCount = validatedErrors.length + skippedWords.size;

  const openSheet = (error: FlaggedWord) => {
    setSheetError(error);
    setSheetVisible(true);
  };

  const dismissWord = (word: string) => {
    setDismissedWords((prev: Set<string>) => new Set([...prev, word]));
  };

  // ── Playback ────────────────────────────────────────────────────────────────
  const playUserAudio = async () => {
    if (!recordedAudioUri) return;
    try {
      setIsPlayingUser(true);
      setUserProgress(0);
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, playThroughEarpieceAndroid: false, staysActiveInBackground: false });
      const { sound } = await Audio.Sound.createAsync({ uri: recordedAudioUri });
      userSoundRef.current = sound;
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded) {
          if (status.durationMillis && status.durationMillis > 0) {
            setUserProgress((status.positionMillis ?? 0) / status.durationMillis);
          }
          if (status.didJustFinish) {
            setIsPlayingUser(false);
            setUserProgress(0);
            sound.unloadAsync().catch(() => {});
          }
        }
      });
    } catch {
      setIsPlayingUser(false);
    }
  };

  const playModelAudio = async () => {
    if (!moduleUri || !modelAudioPath) return;
    try {
      setIsPlayingModel(true);
      await ttsService.playLocalFile(`${moduleUri}${modelAudioPath}`);
    } catch (e) {
      console.warn('[ResultsDisplay] Model audio failed:', e);
    } finally {
      setIsPlayingModel(false);
    }
  };

  // ── Derived display values ──────────────────────────────────────────────────
  const errorCount = validatedErrors.length;
  const issueLabel = totalIssueCount === 0
    ? 'No issues detected'
    : totalIssueCount === 1 ? '1 issue detected'
    : `${totalIssueCount} issues detected`;
  const words = expectedSentence.split(' ');

  const getError = (rawWord: string): FlaggedWord | undefined => {
    const clean = rawWord.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '').toLowerCase();
    return flaggedWords.find((e: FlaggedWord) => e.word.toLowerCase() === clean);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>

      {/* ── 1. SCORE BANNER ───────────────────────────────────────────────── */}
      <Animated.View
        entering={FadeInDown.duration(300)}
        style={[styles.scoreBanner, { backgroundColor: scoreColor }]}
      >
        {/* Centered score */}
        <Text style={styles.bannerLabel}>ACCURACY</Text>
        <Text style={styles.bannerPercent}>
          {accuracy}<Text style={styles.bannerPct}>%</Text>
        </Text>
        <View style={styles.issueBadge}>
          <Ionicons
            name={errorCount === 0 ? 'checkmark-circle' : 'alert-circle'}
            size={14}
            color="rgba(255,255,255,0.85)"
          />
          <Text style={styles.issueBadgeText}>{issueLabel}</Text>
        </View>

        {isAIMode && (
          <View style={styles.aiBannerBadge}>
            <Ionicons name="sparkles" size={10} color="#FFF" />
            <Text style={styles.aiBannerText}>AI Mode</Text>
          </View>
        )}
      </Animated.View>

      {/* ── SCROLLABLE MIDDLE SECTION ─────────────────────────────────────── */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

      {/* ── 2. WORD GRID CARD ─────────────────────────────────────────────── */}
      <Animated.View
        entering={FadeIn.duration(400).delay(100)}
        style={[
          styles.wordCard,
          { backgroundColor: surface, borderColor: border },
          isAIMode ? styles.wordCardAI : styles.wordCardFull,
        ]}
      >
        {/* Tap hint — shown when there are errors or skipped words */}
        {(flaggedWords.length > 0 || skippedWords.size > 0) && (
          <View style={[styles.tapHintRow, { borderBottomColor: border }]}>
            <Ionicons name="finger-print" size={13} color={subtle} />
            <Text style={[styles.tapHintText, { color: subtle }]}>
              {skippedWords.size > 0 && flaggedWords.length === 0
                ? `${skippedWords.size} word${skippedWords.size > 1 ? 's' : ''} not heard`
                : `Tap your error${flaggedWords.length > 1 ? 's' : ''} to view`
              }
            </Text>
          </View>
        )}

        {/* Word pills — vertically centred in remaining space */}
        <View style={styles.wordGridWrap}>
          <View style={[styles.wordGrid, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            {words.map((rawWord, idx) => {
              const clean = rawWord.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '');
              const err = getError(rawWord);
              const dismissed = err ? dismissedWords.has(err.word) : false;
              const isSkipped = !err && skippedWords.has(clean.toLowerCase());
              const isErr = !!err && !dismissed;
              const isDismissed = !!err && dismissed;
              const isCorrect = !err && !isSkipped;

              return (
                <Animated.View
                  key={idx}
                  entering={FadeIn.duration(260).delay(60 + idx * 35)}
                >
                  <TouchableOpacity
                    onPress={err ? () => openSheet(err) : undefined}
                    activeOpacity={err ? 0.65 : 1}
                    style={[
                      styles.wordPill,
                      isCorrect && styles.wordPillCorrect,
                      isErr && styles.wordPillError,
                      isDismissed && styles.wordPillDismissed,
                      isSkipped && styles.wordPillSkipped,
                    ]}
                  >
                    {isCorrect && (
                      <Ionicons name="checkmark" size={12} color="#10B981" style={styles.wordPillIcon} />
                    )}
                    {isSkipped && (
                      <Ionicons name="remove" size={12} color="#F59E0B" style={styles.wordPillIcon} />
                    )}
                    {isErr && <View style={[styles.wordErrDot, { backgroundColor: getErrorColor(err!) }]} />}
                    <Text
                      style={[
                        styles.wordPillText,
                        isCorrect && { color: '#10B981' },
                        isErr && { color: '#EF4444' },
                        isSkipped && { color: '#F59E0B' },
                        isDismissed && { color: isDark ? '#4A5568' : '#9AA3B0', textDecorationLine: 'line-through' },
                        !isCorrect && !isErr && !isDismissed && !isSkipped && { color: text },
                      ]}
                    >
                      {clean}
                    </Text>
                    {isErr && (
                      <Ionicons name="chevron-down" size={12} color="#EF444490" style={styles.wordChevron} />
                    )}
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>
        </View>

        {/* Bottom of card: legend */}
        <View style={styles.cardBottom}>
          <View style={[styles.legend, { borderTopColor: isDark ? '#1E2A38' : '#D1D8E2' }]}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
              <Text style={[styles.legendText, { color: subtle }]}>Correct</Text>
            </View>
            {flaggedWords.length > 0 && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
                <Text style={[styles.legendText, { color: subtle }]}>Incorrect</Text>
              </View>
            )}
            {skippedWords.size > 0 && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                <Text style={[styles.legendText, { color: subtle }]}>Skipped</Text>
              </View>
            )}
            {dismissedWords.size > 0 && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: subtle }]} />
                <Text style={[styles.legendText, { color: subtle }]}>Dismissed</Text>
              </View>
            )}
          </View>
        </View>
      </Animated.View>

      {/* ── 3. AI BUBBLE CARD ─────────────────────────────────────────────── */}
      {isAIMode && bubbleMessage && (
        <AIFeedbackBubble
          message={bubbleMessage}
          isSpeaking={ttsService.isAudioPlaying}
          onDismiss={() => setBubbleMessage(null)}
          style={styles.resultsBubble}
        />
      )}

      {/* ── 4. PLAYBACK CARD ──────────────────────────────────────────────── */}
      <Animated.View
        entering={FadeInUp.duration(320).delay(140)}
        style={[styles.playbackCard, { backgroundColor: surface, borderColor: border }]}
      >
        <Text style={[styles.playbackSectionLabel, { color: subtle }]}>COMPARE RECORDINGS</Text>
        <View style={styles.playbackBtns}>
          {/* Your recording */}
          <TouchableOpacity
            style={[
              styles.playBtn,
              {
                backgroundColor: isPlayingUser
                  ? accentColor + '15'
                  : isDark ? '#1A2030' : '#E8EDF2',
                borderColor: isPlayingUser ? accentColor + '55' : border,
              },
            ]}
            onPress={playUserAudio}
            disabled={!recordedAudioUri}
            activeOpacity={0.75}
          >
            <View style={[
              styles.playIconRing,
              { backgroundColor: isPlayingUser ? accentColor : isDark ? '#252D3A' : '#D1D8E2' },
            ]}>
              {isPlayingUser
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Ionicons name="mic" size={15} color={recordedAudioUri ? (isDark ? '#C8D3E0' : '#59677A') : subtle} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.playBtnLabel, { color: recordedAudioUri ? text : subtle }]}>
                Your recording
              </Text>
              {isPlayingUser && (
                <View style={[styles.playProgressTrack, { backgroundColor: border, marginTop: 4 }]}>
                  <View style={[styles.playProgressFill, {
                    width: `${userProgress * 100}%` as any,
                    backgroundColor: accentColor,
                  }]} />
                </View>
              )}
            </View>
          </TouchableOpacity>

          <View style={[styles.playDivider, { backgroundColor: border }]} />

          {/* Model */}
          <TouchableOpacity
            style={[
              styles.playBtn,
              {
                backgroundColor: isPlayingModel
                  ? '#10B98115'
                  : isDark ? '#1A2030' : '#E8EDF2',
                borderColor: isPlayingModel ? '#10B98155' : border,
              },
            ]}
            onPress={playModelAudio}
            disabled={!moduleUri || !modelAudioPath}
            activeOpacity={0.75}
          >
            <View style={[
              styles.playIconRing,
              { backgroundColor: isPlayingModel ? '#10B981' : isDark ? '#252D3A' : '#E4E8F0' },
            ]}>
              {isPlayingModel
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Ionicons name="volume-medium" size={15} color={moduleUri && modelAudioPath ? (isDark ? '#C8D3E0' : '#5A6B80') : subtle} />}
            </View>
            <Text style={[styles.playBtnLabel, { color: moduleUri && modelAudioPath ? text : subtle }]}>
              Model
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      </ScrollView>

      {/* ── 5. FOOTER ─────────────────────────────────────────────────────── */}
      <Animated.View
        entering={FadeInUp.duration(320).delay(180)}
        style={[styles.footer, { borderTopColor: border, paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <TouchableOpacity
          style={[styles.retryBtn, { borderColor: border, backgroundColor: surface }]}
          onPress={onRetake}
          activeOpacity={0.75}
        >
          <Ionicons name="reload-outline" size={17} color={subtle} />
          <Text style={[styles.retryText, { color: subtle }]}>Retry</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.continueBtn,
            { backgroundColor: accentColor, shadowColor: accentColor },
            disabled && { opacity: 0.55 },
          ]}
          onPress={() => !disabled && onContinue(validatedErrors)}
          disabled={disabled}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>
            {isLastSentence ? 'Finish' : 'Continue'}
          </Text>
          <Ionicons
            name={isLastSentence ? 'checkmark-circle-outline' : 'arrow-forward'}
            size={17}
            color="#FFF"
          />
        </TouchableOpacity>
      </Animated.View>

      {/* ── ERROR DETAIL SHEET ────────────────────────────────────────────── */}
      <ErrorDetailSheet
        visible={sheetVisible}
        error={sheetError}
        isDismissed={sheetError ? dismissedWords.has(sheetError.word) : false}
        onDismiss={() => sheetError && dismissWord(sheetError.word)}
        onClose={() => setSheetVisible(false)}
        accentColor={accentColor}
        isDark={isDark}
        text={text}
        subtle={subtle}
        surface={surface}
        border={border}
        isAIMode={isAIMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // ── Score banner ───────────────────────────────────────────────────────────
  scoreBanner: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 26,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  bannerLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  bannerPercent: {
    color: '#FFF',
    fontSize: 80,
    fontWeight: '800',
    letterSpacing: -4,
    lineHeight: 84,
    textAlign: 'center',
  },
  bannerPct: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1,
  },
  issueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  issueBadgeText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
  aiBannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 10,
  },
  aiBannerText: { color: '#FFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },

  // ── Scroll area ────────────────────────────────────────────────────────────
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },

  // ── Word grid card ─────────────────────────────────────────────────────────
  wordCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
    flexDirection: 'column',
  },
  // Non-AI: no flex changes needed — card sizes to content
  wordCardFull: {},
  // AI mode: same, bubble is in scroll so no squish
  wordCardAI: {},
  tapHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  tapHintText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  wordGridWrap: {
    paddingVertical: 8,
    justifyContent: 'center',
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBottom: {
    marginTop: 14,
  },
  wordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  wordPillCorrect: {
    backgroundColor: '#10B98114',
    borderColor: '#10B98130',
  },
  wordPillError: {
    backgroundColor: '#EF444416',
    borderColor: '#EF444432',
  },
  wordPillDismissed: {
    backgroundColor: '#9AA3B012',
    borderColor: '#9AA3B028',
  },
  wordPillSkipped: {
    backgroundColor: '#F59E0B14',
    borderColor: '#F59E0B30',
  },
  wordPillIcon: { marginRight: 4 },
  wordErrDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#EF4444',
    marginRight: 5,
  },
  wordPillText: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  wordChevron: { marginLeft: 3 },
  legend: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: '500' },

  // ── AI bubble card (sits between word card and playback card) ───────────────
  resultsBubble: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 0,
  },

  // ── Playback card ──────────────────────────────────────────────────────────
  playbackCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 0,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  playbackSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  playbackBtns: { flexDirection: 'row', gap: 0 },
  playBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  playDivider: { width: 8 },
  playIconRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playBtnLabel: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  playProgressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  playProgressFill: { height: 3, borderRadius: 2 },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    marginTop: 0,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  retryText: { fontSize: 15, fontWeight: '600' },
  continueBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 8,
  },
  continueBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  // ── Sheet ──────────────────────────────────────────────────────────────────
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetContainer: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, marginBottom: 20 },
  sheetWord: {
    fontSize: 28, fontWeight: '700', letterSpacing: -0.5,
    marginBottom: 10, textAlign: 'center',
  },
  sheetTypeBadge: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginBottom: 22,
  },
  sheetTypeText: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6,
  },
  substitutionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24,
  },
  phonemePill: { alignItems: 'center', padding: 14, borderRadius: 16, minWidth: 90 },
  phonemePillExpected: { backgroundColor: '#10B98115' },
  phonemePillHeard: { backgroundColor: '#EF444415' },
  phonemeLabel: {
    fontSize: 10, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 4,
  },
  phonemeIPA: { fontSize: 24, fontWeight: '700' },
  fluencyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
    borderRadius: 12, borderWidth: 1, marginBottom: 24, alignSelf: 'stretch',
  },
  fluencyBadgeText: { flex: 1, fontSize: 13, color: '#F59E0B', fontWeight: '500' },
  notedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14,
    marginBottom: 20, alignSelf: 'stretch', justifyContent: 'center',
  },
  notedText: { fontSize: 13, fontWeight: '500' },
  notMyErrorBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14,
    borderWidth: 1, marginBottom: 20, alignSelf: 'stretch', justifyContent: 'center',
  },
  notMyErrorText: { fontSize: 14, fontWeight: '500' },
  sheetDoneBtn: { width: '100%', paddingVertical: 16, borderRadius: 18, alignItems: 'center' },
  sheetDoneBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  // ── Cluster / Epenthesis pill ──────────────────────────────────────────────
  clusterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 24, borderWidth: 1.5, marginBottom: 14,
  },
  clusterPillText: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },

  // ── Info description badge (shared across subtypes) ────────────────────────
  infoDescBadge: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
    marginBottom: 20, alignSelf: 'stretch',
  },
  infoDescText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18 },

  // ── Block timeline ─────────────────────────────────────────────────────────
  blockTimeline: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, marginBottom: 16, alignSelf: 'stretch',
  },
  blockTimelineWord: {
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10, maxWidth: 90,
  },
  blockTimelineWordText: { fontSize: 13, fontWeight: '600' },
  blockGapTrack: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  blockGapLine: { flex: 1, height: 2, borderRadius: 1 },
  blockGapBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10, borderWidth: 1,
  },
  blockGapMs: { fontSize: 11, fontWeight: '700' },

  // ── Prolongation ───────────────────────────────────────────────────────────
  prolongPillRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 12, alignSelf: 'center',
  },
  prolongPill: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1.5,
  },
  prolongPillText: { fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  prolongDurBadge: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10,
  },
  prolongDurText: { fontSize: 12, fontWeight: '700' },
  prolongBarTrack: {
    height: 6, borderRadius: 3, alignSelf: 'stretch',
    overflow: 'hidden', marginBottom: 14,
  },
  prolongBarFill: { height: 6, borderRadius: 3 },

  // ── Stutter / Repetition ───────────────────────────────────────────────────
  stutterChipRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flexWrap: 'wrap', justifyContent: 'center',
    marginBottom: 14, alignSelf: 'center',
  },
  stutterChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16, borderWidth: 1.5,
  },
  stutterChipText: { fontSize: 15, fontWeight: '700' },
  stutterCount: { fontSize: 15, fontWeight: '700', marginLeft: 4 },

  // ── AI Coaching Card (inside ErrorDetailSheet, AI mode only) ──────────────
  coachingCard: {
    alignSelf: 'stretch',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  coachingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  coachingAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachingTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },
  coachingWaveDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  coachingWaveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  coachingText: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
    fontStyle: 'italic',
    marginBottom: 14,
  },
  coachingReplayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  coachingReplayText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
