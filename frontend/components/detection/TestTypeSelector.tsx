/**
 * Test Type Selector
 * Location: components/detection/TestTypeSelector.tsx
 * * Phase 8 Fix:
 * - Removed deleted useTestProgress and progressCalculator dependencies.
 * - Simplified UI to act as a pure selection menu.
 * - Removed inline progress syncing (handled by Dashboard/Manifests now).
 */

import type { TestType } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface TestTypeInfo {
  type: TestType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  description: string;
}

const COMPREHENSIVE_TEST: TestTypeInfo = {
  type: 'comprehensive',
  label: 'Comprehensive Assessment',
  icon: 'grid-outline',
  color: '#1FB7BC',
  description: 'Full analysis of all fluency and phonological patterns.',
};

const FLUENCY_TESTS: TestTypeInfo[] = [
  { type: 'prolongation',      label: 'Sound Prolongation', icon: 'pause-circle-outline',  color: '#8B5CF6', description: 'Identify stretched-out sounds.' },
  { type: 'blocks',            label: 'Speech Blocks',      icon: 'stop-circle-outline',   color: '#78716C', description: 'Detect silent pauses and airflow stops.' },
  { type: 'repetition',        label: 'Sound Repetition',   icon: 'repeat-outline',        color: '#F59E0B', description: 'Recognise repeated sounds or syllables.' },
];

const PHONOLOGY_TESTS: TestTypeInfo[] = [
  { type: 'velar_fronting',    label: 'Velar Fronting',     icon: 'swap-horizontal-outline', color: '#EF4444', description: 'K/G sounds replaced by T/D.' },
  { type: 'stopping',          label: 'Stopping',           icon: 'hand-right-outline',      color: '#EC4899', description: 'F/S sounds replaced by P/T.' },
  { type: 'gliding',           label: 'Gliding',            icon: 'water-outline',           color: '#0EA5E9', description: 'L/R sounds replaced by W/Y.' },
  { type: 'cluster_reduction', label: 'Cluster Reduction',  icon: 'git-merge-outline',       color: '#10B981', description: 'Consonant clusters simplified.' },
  { type: 'epenthesis',        label: 'Epenthesis',         icon: 'add-circle-outline',      color: '#84CC16', description: 'Extra vowel sounds added between consonants.' },
];

interface Props {
  onSelectTest: (testType: TestType) => void;
}

// ── Standard test row ────────────────────────────────────────────────────────
function TestRow({ info, onPress, text, subtle, surface, border }: {
  info: TestTypeInfo;
  onPress: () => void;
  text: string; subtle: string; surface: string; border: string;
}) {
  return (
    <TouchableOpacity
      style={[rowStyles.card, { backgroundColor: surface, borderColor: border }]}
      onPress={onPress}
      activeOpacity={0.74}
    >
      <View style={[rowStyles.iconBox, { backgroundColor: info.color + '15' }]}>
        <Ionicons name={info.icon} size={19} color={info.color} />
      </View>

      <View style={rowStyles.textWrap}>
        <Text style={[rowStyles.label, { color: text }]} numberOfLines={1}>{info.label}</Text>
        <Text style={[rowStyles.desc, { color: subtle }]} numberOfLines={1}>{info.description}</Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color={border} />
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  iconBox: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  textWrap: { flex: 1 },
  label: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1, marginBottom: 2 },
  desc: { fontSize: 12, fontWeight: '400' },
});

// ── Section label ────────────────────────────────────────────────────────────
function SectionHeader({ label, subtle }: { label: string; subtle: string }) {
  return (
    <Text style={[secStyles.label, { color: subtle }]}>{label.toUpperCase()}</Text>
  );
}
const secStyles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginBottom: 10, marginTop: 24 },
});

// ── Main component ───────────────────────────────────────────────────────────
export function TestTypeSelector({ onSelectTest }: Props) {
  const { resolvedTheme } = useAppTheme();

  const isDark   = resolvedTheme.dark;
  const PRIMARY  = resolvedTheme.colors.primary;
  const text     = resolvedTheme.colors.text;
  const subtle   = isDark ? '#7A8FA3' : '#8D9FAE';
  const surface  = isDark ? '#161B24' : '#FFFFFF';
  const border   = isDark ? '#252D3A' : '#EDF0F3';

  return (
    <ScrollView
      contentContainerStyle={[listStyles.content, { paddingBottom: 110 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── FLAGSHIP COMPREHENSIVE CARD ───────────────── */}
      <TouchableOpacity
        style={[listStyles.flagship, { backgroundColor: PRIMARY }]}
        onPress={() => onSelectTest(COMPREHENSIVE_TEST.type)}
        activeOpacity={0.88}
      >
        <View style={listStyles.flagWave} pointerEvents="none">
          {[0.3, 0.5, 0.7, 0.55, 0.9, 1, 0.85, 0.65, 0.45, 0.7, 0.5, 0.35].map((h, i) => (
            <View key={i} style={[listStyles.flagWaveBar, {
              height: 48 * h,
              opacity: 0.07 + h * 0.06,
            }]} />
          ))}
        </View>

        <View style={listStyles.flagContent}>
          <View style={listStyles.flagTop}>
            <View style={listStyles.flagIconWrap}>
              <Ionicons name="grid-outline" size={22} color={PRIMARY} />
            </View>
            <View style={listStyles.flagBadge}>
              <Text style={listStyles.flagBadgeText}>RECOMMENDED</Text>
            </View>
          </View>

          <Text style={listStyles.flagTitle}>Comprehensive{'\n'}Assessment</Text>
          <Text style={listStyles.flagDesc}>Full analysis of all fluency and phonological patterns</Text>

          <View style={listStyles.flagBottom}>
            <View style={listStyles.flagStartBtn}>
              <Ionicons name="play" size={13} color={PRIMARY} style={{ marginLeft: 1 }} />
              <Text style={[listStyles.flagStartText, { color: PRIMARY }]}>Start session</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>

      {/* ── FLUENCY SECTION ───────────────────────────── */}
      <SectionHeader label="Fluency Disorders" subtle={subtle} />
      {FLUENCY_TESTS.map(info => (
        <TestRow
          key={info.type}
          info={info}
          onPress={() => onSelectTest(info.type)}
          text={text} subtle={subtle} surface={surface} border={border}
        />
      ))}

      {/* ── PHONOLOGY SECTION ─────────────────────────── */}
      <SectionHeader label="Phonological Processes" subtle={subtle} />
      {PHONOLOGY_TESTS.map(info => (
        <TestRow
          key={info.type}
          info={info}
          onPress={() => onSelectTest(info.type)}
          text={text} subtle={subtle} surface={surface} border={border}
        />
      ))}
    </ScrollView>
  );
}

const listStyles = StyleSheet.create({
  content: { paddingHorizontal: 24 },
  flagship: {
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 4,
    shadowColor: '#1FB7BC',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 10,
  },
  flagWave: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-end', height: 60, gap: 0,
  },
  flagWaveBar: { flex: 1, backgroundColor: '#FFF', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  flagContent: { padding: 22, paddingBottom: 20 },
  flagTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  flagIconWrap: {
    width: 42, height: 42, borderRadius: 13,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  flagBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  flagBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  flagTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', letterSpacing: -0.4, lineHeight: 28, marginBottom: 6 },
  flagDesc: { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 19, marginBottom: 22 },
  flagBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flagStartBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 11,
  },
  flagStartText: { fontSize: 13, fontWeight: '700' },
});