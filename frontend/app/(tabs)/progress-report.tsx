/**
 * Progress Report Screen (Premium Gamification)
 * Location: app/(tabs)/progress-report.tsx
 *
 * Data sources:
 *   - useGamification()  → real XP, streak, accuracy, badges (Firestore, language-scoped)
 *   - UAB_API.fetchModules + getModuleProgress → assessment module rows
 * Language isolation: all paths use active `language` — switching lang clears
 * stale data instantly before the new fetch arrives.
 */

import { ProgressBar } from '@/components/onboarding/ProgressBar';
import { BrandWaveform } from '@/components/ui/BrandWaveform';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { useLanguage } from '@/context/LanguageContext';
import { auth } from '@/firebase';
import { BASE_HTTP_URL, UAB_API, USE_MOCK } from '@/lib/api';
import { getSentenceIdsByType } from '@/lib/dataMap';
import { BADGE_DEFINITIONS, getXPProgress } from '@/lib/gamificationTypes';
import { getModuleProgress } from '@/lib/progressService';
import { useGamification } from '@/hooks/useGamification';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from 'expo-router';
import { onAuthStateChanged, User } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Pressable,
} from 'react-native';

// ─── Badge Toast ──────────────────────────────────────────────────────────────
// Shown at the bottom when a new badge is unlocked. Non-intrusive.
// (Consumed by progress screen on mount — future: emit from session)

