/**
 * TechniqueResultCard
 * ───────────────────
 * Premium word-level results display for the Techniques Practice module.
 *
 * Data available from CAM via ScoreResult.details.word_results:
 *   { word: string, status: "heard"|"skipped"|"substituted", heard_as: string|null }
 *
 * Design:
 *  - Dark glassmorphic card (matches TechniquePracticeSession dark theme)
 *  - Sentence rendered as inline word pills — green / amber / red
 *  - Tap any non-green word → bottom-sheet detail with:
 *      • "substituted" → side-by-side pill: expected ↔ heard
 *      • "skipped"     → "word not detected" with tip
 *  - Summary legend + transcript strip at bottom
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WordResult {
  word: string;
  status: 'heard' | 'skipped' | 'substituted';
  heard_as: string | null;
}

interface Props {
  /** Accent colour from the parent session (technique's colour) */
  accentColor: string;
  /** Score 0–100 */
  score: number;
  /** e.g. "excellent" | "good" | "needs_work" | "try_again" */
  grade: string;
  /** Feedback text in active language */
  feedbackText: string;
  /** CAM word_results array */
  wordResults: WordResult[];
  /** What the user was supposed to say */
  expectedSentence: string;
  /** Whisper transcript (raw) */
  transcript?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const HEARD_COLOR      = '#22C55E';
const SUBSTITUTED_COLOR = '#F59E0B';
const SKIPPED_COLOR    = '#EF4444';

const STATUS_LABEL: Record<string, string> = {
  heard:       'Correct',
  substituted: 'Substituted',
  skipped:     'Not Heard',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function clean(w: string): string {
  return w.replace(/[^\w\s]/g, '').trim().toLowerCase();
}

function colorFor(status: string): string {
  if (status === 'heard')       return HEARD_COLOR;
  if (status === 'substituted') return SUBSTITUTED_COLOR;
  return SKIPPED_COLOR;
}

function iconFor(status: string): keyof typeof Ionicons.glyphMap {
  if (status === 'heard')       return 'checkmark-circle';
  if (status === 'substituted') return 'swap-horizontal';
  return 'mic-off';
}

// Build a lookup from expected word (cleaned) → WordResult
function buildResultMap(wordResults: WordResult[]): Map<string, WordResult> {
  const map = new Map<string, WordResult>();
  for (const wr of wordResults) {
    map.set(clean(wr.word), wr);
  }
  return map;
}

// ── WordPill ─────────────────────────────────────────────────────────────────

interface WordPillProps {
  wr: WordResult | null;
  rawWord: string;
  accentColor: string;
  onPress: (wr: WordResult) => void;
  enterDelay: number;
}

function WordPill({ wr, rawWord, accentColor, onPress, enterDelay }: WordPillProps) {
  const scale = useSharedValue(1);
  const status = wr?.status ?? 'heard';
  const color = wr ? colorFor(status) : accentColor;
  const isIssue = wr && status !== 'heard';

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (!isIssue || !wr) return;
    scale.value = withSpring(0.88, { damping: 10, stiffness: 300 }, () => {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
    });
    onPress(wr);
  };

  return (
    <Animated.View entering={FadeIn.duration(220).delay(enterDelay)} style={pillStyle}>
      <Pressable
        onPress={handlePress}
        disabled={!isIssue}
        style={[
          styles.wordPill,
          { backgroundColor: color + '18', borderColor: color + (isIssue ? '55' : '35') },
        ]}
      >
        {status === 'heard' && (
          <Ionicons name="checkmark" size={11} color={HEARD_COLOR} style={styles.pillIcon} />
        )}
        {status === 'substituted' && (
          <Ionicons name="swap-horizontal" size={11} color={SUBSTITUTED_COLOR} style={styles.pillIcon} />
        )}
        {status === 'skipped' && (
          <Ionicons name="close" size={11} color={SKIPPED_COLOR} style={styles.pillIcon} />
        )}
        <Text style={[styles.wordPillText, { color }]}>{clean(rawWord) || rawWord}</Text>
        {isIssue && (
          <Ionicons name="chevron-down" size={10} color={color + 'AA'} style={styles.pillChevron} />
        )}
      </Pressable>
    </Animated.View>
  );
}

