/**
 * Practice Session Entry Screen
 * Location: components/practice/session.tsx
 *
 * Redesigned level-selection UI — premium dark glass aesthetic.
 * Hero header with severity bar, per-card format-colour accents,
 * per-card inline progress bar, and a polished empty / error state.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModeSelectSheet } from '@/components/dashboard/ModeSelectSheet';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { auth } from '@/firebase';
import { haptics } from '@/lib/haptics';
import { mapTrainingBundleToPracticePlan } from '@/lib/practiceMapper';
import { setActivePracticePlan } from '@/lib/practiceSessionStore';
import type { PracticeExerciseCard } from '@/lib/practiceTypes';
import { getModuleProgress } from '@/lib/progressService';
import type { TrainingBundleData } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';

const FS: any = FileSystem;
const STATUSBAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 32) : 0;

// ── Format colour / icon map ──────────────────────────────────────────────────
const FORMAT_ACCENT: Record<string, string> = {
  auditory_bombardment: '#F59E0B',
  phoneme_isolation:    '#6366F1',
  minimal_pairs:        '#1FB7BC',
  syllable_chaining:    '#F97316',
  carrier_phrases:      '#06B6D4',
  pacing:               '#A855F7',
  shadowing:            '#38BDF8',
  speed_drills:         '#EF4444',
};
const FORMAT_ICON: Record<string, string> = {
  auditory_bombardment: 'headset-outline',
  phoneme_isolation:    'mic-circle-outline',
  minimal_pairs:        'git-compare-outline',
  syllable_chaining:    'link-outline',
  carrier_phrases:      'chatbubbles-outline',
  pacing:               'speedometer-outline',
  shadowing:            'layers-outline',
  speed_drills:         'flash-outline',
};
const FORMAT_LABEL: Record<string, string> = {
  auditory_bombardment: 'Auditory Bombardment',
  phoneme_isolation:    'Phoneme Isolation',
  minimal_pairs:        'Minimal Pairs',
  syllable_chaining:    'Syllable Chaining',
  carrier_phrases:      'Carrier Phrases',
  pacing:               'Pacing',
  shadowing:            'Shadowing',
  speed_drills:         'Speed Drills',
};

// ── Severity helpers ──────────────────────────────────────────────────────────
function sevColor(s: number) {
  if (s >= 0.7) return '#EF4444';
  if (s >= 0.4) return '#F59E0B';
  return '#10B981';
}
function sevLabel(s: number) {
  if (s >= 0.7) return 'High';
  if (s >= 0.4) return 'Medium';
  return 'Low';
}

// ── Tiny inline progress bar ──────────────────────────────────────────────────
function InlineBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={inlineBarStyles.track}>
      <View style={[inlineBarStyles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
}
const inlineBarStyles = StyleSheet.create({
  track: {
    height: 3,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 10,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 99 },
});

// ── Level card ────────────────────────────────────────────────────────────────
interface LevelCardProps {
  card: PracticeExerciseCard;
  idx: number;
  accent: string;
  icon: string;
  completedItems: number;
  totalItems: number;
  isDark: boolean;
  surface: string;
  border: string;
  text: string;
  subtle: string;
  onPress: () => void;
}

function LevelCard({
  card, idx, accent, icon,
  completedItems, totalItems,
  isDark, surface, border, text, subtle,
  onPress,
}: LevelCardProps) {
  const isComplete = totalItems > 0 && completedItems === totalItems;
  const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const fmtLabel = FORMAT_LABEL[card.backendFormat] ?? card.title;

  return (
    <TouchableOpacity
      style={[styles.levelCard, { backgroundColor: surface, borderColor: border }]}
      activeOpacity={0.75}
      onPress={onPress}
    >
      {/* Left accent bar */}
      <View style={[styles.accentBar, { backgroundColor: accent }]} />

      {/* Card body */}
      <View style={styles.cardInner}>
        {/* Top row */}
        <View style={styles.cardTop}>
          {/* Level number bubble */}
          <View style={[styles.numBubble, { backgroundColor: accent + '22' }]}>
            <Text style={[styles.numText, { color: accent }]}>{idx + 1}</Text>
          </View>

          {/* Title / subtitle */}
          <View style={styles.cardTextWrap}>
            <Text style={[styles.cardTitle, { color: text }]} numberOfLines={1}>
              {fmtLabel}
            </Text>
            <Text style={[styles.cardSub, { color: subtle }]} numberOfLines={1}>
              {card.subtitle}
            </Text>
          </View>

          {/* Right: difficulty badge + chevron */}
          <View style={styles.cardRight}>
            <View style={[styles.diffBadge, { backgroundColor: accent + '18', borderColor: accent + '30' }]}>
              <Text style={[styles.diffText, { color: accent }]}>D{card.difficulty}</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={subtle} />
          </View>
        </View>

        {/* Completion row */}
        {totalItems > 0 && (
          <View style={styles.progressRow}>
            <InlineBar pct={pct} color={accent} />
            <View style={styles.progressMeta}>
              {isComplete ? (
                <View style={styles.completedRow}>
                  <Ionicons name="checkmark-circle" size={11} color="#10B981" />
                  <Text style={[styles.progressLabel, { color: '#10B981' }]}>Completed</Text>
                </View>
              ) : (
                <Text style={[styles.progressLabel, { color: subtle }]}>
                  {completedItems}/{totalItems} items
                </Text>
              )}
              <Text style={[styles.progressLabel, { color: accent }]}>{pct}%</Text>
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function PracticeSessionScreen() {
  const { resolvedTheme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    moduleId: string;
    errorName: string;
    majorType: string;
    language: string;
    severity: string;
    levelCount: string;
  }>();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg = isDark ? '#080A10' : '#F5F7FA';
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#7A8FA3' : '#8D9FAE';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const border = isDark ? '#252D3A' : '#E4E8EE';

  const [isLoading, setIsLoading]       = useState(true);
  const [cards, setCards]               = useState<PracticeExerciseCard[]>([]);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const insets = useSafeAreaInsets();
  const { setAiEnabled } = useAICoPilot();

  const [sheetVisible, setSheetVisible]     = useState(false);
  const [selectedCard, setSelectedCard]     = useState<{ card: PracticeExerciseCard; resumeIndex: number } | null>(null);

  // Derived from params
  const severity  = parseFloat(params.severity ?? '0');
  const sevCol    = sevColor(severity);
  const levelCount = parseInt(params.levelCount ?? '0', 10) || cards.length;

  // Overall progress %
  const allItemIds = cards.flatMap(c => {
    const raw = c.payload.items?.items || c.payload.items?.pairs || [];
    return Array.isArray(raw) ? raw.map((it: any) => it.item_id || it.id || it.word) : [];
  });
  const completedAll = allItemIds.filter(id => completedIds.includes(id)).length;
  const overallPct   = allItemIds.length > 0 ? Math.round((completedAll / allItemIds.length) * 100) : 0;

  // ── Fetch progress when screen focuses ──────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      if (params.moduleId) {
        getModuleProgress(params.moduleId).then(setCompletedIds).catch(console.error);
      }
    }, [params.moduleId])
  );

  // ── Load & parse data.json from downloaded module ────────────────────────────
  const loadBundle = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !params.moduleId) {
      setErrorMsg('Not logged in or missing module ID.');
      setIsLoading(false);
      return;
    }

    const docDir    = FS.documentDirectory as string;
    const moduleDir = `${docDir}modules/${uid}/${params.moduleId}/`;
    const dataPath  = `${moduleDir}data.json`;

    try {
      const raw    = await FileSystem.readAsStringAsync(dataPath);
      const bundle = JSON.parse(raw) as TrainingBundleData;
      const plan   = mapTrainingBundleToPracticePlan(bundle, moduleDir);
      setActivePracticePlan(plan);
      setCards(plan.cards);
    } catch (e) {
      console.error('[PracticeSession] Failed to load data.json:', e);
      setErrorMsg('Module not downloaded. Return to Practice and download it first.');
    } finally {
      setIsLoading(false);
    }
  }, [params.moduleId]);

  useEffect(() => { loadBundle(); }, [loadBundle]);

  // ── Mode selection & navigation ──────────────────────────────────────────────
  const handleCardPress = useCallback((card: PracticeExerciseCard, resumeIndex: number) => {
    haptics.light();
    setSelectedCard({ card, resumeIndex });
    setSheetVisible(true);
  }, []);

  const handleModeSelect = useCallback((mode: 'efficient' | 'assistant') => {
    setSheetVisible(false);
    setAiEnabled(mode === 'assistant');
    if (!selectedCard) return;
    router.push({
      pathname: selectedCard.card.route as any,
      params: {
        exerciseId: selectedCard.card.id,
        mode,
        resumeIndex: selectedCard.resumeIndex.toString(),
      },
    });
  }, [router, selectedCard, setAiEnabled]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['top']}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Hero header ── */}
      <View style={[styles.hero, { paddingTop: STATUSBAR_HEIGHT }]}>
        {/* Back button */}
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: isDark ? '#1C2231' : '#FFF', borderColor: border }]}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={18} color={text} />
        </TouchableOpacity>

        {/* Hero content */}
        <View style={styles.heroContent}>
          {/* Title */}
          <Text style={[styles.heroTitle, { color: text }]} numberOfLines={1}>
            {params.errorName ?? 'Training Module'}
          </Text>
          <Text style={[styles.heroSub, { color: subtle }]}>
            {params.majorType} · {levelCount} {levelCount === 1 ? 'level' : 'levels'}
          </Text>

          {/* Severity + progress row */}
          <View style={styles.heroMeta}>
            <View style={[styles.severityPill, { backgroundColor: sevCol + '1A', borderColor: sevCol + '40' }]}>
              <View style={[styles.severityDot, { backgroundColor: sevCol }]} />
              <Text style={[styles.severityText, { color: sevCol }]}>
                {sevLabel(severity)} · {Math.round(severity * 100)}%
              </Text>
            </View>

            {!isLoading && allItemIds.length > 0 && (
              <View style={[styles.progressPill, { backgroundColor: isDark ? '#1C2231' : '#EEF0F4' }]}>
                <Text style={[styles.progressPillText, { color: subtle }]}>
                  {overallPct}% done
                </Text>
              </View>
            )}
          </View>

          {/* Overall progress bar */}
          {!isLoading && allItemIds.length > 0 && (
            <View style={[styles.overallTrack, { backgroundColor: isDark ? '#1C2231' : '#E5E8EE' }]}>
              <View style={[styles.overallFill, { width: `${overallPct}%` as any, backgroundColor: PRIMARY }]} />
            </View>
          )}
        </View>
      </View>

      {/* Divider */}
      <View style={[styles.divider, { backgroundColor: border }]} />

      {/* ── Content ── */}
      {isLoading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={[styles.loadingText, { color: subtle }]}>Loading module…</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.centre}>
          <View style={[styles.errorIconWrap, { backgroundColor: '#EF444415' }]}>
            <Ionicons name="alert-circle-outline" size={36} color="#EF4444" />
          </View>
          <Text style={[styles.errorTitle, { color: text }]}>Module not ready</Text>
          <Text style={[styles.errorSub, { color: subtle }]}>{errorMsg}</Text>
          <TouchableOpacity
            style={[styles.errorBtn, { backgroundColor: PRIMARY }]}
            onPress={() => router.back()}
          >
            <Text style={styles.errorBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom + 20, 48) }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Section label */}
          <Text style={[styles.sectionLabel, { color: subtle }]}>CHOOSE A LEVEL</Text>

          {cards.map((card, idx) => {
            const accent = FORMAT_ACCENT[card.backendFormat] ?? PRIMARY;
            const icon   = FORMAT_ICON[card.backendFormat]  ?? 'cube-outline';
            const raw    = card.payload.items?.items || card.payload.items?.pairs || [];
            const items  = Array.isArray(raw) ? raw : [];
            const totalItems     = items.length;
            const completedItems = items.filter((it: any) => completedIds.includes(it.item_id || it.id || it.word)).length;
            const uncompletedIdx = items.findIndex((it: any) => !completedIds.includes(it.item_id || it.id || it.word));
            const resumeIndex    = uncompletedIdx === -1 ? 0 : uncompletedIdx;

            return (
              <LevelCard
                key={card.id}
                card={card}
                idx={idx}
                accent={accent}
                icon={icon}
                completedItems={completedItems}
                totalItems={totalItems}
                isDark={isDark}
                surface={surface}
                border={border}
                text={text}
                subtle={subtle}
                onPress={() => handleCardPress(card, resumeIndex)}
              />
            );
          })}

          {cards.length === 0 && (
            <View style={[styles.emptyCard, { backgroundColor: surface, borderColor: border }]}>
              <View style={[styles.emptyIconWrap, { backgroundColor: subtle + '14' }]}>
                <Ionicons name="layers-outline" size={30} color={subtle} />
              </View>
              <Text style={[styles.emptyTitle, { color: text }]}>No levels found</Text>
              <Text style={[styles.emptyBody, { color: subtle }]}>
                This module has no exercise levels. Try regenerating your training plan.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      <ModeSelectSheet
        visible={sheetVisible}
        testTitle={selectedCard?.card.title ?? ''}
        onSelect={handleModeSelect}
        onClose={() => setSheetVisible(false)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Hero header
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 16,
    gap: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  heroContent: { flex: 1 },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 30,
  },
  heroSub: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 4,
  },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  severityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  severityText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  progressPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  progressPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  overallTrack: {
    height: 4,
    borderRadius: 99,
    marginTop: 12,
    overflow: 'hidden',
  },
  overallFill: {
    height: '100%',
    borderRadius: 99,
  },

  divider: {
    height: 1,
    marginHorizontal: 20,
    marginBottom: 4,
    opacity: 0.6,
  },

  // States
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  loadingText: { fontSize: 14 },
  errorIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  errorTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  errorSub:   { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  errorBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
  },
  errorBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },

  // Scroll
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 14,
    marginLeft: 2,
  },

  // Level card
  levelCard: {
    borderWidth: 1,
    borderRadius: 20,
    marginBottom: 12,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  cardInner: {
    paddingVertical: 16,
    paddingLeft: 20,   // clear the 3px accent bar + breathing room
    paddingRight: 16,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  numBubble: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { fontSize: 13, fontWeight: '800' },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTextWrap: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  cardSub:   { fontSize: 12, marginTop: 3, lineHeight: 17 },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diffBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  diffText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  progressRow: {
    marginTop: 0,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  progressLabel: { fontSize: 11, fontWeight: '600' },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  // Empty
  emptyCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyBody:  { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
