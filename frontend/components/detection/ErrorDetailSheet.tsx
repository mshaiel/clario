/**
 * ErrorDetailSheet
 * Location: components/detection/ErrorDetailSheet.tsx
 *
 * Bottom-sheet modal for a single FlaggedWord error.
 * Extracted from ResultsDisplay so it can be reused by ParagraphModeSession.
 *
 * Handles all 6 error subtypes:
 *   - Phonology: substitution, cluster-reduction (heard=''), epenthesis (expected='')
 *   - Fluency: block, prolongation, stutter
 * In AI mode shows the coaching card; in efficient mode shows the static per-subtype detail.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AI_ACCENT } from './AICoPilotToggle';
import { ttsService } from '@/lib/ttsService';
import type {
  FlaggedWord,
  PhonologyError,
  FluencyProlongationError,
  FluencyStutterError,
  FluencyBlockError,
} from '@/lib/types';

// ─── Colour + label helpers (shared) ─────────────────────────────────────────

export function getErrorColor(error: FlaggedWord): string {
  if (error.error_category === 'fluency') {
    if (error.error_type === 'block') return '#F97316';
    if (error.error_type === 'stutter') return '#06B6D4';
    return '#F59E0B'; // prolongation
  }
  const ph = error as PhonologyError;
  if (ph.heard_phoneme === '') return '#F59E0B';    // cluster reduction
  if (ph.expected_phoneme === '') return '#8B5CF6'; // epenthesis
  return '#EF4444'; // substitution
}

export function getErrorLabel(error: FlaggedWord): string {
  if (error.error_category === 'fluency') {
    if (error.error_type === 'block') return 'Block';
    if (error.error_type === 'stutter') return 'Repetition';
    return 'Prolongation';
  }
  const ph = error as PhonologyError;
  if (ph.heard_phoneme === '') return 'Cluster Reduction';
  if (ph.expected_phoneme === '') return 'Epenthesis';
  return 'Substitution';
}

function isPhonologyError(e: FlaggedWord): e is PhonologyError {
  return e.error_category === 'phonology';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ErrorDetailSheetProps {
  visible: boolean;
  error: FlaggedWord | null;
  isDismissed: boolean;
  onDismiss: () => void;
  onClose: () => void;
  accentColor: string;
  isDark: boolean;
  text: string;
  subtle: string;
  surface: string;
  border: string;
  isAIMode: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ErrorDetailSheet({
  visible,
  error,
  isDismissed,
  onDismiss,
  onClose,
  accentColor,
  isDark,
  text,
  subtle,
  surface,
  border,
  isAIMode,
}: ErrorDetailSheetProps) {
  // ── All hooks before conditional returns ────────────────────────────────
  const coachingText: string | null = error ? ((error as any).assistant_text ?? null) : null;
  const coachingAudioUrl: string | null = error ? ((error as any).assistant_audio_url ?? null) : null;
  const hasCoaching = isAIMode && !!coachingText;

  const [isCoachingPlaying, setIsCoachingPlaying] = useState(false);

  useEffect(() => {
    if (!visible || !hasCoaching) return;
    let cancelled = false;
    const play = async () => {
      try {
        setIsCoachingPlaying(true);
        if (coachingAudioUrl) {
          await ttsService.playRemoteUrl(coachingAudioUrl);
        } else {
          await ttsService.synthesizeAndPlay(coachingText!, 'english');
        }
      } catch (e) {
        console.warn('[ErrorDetailSheet] Coaching audio failed:', e);
      } finally {
        if (!cancelled) setIsCoachingPlaying(false);
      }
    };
    play();
    return () => {
      cancelled = true;
      ttsService.stopPlayback();
      setIsCoachingPlaying(false);
    };
  }, [visible, error]);

  // ── Early return after hooks ────────────────────────────────────────────
  if (!error) return null;

  const errorColor = getErrorColor(error);
  const errorLabel = getErrorLabel(error);

  // ── Per-subtype detail renderer ─────────────────────────────────────────
  const renderDetail = () => {
    // Cluster Reduction
    if (isPhonologyError(error) && (error as PhonologyError).heard_phoneme === '') {
      const ph = error as PhonologyError;
      return (
        <>
          <View style={[styles.clusterPill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B50' }]}>
            <Ionicons name="remove-circle-outline" size={16} color="#F59E0B" />
            <Text style={[styles.clusterPillText, { color: '#F59E0B' }]}>
              /{ph.expected_phoneme}/ dropped
            </Text>
          </View>
          <View style={[styles.infoDescBadge, { backgroundColor: isDark ? '#F59E0B12' : '#FEF9EE', borderColor: '#F59E0B30' }]}>
            <Ionicons name="information-circle-outline" size={14} color="#F59E0B" />
            <Text style={[styles.infoDescText, { color: isDark ? '#F7C87A' : '#92580A' }]}>
              The /{ph.expected_phoneme}/ sound was dropped from a consonant cluster in this word
            </Text>
          </View>
        </>
      );
    }

    // Epenthesis
    if (isPhonologyError(error) && (error as PhonologyError).expected_phoneme === '') {
      const ph = error as PhonologyError;
      return (
        <>
          <View style={[styles.clusterPill, { backgroundColor: '#8B5CF618', borderColor: '#8B5CF650' }]}>
            <Ionicons name="add-circle-outline" size={16} color="#8B5CF6" />
            <Text style={[styles.clusterPillText, { color: '#8B5CF6' }]}>
              +/{ph.heard_phoneme}/ inserted
            </Text>
          </View>
          <View style={[styles.infoDescBadge, { backgroundColor: isDark ? '#8B5CF612' : '#F5F2FF', borderColor: '#8B5CF630' }]}>
            <Ionicons name="information-circle-outline" size={14} color="#8B5CF6" />
            <Text style={[styles.infoDescText, { color: isDark ? '#C4B5FD' : '#5B21B6' }]}>
              An extra /{ph.heard_phoneme}/ vowel was inserted into this word
            </Text>
          </View>
        </>
      );
    }

    // Substitution
    if (isPhonologyError(error)) {
      const ph = error as PhonologyError;
      return (
        <View style={styles.substitutionRow}>
          <View style={[styles.phonemePill, styles.phonemePillExpected]}>
            <Text style={[styles.phonemeLabel, { color: '#10B981' }]}>expected</Text>
            <Text style={[styles.phonemeIPA, { color: '#10B981' }]}>/{ph.expected_phoneme}/</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={subtle} />
          <View style={[styles.phonemePill, styles.phonemePillHeard]}>
            <Text style={[styles.phonemeLabel, { color: '#EF4444' }]}>heard</Text>
            <Text style={[styles.phonemeIPA, { color: '#EF4444' }]}>/{ph.heard_phoneme}/</Text>
          </View>
        </View>
      );
    }

    // Block
    if (error.error_type === 'block') {
      const blk = error as FluencyBlockError;
      const ms = blk.block_duration_ms ?? 0;
      const sevColor = ms < 300 ? '#F59E0B' : ms < 600 ? '#F97316' : '#EF4444';
      const sevLabel = ms < 300 ? 'Mild' : ms < 600 ? 'Moderate' : 'Severe';
      return (
        <>
          <View style={styles.blockTimeline}>
            <View style={[styles.blockTimelineWord, { backgroundColor: isDark ? '#1E2A38' : '#EDF0F3' }]}>
              <Text style={[styles.blockTimelineWordText, { color: subtle }]} numberOfLines={1}>
                {blk.preceding_phoneme ?? '…'}
              </Text>
            </View>
            <View style={styles.blockGapTrack}>
              <View style={[styles.blockGapLine, { backgroundColor: sevColor + '60' }]} />
              <View style={[styles.blockGapBadge, { backgroundColor: sevColor + '20', borderColor: sevColor + '60' }]}>
                <Text style={[styles.blockGapMs, { color: sevColor }]}>{ms}ms</Text>
              </View>
              <View style={[styles.blockGapLine, { backgroundColor: sevColor + '60' }]} />
            </View>
            <View style={[styles.blockTimelineWord, { backgroundColor: errorColor + '18', borderColor: errorColor + '50', borderWidth: 1 }]}>
              <Text style={[styles.blockTimelineWordText, { color: errorColor }]} numberOfLines={1}>
                {error.word}
              </Text>
            </View>
          </View>
          <View style={[styles.infoDescBadge, { backgroundColor: sevColor + '12', borderColor: sevColor + '35' }]}>
            <Ionicons name="timer-outline" size={14} color={sevColor} />
            <Text style={[styles.infoDescText, { color: sevColor }]}>
              {sevLabel} block — {ms}ms pause detected before "{error.word}"
            </Text>
          </View>
        </>
      );
    }

    // Prolongation
    if (error.error_type === 'prolongation') {
      const prol = error as FluencyProlongationError;
      const ms = prol.duration_ms ?? 0;
      const threshold = 200;
      const fillPct = Math.min((ms / (threshold * 4)) * 100, 100);
      const phoneme = prol.phoneme_prolonged ?? '~';
      return (
        <>
          <View style={styles.prolongPillRow}>
            <View style={[styles.prolongPill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B50' }]}>
              <Text style={[styles.prolongPillText, { color: '#F59E0B' }]}>/{phoneme}─────/</Text>
            </View>
            <View style={[styles.prolongDurBadge, { backgroundColor: '#F59E0B20' }]}>
              <Text style={[styles.prolongDurText, { color: '#F59E0B' }]}>{ms}ms</Text>
            </View>
          </View>
          <View style={[styles.prolongBarTrack, { backgroundColor: isDark ? '#1E2A38' : '#EDF0F3' }]}>
            <View style={[styles.prolongBarFill, { width: `${fillPct}%` as any, backgroundColor: '#F59E0B' }]} />
          </View>
          <View style={[styles.infoDescBadge, { backgroundColor: isDark ? '#F59E0B12' : '#FEF9EE', borderColor: '#F59E0B30' }]}>
            <Ionicons name="radio-outline" size={14} color="#F59E0B" />
            <Text style={[styles.infoDescText, { color: isDark ? '#F7C87A' : '#92580A' }]}>
              /{phoneme}/ was held for {ms}ms in "{error.word}"
            </Text>
          </View>
        </>
      );
    }

    // Stutter / Repetition
    if (error.error_type === 'stutter') {
      const st = error as FluencyStutterError;
      const phonemes: string[] = st.phonemes_stuttered ?? [];
      const count = st.repetition_count ?? phonemes.length;
      const displayPhonemes = phonemes.length > 0 ? phonemes : Array(count).fill('~');
      return (
        <>
          <View style={styles.stutterChipRow}>
            {displayPhonemes.map((p: string, i: number) => (
              <View
                key={i}
                style={[
                  styles.stutterChip,
                  { backgroundColor: '#06B6D418', borderColor: '#06B6D450', opacity: Math.max(1 - (i * 0.18), 0.35) },
                ]}
              >
                <Text style={[styles.stutterChipText, { color: '#06B6D4' }]}>/{p}/</Text>
              </View>
            ))}
            <Text style={[styles.stutterCount, { color: subtle }]}>×{count}</Text>
          </View>
          <View style={[styles.infoDescBadge, { backgroundColor: isDark ? '#06B6D412' : '#ECFEFF', borderColor: '#06B6D430' }]}>
            <Ionicons name="repeat-outline" size={14} color="#06B6D4" />
            <Text style={[styles.infoDescText, { color: isDark ? '#67E8F9' : '#0E7490' }]}>
              {phonemes.length > 0 ? `/${phonemes[0]}/` : 'A sound'} repeated {count} time{count !== 1 ? 's' : ''} before "{error.word}"
            </Text>
          </View>
        </>
      );
    }

    return null;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheetContainer, { backgroundColor: surface }]}>
        {/* Handle */}
        <View style={[styles.sheetHandle, { backgroundColor: isDark ? '#3A4560' : '#D0D5DD' }]} />

        {/* Word title */}
        <Text style={[styles.sheetWord, { color: text }]}>"{error.word}"</Text>

        {/* Error type badge */}
        <View style={[styles.sheetTypeBadge, { backgroundColor: errorColor + '22' }]}>
          <Text style={[styles.sheetTypeText, { color: errorColor }]}>{errorLabel}</Text>
        </View>

        {/* Per-subtype detail or AI coaching */}
        {hasCoaching ? (
          <Animated.View
            entering={FadeIn.duration(300)}
            style={[
              styles.coachingCard,
              { backgroundColor: isDark ? '#16152A' : '#F6F5FF', borderColor: AI_ACCENT + '35' },
            ]}
          >
            <View style={styles.coachingHeader}>
              <View style={[styles.coachingAvatar, { backgroundColor: AI_ACCENT + '22', borderColor: AI_ACCENT + '40' }]}>
                <Ionicons name="sparkles" size={14} color={AI_ACCENT} />
              </View>
              <Text style={[styles.coachingTitle, { color: AI_ACCENT }]}>Co-Pilot</Text>
              {isCoachingPlaying && (
                <View style={styles.coachingWaveDots}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[styles.coachingWaveDot, { backgroundColor: AI_ACCENT, opacity: 0.5 + i * 0.2 }]} />
                  ))}
                </View>
              )}
            </View>
            <Text style={[styles.coachingText, { color: isDark ? '#E2E0FF' : '#3730A3' }]}>
              "{coachingText}"
            </Text>
            <TouchableOpacity
              style={[styles.coachingReplayBtn, { borderColor: AI_ACCENT + '50' }]}
              activeOpacity={0.7}
              onPress={() => {
                if (isCoachingPlaying) {
                  ttsService.stopPlayback();
                  setIsCoachingPlaying(false);
                } else {
                  const play = async () => {
                    try {
                      setIsCoachingPlaying(true);
                      if (coachingAudioUrl) {
                        await ttsService.playRemoteUrl(coachingAudioUrl);
                      } else {
                        await ttsService.synthesizeAndPlay(coachingText!, 'english');
                      }
                    } catch {}
                    finally { setIsCoachingPlaying(false); }
                  };
                  play();
                }
              }}
            >
              <Ionicons
                name={isCoachingPlaying ? 'stop-circle-outline' : 'volume-medium-outline'}
                size={14}
                color={AI_ACCENT}
              />
              <Text style={[styles.coachingReplayText, { color: AI_ACCENT }]}>
                {isCoachingPlaying ? 'Stop' : 'Replay'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          renderDetail()
        )}

        {/* Dismiss / Noted */}
        {isDismissed ? (
          <View style={[styles.notedBadge, { backgroundColor: isDark ? '#2A3040' : '#F1F3F7' }]}>
            <Ionicons name="checkmark-circle-outline" size={15} color={subtle} />
            <Text style={[styles.notedText, { color: subtle }]}>Noted — not counted as an error</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.notMyErrorBtn, { borderColor: border }]}
            onPress={() => { onDismiss(); onClose(); }}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle-outline" size={16} color={subtle} />
            <Text style={[styles.notMyErrorText, { color: subtle }]}>Not my error</Text>
          </TouchableOpacity>
        )}

        {/* Done */}
        <TouchableOpacity
          style={[styles.sheetDoneBtn, { backgroundColor: accentColor }]}
          onPress={onClose}
          activeOpacity={0.85}
        >
          <Text style={styles.sheetDoneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetContainer: {
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 14,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, marginBottom: 20 },
  sheetWord: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 10, textAlign: 'center' },
  sheetTypeBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginBottom: 22 },
  sheetTypeText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },

  // Substitution
  substitutionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  phonemePill: { alignItems: 'center', padding: 14, borderRadius: 16, minWidth: 90 },
  phonemePillExpected: { backgroundColor: '#10B98115' },
  phonemePillHeard: { backgroundColor: '#EF444415' },
  phonemeLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  phonemeIPA: { fontSize: 24, fontWeight: '700' },

  // Cluster / Epenthesis
  clusterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center',
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, borderWidth: 1.5, marginBottom: 14,
  },
  clusterPillText: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },

  // Info badge (shared)
  infoDescBadge: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12,
    borderRadius: 12, borderWidth: 1, marginBottom: 20, alignSelf: 'stretch',
  },
  infoDescText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18 },

  // Block
  blockTimeline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, alignSelf: 'stretch' },
  blockTimelineWord: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, maxWidth: 90 },
  blockTimelineWordText: { fontSize: 13, fontWeight: '600' },
  blockGapTrack: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  blockGapLine: { flex: 1, height: 2, borderRadius: 1 },
  blockGapBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  blockGapMs: { fontSize: 11, fontWeight: '700' },

  // Prolongation
  prolongPillRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, alignSelf: 'center' },
  prolongPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5 },
  prolongPillText: { fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  prolongDurBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  prolongDurText: { fontSize: 12, fontWeight: '700' },
  prolongBarTrack: { height: 6, borderRadius: 3, alignSelf: 'stretch', overflow: 'hidden', marginBottom: 14 },
  prolongBarFill: { height: 6, borderRadius: 3 },

  // Stutter
  stutterChipRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flexWrap: 'wrap', justifyContent: 'center', marginBottom: 14, alignSelf: 'center',
  },
  stutterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1.5 },
  stutterChipText: { fontSize: 15, fontWeight: '700' },
  stutterCount: { fontSize: 15, fontWeight: '700', marginLeft: 4 },

  // AI Coaching Card
  coachingCard: { alignSelf: 'stretch', borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20 },
  coachingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  coachingAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  coachingTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', flex: 1 },
  coachingWaveDots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  coachingWaveDot: { width: 4, height: 4, borderRadius: 2 },
  coachingText: { fontSize: 15, fontWeight: '500', lineHeight: 22, fontStyle: 'italic', marginBottom: 14 },
  coachingReplayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1,
  },
  coachingReplayText: { fontSize: 12, fontWeight: '600' },

  // Dismiss
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
});