// ─── Level Banner ─────────────────────────────────────────────────────────────
function LevelBanner({
  PRIMARY, isDark, surface, border, text, subtle, totalXP,
}: {
  PRIMARY: string; isDark: boolean; surface: string; border: string;
  text: string; subtle: string; totalXP: number;
}) {
  const { level, nextLevel, xpInCurrentLevel, xpForCurrentRange, progressFraction } = getXPProgress(totalXP);

  const xpAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(xpAnim, {
      toValue: progressFraction,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [progressFraction]);

  const xpBarWidth = xpAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={[lvlStyles.card, { backgroundColor: surface, borderColor: border }]}>
      <View style={lvlStyles.topRow}>
        <View style={[lvlStyles.levelPill, { backgroundColor: PRIMARY + '18' }]}>
          <Ionicons name="star" size={14} color={PRIMARY} />
          <Text style={[lvlStyles.levelNum, { color: PRIMARY }]}>Lv {level.level}</Text>
        </View>
        <Text style={[lvlStyles.levelName, { color: text }]}>{level.name}</Text>
        <Text style={[lvlStyles.totalXP, { color: subtle }]}>{totalXP} XP</Text>
      </View>

      <View style={[lvlStyles.track, { backgroundColor: isDark ? '#252D3A' : '#E8EDF2' }]}>
        <Animated.View style={[lvlStyles.fill, { width: xpBarWidth, backgroundColor: PRIMARY }]} />
      </View>

      <View style={lvlStyles.bottomRow}>
        <Text style={[lvlStyles.hint, { color: subtle }]}>
          {xpInCurrentLevel} / {xpForCurrentRange > 0 ? xpForCurrentRange : '—'} XP
        </Text>
        {nextLevel && (
          <Text style={[lvlStyles.hint, { color: subtle }]}>
            Next: {nextLevel.name}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Stats Row ────────────────────────────────────────────────────────────────
function StatsRow({
  currentStreak, totalExercises, overallAccuracy, hasData,
  PRIMARY, isDark, surface, border, text, subtle,
}: {
  currentStreak: number; totalExercises: number; overallAccuracy: number; hasData: boolean;
  PRIMARY: string; isDark: boolean; surface: string; border: string; text: string; subtle: string;
}) {
  const chips = [
    { icon: 'flame' as const, value: String(currentStreak), label: 'day streak', color: currentStreak > 0 ? '#FF6B00' : subtle },
    { icon: 'checkmark-circle-outline' as const, value: String(totalExercises), label: 'exercises', color: PRIMARY },
    { icon: 'stats-chart-outline' as const, value: hasData ? `${overallAccuracy}%` : '—', label: 'accuracy', color: '#34C759' },
  ];

  return (
    <View style={statsStyles.row}>
      {chips.map((chip, i) => (
        <View key={i} style={[statsStyles.chip, { backgroundColor: surface, borderColor: border }]}>
          <View style={[statsStyles.chipIcon, { backgroundColor: chip.color + '18' }]}>
            <Ionicons name={chip.icon} size={18} color={chip.color} />
          </View>
          <Text style={[statsStyles.chipValue, { color: text }]}>{chip.value}</Text>
          <Text style={[statsStyles.chipLabel, { color: subtle }]}>{chip.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Hero Accuracy Card ───────────────────────────────────────────────────────
function HeroCard({
  accuracy, exercises, hasData, PRIMARY, text,
}: {
  accuracy: number; exercises: number; hasData: boolean;
  PRIMARY: string; text: string;
}) {
  const label = accuracy >= 80 ? 'Excellent' : accuracy >= 50 ? 'Good progress' : 'Keep going';
  const waveHeights = [0.3, 0.5, 0.7, 0.55, 0.9, 1, 0.85, 0.65, 0.45, 0.7, 0.5, 0.35, 0.6, 0.8, 0.5, 0.4];

  return (
    <View style={[heroStyles.card, { backgroundColor: PRIMARY }]}>
      <View style={heroStyles.waveOverlay} pointerEvents="none">
        {waveHeights.map((h, i) => (
          <View key={i} style={[heroStyles.waveBar, { height: 56 * h, backgroundColor: '#FFF', opacity: 0.05 + h * 0.06 }]} />
        ))}
      </View>
      <View style={heroStyles.inner}>
        <View>
          <Text style={heroStyles.heroLabel}>AVERAGE ACCURACY</Text>
          <Text style={heroStyles.heroScore}>{hasData ? `${accuracy}%` : '—'}</Text>
          <View style={[heroStyles.badge, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
            <Text style={heroStyles.badgeText}>{hasData ? label : 'No data yet'}</Text>
          </View>
        </View>
        <View style={heroStyles.rightBlock}>
          <View style={[heroStyles.sessionsCircle, { borderColor: 'rgba(255,255,255,0.25)' }]}>
            <Ionicons name="checkmark-circle-outline" size={20} color="rgba(255,255,255,0.9)" />
            <Text style={heroStyles.sessionsCount}>{exercises}</Text>
            <Text style={heroStyles.sessionsLabel}>exercises</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Badges Section ───────────────────────────────────────────────────────────
function BadgesSection({
  earnedBadges, PRIMARY, isDark, surface, border, text, subtle,
}: {
  earnedBadges: Record<string, { earnedAt: string }>;
  PRIMARY: string; isDark: boolean; surface: string; border: string; text: string; subtle: string;
}) {
  const earnedCount = Object.keys(earnedBadges).length;

  // Sort: earned first, locked after
  const sorted = [...BADGE_DEFINITIONS].sort((a, b) => {
    const aEarned = !!earnedBadges[a.id];
    const bEarned = !!earnedBadges[b.id];
    if (aEarned && !bEarned) return -1;
    if (!aEarned && bEarned) return 1;
    return 0;
  });

  return (
    <View style={badgeStyles.wrap}>
      <View style={badgeStyles.headerRow}>
        <Text style={[badgeStyles.sectionTitle, { color: text }]}>Achievements</Text>
        <Text style={[badgeStyles.count, { color: PRIMARY }]}>{earnedCount} / {BADGE_DEFINITIONS.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={badgeStyles.scroll}>
        {sorted.map((badge) => {
          const earned = !!earnedBadges[badge.id];
          return (
            <View
              key={badge.id}
              style={[
                badgeStyles.badge,
                {
                  backgroundColor: surface,
                  borderColor: earned ? badge.color + '50' : border,
                  opacity: earned ? 1 : 0.38,
                },
              ]}
            >
              <View style={[badgeStyles.badgeIcon, { backgroundColor: badge.color + '18' }]}>
                <Ionicons
                  name={badge.icon as any}
                  size={22}
                  color={earned ? badge.color : subtle}
                />
              </View>
              <Text
                style={[badgeStyles.badgeLabel, { color: earned ? text : subtle }]}
                numberOfLines={2}
              >
                {badge.label}
              </Text>
              {earned && (
                <View style={[badgeStyles.earnedDot, { backgroundColor: badge.color }]} />
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Module Row ───────────────────────────────────────────────────────────────
function ModuleRow({
  title, progress, completedCount, totalCount, kind, PRIMARY, surface, border, text,
}: {
  title: string; progress: number; completedCount: number; totalCount: number; kind?: 'assessment' | 'practice';
  PRIMARY: string; surface: string; border: string; text: string;
}) {
  const isComplete = progress >= 1 && totalCount > 0;
  const accentColor = isComplete ? '#34C759' : PRIMARY;
  const itemTypeLabel = kind === 'practice' ? 'exercises' : 'sentences';
  const countLabel = totalCount > 0
    ? `${completedCount} / ${totalCount} ${itemTypeLabel}`
    : completedCount > 0
    ? `${completedCount} ${itemTypeLabel} done`
    : 'Not started';

  return (
    <View style={[modStyles.row, { backgroundColor: surface, borderColor: border }]}>
      <View style={[modStyles.accentStrip, { backgroundColor: accentColor }]} />
      <View style={modStyles.content}>
        <View style={modStyles.topRow}>
          <Text style={[modStyles.label, { color: text }]}>{title}</Text>
          <Text style={[modStyles.score, { color: accentColor }]}>
            {totalCount > 0 ? `${Math.round(progress * 100)}%` : '—'}
          </Text>
        </View>
        <ProgressBar progress={progress} />
        <Text style={[modStyles.countHint, { color: accentColor + 'AA' }]}>{countLabel}</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProgressReportScreen() {
  const { resolvedTheme } = useAppTheme();
  const { language } = useLanguage();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return unsub;
  }, []);

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#0C0F14' : '#F2F5F9';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const border  = isDark ? '#252D3A' : '#D1D8E2';
  const subtle  = isDark ? '#7A8FA3' : '#59677A';
  const text    = resolvedTheme.colors.text;

  // ── Gamification data ─────────────────────────────────────────────────────
  const { snapshot, isLoading: gamLoading, refetch: refetchGam } = useGamification();

  // ── Module progress data ──────────────────────────────────────────────────
  const [moduleData, setModuleData]     = useState<any[]>([]);
  const [modulesLoading, setModulesLoading] = useState(true);

  // Track previous language to clear stale module data on switch
  const prevLangRef = useRef(language);
  // Only show the loading spinner on the very first fetch per language.
  // Subsequent focus-refetches silently update without blanking the screen.
  const modulesFetchedOnce = useRef(false);

  const fetchModules = useCallback(async (silent = false) => {
    if (!user) { setModulesLoading(false); return; }
    // Show spinner only on first load; use silent mode for focus revisits
    if (!silent) setModulesLoading(true);
    try {
      const [assessments, practice] = await Promise.all([
        UAB_API.fetchModules(user.uid, 'assessments', language),
        UAB_API.fetchTrainingModules(user.uid, language),
      ]);

      const enrich = async (modules: any[], kind: 'assessment' | 'practice') => {
        return Promise.all(
          modules.map(async (m) => {
            const completedIds = await getModuleProgress(m.id);

            // ── Get real total (mirrors index.tsx exactly) ──────────────────
            let total = 0;
            if (USE_MOCK) {
              // In mock mode the sentence bank is bundled — use dataMap
              const bundled = getSentenceIdsByType(m.test_type ?? m.subtype, language);
              total = bundled.length;
            } else {
              // In real mode, read the cached data.json the bundle downloader wrote
              try {
                const FS: any = FileSystem;
                const docDir = FS.documentDirectory as string | null;
                if (docDir && user) {
                  const dataJsonPath = `${docDir}modules/${user.uid}/${m.id}/data.json`;
                  const rawJson = await FileSystem.readAsStringAsync(dataJsonPath);
                  const parsed = JSON.parse(rawJson);
                  if (kind === 'assessment') {
                    total = Array.isArray(parsed.sentences) ? parsed.sentences.length : 0;
                  } else {
                    total = Array.isArray(parsed.levels) 
                      ? parsed.levels.reduce((acc: number, level: any) => acc + (Array.isArray(level.items) ? level.items.length : 0), 0) 
                      : 0;
                  }
                }
              } catch {
                // Bundle not downloaded yet — total remains 0 (shows 0%, not 100%)
              }
            }

            // When total is unknown (0), show 0% rather than a false 100%.
            const progress = total > 0 ? Math.min(completedIds.length / total, 1) : 0;

            return {
              id: m.id,
              title: kind === 'practice' ? (m.error_name || 'Practice Plan') : m.title,
              kind,
              progress,
              completedCount: completedIds.length,
              totalCount: total,
            };
          })
        );
      };

      const [enrichedAssessments, enrichedPractice] = await Promise.all([
        enrich(assessments, 'assessment'),
        enrich(practice, 'practice'),
      ]);

      setModuleData([...enrichedAssessments, ...enrichedPractice]);
    } catch (err) {
      console.error('[ProgressReport] fetchModules failed:', err);
    } finally {
      setModulesLoading(false);
      modulesFetchedOnce.current = true;
    }
  }, [user, language]);

  // Clear stale module data immediately on language change
  useEffect(() => {
    if (prevLangRef.current !== language) {
      prevLangRef.current = language;
      modulesFetchedOnce.current = false;
      setModuleData([]);
      setModulesLoading(true);
    }
  }, [language]);

  useFocusEffect(
    useCallback(() => {
      // On first focus: show spinner. On subsequent focuses (returning from a session):
      // run a silent refresh — cached progress data makes this near-instant.
      const silent = modulesFetchedOnce.current;
      fetchModules(silent);
      refetchGam();
    }, [fetchModules, refetchGam])
  );

  const isLoading = gamLoading || modulesLoading;

  // ── Derived stats ─────────────────────────────────────────────────────────
  const { stats, badges } = snapshot;
  const hasData = stats.totalSentencesCompleted > 0;

  const assessmentModules = useMemo(
    () => moduleData.filter((m) => m.kind === 'assessment'),
    [moduleData]
  );
  const practiceModules = useMemo(
    () => moduleData.filter((m) => m.kind === 'practice'),
    [moduleData]
  );

  const langLabel = language === 'urdu' ? 'اردو' : 'EN';

  const onRefresh = useCallback(async () => {
    await Promise.all([fetchModules(), refetchGam()]);
  }, [fetchModules, refetchGam]);

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* ── Soft glowing top background overlay ── */}
      <GradientGlow color={PRIMARY} isDark={isDark} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor={PRIMARY} />
        }
      >
        {/* ── Page Header ───────────────────────────────────────────── */}
        <View style={styles.pageHeader}>
          <View>
            <Text style={[styles.pageTitle, { color: PRIMARY }]}>Progress</Text>
            <Text style={[styles.pageSubtitle, { color: subtle }]}>
              {language === 'urdu' ? 'Urdu' : 'English'} · {stats.totalSentencesCompleted} exercises
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.langPill, { backgroundColor: PRIMARY + '18', borderColor: PRIMARY + '44' }]}>
              <Text style={[styles.langPillText, { color: PRIMARY }]}>{langLabel}</Text>
            </View>
            <BrandWaveform size="sm" />
          </View>
        </View>

        {/* ── Hero accuracy card ─────────────────────────────────────── */}
        <HeroCard
          accuracy={stats.overallAccuracy}
          exercises={stats.totalSentencesCompleted}
          hasData={hasData}
          PRIMARY={PRIMARY}
          text={text}
        />

        {/* ── Level banner ───────────────────────────────────────────── */}
        <LevelBanner
          PRIMARY={PRIMARY} isDark={isDark}
          surface={surface} border={border}
          text={text} subtle={subtle}
          totalXP={stats.totalXP}
        />

        {/* ── Stats row: streak / sessions / accuracy ────────────────── */}
        <StatsRow
          currentStreak={stats.currentStreak}
          totalExercises={stats.totalSentencesCompleted}
          overallAccuracy={stats.overallAccuracy}
          hasData={hasData}
          PRIMARY={PRIMARY} isDark={isDark}
          surface={surface} border={border}
          text={text} subtle={subtle}
        />

        {/* ── Badges ────────────────────────────────────────────────── */}
        <BadgesSection
          earnedBadges={badges as Record<string, { earnedAt: string }>}
          PRIMARY={PRIMARY} isDark={isDark}
          surface={surface} border={border}
          text={text} subtle={subtle}
        />

        {/* ── Module Performance ─────────────────────────────────────── */}
        <View style={styles.moduleSection}>
          {/* Assessments subsection */}
          {(modulesLoading || assessmentModules.length > 0) && (
            <>
              <Text style={[styles.sectionLabel, { color: subtle }]}>ASSESSMENTS</Text>
              {modulesLoading && assessmentModules.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <ActivityIndicator size="small" color={PRIMARY} />
                </View>
              ) : (
                assessmentModules.map((item) => (
                  <ModuleRow
                    key={item.id}
                    title={item.title}
                    progress={item.progress}
                    completedCount={item.completedCount}
                    totalCount={item.totalCount}
                    kind={item.kind as any}
                    PRIMARY={PRIMARY} surface={surface} border={border} text={text}
                  />
                ))
              )}
            </>
          )}

          {/* Practice subsection */}
          {(modulesLoading || practiceModules.length > 0) && (
            <>
              <Text style={[styles.sectionLabel, { color: subtle, marginTop: assessmentModules.length > 0 ? 16 : 0 }]}>
                PRACTICE
              </Text>
              {modulesLoading && practiceModules.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <ActivityIndicator size="small" color={PRIMARY} />
                </View>
              ) : (
                practiceModules.map((item) => (
                  <ModuleRow
                    key={item.id}
                    title={item.title}
                    progress={item.progress}
                    completedCount={item.completedCount}
                    totalCount={item.totalCount}
                    kind={item.kind as any}
                    PRIMARY={PRIMARY} surface={surface} border={border} text={text}
                  />
                ))
              )}
            </>
          )}

          {/* No modules at all */}
          {!modulesLoading && moduleData.length === 0 && (
            <View style={styles.emptyWrap}>
              <Ionicons name="analytics-outline" size={28} color={subtle} />
              <Text style={[styles.emptyText, { color: subtle }]}>No sessions recorded yet</Text>
              <Text style={[styles.emptyHint, { color: subtle }]}>Complete an assessment to see your progress here</Text>
            </View>
          )}
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 60 },

  pageHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 20,
  },
  pageTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginBottom: 3 },
  pageSubtitle: { fontSize: 13, fontWeight: '400' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  langPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1,
  },
  langPillText: { fontSize: 12, fontWeight: '700' },

  moduleSection: { marginBottom: 8 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1,
    marginBottom: 10,
  },
  emptyWrap: { paddingVertical: 32, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 15, fontWeight: '600' },
  emptyHint: { fontSize: 13, fontWeight: '400', textAlign: 'center', opacity: 0.8 },
});

const lvlStyles = StyleSheet.create({
  card: {
    borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  levelPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  levelNum: { fontSize: 13, fontWeight: '800' },
  levelName: { fontSize: 15, fontWeight: '700', flex: 1 },
  totalXP: { fontSize: 12, fontWeight: '600' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  fill: { height: '100%', borderRadius: 3 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between' },
  hint: { fontSize: 11, fontWeight: '500' },
});

const statsStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  chip: {
    flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8,
    borderRadius: 18, borderWidth: 1, gap: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  chipIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chipValue: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  chipLabel: { fontSize: 11, fontWeight: '500' },
});

const heroStyles = StyleSheet.create({
  card: {
    borderRadius: 24, overflow: 'hidden', marginBottom: 16,
    shadowColor: '#1FB7BC', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28, shadowRadius: 20, elevation: 10,
  },
  waveOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-end', height: 64, gap: 3,
  },
  waveBar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 24 },
  heroLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  heroScore: { color: '#FFF', fontSize: 52, fontWeight: '800', letterSpacing: -2, marginBottom: 10 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  rightBlock: { alignItems: 'center' },
  sessionsCircle: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  sessionsCount: { color: '#FFF', fontSize: 20, fontWeight: '700', letterSpacing: -0.5, marginTop: 2 },
  sessionsLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '500' },
});

const badgeStyles = StyleSheet.create({
  wrap: { marginBottom: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  count: { fontSize: 13, fontWeight: '600' },
  scroll: { gap: 10, paddingRight: 4 },
  badge: {
    width: 88, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 10,
    borderRadius: 18, borderWidth: 1, gap: 8, position: 'relative',
  },
  badgeIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 15 },
  earnedDot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4 },
});

const modStyles = StyleSheet.create({
  row: {
    borderRadius: 16, borderWidth: 1, flexDirection: 'row', overflow: 'hidden',
    marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  accentStrip: { width: 4 },
  content: { flex: 1, padding: 16, gap: 8 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 12, letterSpacing: -0.1 },
  score: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3 },
  countHint: { fontSize: 11, fontWeight: '500', marginTop: -2 },
});