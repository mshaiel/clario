/**
 * BrandWaveform
 * Location: components/ui/BrandWaveform.tsx
 *
 * Single-source-of-truth for the Clario waveform identity mark.
 * Replaces the WAVEFORM array + .map() pattern that was copy-pasted
 * across 8+ files. Supports multiple size presets and an optional
 * breathing pulse animation.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';

// Canonical waveform shape — symmetrical, intentional
const WAVEFORM_HEIGHTS = [0.2, 0.4, 0.6, 0.8, 1, 0.8, 0.6, 0.4, 0.2];

export type WaveformSize = 'sm' | 'md' | 'lg';

interface Props {
  /** Base multiplier for bar heights. Defaults based on `size`. */
  height?: number;
  /** sm = header identity marks, md = brand blocks, lg = splash/loading */
  size?: WaveformSize;
  /** Override primary color */
  color?: string;
  /** Enable breathing pulse animation */
  animated?: boolean;
  /** Override the base opacity range (min). Default 0.3 */
  minOpacity?: number;
  /** Override the base opacity range (max multiplier). Default 0.45 */
  opacityMultiplier?: number;
  /** Bar width override */
  barWidth?: number;
  /** Gap between bars */
  gap?: number;
}

const SIZE_PRESETS: Record<WaveformSize, { height: number; barWidth: number; gap: number }> = {
  sm: { height: 18, barWidth: 3, gap: 2.5 },
  md: { height: 18, barWidth: 3.5, gap: 3 },
  lg: { height: 24, barWidth: 4, gap: 3.5 },
};

export function BrandWaveform({
  height,
  size = 'md',
  color,
  animated = false,
  minOpacity = 0.3,
  opacityMultiplier = 0.45,
  barWidth,
  gap,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const PRIMARY = color ?? resolvedTheme.colors.primary;
  const preset = SIZE_PRESETS[size];

  const resolvedHeight = height ?? preset.height;
  const resolvedBarWidth = barWidth ?? preset.barWidth;
  const resolvedGap = gap ?? preset.gap;

  const pulse = useSharedValue(1);

  useEffect(() => {
    if (animated) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.6, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    } else {
      pulse.value = 1;
    }
  }, [animated]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }));

  const Container = animated ? Animated.View : View;
  const containerProps = animated ? { style: [styles.row, { gap: resolvedGap }, animatedStyle] } : { style: [styles.row, { gap: resolvedGap }] };

  return (
    <Container {...containerProps}>
      {WAVEFORM_HEIGHTS.map((h, i) => (
        <View
          key={i}
          style={{
            width: resolvedBarWidth,
            height: resolvedHeight * h,
            borderRadius: resolvedBarWidth / 2,
            backgroundColor: PRIMARY,
            opacity: minOpacity + h * opacityMultiplier,
          }}
        />
      ))}
    </Container>
  );
}

/** Export the raw heights for any custom rendering needs */
export { WAVEFORM_HEIGHTS };

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
