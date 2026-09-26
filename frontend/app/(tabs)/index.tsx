/**
 * Plan Dashboard
 * Location: app/(tabs)/index.tsx
 *
 * Mock mode: modules are served from bundled JSON sentence banks (velar_fronting
 * + stopping) so the session works without any real OTA zip download.
 * A fake download animation is shown first; then the session opens using the
 * bundled sentences via getSentenceById() in DetectionSession.
 */

import { ModeSelectSheet } from '@/components/dashboard/ModeSelectSheet';
import { PlanSetList } from '@/components/dashboard/PlanSetList';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { BASE_HTTP_URL, UAB_API, USE_MOCK } from '@/lib/api';
import { getSentenceIdsByType } from '@/lib/dataMap'; // Used in MOCK path only
import { getModuleProgress } from '@/lib/progressService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect, useRouter } from 'expo-router';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { useLanguage } from '../../context/LanguageContext';
import { auth } from '../../firebase';
import { useAppTheme } from '../../theme-provider';

export interface MappedDashboardSet {
  set_id: string;
  subtype: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  progress: number;
  estimated_time: string;
  icon: string;
  download_url: string;
  priority: number;
  raw_sentence_count: number;
  /** Sentence IDs from the bundled JSON — only populated in MOCK mode */
  bundled_sentence_ids?: string[];
  /** Number of sentences the user has completed for this module */
  completed_sentences: number;
  /** Total sentences in this module (0 = unknown, shown as '?' in UI) */
  total_sentences: number;
}

