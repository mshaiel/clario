// components/dashboard/PlanSetList.tsx
// Renders the user's personalised plan sets.
// Mock mode: modules with no download_url show a fake progress animation then
// open immediately, using bundled JSON sentences instead of a real OTA zip.

import type { MappedDashboardSet } from '@/app/(tabs)/index';
import { auth } from '@/firebase';
import { useDownloadManager } from '@/hooks/useDownloadManager';
import { USE_MOCK } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

// Map subtypes to premium filled icons with a muted, sophisticated palette
const MODULE_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  blocks:            { icon: 'cube',              color: '#E8637C' },
  prolongation:      { icon: 'timer',             color: '#9F7AEA' },
  repetition:        { icon: 'sync-circle',       color: '#D97706' },
  velar_fronting:    { icon: 'swap-horizontal',   color: '#3B9EBF' },
  stopping:          { icon: 'stop-circle',       color: '#E06B8B' },
  gliding:           { icon: 'water',             color: '#2AA6A0' },
  cluster_reduction: { icon: 'git-merge',         color: '#6DA544' },
  epenthesis:        { icon: 'add-circle',        color: '#D48B3D' },
  comprehensive:     { icon: 'apps',              color: '#5A8DC8' },
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Circular Progress Ring (used during download) ───────────────────────────
function CircularProgress({ progress, color }: { progress: number; color: string }) {
  const radius = 14;
  const strokeWidth = 3;
  const circumference = 2 * Math.PI * radius;
  const animatedProgress = useSharedValue(0);

  useEffect(() => {
    animatedProgress.value = withTiming(progress, { duration: 300 });
  }, [progress]);

  const animatedProps = useAnimatedProps(() => {
    const strokeDashoffset = circumference - (animatedProgress.value / 100) * circumference;
    return { strokeDashoffset };
  });

  return (
    <View style={styles.progressRingWrap}>
      <Svg width="36" height="36" viewBox="0 0 36 36">
        <Circle
          cx="18" cy="18" r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeOpacity={0.15}
          fill="none"
        />
        <AnimatedCircle
          cx="18" cy="18" r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
          fill="none"
          rotation="-90"
          origin="18, 18"
        />
      </Svg>
    </View>
  );
}

// ─── Horizontal Progress Bar ─────────────────────────────────────────────────
function ProgressBar({
  completed,
  total,
  accentColor,
  isDark,
}: {
  completed: number;
  total: number;
  accentColor: string;
  isDark: boolean;
}) {
  const progress = useSharedValue(0);
  const ratio = total > 0 ? Math.min(completed / total, 1) : 0;

  useEffect(() => {
    progress.value = withTiming(ratio, { duration: 600 });
  }, [ratio]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as any,
  }));

  const trackBg = isDark ? '#1E2A36' : '#E8EDF2';

  return (
    <View style={[styles.progressTrack, { backgroundColor: trackBg }]}>
      <Animated.View
        style={[
          styles.progressFill,
          { backgroundColor: accentColor },
          fillStyle,
        ]}
      />
    </View>
  );
}

// ─── Fraction Badge ──────────────────────────────────────────────────────────
function FractionBadge({
  completed,
  total,
  accentColor,
  isDark,
}: {
  completed: number;
  total: number;
  accentColor: string;
  isDark: boolean;
}) {
  if (total === 0) return null;
  const isAllDone = completed >= total;
  const bg = isAllDone
    ? (isDark ? '#22C55E18' : '#22C55E14')
    : (isDark ? accentColor + '18' : accentColor + '12');
  const fg = isAllDone ? '#22C55E' : accentColor;

  return (
    <View style={[styles.fractionBadge, { backgroundColor: bg }]}>
      <Text style={[styles.fractionText, { color: fg }]}>
        {completed}<Text style={styles.fractionDivider}>/</Text>{total}
      </Text>
    </View>
  );
}

