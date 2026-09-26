/**
 * TechniqueSignalResultCard
 * ─────────────────────────
 * Premium result display for Tier 3 signal-analysis techniques.
 * Used when scoring_mode is one of: rate | phonation | repair | rhythm | voice_quality
 *
 * These scorers do NOT return word-level results — they return acoustic metrics.
 * Each mode renders a unique, data-rich inner panel matching the clinical metric.
 *
 * Data shapes expected in `details` (= ScoreResult.details):
 *
 *  rate:         { actual_spm, target_spm, syllable_count, duration_sec, in_range, feedback_key }
 *  phonation:    { total_gaps, broken_gaps, smooth_gaps, gaps: [{gap_ms, broken}], feedback_key }
 *  repair:       { pause_found, max_silence_ms, pause_threshold_ms, target_found_after_pause, transcript, technique, feedback_key }
 *  rhythm:       { actual_bpm, expected_bpm, regularity, tempo_accuracy, tap_count, mean_interval_ms, feedback_key }
 *  voice_quality:{ energy_ratio, start_energy, end_energy, feedback_key }
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  FadeIn, FadeInDown, FadeInUp,
  useAnimatedStyle, useSharedValue, withTiming,
  Easing,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalScoringMode = 'rate' | 'phonation' | 'repair' | 'rhythm' | 'voice_quality';

interface Props {
  accentColor: string;
  score: number;
  grade: string;
  feedbackText: string;
  scoringMode: SignalScoringMode;
  details: Record<string, any>;
}

// ── Grade helpers ─────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return '#22C55E';
  if (score >= 55) return '#F59E0B';
  return '#EF4444';
}

function gradeLabel(grade: string): string {
  return grade === 'excellent'   ? 'Excellent!'
    : grade === 'good'           ? 'Good Job!'
    : grade === 'needs_work'     ? 'Keep Practicing'
    : 'Try Again';
}

// ── Shared sub-components ─────────────────────────────────────────────────────

/** A horizontal "stat row": label on the left, value on the right */
function StatRow({
  label,
  value,
  valueColor,
  icon,
}: {
  label: string;
  value: string;
  valueColor?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={statRowStyles.row}>
      <View style={statRowStyles.labelSide}>
        {icon && <Ionicons name={icon} size={13} color="#FFFFFF44" style={statRowStyles.icon} />}
        <Text style={statRowStyles.label}>{label}</Text>
      </View>
      <Text style={[statRowStyles.value, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

const statRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  labelSide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: {},
  label: { fontSize: 13, color: '#FFFFFF66', fontWeight: '500' },
  value: { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },
});

/** Horizontal progress bar with animated fill */
function ProgressBar({
  fill,        // 0–1
  color,
  bgColor,
  label,
}: {
  fill: number;
  color: string;
  bgColor?: string;
  label?: string;
}) {
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(Math.min(Math.max(fill, 0), 1), {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
  }, [fill]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${width.value * 100}%` as any }));

  return (
    <View>
      {label && <Text style={barStyles.label}>{label}</Text>}
      <View style={[barStyles.track, bgColor ? { backgroundColor: bgColor } : undefined]}>
        <Animated.View style={[barStyles.fill, { backgroundColor: color }, fillStyle]} />
      </View>
    </View>
  );
}

const barStyles = StyleSheet.create({
  label: { fontSize: 10, color: '#FFFFFF44', fontWeight: '600', letterSpacing: 0.8, marginBottom: 5 },
  track: { height: 9, borderRadius: 5, backgroundColor: '#FFFFFF0E', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
});

/** Divider */
function Divider() {
  return <View style={{ height: 1, backgroundColor: '#FFFFFF0A', marginVertical: 12 }} />;
}

// ── Mode panels ───────────────────────────────────────────────────────────────

// ── RATE ─────────────────────────────────────────────────────────────────────
function RatePanel({ details, accentColor }: { details: any; accentColor: string }) {
  const actual: number = details.actual_spm ?? 0;
  const target: number = details.target_spm ?? 220;
  const syllables: number = details.syllable_count ?? 0;
  const duration: number = details.duration_sec ?? 0;
  const inRange: boolean = details.in_range ?? false;
  const fk: string = details.feedback_key ?? '';

  // Gauge: position actual on a 0–440 SPM scale
  const gaugeMax = Math.max(target * 2, actual * 1.1, 440);
  const gaugeFill = actual / gaugeMax;
  const targetFill = target / gaugeMax;

  const actualColor = inRange ? '#22C55E' : fk === 'too_fast' ? '#EF4444' : '#F59E0B';

  return (
    <Animated.View entering={FadeIn.duration(300).delay(80)} style={styles.panel}>
      <Text style={styles.panelTitle}>SYLLABLE RATE</Text>

      {/* Big SPM display */}
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={[styles.bigNum, { color: actualColor }]}>{Math.round(actual)}</Text>
          <Text style={styles.bigUnit}>SPM</Text>
          <Text style={[styles.bigLabel, { color: actualColor }]}>YOUR RATE</Text>
        </View>
        <View style={[styles.bigMetricDivider, { backgroundColor: '#FFFFFF0C' }]} />
        <View style={styles.bigMetric}>
          <Text style={[styles.bigNum, { color: accentColor }]}>{Math.round(target)}</Text>
          <Text style={styles.bigUnit}>SPM</Text>
          <Text style={[styles.bigLabel, { color: accentColor + '99' }]}>TARGET</Text>
        </View>
      </View>

      {/* Gauge bar with target marker */}
      <Text style={barStyles.label}>RATE GAUGE</Text>
      <View style={{ position: 'relative', marginBottom: 12 }}>
        <ProgressBar fill={gaugeFill} color={actualColor} />
        {/* Target marker */}
        <View style={[styles.gaugeMarker, { left: `${targetFill * 100}%` as any, backgroundColor: accentColor }]} />
      </View>

      <Divider />
      <StatRow label="Syllables counted" value={String(syllables)} icon="musical-notes-outline" />
      <StatRow label="Recording duration" value={`${duration}s`} icon="timer-outline" />
      <StatRow
        label="Result"
        value={inRange ? 'In target range ✓' : fk === 'too_fast' ? 'Too fast — slow down' : 'Too slow — speed up'}
        valueColor={inRange ? '#22C55E' : '#F59E0B'}
      />
    </Animated.View>
  );
}

// ── PHONATION ─────────────────────────────────────────────────────────────────
function PhonationPanel({ details }: { details: any }) {
  const total: number = details.total_gaps ?? 0;
  const broken: number = details.broken_gaps ?? 0;
  const smooth: number = details.smooth_gaps ?? 0;
  const gaps: Array<{ gap_ms: number; broken: boolean }> = details.gaps ?? [];
  const smoothFill = total > 0 ? smooth / total : 1;

  return (
    <Animated.View entering={FadeIn.duration(300).delay(80)} style={styles.panel}>
      <Text style={styles.panelTitle}>PHONATION FLOW</Text>

      {/* Smooth vs broken summary */}
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={[styles.bigNum, { color: '#22C55E' }]}>{smooth}</Text>
          <Text style={[styles.bigLabel, { color: '#22C55E99' }]}>SMOOTH</Text>
        </View>
        <View style={[styles.bigMetricDivider, { backgroundColor: '#FFFFFF0C' }]} />
        <View style={styles.bigMetric}>
          <Text style={[styles.bigNum, { color: broken > 0 ? '#EF4444' : '#FFFFFF33' }]}>{broken}</Text>
          <Text style={[styles.bigLabel, { color: broken > 0 ? '#EF444499' : '#FFFFFF22' }]}>BROKEN</Text>
        </View>
      </View>

      <ProgressBar
        fill={smoothFill}
        color="#22C55E"
        bgColor="#EF444430"
        label="SMOOTH TRANSITIONS"
      />

      {gaps.length > 0 && (
        <>
          <Divider />
          <Text style={styles.panelTitle}>GAP TIMELINE</Text>
          <View style={styles.gapRow}>
            {gaps.map((g, i) => {
              const c = g.broken ? '#EF4444' : '#22C55E';
              return (
                <View key={i} style={[styles.gapChip, { backgroundColor: c + '18', borderColor: c + '40' }]}>
                  <Text style={[styles.gapMs, { color: c }]}>{g.gap_ms}ms</Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      <Divider />
      <StatRow label="Word boundaries checked" value={String(total)} icon="git-branch-outline" />
      <StatRow
        label="Continuity"
        value={broken === 0 ? 'Perfect flow' : `${broken} break${broken > 1 ? 's' : ''} detected`}
        valueColor={broken === 0 ? '#22C55E' : '#EF4444'}
      />
    </Animated.View>
  );
}

// ── REPAIR ────────────────────────────────────────────────────────────────────
function RepairPanel({ details }: { details: any }) {
  const pauseFound: boolean = details.pause_found ?? false;
  const targetFound: boolean = details.target_found_after_pause ?? false;
  const silenceMs: number = details.max_silence_ms ?? 0;
  const thresholdMs: number = details.pause_threshold_ms ?? 400;
  const transcript: string = details.transcript ?? '';
  const technique: string = details.technique ?? 'repair';
  const fk: string = details.feedback_key ?? '';

  const step1Color = pauseFound ? '#22C55E' : '#EF4444';
  const step2Color = targetFound ? '#22C55E' : pauseFound ? '#F59E0B' : '#FFFFFF22';

  return (
    <Animated.View entering={FadeIn.duration(300).delay(80)} style={styles.panel}>
      <Text style={styles.panelTitle}>
        {technique === 'pullout' ? 'PULL-OUT DETECTION' : 'CANCELLATION DETECTION'}
      </Text>

      {/* Step indicators */}
      <View style={styles.stepsCol}>
        {/* Step 1: Pause */}
        <View style={styles.stepRow}>
          <View style={[styles.stepDot, { backgroundColor: step1Color }]}>
            <Ionicons
              name={pauseFound ? 'checkmark' : 'close'}
              size={12}
              color="#FFF"
            />
          </View>
          <View style={styles.stepBody}>
            <Text style={[styles.stepTitle, { color: step1Color }]}>
              {pauseFound ? 'Pause detected' : 'No pause found'}
            </Text>
            <Text style={styles.stepSub}>
              {pauseFound
                ? `${Math.round(silenceMs)}ms gap (threshold: ${Math.round(thresholdMs)}ms)`
                : `Need ≥ ${Math.round(thresholdMs)}ms silence after the block`}
            </Text>
          </View>
        </View>

        {/* Connector */}
        <View style={[styles.stepConnector, { backgroundColor: step1Color + '40' }]} />

        {/* Step 2: Repair word */}
        <View style={styles.stepRow}>
          <View style={[styles.stepDot, { backgroundColor: step2Color }]}>
            <Ionicons
              name={targetFound ? 'checkmark' : pauseFound ? 'ellipsis-horizontal' : 'remove'}
              size={12}
              color="#FFF"
            />
          </View>
          <View style={styles.stepBody}>
            <Text style={[styles.stepTitle, { color: step2Color }]}>
              {targetFound
                ? 'Repair word confirmed'
                : pauseFound
                  ? 'Target word not detected after pause'
                  : 'Repair: pending pause'}
            </Text>
            {transcript.length > 0 && (
              <Text style={styles.stepSub} numberOfLines={1}>
                Heard: "{transcript}"
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Silence bar */}
      {pauseFound && (
        <>
          <Divider />
          <ProgressBar
            fill={Math.min(silenceMs / (thresholdMs * 3), 1)}
            color={step1Color}
            label="PAUSE DURATION"
          />
        </>
      )}
    </Animated.View>
  );
}

// ── RHYTHM ────────────────────────────────────────────────────────────────────
function RhythmPanel({ details, accentColor }: { details: any; accentColor: string }) {
  const actualBpm: number = details.actual_bpm ?? 0;
  const expectedBpm: number = details.expected_bpm ?? 60;
  const regularity: number = details.regularity ?? 0;     // 0–1
  const tempoAcc: number = details.tempo_accuracy ?? 0;  // 0–1
  const tapCount: number = details.tap_count ?? 0;
  const meanInterval: number = details.mean_interval_ms ?? 0;

  const bpmColor = tempoAcc >= 0.75 ? '#22C55E' : tempoAcc >= 0.4 ? '#F59E0B' : '#EF4444';
  const regColor = regularity >= 0.75 ? '#22C55E' : regularity >= 0.4 ? '#F59E0B' : '#EF4444';

  return (
    <Animated.View entering={FadeIn.duration(300).delay(80)} style={styles.panel}>
      <Text style={styles.panelTitle}>RHYTHM ANALYSIS</Text>

      {/* BPM comparison */}
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={[styles.bigNum, { color: bpmColor }]}>{actualBpm.toFixed(1)}</Text>
          <Text style={styles.bigUnit}>BPM</Text>
          <Text style={[styles.bigLabel, { color: bpmColor + '99' }]}>YOUR TEMPO</Text>
        </View>
        <View style={[styles.bigMetricDivider, { backgroundColor: '#FFFFFF0C' }]} />
        <View style={styles.bigMetric}>
          <Text style={[styles.bigNum, { color: accentColor }]}>{expectedBpm}</Text>
          <Text style={styles.bigUnit}>BPM</Text>
          <Text style={[styles.bigLabel, { color: accentColor + '99' }]}>TARGET</Text>
        </View>
      </View>

      <ProgressBar fill={regularity} color={regColor} label="REGULARITY" />
      <View style={{ height: 8 }} />
      <ProgressBar fill={tempoAcc} color={bpmColor} label="TEMPO ACCURACY" />

      <Divider />
      <StatRow label="Taps recorded" value={String(tapCount)} icon="hand-left-outline" />
      <StatRow label="Mean interval" value={`${Math.round(meanInterval)}ms`} icon="time-outline" />
      <StatRow
        label="Regularity score"
        value={`${Math.round(regularity * 100)}%`}
        valueColor={regColor}
      />
    </Animated.View>
  );
}

// ── VOICE QUALITY ─────────────────────────────────────────────────────────────
function VoiceQualityPanel({ details }: { details: any }) {
  const ratio: number = details.energy_ratio ?? 1;
  const startE: number = details.start_energy ?? 0;
  const endE: number = details.end_energy ?? 0;
  const fk: string = details.feedback_key ?? '';
  const good = fk === 'good';
  const rampFill = Math.min((ratio - 1.0) / 2.5, 1); // ratio 1→3.5 maps to 0→100%

  return (
    <Animated.View entering={FadeIn.duration(300).delay(80)} style={styles.panel}>
      <Text style={styles.panelTitle}>VOICE ENERGY RAMP</Text>

      {/* Ramp visualisation */}
      <View style={styles.rampRow}>
        {/* Whisper bar */}
        <View style={styles.rampBarWrap}>
          <View style={[styles.rampBar, { height: 50, backgroundColor: '#FFFFFF18' }]}>
            <View style={[styles.rampBarFill, { height: `${Math.min(startE * 50000, 100)}%` as any, backgroundColor: '#FFFFFF44' }]} />
          </View>
          <Text style={styles.rampBarLabel}>START{'\n'}(Whisper)</Text>
        </View>

        {/* Arrow */}
        <Ionicons name="arrow-forward-outline" size={20} color="#FFFFFF22" style={{ alignSelf: 'center' }} />

        {/* Voice bar */}
        <View style={styles.rampBarWrap}>
          <View style={[styles.rampBar, { height: 80, backgroundColor: '#FFFFFF18' }]}>
            <View style={[styles.rampBarFill, { height: `${Math.min(endE * 50000, 100)}%` as any, backgroundColor: good ? '#22C55E' : '#F59E0B' }]} />
          </View>
          <Text style={styles.rampBarLabel}>END{'\n'}(Voice)</Text>
        </View>
      </View>

      <ProgressBar fill={Math.max(0, rampFill)} color={good ? '#22C55E' : '#F59E0B'} label="ENERGY RAMP" />

      <Divider />
      <StatRow
        label="Energy ratio (end/start)"
        value={`${ratio.toFixed(2)}×`}
        valueColor={good ? '#22C55E' : '#F59E0B'}
        icon="flash-outline"
      />
      <StatRow
        label="Result"
        value={good ? 'Smooth whisper → voice ✓' : 'Onset too abrupt — start softer'}
        valueColor={good ? '#22C55E' : '#EF4444'}
      />
    </Animated.View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TechniqueSignalResultCard({
  accentColor,
  score,
  grade,
  feedbackText,
  scoringMode,
  details,
}: Props) {
  const sc = scoreColor(score);

  const renderPanel = () => {
    switch (scoringMode) {
      case 'rate':
        return <RatePanel details={details} accentColor={accentColor} />;
      case 'phonation':
        return <PhonationPanel details={details} />;
      case 'repair':
        return <RepairPanel details={details} />;
      case 'rhythm':
        return <RhythmPanel details={details} accentColor={accentColor} />;
      case 'voice_quality':
        return <VoiceQualityPanel details={details} />;
      default:
        return null;
    }
  };

  return (
    <Animated.View entering={FadeInDown.duration(380)} style={styles.root}>
      {/* ── Score ring + grade ─────────────────────────────────────────────── */}
      <View style={[styles.scoreRow, { borderBottomColor: accentColor + '20' }]}>
        <View style={[styles.scoreRing, { borderColor: sc }]}>
          <Text style={[styles.scoreNum, { color: sc }]}>{Math.round(score)}</Text>
          <Text style={[styles.scoreOf, { color: sc + '66' }]}>/100</Text>
        </View>
        <View style={styles.scoreLabels}>
          <Text style={[styles.gradeText, { color: sc }]}>{gradeLabel(grade)}</Text>
          <Text style={styles.feedbackText} numberOfLines={3}>{feedbackText}</Text>
        </View>
      </View>

      {/* ── Mode-specific panel ───────────────────────────────────────────── */}
      {renderPanel()}
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

  // Score row
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
  scoreNum: { fontSize: 28, fontWeight: '900', letterSpacing: -1, lineHeight: 32 },
  scoreOf: { fontSize: 11, fontWeight: '500', marginTop: -2 },
  scoreLabels: { flex: 1, gap: 5 },
  gradeText: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  feedbackText: { fontSize: 13, color: '#FFFFFF88', lineHeight: 19 },

  // Panel wrapper
  panel: { padding: 20, paddingTop: 18, gap: 4 },
  panelTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: '#FFFFFF33',
    marginBottom: 14,
  },

  // Big metric pair (left | right)
  bigMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  bigMetric: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  bigNum: { fontSize: 38, fontWeight: '900', letterSpacing: -1.5 },
  bigUnit: { fontSize: 12, color: '#FFFFFF55', fontWeight: '600', marginTop: -4 },
  bigLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: 3 },
  bigMetricDivider: { width: 1, height: 56, marginHorizontal: 8 },

  // Gauge marker overlay
  gaugeMarker: {
    position: 'absolute',
    top: -4,
    width: 2,
    height: 16,
    borderRadius: 1,
    marginLeft: -1,
  },

  // Gap chips
  gapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  gapChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  gapMs: { fontSize: 11, fontWeight: '600' },

  // Repair steps
  stepsCol: { gap: 0, marginBottom: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  stepConnector: { width: 2, height: 20, marginLeft: 11, borderRadius: 1 },
  stepBody: { flex: 1, paddingBottom: 8 },
  stepTitle: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  stepSub: { fontSize: 12, color: '#FFFFFF55', lineHeight: 17, marginTop: 2 },

  // Voice quality ramp
  rampRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
  },
  rampBarWrap: { alignItems: 'center', gap: 8 },
  rampBar: {
    width: 48,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  rampBarFill: { width: '100%', borderRadius: 6 },
  rampBarLabel: { fontSize: 9, color: '#FFFFFF44', fontWeight: '600', letterSpacing: 0.5, textAlign: 'center' },
});