export default function PlanScreen() {
  const { resolvedTheme } = useAppTheme();
  const router = useRouter();
  const { setAiEnabled } = useAICoPilot();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return unsub;
  }, []);

  const { language } = useLanguage();
  const prevLanguageRef = useRef(language);

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#0C0F14' : '#F2F5F9';
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#59677A';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const border  = isDark ? '#252D3A' : '#D1D8E2';

  const [activeSets, setActiveSets] = useState<MappedDashboardSet[]>([]);
  const [loading, setLoading] = useState(true);

  // Mode selection bottom sheet state
  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedSet, setSelectedSet] = useState<MappedDashboardSet | null>(null);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  // Always-fresh ref so refreshProgress can read activeSets without a stale closure.
  const activeSetsRef = useRef<MappedDashboardSet[]>([]);
  useEffect(() => { activeSetsRef.current = activeSets; }, [activeSets]);

  const runEntrance = () => {
    fadeAnim.setValue(0);
    slideAnim.setValue(16);
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 14, useNativeDriver: true }),
    ]).start();
  };

  const fetchPlan = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (USE_MOCK) {
        // ── MOCK MODULE DEFINITIONS ──────────────────────────────────────────
        // Modules served from bundled JSON sentence banks. No OTA zip needed.
        const MOCK_MODULES = [
          {
            id: `mock_velar_${language}`,
            test_type: 'velar_fronting' as const,
            title: language === 'urdu' ? 'Velar Fronting (اردو)' : 'Velar Fronting',
            description: language === 'urdu'
              ? 'K اور G کی آوازوں کا جائزہ'
              : 'Focused evaluation on K and G sound substitutions.',
          },
          {
            id: `mock_stopping_${language}`,
            test_type: 'stopping' as const,
            title: language === 'urdu' ? 'Stopping (اردو)' : 'Stopping',
            description: language === 'urdu'
              ? 'رکاوٹ والی آوازوں کا جائزہ'
              : 'Evaluation of fricative stopping patterns.',
          },
        ];

        const mappedSets: MappedDashboardSet[] = await Promise.all(
          MOCK_MODULES.map(async (m, index) => {
            // Load sentence IDs directly from the bundled JSON for this language + subtype
            const bundledIds = getSentenceIdsByType(m.test_type, language);
            const completedIds = await getModuleProgress(m.id);
            const total = bundledIds.length || 1;
            const ratio = completedIds.length / total;

            return {
              set_id: m.id,
              subtype: m.test_type,
              title: m.title,
              description: m.description,
              status: ratio >= 1 ? 'completed' : ratio > 0 ? 'in_progress' : 'pending',
              progress: Math.min(ratio, 1),
              estimated_time: `${total} sentences`,
              icon: '',
              download_url: '',   // no real download needed in mock mode
              priority: index === 0 ? 1 : 2,
              raw_sentence_count: total,
              bundled_sentence_ids: bundledIds,
              completed_sentences: completedIds.length,
              total_sentences: total,
            } as MappedDashboardSet;
          })
        );

        setActiveSets(mappedSets);
        // ── END MOCK ────────────────────────────────────────────────────────
        return;
      }

      // ── REAL API PATH ────────────────────────────────────────────────────────
      const manifests = await UAB_API.fetchModules(user.uid, 'assessments', language);

      // Cache key scoped to user + language so each language has its own slot
      const cacheKey = `clario_manifests_${user.uid}_${language}`;

      // If the backend returned no assessments for this language (e.g. because a
      // newer questionnaire submission overwrote the Firestore document with a
      // different language), fall back to the last cached manifests for this language.
      let effectiveManifests = manifests;
      if (manifests.length === 0) {
        try {
          const cached = await AsyncStorage.getItem(cacheKey);
          if (cached) {
            effectiveManifests = JSON.parse(cached) as typeof manifests;
            console.log(`[Plan] Backend returned empty for ${language} — using cached manifests (${effectiveManifests.length} modules)`);
          }
        } catch {
          // cache miss or parse error — leave effectiveManifests empty
        }
      } else {
        // Persist the fresh response so future fallbacks are up-to-date
        try {
          await AsyncStorage.setItem(cacheKey, JSON.stringify(manifests));
        } catch {
          // non-critical — ignore
        }
      }

      const mappedSets: MappedDashboardSet[] = await Promise.all(
        effectiveManifests.map(async (m: any, index: number) => {
          // Construct the bundle download URL for this assessment
          const bundleUrl = `${BASE_HTTP_URL}/assessments/${m.id}/bundle?user_id=${user.uid}`;
          const completedIds = await getModuleProgress(m.id);

          // Try reading cached data.json to get total sentence count
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
            // Zip not yet downloaded — total stays 0
          }

          const ratio = total > 0 ? completedIds.length / total : 0;

          return {
            set_id: m.id,
            subtype: m.test_type,
            title: m.title,
            description: m.description,
            status: ratio >= 1 ? 'completed' : completedIds.length > 0 ? 'in_progress' : 'pending',
            progress: Math.min(ratio, 1),
            estimated_time: total > 0 ? `${total} items` : 'Tap to download',
            icon: '',
            download_url: bundleUrl,
            priority: index + 1,
            raw_sentence_count: total,
            completed_sentences: completedIds.length,
            total_sentences: total,
          } as MappedDashboardSet;
        })
      );

      setActiveSets(mappedSets);
      // ── END REAL ────────────────────────────────────────────────────────────
    } catch (e) {
      console.error('[Plan] Failed to fetch plan:', e);
      setActiveSets([]);
    } finally {
      setLoading(false);
    }
  }, [user, language]);

  // When language changes, immediately clear stale data and re-fetch for the
  // new language. This covers the case where the user changes language while the
  // Plan tab is already in focus (useFocusEffect won’t re-fire in that case).
  useEffect(() => {
    if (prevLanguageRef.current === language) return;
    prevLanguageRef.current = language;
    setActiveSets([]);
    setLoading(true);
    fadeAnim.setValue(0);
    slideAnim.setValue(16);
    fetchPlan();
  }, [language, fetchPlan]);

  /**
   * Lightweight progress refresh — called on every subsequent tab focus.
   * Only updates completed_sentences / total_sentences / status / progress
   * for the modules already in state. Does NOT clear activeSets or set loading,
   * so the UI updates in-place with no flash or spinner.
   *
   * Also re-reads data.json for any module whose total_sentences is still 0
   * (i.e. it was just downloaded since the last full fetchPlan).
   */
  const refreshProgress = useCallback(async () => {
    if (!user) return;
    const current = activeSetsRef.current;
    if (current.length === 0) return;

    const updated = await Promise.all(
      current.map(async (s: MappedDashboardSet) => {
        const completedIds = await getModuleProgress(s.set_id);

        // Re-read data.json only if total is still unknown (module just downloaded)
        let total = s.total_sentences;
        if (total === 0 && !USE_MOCK) {
          try {
            const FS: any = FileSystem;
            const docDir = FS.documentDirectory as string | null;
            if (docDir) {
              const dataJsonPath = `${docDir}modules/${user.uid}/${s.set_id}/data.json`;
              const rawJson = await FileSystem.readAsStringAsync(dataJsonPath);
              const parsed = JSON.parse(rawJson);
              total = Array.isArray(parsed.sentences) ? parsed.sentences.length : 0;
            }
          } catch {
            // not yet downloaded — leave total as 0
          }
        }

        const ratio = total > 0 ? completedIds.length / total : 0;
        return {
          ...s,
          completed_sentences: completedIds.length,
          total_sentences: total,
          raw_sentence_count: total > 0 ? total : s.raw_sentence_count,
          estimated_time: total > 0 ? `${total} items` : s.estimated_time,
          progress: Math.min(ratio, 1),
          status: (ratio >= 1 ? 'completed' : completedIds.length > 0 ? 'in_progress' : 'pending') as MappedDashboardSet['status'],
        };
      })
    );
    setActiveSets(updated);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      // First load (or after language reset): full manifest + progress fetch.
      // Subsequent focuses: only refresh progress counts in-place — no spinner, no flash.
      if (activeSetsRef.current.length === 0) {
        fetchPlan();
      } else {
        refreshProgress();
      }
      runEntrance();
    }, [fetchPlan, refreshProgress])
  );

  useEffect(() => {
    if (user && activeSetsRef.current.length === 0) {
      fetchPlan();
    }
  }, [user, fetchPlan]);

  const navigateToSession = (targetSet: MappedDashboardSet, mode: 'efficient' | 'assistant', paragraphMode = false) => {
    if (USE_MOCK && targetSet.bundled_sentence_ids?.length) {
      router.push({
        pathname: '/diagnostics',
        params: {
          testId: targetSet.set_id,
          testType: targetSet.subtype,
          bundledIds: targetSet.bundled_sentence_ids.join(','),
          mode,
          paragraphMode: paragraphMode ? '1' : '0',
        },
      });
    } else {
      router.push({
        pathname: '/diagnostics',
        params: {
          testId: targetSet.set_id,
          testType: targetSet.subtype,
          mode,
          paragraphMode: paragraphMode ? '1' : '0',
        },
      });
    }
  };

  const handleSetSelect = useCallback(async (setId: string) => {
    const targetSet = activeSets.find((s: MappedDashboardSet) => s.set_id === setId || s.subtype === setId);
    if (!targetSet) return;

    // If total_sentences is still 0 (just downloaded), read data.json now
    if (targetSet.total_sentences === 0 && !USE_MOCK && user) {
      try {
        const FS: any = FileSystem;
        const docDir = FS.documentDirectory as string | null;
        if (docDir) {
          const dataJsonPath = `${docDir}modules/${user.uid}/${targetSet.set_id}/data.json`;
          const rawJson = await FileSystem.readAsStringAsync(dataJsonPath);
          const parsed = JSON.parse(rawJson);
          const total = Array.isArray(parsed.sentences) ? parsed.sentences.length : 0;
          if (total > 0) {
            const completedIds = await getModuleProgress(targetSet.set_id);
            const ratio = completedIds.length / total;
            const patched: MappedDashboardSet = {
              ...targetSet,
              total_sentences: total,
              raw_sentence_count: total,
              estimated_time: `${total} items`,
              completed_sentences: completedIds.length,
              progress: Math.min(ratio, 1),
              status: ratio >= 1 ? 'completed' : completedIds.length > 0 ? 'in_progress' : 'pending',
            };
            setActiveSets(prev => prev.map(s => s.set_id === setId ? patched : s));
            setSelectedSet(patched);
            setSheetVisible(true);
            return;
          }
        }
      } catch {
        // data.json not readable — proceed with original set
      }
    }

    setSelectedSet(targetSet);
    setSheetVisible(true);
  }, [activeSets, user]);

  const handleModeSelect = (mode: 'efficient' | 'assistant', paragraphMode?: boolean) => {
    setSheetVisible(false);
    setAiEnabled(mode === 'assistant');
    if (selectedSet) {
      navigateToSession(selectedSet, mode, paragraphMode ?? false);
    }
  };

  const completedCount = activeSets.filter((s: MappedDashboardSet) => s.status === 'completed').length;

  const DashboardHeader = (
    <Animated.View
      style={{
        opacity:   fadeAnim,
        transform: [{ translateY: slideAnim }],
      }}
    >
      {/* ── Page Header ──────────────────────────────── */}
      <View style={styles.pageHeader}>
        <Text style={[styles.pageTitle, { color: text }]}>
          Your <Text style={{ color: PRIMARY }}>Assessments</Text>
        </Text>
        <View style={[styles.countBadge, { backgroundColor: PRIMARY + '15' }]}>
          <Text style={[styles.countBadgeText, { color: PRIMARY }]}>
            {completedCount}/{activeSets.length}
          </Text>
        </View>
      </View>

      <Text style={[styles.pageDesc, { color: subtle }]}>
        Complete these to unlock personalised practice modules tailored to your speech patterns.
      </Text>

      {/* ── Divider ──────────────────────────────────── */}
      <View style={[styles.divider, { backgroundColor: border }]} />

      {loading && activeSets.length === 0 && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={PRIMARY} />
          <Text style={[styles.loadingText, { color: subtle }]}>Loading assessments…</Text>
        </View>
      )}
    </Animated.View>
  );

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* ── Soft glowing top background overlay ── */}
      <GradientGlow color={PRIMARY} isDark={isDark} />

      <PlanSetList
        sets={activeSets as any}
        onSelect={handleSetSelect}
        ListHeaderComponent={DashboardHeader}
        loading={loading}
      />
      <ModeSelectSheet
        visible={sheetVisible}
        testTitle={selectedSet?.title ?? ''}
        isAssessment={true}
        onSelect={handleModeSelect}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 64,
    paddingBottom: 8,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pageDesc: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 21,
    marginBottom: 20,
  },
  divider: {
    height: 1,
    marginBottom: 20,
  },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 32,
  },
  loadingText: { fontSize: 14, fontWeight: '500' },
});
