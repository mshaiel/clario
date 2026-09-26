import React from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

interface Props {
  word: string;
  correctness: number;
  phonemeErrors?: string[];
  onPress?: () => void;
}

export function WordHighlight({ word, correctness, onPress }: Props) {
  const scaleAnim = useSharedValue(1);

  // Tier colors
  const color =
    correctness >= 0.8 ? '#10B981' // green
    : correctness >= 0.5 ? '#F59E0B' // amber
    : '#EF4444'; // red

  const hasIssue = correctness < 0.8;

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleAnim.value }],
  }));

  const handlePress = () => {
    if (!hasIssue) return;
    scaleAnim.value = withSequence(
      withSpring(0.9, { damping: 12, stiffness: 280 }),
      withSpring(1, { damping: 14, stiffness: 200 }),
    );
    onPress?.();
  };

  return (
    <Pressable onPress={handlePress} disabled={!hasIssue}>
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: color + '18',
            borderColor: color + '40',
          },
          animStyle,
        ]}
      >
        <Text
          style={[
            styles.word,
            { color },
            hasIssue && correctness < 0.5 && styles.errorUnderline,
          ]}
        >
          {word}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  errorUnderline: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
  },
});