// ─── Individual Set Card ─────────────────────────────────────────────────────
// Real mode: uses DownloadContext to trigger real OTA download from backend.
// Mock mode: uses a local fake progress animation (set USE_MOCK = true to enable).

// ── MOCK: fake download config (kept for re-enabling mock mode) ──────────────
const FAKE_DOWNLOAD_MS = 1600; // total fake download duration
// ─────────────────────────────────────────────────────────────────────────────

const PlanSetRow = React.memo(({
  set,
  onSelect,
  index,
}: {
  set: MappedDashboardSet;
  onSelect: (setId: string) => void;
  index: number;
}) => {
  const { resolvedTheme } = useAppTheme();
  const { downloadModule, isModuleCached, activeDownloads } = useDownloadManager();

  const isDark   = resolvedTheme.dark;
  const PRIMARY  = resolvedTheme.colors.primary;
  const text     = resolvedTheme.colors.text;
  const subtle   = isDark ? '#8A9BB0' : '#6B7A8D';
  const surface  = isDark ? '#131A24' : '#FFFFFF';
  const border   = isDark ? '#1E2A36' : '#E4E8EE';

  const iconConfig = MODULE_ICONS[set.subtype] || { icon: 'cube' as const, color: PRIMARY };
  const accentColor = iconConfig.color;

  // Local total — populated immediately after download finishes (before parent re-fetches)
  const [localTotal, setLocalTotal] = useState<number | null>(null);

  // ── Fake download state ──────────────────────────────────────────────────
  const [fakeProgress, setFakeProgress] = useState<number | null>(null);
  const [isFakeCached, setIsFakeCached] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ── MOCK: startFakeDownload ────────────────────────────────────────────────
  // Un-comment the USE_MOCK branch in handlePress to re-enable fake download.
  const startFakeDownload = () => {
    if (fakeProgress !== null || isFakeCached) return;
    setFakeProgress(0);
    const steps = 30;
    const interval = FAKE_DOWNLOAD_MS / steps;
    let tick = 0;
    intervalRef.current = setInterval(() => {
      tick += 1;
      const pct = Math.min(100, Math.round((tick / steps) * 100));
      setFakeProgress(pct);
      if (pct >= 100) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setIsFakeCached(true);
        setFakeProgress(null);
        onSelect(set.set_id);
      }
    }, interval);
  };
  // ──────────────────────────────────────────────────────────────────────────

  const handlePress = async () => {
    haptics.light();

    if (USE_MOCK) {
      // ── MOCK path ────────────────────────────────────────────────────────
      if (isFakeCached) {
        onSelect(set.set_id);
      } else if (fakeProgress === null) {
        startFakeDownload();
      }
      // mid-animation: ignore tap
      return;
    }

    // ── Real path: DownloadContext ─────────────────────────────────────────
    if (isModuleCached(set.set_id)) {
      onSelect(set.set_id);
      return;
    }
    if (activeDownloads[set.set_id] !== undefined) {
      return; // already downloading
    }
    if (!set.download_url) {
      onSelect(set.set_id);
      return;
    }
    const success = await downloadModule(set.set_id, set.download_url);
    if (success) {
      // Read data.json immediately so the card shows total count without waiting for tab refocus
      try {
        const FS: any = FileSystem;
        const docDir = FS.documentDirectory as string | null;
        const uid = auth.currentUser?.uid;
        if (docDir && uid) {
          const dataJsonPath = `${docDir}modules/${uid}/${set.set_id}/data.json`;
          const rawJson = await FileSystem.readAsStringAsync(dataJsonPath);
          const parsed = JSON.parse(rawJson);
          const total = Array.isArray(parsed.sentences) ? parsed.sentences.length : 0;
          if (total > 0) setLocalTotal(total);
        }
      } catch { /* ignore — will be read on next focus */ }
      onSelect(set.set_id);
    }
  };

  // Visual state
  const realProgress = activeDownloads[set.set_id];
  const realCached = !USE_MOCK && isModuleCached(set.set_id);
  const isDownloading = USE_MOCK ? fakeProgress !== null : realProgress !== undefined;
  const isCached = USE_MOCK ? isFakeCached : realCached;
  const displayProgress = USE_MOCK ? (fakeProgress ?? 0) : (realProgress ?? 0);

  const completedCount = set.completed_sentences ?? 0;
  const totalCount = localTotal ?? set.total_sentences ?? set.raw_sentence_count ?? 0;
  const isCompleted = completedCount > 0 && completedCount >= totalCount && totalCount > 0;

  const pressOpacity = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ opacity: pressOpacity.value }));

  // Subtle shimmer for the accent stripe when in-progress
  const shimmer = useSharedValue(0);
  useEffect(() => {
    if (set.status === 'in_progress') {
      shimmer.value = withRepeat(withTiming(1, { duration: 2000 }), -1, true);
    }
  }, [set.status]);

  const stripeAnimStyle = useAnimatedStyle(() => {
    if (set.status !== 'in_progress') return { opacity: 1 };
    return { opacity: 0.6 + shimmer.value * 0.4 };
  });

  return (
    <Animated.View
      entering={FadeIn.delay(index * 50).duration(350)}
      style={animStyle}
    >
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.card,
          {
            backgroundColor: surface,
            borderColor: isDark ? border : '#EBF0F5',
          },
          !isDark && styles.cardShadow,
        ]}
        onPressIn={() => (pressOpacity.value = withTiming(0.85, { duration: 120 }))}
        onPressOut={() => (pressOpacity.value = withTiming(1, { duration: 200 }))}
        onPress={handlePress}
      >
        {/* ── Left accent stripe ── */}
        <Animated.View
          style={[
            styles.accentStripe,
            { backgroundColor: accentColor },
            stripeAnimStyle,
          ]}
        />

        {/* ── Card content ── */}
        <View style={styles.cardContent}>
          {/* ── Header row: icon + title + fraction ── */}
          <View style={styles.headerRow}>
            <View style={[styles.iconContainer, { backgroundColor: accentColor + (isDark ? '20' : '12') }]}>
              <Ionicons name={iconConfig.icon} size={22} color={accentColor} />
            </View>

            <View style={styles.titleBlock}>
              <Text style={[styles.title, { color: text }]} numberOfLines={1}>
                {set.title}
              </Text>
              {set.description ? (
                <Text
                  style={[styles.description, { color: subtle }]}
                  numberOfLines={2}
                >
                  {set.description}
                </Text>
              ) : null}
            </View>

            {totalCount > 0 && (
              <FractionBadge
                completed={completedCount}
                total={totalCount}
                accentColor={accentColor}
                isDark={isDark}
              />
            )}
          </View>

          {/* ── Progress bar (only when there's data) ── */}
          {totalCount > 0 && (
            <View style={styles.progressSection}>
              <ProgressBar
                completed={completedCount}
                total={totalCount}
                accentColor={isCompleted ? '#22C55E' : accentColor}
                isDark={isDark}
              />
            </View>
          )}

          {/* ── Footer: status indicator + action button ── */}
          <View style={styles.footerRow}>
            <View style={styles.footerLeft}>
              {isCompleted ? (
                <View style={[styles.statusChip, { backgroundColor: isDark ? '#22C55E14' : '#22C55E10' }]}>
                  <Ionicons name="checkmark-circle" size={13} color="#22C55E" />
                  <Text style={[styles.statusText, { color: '#22C55E' }]}>Completed</Text>
                </View>
              ) : set.status === 'in_progress' ? (
                <View style={[styles.statusChip, { backgroundColor: accentColor + '14' }]}>
                  <Ionicons name="play-circle" size={13} color={accentColor} />
                  <Text style={[styles.statusText, { color: accentColor }]}>In Progress</Text>
                </View>
              ) : (
                <View style={[styles.statusChip, { backgroundColor: isDark ? '#1E2A36' : '#F0F3F7' }]}>
                  <Ionicons name="hourglass-outline" size={12} color={subtle} />
                  <Text style={[styles.statusText, { color: subtle }]}>Not Started</Text>
                </View>
              )}
            </View>

            {/* Action button */}
            <View style={styles.actionWrap}>
              {isCached ? (
                <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
                  <View style={[styles.actionButton, styles.downloadedButton]}>
                    <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
                    <Text style={styles.downloadedLabel}>Downloaded</Text>
                  </View>
                </Animated.View>
              ) : isDownloading ? (
                <Animated.View entering={FadeIn.duration(200)}>
                  <CircularProgress progress={displayProgress} color={accentColor} />
                </Animated.View>
              ) : (
                <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
                  <View style={[styles.actionButton, styles.downloadButton, { backgroundColor: PRIMARY + (isDark ? '1A' : '10') }]}>
                    <Ionicons name="cloud-download-outline" size={14} color={PRIMARY} />
                    <Text style={[styles.downloadLabel, { color: PRIMARY }]}>Download</Text>
                  </View>
                </Animated.View>
              )}
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

