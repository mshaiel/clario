/**
 * TrainingModuleCard
 * Location: components/practice/TrainingModuleCard.tsx
 *
 * Downloadable training module card for the Practice tab.
 * Mirrors PlanSetRow from PlanSetList.tsx using the same DownloadContext.
 *
 * Severity pill colours:
 *   High   (≥0.7) → red
 *   Medium (≥0.4) → amber
 *   Low    (<0.4) → green
 *
 * major_type chip: "Artic" | "Fluency" | "Motor"
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { auth } from '@/firebase';
import { useDownloadManager } from '@/hooks/useDownloadManager';
import { UAB_API, USE_MOCK } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import type { TrainingModuleManifest } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';

// ── Severity colours ─────────────────────────────────────────────────────────
function severityColor(severity: number): string {
  if (severity >= 0.7) return '#EF4444';
  if (severity >= 0.4) return '#F59E0B';
  return '#10B981';
}

function severityLabel(severity: number): string {
  if (severity >= 0.7) return 'High';
  if (severity >= 0.4) return 'Medium';
  return 'Low';
}

// ── major_type config ─────────────────────────────────────────────────────────
const MAJOR_TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Artic:   'mic-outline',
  Fluency: 'pulse-outline',
  Motor:   'body-outline',
};
const MAJOR_TYPE_COLOR: Record<string, string> = {
  Artic:   '#6366F1',
  Fluency: '#F97316',
  Motor:   '#10B981',
};

// ── Circular progress ring (same as PlanSetList) ──────────────────────────────
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function CircularProgress({ progress, color }: { progress: number; color: string }) {
  const radius = 12;
  const strokeWidth = 3;
  const circumference = 2 * Math.PI * radius;
  const animProg = useSharedValue(0);

  React.useEffect(() => {
    animProg.value = withTiming(progress, { duration: 300 });
  }, [progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference - (animProg.value / 100) * circumference,
  }));

  return (
    <View style={styles.progressRingWrap}>
      <Svg width="32" height="32" viewBox="0 0 32 32">
        <Circle
          cx="16" cy="16" r={radius}
          stroke={color} strokeWidth={strokeWidth}
          strokeOpacity={0.2} fill="none"
        />
        <AnimatedCircle
          cx="16" cy="16" r={radius}
          stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round" fill="none"
          rotation="-90" origin="16, 16"
        />
      </Svg>
    </View>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, PRIMARY, subtle }: { status: TrainingModuleManifest['status']; PRIMARY: string; subtle: string }) {
  const pulse = useSharedValue(1);
  React.useEffect(() => {
    if (status === 'in_progress') {
      pulse.value = withRepeat(withTiming(0.6, { duration: 1000 }), -1, true);
    }
  }, [status]);
  const animStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (status === 'completed') {
    return (
      <View style={[styles.statusBadge, { backgroundColor: '#10B98118' }]}>
        <Ionicons name="checkmark-circle" size={11} color="#10B981" />
        <Text style={[styles.statusBadgeText, { color: '#10B981' }]}>Done</Text>
      </View>
    );
  }
  if (status === 'in_progress') {
    return (
      <Animated.View style={[styles.statusBadge, { backgroundColor: PRIMARY + '15' }, animStyle]}>
        <Ionicons name="play-circle" size={11} color={PRIMARY} />
        <Text style={[styles.statusBadgeText, { color: PRIMARY }]}>In Progress</Text>
      </Animated.View>
    );
  }
  return null;
}

// ── Main card ─────────────────────────────────────────────────────────────────
interface Props {
  module: TrainingModuleManifest;
  onStart: (moduleId: string) => void;
}

const FAKE_DOWNLOAD_MS = 1600;

export const TrainingModuleCard = React.memo(function TrainingModuleCard({ module, onStart }: Props) {
  const { resolvedTheme } = useAppTheme();
  const { downloadModule, isModuleCached, activeDownloads } = useDownloadManager();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  // Light mode uses a slightly warm off-white to "float" off the #F5F7FA page background
  const surface = isDark ? '#1A2030' : '#FAFBFF';
  const border  = isDark ? '#2A3448' : '#E8ECF2';
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#8D9FAE';
  const trackBg = isDark ? '#1A2236' : '#EDEEF2';

  const accentColor = MAJOR_TYPE_COLOR[module.major_type] ?? PRIMARY;
  const severityCol = severityColor(module.severity);
  const iconName    = MAJOR_TYPE_ICON[module.major_type] ?? 'cube-outline';

  // Fake download for mock mode
  const [fakeProgress, setFakeProgress] = useState<number | null>(null);
  const [isFakeCached, setIsFakeCached] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [downloadFailed, setDownloadFailed] = useState(false);

  const startFakeDownload = () => {
    if (fakeProgress !== null || isFakeCached) return;
    setFakeProgress(0);
    setDownloadFailed(false);
    const steps = 30;
    const interval = FAKE_DOWNLOAD_MS / steps;
    let tick = 0;
    intervalRef.current = setInterval(() => {
      tick += 1;
      const pct = Math.min(100, Math.round((tick / steps) * 100));
      setFakeProgress(pct);
      if (pct >= 100) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setIsFakeCached(true);
        setFakeProgress(null);
        onStart(module.id);
      }
    }, interval);
  };

  const handlePress = async () => {
    haptics.light();

    if (USE_MOCK) {
      if (isFakeCached) {
        onStart(module.id);
      } else if (fakeProgress === null) {
        startFakeDownload();
      }
      return;
    }

    // Real path
    if (isModuleCached(module.id)) {
      onStart(module.id);
      return;
    }
    if (activeDownloads[module.id] !== undefined) return; // already downloading

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setDownloadFailed(false);
    const downloadUrl = module.download_url ?? UAB_API.trainingBundleUrl(module.id, uid);
    const success = await downloadModule(module.id, downloadUrl);
    if (success) {
      onStart(module.id);
    } else {
      setDownloadFailed(true);
    }
  };

  const realProgress = activeDownloads[module.id];
  const realCached   = !USE_MOCK && isModuleCached(module.id);
  const isDownloading = USE_MOCK ? fakeProgress !== null : realProgress !== undefined;
  const isCached      = USE_MOCK ? isFakeCached : realCached;
  const displayProgress = USE_MOCK ? (fakeProgress ?? 0) : (realProgress ?? 0);

  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={({ pressed }) => [
          styles.cardOuter,
          { backgroundColor: surface, borderColor: border },
          !isDark && styles.cardOuterLightShadow
        ]}
        onPressIn={() => scale.value = withSpring(0.97, { damping: 15, stiffness: 250 })}
        onPressOut={() => scale.value = withSpring(1, { damping: 15, stiffness: 250 })}
        onPress={handlePress}
      >
      {/* Accent left bar — full card height */}
      <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

      {/* Top row */}
      <View style={styles.topRow}>
        <View style={[styles.iconBox, { backgroundColor: accentColor + (isDark ? '22' : '18') }]}>
          <Ionicons name={iconName} size={20} color={accentColor} />
        </View>

        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: text }]} numberOfLines={1}>{module.error_name}</Text>
          <Text style={[styles.subtitle, { color: subtle }]}>
            {module.level_count} {module.level_count === 1 ? 'level' : 'levels'} · {module.language}
          </Text>
        </View>

        {/* Download / progress / cached indicator */}
        <View style={styles.actionWrap}>
          {isCached ? (
            <Animated.View entering={FadeIn} exiting={FadeOut}>
              <View style={[styles.cachedBadge, { backgroundColor: '#10B98118' }]}>
                <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                <Text style={[styles.cachedText, { color: '#10B981' }]}>Ready</Text>
              </View>
            </Animated.View>
          ) : isDownloading ? (
            <Animated.View entering={FadeIn}>
              <CircularProgress progress={displayProgress} color={accentColor} />
            </Animated.View>
          ) : downloadFailed ? (
            <Animated.View entering={FadeIn} exiting={FadeOut}>
              <View style={[styles.downloadPill, { backgroundColor: '#EF444415', borderColor: '#EF444430' }]}>
                <Ionicons name="refresh-outline" size={13} color="#EF4444" />
                <Text style={[styles.downloadPillText, { color: '#EF4444' }]}>Failed</Text>
              </View>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeIn} exiting={FadeOut}>
              <View style={[styles.downloadPill, { backgroundColor: accentColor + '15', borderColor: accentColor + '30' }]}>
                <Ionicons name="cloud-download-outline" size={13} color={accentColor} />
                <Text style={[styles.downloadPillText, { color: accentColor }]}>Download</Text>
              </View>
            </Animated.View>
          )}
        </View>
      </View>

      {/* Chips row */}
      <View style={styles.chipsRow}>
        <StatusBadge status={module.status} PRIMARY={PRIMARY} subtle={subtle} />

        {/* major_type chip */}
        <View style={[styles.chip, { backgroundColor: accentColor + (isDark ? '1A' : '12'), borderColor: accentColor + '25', borderWidth: 1 }]}>
          <Text style={[styles.chipText, { color: accentColor }]}>{module.major_type}</Text>
        </View>

        {/* severity chip */}
        <View style={[styles.chip, { backgroundColor: severityCol + (isDark ? '1A' : '12'), borderColor: severityCol + '25', borderWidth: 1 }]}>
          <View style={[styles.severityDot, { backgroundColor: severityCol }]} />
          <Text style={[styles.chipText, { color: severityCol }]}>
            {severityLabel(module.severity)} · {Math.round(module.severity * 100)}%
          </Text>
        </View>
      </View>

      {/* Severity progress bar — pill-shaped, no border */}
      <View style={[styles.severityTrack, { backgroundColor: trackBg }]}>
        <View style={[styles.severityFill, { width: `${module.severity * 100}%`, backgroundColor: severityCol }]} />
      </View>
    </Pressable>
  </Animated.View>
);
});

const styles = StyleSheet.create({
  cardOuter: {
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 18,
    paddingRight: 18,
    paddingLeft: 20,
    marginBottom: 14,
    position: 'relative',
    overflow: 'hidden',
  },
  cardOuterLightShadow: {
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 4,
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 18,
    bottom: 18,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1 },
  title: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
    fontWeight: '500',
  },
  actionWrap: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingLeft: 56,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  severityTrack: {
    marginTop: 14,
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    marginLeft: 56,
  },
  metaRibbon: {
    left: 56,
  },
  severityFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressRingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  downloadPillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  cachedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  cachedText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
}) as any;
