import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
  SharedValue,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';
import { AI_ACCENT } from './AICoPilotToggle';

interface Props {
  metering: number; // -160 to 0 dB
  isRecording: boolean;
  isAIMode?: boolean;
}

// Scale factors give a natural mountain curve to the waveform
const SCALE_FACTORS = [0.45, 0.6, 0.75, 0.9, 1.1, 1.3, 1.1, 0.9, 0.75, 0.6, 0.45];

const Bar = ({
  value,
  color,
  isRecording,
}: {
  value: SharedValue<number>;
  color: string;
  isRecording: boolean;
}) => {
  const style = useAnimatedStyle(() => ({
    height: value.value,
    backgroundColor: color,
    borderRadius: 4,
    opacity: isRecording ? 1 : 0.2,
    shadowColor: color,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isRecording ? 0.35 : 0,
    shadowRadius: 4,
  }));
  return <Animated.View style={[styles.bar, style]} />;
};

export function VoiceVisualizer({ metering, isRecording, isAIMode = false }: Props) {
  const { resolvedTheme } = useAppTheme();
  const PRIMARY = resolvedTheme.colors.primary;
  const barColor = isAIMode ? AI_ACCENT : PRIMARY;

  // 11 independent shared values — no hook-in-loop, all declared statically
  const b0  = useSharedValue(4);
  const b1  = useSharedValue(4);
  const b2  = useSharedValue(4);
  const b3  = useSharedValue(4);
  const b4  = useSharedValue(4);
  const b5  = useSharedValue(4);
  const b6  = useSharedValue(4);
  const b7  = useSharedValue(4);
  const b8  = useSharedValue(4);
  const b9  = useSharedValue(4);
  const b10 = useSharedValue(4);

  const bars = [b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10];

  useEffect(() => {
    if (!isRecording) {
      bars.forEach(bar => {
        bar.value = withTiming(4, { duration: 300, easing: Easing.out(Easing.ease) });
      });
      return;
    }

    // dB to 0–1, clamped. Shift by 55 so quiet voices still show movement.
    const normalized = Math.max(0.05, Math.min(1, (metering + 55) / 55));

    bars.forEach((bar, i) => {
      const scale  = SCALE_FACTORS[i];
      const jitter = Math.random() * 14 + 2; // organic noise
      const target = Math.max(4, normalized * 68 * scale + jitter);
      bar.value = withSpring(target, { damping: 15, stiffness: 150 });
    });
  }, [metering, isRecording]);

  return (
    <View style={styles.container}>
      {bars.map((bar, i) => (
        <Bar key={i} value={bar} color={barColor} isRecording={isRecording} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 72,
    paddingHorizontal: 4,
  },
  bar: {
    width: 5,
    minHeight: 4,
  },
});