// ── DetailSheet ───────────────────────────────────────────────────────────────

interface SheetProps {
  visible: boolean;
  wr: WordResult | null;
  accentColor: string;
  onClose: () => void;
}

function DetailSheet({ visible, wr, accentColor, onClose }: SheetProps) {
  // Slide animation for the sheet
  const slideAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      RNAnimated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    } else {
      RNAnimated.timing(slideAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  if (!wr) return null;

  const color = colorFor(wr.status);

  const renderDetail = () => {
    if (wr.status === 'substituted' && wr.heard_as) {
      return (
        <Animated.View entering={FadeInUp.duration(300).delay(80)}>
          {/* Side-by-side comparison */}
          <Text style={styles.sheetSectionLabel}>WHAT HAPPENED</Text>
          <View style={styles.substitutionRow}>
            {/* Expected */}
            <View style={[styles.subPill, { backgroundColor: '#22C55E18', borderColor: '#22C55E40' }]}>
              <Text style={styles.subPillLabel}>EXPECTED</Text>
              <Text style={[styles.subPillWord, { color: '#22C55E' }]}>{wr.word}</Text>
            </View>

            {/* Arrow */}
            <View style={styles.subArrow}>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF33" />
            </View>

            {/* Heard */}
            <View style={[styles.subPill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B40' }]}>
              <Text style={styles.subPillLabel}>YOU SAID</Text>
              <Text style={[styles.subPillWord, { color: '#F59E0B' }]}>{wr.heard_as}</Text>
            </View>
          </View>

          {/* Human-readable tip */}
          <View style={[styles.tipBox, { backgroundColor: '#F59E0B0C', borderColor: '#F59E0B25' }]}>
            <Ionicons name="bulb-outline" size={14} color="#F59E0B" />
            <Text style={styles.tipText}>
              The system heard "{wr.heard_as}" instead of "{wr.word}". Try saying it again more clearly and listen to the model audio first.
            </Text>
          </View>
        </Animated.View>
      );
    }

    if (wr.status === 'skipped') {
      return (
        <Animated.View entering={FadeInUp.duration(300).delay(80)}>
          {/* Not detected indicator */}
          <Text style={styles.sheetSectionLabel}>WHAT HAPPENED</Text>
          <View style={[styles.skippedBox, { backgroundColor: '#EF444410', borderColor: '#EF444430' }]}>
            <Ionicons name="mic-off-outline" size={28} color="#EF4444" />
            <Text style={[styles.skippedBoxTitle, { color: '#EF4444' }]}>Word Not Detected</Text>
            <Text style={styles.skippedBoxSub}>
              "{wr.word}" was not heard in your recording.
            </Text>
          </View>

          <View style={[styles.tipBox, { backgroundColor: '#EF44440C', borderColor: '#EF444425' }]}>
            <Ionicons name="bulb-outline" size={14} color="#EF4444" />
            <Text style={[styles.tipText, { color: '#EF4444CC' }]}>
              Make sure you're speaking clearly and that the word is audible. Check that your microphone is working.
            </Text>
          </View>
        </Animated.View>
      );
    }

    return null;
  };

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Dimmed backdrop */}
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />

      {/* Sheet */}
      <RNAnimated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        {/* Handle */}
        <View style={styles.sheetHandle} />

        {/* Word + status badge */}
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetWord, { color }]}>"{wr.word}"</Text>
          <View style={[styles.sheetBadge, { backgroundColor: color + '1A', borderColor: color + '40' }]}>
            <Ionicons name={iconFor(wr.status)} size={12} color={color} />
            <Text style={[styles.sheetBadgeText, { color }]}>{STATUS_LABEL[wr.status]}</Text>
          </View>
        </View>

        {/* Dynamic content */}
        {renderDetail()}

        {/* Close */}
        <Pressable
          style={[styles.sheetDoneBtn, { backgroundColor: accentColor }]}
          onPress={onClose}
        >
          <Text style={styles.sheetDoneBtnText}>Got it</Text>
        </Pressable>
      </RNAnimated.View>
    </Modal>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function TechniqueResultCard({
  accentColor,
  score,
  grade,
  feedbackText,
  wordResults,
  expectedSentence,
  transcript,
}: Props) {
  const [sheetWr, setSheetWr] = useState<WordResult | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const openSheet = useCallback((wr: WordResult) => {
    setSheetWr(wr);
    setSheetVisible(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetVisible(false);
  }, []);

  // Build result lookup
  const resultMap = buildResultMap(wordResults);

  // Word tokens from expected sentence
  const tokens = expectedSentence.split(/\s+/).filter(Boolean);

  // Summary counts
  const heardCount      = wordResults.filter(w => w.status === 'heard').length;
  const substitutedCount = wordResults.filter(w => w.status === 'substituted').length;
  const skippedCount    = wordResults.filter(w => w.status === 'skipped').length;
  const totalWords      = wordResults.length || tokens.length;

  const hasIssues = substitutedCount > 0 || skippedCount > 0;

  // Score ring colour
  const scoreColor =
    score >= 80 ? '#22C55E'
    : score >= 55 ? '#F59E0B'
    : '#EF4444';

  return (
    <Animated.View entering={FadeInDown.duration(380)} style={styles.root}>
      {/* ── TOP: Score + grade ─────────────────────────────────────────────── */}
      <View style={[styles.scoreRow, { borderBottomColor: accentColor + '20' }]}>
        {/* Ring */}
        <View style={[styles.scoreRing, { borderColor: scoreColor }]}>
          <Text style={[styles.scoreNum, { color: scoreColor }]}>{Math.round(score)}</Text>
          <Text style={[styles.scoreOf, { color: scoreColor + '66' }]}>/100</Text>
        </View>

        {/* Labels */}
        <View style={styles.scoreLabels}>
          <Text style={[styles.gradeText, { color: scoreColor }]}>
            {grade === 'excellent'  ? 'Excellent!'
            : grade === 'good'      ? 'Good Job!'
            : grade === 'needs_work'? 'Keep Practicing'
            : 'Try Again'}
          </Text>
          <Text style={styles.feedbackText} numberOfLines={3}>{feedbackText}</Text>
        </View>
      </View>

      {/* ── WORD RESULTS SECTION ───────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="text-outline" size={13} color="#FFFFFF55" />
        <Text style={styles.sectionLabel}>WORD BREAKDOWN</Text>
        {hasIssues && (
          <View style={styles.tapHint}>
            <Ionicons name="hand-left-outline" size={11} color="#FFFFFF44" />
            <Text style={styles.tapHintText}>Tap issues to see detail</Text>
          </View>
        )}
      </View>

      {/* Word pills */}
      <View style={styles.wordRow}>
        {tokens.map((token, i) => {
          const key = clean(token);
          const wr = resultMap.get(key) ?? null;
          return (
            <WordPill
              key={`${token}-${i}`}
              rawWord={token}
              wr={wr}
              accentColor={accentColor}
              onPress={openSheet}
              enterDelay={i * 45}
            />
          );
        })}
      </View>

      {/* ── LEGEND + COUNTS ────────────────────────────────────────────────── */}
      <Animated.View
        entering={FadeIn.duration(300).delay(200)}
        style={[styles.statsRow, { borderTopColor: '#FFFFFF0C' }]}
      >
        <View style={styles.statChip}>
          <View style={[styles.statDot, { backgroundColor: HEARD_COLOR }]} />
          <Text style={styles.statNum}>{heardCount}</Text>
          <Text style={styles.statLabel}>Correct</Text>
        </View>
        {substitutedCount > 0 && (
          <View style={styles.statChip}>
            <View style={[styles.statDot, { backgroundColor: SUBSTITUTED_COLOR }]} />
            <Text style={styles.statNum}>{substitutedCount}</Text>
            <Text style={styles.statLabel}>Substituted</Text>
          </View>
        )}
        {skippedCount > 0 && (
          <View style={styles.statChip}>
            <View style={[styles.statDot, { backgroundColor: SKIPPED_COLOR }]} />
            <Text style={styles.statNum}>{skippedCount}</Text>
            <Text style={styles.statLabel}>Not Heard</Text>
          </View>
        )}
        <View style={styles.statChip}>
          <Ionicons name="stats-chart-outline" size={12} color="#FFFFFF44" />
          <Text style={styles.statNum}>{totalWords}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </Animated.View>

      {/* ── TRANSCRIPT STRIP (if available) ───────────────────────────────── */}
      {!!transcript && transcript.trim().length > 0 && (
        <Animated.View
          entering={FadeInUp.duration(280).delay(280)}
          style={styles.transcriptStrip}
        >
          <Ionicons name="mic-outline" size={12} color="#FFFFFF33" />
          <Text style={styles.transcriptLabel}>You said: </Text>
          <Text style={styles.transcriptText} numberOfLines={2}>{transcript}</Text>
        </Animated.View>
      )}

      {/* ── DETAIL SHEET ──────────────────────────────────────────────────── */}
      <DetailSheet
        visible={sheetVisible}
        wr={sheetWr}
        accentColor={accentColor}
        onClose={closeSheet}
      />
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    width: '100%',
    backgroundColor: '#0D1421',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FFFFFF0D',
    overflow: 'hidden',
    marginVertical: 4,
  },

  // ── Score row
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    paddingBottom: 18,
    borderBottomWidth: 1,
  },
  scoreRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scoreNum: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 32,
  },
  scoreOf: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: -2,
  },
  scoreLabels: {
    flex: 1,
    gap: 5,
  },
  gradeText: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  feedbackText: {
    fontSize: 13,
    color: '#FFFFFF88',
    lineHeight: 19,
  },

  // ── Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: '#FFFFFF44',
    flex: 1,
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tapHintText: {
    fontSize: 10,
    color: '#FFFFFF33',
    fontStyle: 'italic',
  },

  // ── Word pills
  wordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    paddingHorizontal: 20,
    paddingBottom: 18,
    rowGap: 8,
  },
  wordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillIcon: {
    marginRight: 1,
  },
  wordPillText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  pillChevron: {
    marginLeft: 1,
  },

  // ── Stats row
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    paddingHorizontal: 20,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statNum: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 11,
    color: '#FFFFFF55',
    fontWeight: '500',
  },

  // ── Transcript strip
  transcriptStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 2,
    borderTopWidth: 1,
    borderTopColor: '#FFFFFF08',
  },
  transcriptLabel: {
    fontSize: 11,
    color: '#FFFFFF33',
    fontWeight: '600',
    flexShrink: 0,
  },
  transcriptText: {
    fontSize: 11,
    color: '#FFFFFF33',
    fontStyle: 'italic',
    flex: 1,
    lineHeight: 16,
  },

  // ── Bottom sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: '#00000088',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#111827',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderColor: '#FFFFFF12',
    gap: 16,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF22',
    marginBottom: 4,
  },
  sheetHeader: {
    alignItems: 'center',
    gap: 10,
  },
  sheetWord: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  sheetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  sheetBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sheetSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.3,
    color: '#FFFFFF33',
    marginBottom: 12,
  },

  // Substitution layout
  substitutionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  subPill: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    paddingVertical: 14,
    gap: 4,
  },
  subPillLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#FFFFFF44',
  },
  subPillWord: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subArrow: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },

  // Skipped layout
  skippedBox: {
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
    marginBottom: 14,
  },
  skippedBoxTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  skippedBoxSub: {
    fontSize: 13,
    color: '#FFFFFF66',
    textAlign: 'center',
  },

  // Tip box
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: '#FFFFFF99',
    lineHeight: 18,
  },

  // Done button
  sheetDoneBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  sheetDoneBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
