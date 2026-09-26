/**
 * TimerDisplay
 * Location: components/detection/TimerDisplay.tsx
 *
 * Premium timer pill extracted from DetectionSession.
 * Monospace digits, pulsing dot when active, urgent red flash when ≤4s.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface Props {
  remaining: number;
  color: string;
  subtle: string;
  isDark: boolean;
}

export function TimerDisplay({ remaining, color, subtle, isDark }: Props) {
  const isUrgent = remaining <= 4;
  const accentColor = isUrgent ? '#EF4444' : color;

  const dotOpacity = useSharedValue(1);

  useEffect(() => {
    dotOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: isUrgent ? 250 : 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.2, { duration: isUrgent ? 250 : 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [isUrgent]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
  }));

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: (isUrgent ? '#EF4444' : color) + '16',
          borderColor: accentColor + '35',
        },
      ]}
    >
      <Animated.View style={[styles.dot, { backgroundColor: accentColor }, dotStyle]} />
      <Text style={[styles.time, { color: accentColor }]}>{timeStr}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  time: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
});
