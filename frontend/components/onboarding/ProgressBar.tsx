import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';

interface Props {
  progress: number; // 0.0 to 1.0
}

export function ProgressBar({ progress }: Props) {
  const { resolvedTheme } = useAppTheme();
  const widthVal = useSharedValue(0);

  useEffect(() => {
    widthVal.value = withTiming(progress * 100, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${widthVal.value}%`,
    backgroundColor: resolvedTheme.colors.primary, // Brand color, not Duolingo green
  }));

  return (
    <View style={[styles.track, { backgroundColor: resolvedTheme.dark ? '#1E2530' : '#E8EDEF' }]}>
      <Animated.View style={[styles.fill, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 3, // Thin, refined — not 12px chunky
    borderRadius: 2,
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});