// ─── Main List ───────────────────────────────────────────────────────────────
interface Props {
  sets: MappedDashboardSet[];
  onSelect: (setId: string) => void;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
  loading?: boolean;
}

export function PlanSetList({ sets, onSelect, ListHeaderComponent, loading }: Props) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const subtle  = isDark ? '#8A9BB0' : '#6B7A8D';
  const text    = resolvedTheme.colors.text;

  if (!loading && sets.length === 0) {
    return (
      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={[styles.emptyIconWrap, { backgroundColor: isDark ? '#1E2A36' : '#EBF0F5' }]}>
              <Ionicons name="layers-outline" size={32} color={subtle} style={{ opacity: 0.6 }} />
            </View>
            <Text style={[styles.emptyTitle, { color: text }]}>No plan yet</Text>
            <Text style={[styles.emptySub, { color: subtle }]}>
              Complete onboarding to receive your personalised sets.
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={<View style={{ height: 110 }} />}
      />
    );
  }

  return (
    <FlatList
      data={sets}
      keyExtractor={(item) => item.set_id}
      renderItem={({ item, index }) => (
        <PlanSetRow set={item} onSelect={onSelect} index={index} />
      )}
      ListHeaderComponent={ListHeaderComponent}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      ListFooterComponent={<View style={{ height: 110 }} />}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 20,
  },

  /* ── Card ─────────────────────────────────────────────── */
  card: {
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  cardShadow: {
    shadowColor: '#18394B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },

  /* ── Left accent stripe ────────────────────────────────── */
  accentStripe: {
    width: 4,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },

  /* ── Card content area ─────────────────────────────────── */
  cardContent: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
    paddingLeft: 14,
  },

  /* ── Header row: icon + title block + fraction ─────────── */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  description: {
    fontSize: 12.5,
    fontWeight: '400',
    lineHeight: 17,
    marginTop: 3,
    opacity: 0.8,
  },

  /* ── Fraction badge ────────────────────────────────────── */
  fractionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    marginTop: 2,
  },
  fractionText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  fractionDivider: {
    fontWeight: '400',
    opacity: 0.5,
  },

  /* ── Progress bar ──────────────────────────────────────── */
  progressSection: {
    marginTop: 14,
    marginBottom: 2,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  /* ── Footer row ────────────────────────────────────────── */
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  /* ── Status chip ───────────────────────────────────────── */
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  /* ── Action buttons ────────────────────────────────────── */
  actionWrap: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
  },
  downloadButton: {
    // background color set dynamically
  },
  downloadLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  downloadedButton: {
    backgroundColor: '#22C55E12',
  },
  downloadedLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.1,
    color: '#22C55E',
  },

  /* ── Circular download progress ────────────────────────── */
  progressRingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Empty state ─────────────────────────────────────── */
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  emptySub: {
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.8,
  },
});
