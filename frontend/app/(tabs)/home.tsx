/**
 * Home Tab — app/(tabs)/home.tsx
 *
 * Layout (top → bottom):
 *   1. Greeting header  — time-aware salutation + user first name + date
 *   2. Current Focus    — square priority tiles with one primary action
 *   3. Techniques       — square technique tiles in a modern grid
 *   4. Last Session     — most recent module recap card
 *   5. Quick Access     — pill shortcuts to every other tab
 *   5. Quick Access     — pill shortcuts to every other tab
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { TechniqueModal } from '@/components/techniques/TechniqueModal';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { useLanguage } from '@/context/LanguageContext';
import { useOnboardingState } from '@/context/OnboardingContext';
import { BASE_HTTP_URL, UAB_API, USE_MOCK } from '@/lib/api';
import { getSentenceIdsByType } from '@/lib/dataMap';
import { haptics } from '@/lib/haptics';
import { getModuleProgress } from '@/lib/progressService';
import {
  CATEGORY_MAP,
  DIFFICULTY_STYLES,
  ENGLISH_TECHNIQUES,
  TURQUOISE,
  TechniqueGuide,
  URDU_TECHNIQUES,
} from '@/lib/techniqueData';
import {
  TechniqueReviewMap, loadReviewMap, markTechniqueReviewed,
  unmarkTechniqueReviewed
} from '@/lib/techniqueReviewService';
import { useAppTheme } from '@/theme-provider';
import * as FileSystem from 'expo-file-system/legacy';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebase';
import type { MappedDashboardSet } from './index';

// ─── helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}

const GREETING_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  morning: 'sunny-outline',
  afternoon: 'partly-sunny-outline',
  evening: 'moon-outline',
};

function getFirstName(displayName: string | null | undefined): string {
  if (!displayName) return 'there';
  return displayName.split(' ')[0];
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── Priority item types ───────────────────────────────────────────────────

type FocusItemKind =
  | 'continue_module'
  | 'start_module'
  | 'first_assessment'
  | 'techniques'
  | 'all_done';

interface FocusItem {
  kind: FocusItemKind;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  accentColor: string;
  set?: MappedDashboardSet;
}

// ─── Build priority queue ─────────────────────────────────────────────────

function buildFocusQueue(
  modules: MappedDashboardSet[],
  techniquesPending: number,
  accentColor: string,
): FocusItem[] {
  const queue: FocusItem[] = [];

  // In-progress modules first
  for (const m of modules.filter(m => m.status === 'in_progress')) {
    queue.push({
      kind: 'continue_module',
      title: `Continue ${m.title}`,
      subtitle: `${m.completed_sentences} of ${m.total_sentences || '?'} items done`,
      icon: 'play-circle-outline',
      accentColor,
      set: m,
    });
  }

  // Pending (not started) modules
  for (const m of modules.filter(m => m.status === 'pending')) {
    queue.push({
      kind: 'start_module',
      title: `Start ${m.title}`,
      subtitle: `${m.total_sentences || '?'} items · tap to begin`,
      icon: 'flag-outline',
      accentColor,
      set: m,
    });
  }

  // No modules at all → prompt assessment
  if (modules.length === 0) {
    queue.push({
      kind: 'first_assessment',
      title: 'Take your first assessment',
      subtitle: 'Complete the plan setup to get started',
      icon: 'clipboard-outline',
      accentColor,
    });
  }

  // Pending techniques
  if (techniquesPending > 0) {
    queue.push({
      kind: 'techniques',
      title: `${techniquesPending} technique${techniquesPending > 1 ? 's' : ''} to explore`,
      subtitle: 'Review recommended therapy techniques',
      icon: 'bulb-outline',
      accentColor: '#FFA726',
    });
  }

  // Rest state
  if (queue.length === 0) {
    queue.push({
      kind: 'all_done',
      title: "You're all caught up!",
      subtitle: 'Great work — keep practising daily',
      icon: 'checkmark-circle-outline',
      accentColor: '#4CAF50',
    });
  }

  return queue;
}

// ─── Sub-components ────────────────────────────────────────────────────────

function SectionLabel({ label, color, subtle }: { label: string; color: string; subtle: string }) {
  return (
    <View style={sc.sectionLabelRow}>
      <Text style={[sc.sectionLabel, { color: color }]}>{label}</Text>
    </View>
  );
}

// Sliding Focus Card
function FocusCard({
  item, isDark, surface, border, onPress,
}: {
  item: FocusItem;
  isDark: boolean;
  surface: string;
  border: string;
  onPress: (item: FocusItem) => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={() => { haptics.medium(); onPress(item); }}
        onPressIn={() => scale.value = withSpring(0.96, { damping: 12, stiffness: 200 })}
        onPressOut={() => scale.value = withSpring(1, { damping: 12, stiffness: 200 })}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        style={({ pressed }: { pressed: boolean }) => [
          sc.focusCardInner,
          {
            backgroundColor: surface,
            borderColor: border,
          },
          !isDark && sc.cardLightShadow,
        ]}
      >
        <View style={[sc.focusTileGlow, { backgroundColor: item.accentColor + '1A' }]} />
        <View style={sc.focusTileTopRow}>
          <View style={[sc.primaryIconWrap, { backgroundColor: item.accentColor + '18' }]}>
            <Ionicons name={item.icon} size={24} color={item.accentColor} />
          </View>
          {item.kind !== 'all_done' && (
            <Ionicons name="arrow-forward" size={16} color={item.accentColor} />
          )}
        </View>
        <View style={sc.focusTileBody}>
          <Text style={[sc.primaryTitle, { color: isDark ? '#ECEFF1' : '#1A2332' }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[sc.primarySubtitle, { color: isDark ? '#7A8FA3' : '#8D9FAE' }]} numberOfLines={3}>
            {item.subtitle}
          </Text>
        </View>
        {item.set && item.set.total_sentences > 0 && (
          <View style={[sc.progressTrack, { backgroundColor: isDark ? '#1A2236' : '#EDEEF2' }]}>
            <View
              style={[
                sc.progressFill,
                { backgroundColor: item.accentColor, width: `${Math.round(item.set.progress * 100)}%` as any },
              ]}
            />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// Last session recap card
function LastSessionCard({
  module, isDark, surface, border, accentColor, onPress,
}: {
  module: MappedDashboardSet;
  isDark: boolean;
  surface: string;
  border: string;
  accentColor: string;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pct = Math.round(module.progress * 100);

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={() => { haptics.light(); onPress(); }}
        onPressIn={() => scale.value = withSpring(0.97, { damping: 15, stiffness: 250 })}
        onPressOut={() => scale.value = withSpring(1, { damping: 15, stiffness: 250 })}
        accessibilityRole="button"
        accessibilityLabel={`Last session: ${module.title}`}
        style={({ pressed }: { pressed: boolean }) => [
          sc.sessionCard,
          { backgroundColor: surface, borderColor: isDark ? border : '#E4E8EE' },
          !isDark && sc.cardLightShadow,
        ]}
      >
        <View style={[sc.sessionIconWrap, { backgroundColor: accentColor + '18' }]}>
          <Ionicons name="analytics-outline" size={20} color={accentColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[sc.sessionTitle, { color: isDark ? '#ECEFF1' : '#1A2332' }]}>
            {module.title}
          </Text>
          <Text style={[sc.sessionSub, { color: isDark ? '#7A8FA3' : '#8D9FAE' }]}>
            {module.completed_sentences} of {module.total_sentences || '?'} items · {pct}% complete
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={isDark ? '#4A5A6A' : '#BDC7D1'} />
      </Pressable>
    </Animated.View>
  );
}

// Square technique tile
function TechniqueTile({
  technique, isDark, surface, border, isReviewed, onPress,
}: {
  technique: TechniqueGuide;
  isDark: boolean;
  surface: string;
  border: string;
  isReviewed: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const catMeta = CATEGORY_MAP[technique.category];
  const accent = catMeta?.color ?? TURQUOISE;
  const diff = DIFFICULTY_STYLES[technique.difficulty];

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={() => { haptics.light(); onPress(); }}
        onPressIn={() => scale.value = withSpring(0.97, { damping: 15, stiffness: 250 })}
        onPressOut={() => scale.value = withSpring(1, { damping: 15, stiffness: 250 })}
        accessibilityRole="button"
        accessibilityLabel={`Today's technique: ${technique.title}`}
        style={({ pressed }: { pressed: boolean }) => [
          sc.techniqueTile,
          { backgroundColor: surface, borderColor: isDark ? border : '#E4E8EE' },
          !isDark && sc.cardLightShadow,
        ]}
      >
        <View style={[sc.techniqueTileGlow, { backgroundColor: accent + '14' }]} />
        <View style={sc.techniqueTileTop}>
          <View style={sc.techniqueTitleRow}>
            <View style={[sc.techniqueIconWrap, { backgroundColor: accent + '18' }]}>
              <Ionicons name={technique.icon as any} size={20} color={accent} />
            </View>
          </View>
          <View style={[sc.diffBadge, { backgroundColor: isDark ? diff.bgDark : diff.bg }]}>
            <Text style={[sc.diffBadgeText, { color: diff.text }]}>{technique.difficulty}</Text>
          </View>
        </View>
        <View style={sc.techniqueTileBody}>
          <Text numberOfLines={2} style={[sc.techniqueTitle, { color: isDark ? '#ECEFF1' : '#1A2332' }]}>
            {technique.title}
          </Text>
          <Text style={[sc.techniqueCategory, { color: accent }]} numberOfLines={1}>
            {technique.category}
          </Text>
        </View>
        <View style={sc.techniqueTileFooter}>
          {isReviewed && (
            <View style={[sc.techniqueStatusPill, { backgroundColor: '#16A34A1A' }]}> 
              <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
              <Text style={[sc.techniqueStatusText, { color: '#16A34A' }]}>Reviewed</Text>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Quick access floating pill
interface QuickPill {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

function QuickAccessPill({
  pill, accent, isDark, onPress,
}: { pill: QuickPill; accent: string; isDark: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={() => { haptics.light(); onPress(); }}
        onPressIn={() => scale.value = withSpring(0.92, { damping: 15, stiffness: 300 })}
        onPressOut={() => scale.value = withSpring(1, { damping: 15, stiffness: 300 })}
        accessibilityRole="button"
        accessibilityLabel={pill.label}
        style={({ pressed }: { pressed: boolean }) => [
          sc.quickPill,
          {
            backgroundColor: isDark ? '#1C2231' : '#FFFFFF',
            borderColor: isDark ? '#2A3446' : '#E4E8EE',
          },
          !isDark && sc.cardLightShadow,
        ]}
      >
        <View style={[sc.quickPillIconWrap, { backgroundColor: accent + '1A' }]}>
          <Ionicons name={pill.icon} size={20} color={accent} />
        </View>
        <Text style={[sc.quickPillLabel, { color: isDark ? '#C5CDD8' : '#3A4A5C' }]}>
          {pill.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────

const QUICK_PILLS: QuickPill[] = [
  { label: 'Practice', icon: 'barbell-outline', route: '/(tabs)/practice' },
  { label: 'Progress', icon: 'stats-chart-outline', route: '/(tabs)/progress-report' },
  { label: 'Techniques', icon: 'bulb-outline', route: '/(tabs)/techniques' },
  { label: 'Settings', icon: 'settings-outline', route: '/(tabs)/settings' },
];

export default function HomeScreen() {
  const router = useRouter();
  const { resolvedTheme } = useAppTheme();
  const { language } = useLanguage();
  const { profile } = useOnboardingState();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return unsub;
  }, []);

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#0C0F14' : '#F2F5F9';
  const surface = isDark ? '#1A2030' : '#FFFFFF';
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#59677A';
  const border  = isDark ? '#2A3448' : '#D1D8E2';

  // ── State ────────────────────────────────────────────────────────────────
  const [modules, setModules] = useState<MappedDashboardSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewMap, setReviewMap] = useState<TechniqueReviewMap>({});
  const [todaysTechnique, setTodaysTechnique] = useState<TechniqueGuide | null>(null);
  const [modalTechnique, setModalTechnique] = useState<TechniqueGuide | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const greeting = getGreeting();
  const firstName = getFirstName(user?.displayName);
  const today = formatDate(new Date());

  // ── Derived accent colour (from primary concern / profile) ───────────────
  const accentColor = PRIMARY ?? TURQUOISE;

  // ── Today’s technique — first unreviewed sorted easy→hard ──────────────────────
  useEffect(() => {
    const allT = language === 'urdu' ? URDU_TECHNIQUES : ENGLISH_TECHNIQUES;
    const userSubs = profile?.selections?.map((s: { subtype: string }) => s.subtype) ?? [];
    const relevant = userSubs.length > 0
      ? allT.filter((t: TechniqueGuide) => t.subtypes.some((s: string) => userSubs.includes(s)))
      : allT;

    if (relevant.length === 0) { setTodaysTechnique(null); return; }

    const DIFF_ORD: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };
    const sorted = [...relevant].sort(
      (a, b) => (DIFF_ORD[a.difficulty] ?? 1) - (DIFF_ORD[b.difficulty] ?? 1)
    );
    // Pick the first unreviewed; fall back to first if all done
    const pick = sorted.find(t => !reviewMap[t.id]) ?? sorted[0];
    setTodaysTechnique(pick ?? null);
  }, [language, profile?.selections, reviewMap]);

  // ── Load modules ─────────────────────────────────────────────────────────
  const loadModules = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    try {
      if (USE_MOCK) {
        const MOCK_MODULES = [
          {
            id: `mock_velar_${language}`, test_type: 'velar_fronting' as const,
            title: language === 'urdu' ? 'Velar Fronting (اردو)' : 'Velar Fronting'
          },
          {
            id: `mock_stopping_${language}`, test_type: 'stopping' as const,
            title: language === 'urdu' ? 'Stopping (اردو)' : 'Stopping'
          },
        ];

        const mapped: MappedDashboardSet[] = await Promise.all(
          MOCK_MODULES.map(async (m, i) => {
            const bundledIds = getSentenceIdsByType(m.test_type, language);
            const completedIds = await getModuleProgress(m.id);
            const total = bundledIds.length || 1;
            const ratio = completedIds.length / total;
            return {
              set_id: m.id, subtype: m.test_type, title: m.title,
              description: '', status: ratio >= 1 ? 'completed' : ratio > 0 ? 'in_progress' : 'pending',
              progress: Math.min(ratio, 1), estimated_time: `${total} items`,
              icon: '', download_url: '', priority: i + 1, raw_sentence_count: total,
              bundled_sentence_ids: bundledIds,
              completed_sentences: completedIds.length, total_sentences: total,
            } as MappedDashboardSet;
          })
        );
        setModules(mapped);
      } else {
        const cacheKey = `clario_manifests_${user.uid}_${language}`;
        let manifests = await UAB_API.fetchModules(user.uid, 'assessments', language);
        if (manifests.length === 0) {
          try {
            const cached = await AsyncStorage.getItem(cacheKey);
            if (cached) manifests = JSON.parse(cached);
          } catch { /* ignore */ }
        } else {
          AsyncStorage.setItem(cacheKey, JSON.stringify(manifests)).catch(() => { });
        }

        const mapped: MappedDashboardSet[] = await Promise.all(
          manifests.map(async (m: any, i: number) => {
            const completedIds = await getModuleProgress(m.id);

            // Try reading total from cached data.json (same as index.tsx does)
            let total = 0;
            try {
              const FS: any = FileSystem;
              const docDir = FS.documentDirectory as string | null;
              if (docDir && user) {
                const dataJsonPath = `${docDir}modules/${user.uid}/${m.id}/data.json`;
                const rawJson = await FileSystem.readAsStringAsync(dataJsonPath);
                const parsed = JSON.parse(rawJson);
                total = Array.isArray(parsed.sentences) ? parsed.sentences.length : 0;
              }
            } catch {
              // Bundle not yet downloaded — total stays 0
            }

            const ratio = total > 0 ? completedIds.length / total : 0;
            return {
              set_id: m.id, subtype: m.test_type, title: m.title,
              description: m.description ?? '', priority: i + 1,
              status: ratio >= 1 ? 'completed' : completedIds.length > 0 ? 'in_progress' : 'pending',
              progress: Math.min(ratio, 1), estimated_time: total > 0 ? `${total} items` : 'Tap to download',
              icon: '', download_url: `${BASE_HTTP_URL}/assessments/${m.id}/bundle?user_id=${user.uid}`,
              raw_sentence_count: total,
              completed_sentences: completedIds.length, total_sentences: total,
            } as MappedDashboardSet;
          })
        );
        setModules(mapped);
      }
    } catch (e) {
      console.error('[Home] loadModules error:', e);
      setModules([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, language]);

  // ── Load technique review map ─────────────────────────────────────────────
  const loadReviews = useCallback(async () => {
    const map = await loadReviewMap(language);
    setReviewMap(map);
  }, [language]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    Promise.all([loadModules(), loadReviews()]);
  }, [loadModules, loadReviews]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadModules(), loadReviews()]);
  }, [loadModules, loadReviews]);

  // ── Priority queue ────────────────────────────────────────────────────────
  const allTechniques = language === 'urdu' ? URDU_TECHNIQUES : ENGLISH_TECHNIQUES;
  const userSubtypes = profile?.selections?.map((s: any) => s.subtype) ?? [];
  const relevantTechniques = userSubtypes.length > 0
    ? allTechniques.filter((t: TechniqueGuide) => t.subtypes.some((s: any) => userSubtypes.includes(s)))
    : allTechniques;
  const techniqueTiles = useMemo(() => {
    const DIFF_ORD: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };
    return [...relevantTechniques]
      .sort((a, b) => {
        const aReviewed = !!reviewMap[a.id];
        const bReviewed = !!reviewMap[b.id];
        if (aReviewed !== bReviewed) return aReviewed ? 1 : -1;
        return (DIFF_ORD[a.difficulty] ?? 1) - (DIFF_ORD[b.difficulty] ?? 1);
      })
      .slice(0, 4);
  }, [relevantTechniques, reviewMap]);
  const techniquesPending = relevantTechniques.filter((t: TechniqueGuide) => !reviewMap[t.id]).length;
  const techniquesReviewed = relevantTechniques.length - techniquesPending;
  const activeModules = modules.filter((m: MappedDashboardSet) => m.status === 'in_progress').length;

  const focusQueue = useMemo(
    () => buildFocusQueue(modules, techniquesPending, accentColor),
    [modules, techniquesPending, accentColor],
  );

  const focusQueueItems = focusQueue;

  // ── Last in-progress or most recent module ─────────────────────────────
  const lastSession = useMemo(() => {
    const inProgress = modules.filter((m: MappedDashboardSet) => m.status === 'in_progress');
    if (inProgress.length > 0) return inProgress[0];
    const completed = modules.filter((m: MappedDashboardSet) => m.status === 'completed');
    if (completed.length > 0) return completed[completed.length - 1];
    return null;
  }, [modules]);

  // ── Navigation handlers ───────────────────────────────────────────────────
  const handleFocusPress = useCallback((item: FocusItem) => {
    switch (item.kind) {
      case 'continue_module':
      case 'start_module':
        router.push('/');
        break;
      case 'first_assessment':
        router.push('/');
        break;
      case 'techniques':
        router.push('/(tabs)/techniques');
        break;
      default:
        break;
    }
  }, [router]);

  const handleTechniquePress = useCallback(() => {
    if (todaysTechnique) {
      setModalTechnique(todaysTechnique);
      setModalVisible(true);
    }
  }, [todaysTechnique]);

  const handleMarkReviewed = useCallback(async () => {
    if (!modalTechnique) return;
    const updated = await markTechniqueReviewed(modalTechnique.id, language);
    setReviewMap(updated);
  }, [modalTechnique, language]);

  const handleUnmarkReviewed = useCallback(async () => {
    if (!modalTechnique) return;
    const updated = await unmarkTechniqueReviewed(modalTechnique.id, language);
    setReviewMap(updated);
  }, [modalTechnique, language]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[sc.root, { backgroundColor: bg }]}>
      {/* ── Soft glowing top background overlay ── */}
      <GradientGlow color={accentColor} isDark={isDark} />



      <ScrollView
        contentContainerStyle={sc.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={accentColor}
            colors={[accentColor]}
          />
        }
      >

        {/* ── 1. GREETING ──────────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.duration(350).delay(0)} style={sc.greetingCard}>
          {/* Avatar + greeting + date */}
          <View style={sc.greetingTopBar}>
            <View style={[sc.avatarCircle, { backgroundColor: accentColor }]}>
              <Text style={sc.avatarInitial}>{firstName[0]?.toUpperCase() ?? '?'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sc.greetingName, { color: text }]}>
                Good {greeting}, <Text style={{ color: accentColor }}>{firstName}</Text>
              </Text>
              <Text style={[sc.dateText, { color: subtle }]}>{today}</Text>
            </View>
          </View>
        </Animated.View>

        {/* ── 2. CURRENT FOCUS ─────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.duration(350).delay(60)} style={sc.section}>
          <SectionLabel label="Current Focus" color={text} subtle={subtle} />

          {loading ? (
            <View style={[sc.loadingCard, { backgroundColor: surface, borderColor: border }]}>
              <ActivityIndicator color={accentColor} />
            </View>
          ) : focusQueueItems.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={182}
              decelerationRate="fast"
              contentContainerStyle={sc.tileRail}
            >
              {focusQueueItems.map((item, idx) => (
                <FocusCard
                  key={item.kind + idx}
                  item={item}
                  isDark={isDark}
                  surface={surface}
                  border={border}
                  onPress={handleFocusPress}
                />
              ))}
            </ScrollView>
          ) : null}
        </Animated.View>

        {/* ── 3. TECHNIQUES ───────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.duration(350).delay(120)} style={sc.section}>
          <SectionLabel label="Techniques" color={text} subtle={subtle} />
          {loading ? (
            <View style={[sc.loadingCard, { backgroundColor: surface, borderColor: border }]}> 
              <ActivityIndicator color={accentColor} />
            </View>
          ) : techniqueTiles.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={182}
              decelerationRate="fast"
              contentContainerStyle={sc.tileRail}
            >
              {techniqueTiles.map((technique, idx) => (
                <TechniqueTile
                  key={technique.id}
                  technique={technique}
                  isDark={isDark}
                  surface={surface}
                  border={border}
                  isReviewed={!!reviewMap[technique.id]}
                  onPress={() => {
                    setModalTechnique(technique);
                    setModalVisible(true);
                  }}
                />
              ))}
            </ScrollView>
          ) : null}
        </Animated.View>

        {/* ── 4. LAST SESSION ──────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.duration(350).delay(180)} style={sc.section}>
          <SectionLabel label="Last Session" color={text} subtle={subtle} />
          {loading ? (
            <View style={[sc.loadingCard, { backgroundColor: surface, borderColor: border }]}> 
              <ActivityIndicator color={accentColor} />
            </View>
          ) : lastSession ? (
            <LastSessionCard
              module={lastSession}
              isDark={isDark}
              surface={surface}
              border={border}
              accentColor={accentColor}
              onPress={() => router.push('/(tabs)/progress-report')}
            />
          ) : (
            <View style={[sc.emptyCard, { backgroundColor: surface, borderColor: border }]}> 
              <Ionicons name="analytics-outline" size={22} color={subtle} />
              <Text style={[sc.emptyText, { color: subtle }]}>No sessions yet</Text>
            </View>
          )}
        </Animated.View>

        {/* ── 5. QUICK ACCESS ──────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.duration(350).delay(240)} style={sc.section}>
          <SectionLabel label="Quick Access" color={text} subtle={subtle} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={sc.quickDockScroll}
          >
            {QUICK_PILLS.map(pill => (
              <QuickAccessPill
                key={pill.label}
                pill={pill}
                accent={accentColor}
                isDark={isDark}
                onPress={() => router.push(pill.route as any)}
              />
            ))}
          </ScrollView>
        </Animated.View>

        <View style={sc.bottomPad} />
      </ScrollView>

      {/* ── Technique Detail Modal ─────────────────────────────────────────── */}
      <TechniqueModal
        visible={modalVisible}
        technique={modalTechnique}
        onClose={() => setModalVisible(false)}
        reviewed={modalTechnique ? !!reviewMap[modalTechnique.id] : false}
        reviewDate={modalTechnique ? reviewMap[modalTechnique.id]?.reviewedAt ?? null : null}
        onMarkReviewed={handleMarkReviewed}
        onUnmarkReviewed={handleUnmarkReviewed}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const sc = StyleSheet.create({
  root: { flex: 1 },
  safeTop: { width: '100%' },
  scroll: { paddingHorizontal: 16, paddingTop: 60, paddingBottom: 20 },

  // Greeting card
  greetingCard: {
    paddingHorizontal: 4,
    paddingTop: 16,
    marginBottom: 32,
  },
  greetingTopBar: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  greetingName: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8 },
  dateText: { fontSize: 13, fontWeight: '500', marginTop: 4 },
  avatarCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },

  // Section label
  section: { marginBottom: 28 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  sectionLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },

  // Unified focus card container
  focusCardInner: {
    width: 176,
    aspectRatio: 1,
    marginRight: 14,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 16,
    justifyContent: 'space-between',
    position: 'relative',
  },
  tileRail: { paddingRight: 16 },
  cardLightShadow: {
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 4,
  },
  focusTileGlow: {
    position: 'absolute',
    top: -32,
    right: -32,
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  focusTileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  focusTileBody: { gap: 10 },
  primaryIconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryTitle: { fontSize: 17, fontWeight: '800', lineHeight: 21, letterSpacing: -0.3 },
  primarySubtitle: { fontSize: 13, fontWeight: '500', lineHeight: 17 },
  progressTrack: { height: 4, width: '100%' },
  progressFill: { height: 4, borderRadius: 2 },

  // Last session card
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  sessionIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sessionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3, letterSpacing: -0.1 },
  sessionSub: { fontSize: 12, fontWeight: '400' },

  // Today's technique card
  techniqueGrid: {
    marginTop: 2,
  },
  techniqueTile: {
    width: 176,
    marginRight: 14,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    aspectRatio: 1,
    padding: 16,
    justifyContent: 'space-between',
    position: 'relative',
  },
  techniqueTileGlow: {
    position: 'absolute',
    top: -28,
    right: -28,
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  techniqueTileTop: { gap: 12 },
  techniqueTileBody: { gap: 6 },
  techniqueTileFooter: { alignItems: 'flex-start', minHeight: 32 },
  techniqueTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  techniqueIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  techniqueTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, lineHeight: 20 },
  techniqueCategory: { fontSize: 12, fontWeight: '700', letterSpacing: 0.35, textTransform: 'uppercase' },
  diffBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  diffBadgeText: { fontSize: 10, fontWeight: '700' },
  techniqueStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  techniqueStatusText: { fontSize: 11, fontWeight: '700' },

  // Quick access floating dock
  quickDockScroll: {
    gap: 12,
    paddingRight: 16,
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 28,
    borderWidth: 1,
  },
  quickPillIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  quickPillLabel: { fontSize: 14, fontWeight: '700', paddingRight: 4, letterSpacing: -0.1 },

  // Misc
  loadingCard: {
    height: 80, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
  },
  emptyText: { fontSize: 13 },
  bottomPad: { height: 20 },
});
