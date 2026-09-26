/**
 * SegmentDots
 * Location: components/detection/SegmentDots.tsx
 *
 * Premium numbered progress dots extracted from DetectionSession.
 * Active dot expands, completed dots show a checkmark, upcoming are muted outlines.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

interface Props {
  current: number;
  total: number;
  color: string;
  subtle: string;
}

function Dot({
  index,
  current,
  color,
  subtle,
}: {
  index: number;
  current: number;
  color: string;
  subtle: string;
}) {
  const isDone = index < current;
  const isActive = index === current;
  const isUpcoming = index > current;

  const scale = useSharedValue(isActive ? 1 : 0.85);

  React.useEffect(() => {
    scale.value = withSpring(isActive ? 1 : 0.85, { damping: 14, stiffness: 180 });
  }, [isActive]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  if (isDone) {
    return (
      <Animated.View
        style={[
          styles.dot,
          animStyle,
          {
            backgroundColor: color,
            width: 22,
            height: 22,
            borderRadius: 11,
          },
        ]}
      >
        <Ionicons name="checkmark" size={12} color="#FFF" />
      </Animated.View>
    );
  }

  if (isActive) {
    return (
      <Animated.View
        style={[
          styles.dot,
          animStyle,
          {
            backgroundColor: color,
            width: 26,
            height: 26,
            borderRadius: 13,
            shadowColor: color,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.45,
            shadowRadius: 8,
            elevation: 5,
          },
        ]}
      >
        <Text style={[styles.dotNum, { color: '#FFF' }]}>{index + 1}</Text>
      </Animated.View>
    );
  }

  // Upcoming
  return (
    <Animated.View
      style={[
        styles.dot,
        animStyle,
        {
          backgroundColor: 'transparent',
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 1.5,
          borderColor: subtle + '50',
        },
      ]}
    >
      <Text style={[styles.dotNum, { color: subtle + '70', fontSize: 10 }]}>{index + 1}</Text>
    </Animated.View>
  );
}

export function SegmentDots({ current, total, color, subtle }: Props) {
  // Show max 10 dots; collapse if more
  const showCount = Math.min(total, 10);

  return (
    <View style={styles.row}>
      {Array.from({ length: showCount }).map((_, i) => (
        <Dot key={i} index={i} current={current} color={color} subtle={subtle} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  dot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotNum: {
    fontSize: 11,
    fontWeight: '700',
  },
});
