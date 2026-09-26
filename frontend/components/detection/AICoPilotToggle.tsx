// components/detection/AICoPilotToggle.tsx
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming
} from 'react-native-reanimated';

// Exclusive AI identity color
export const AI_ACCENT = '#7C6FFF';

export type AIState = 'off' | 'idle' | 'speaking';

interface Props {
  state: AIState;
  onToggle: () => void;
  accessibilityLabel?: string;
}

// Mini animated bar for "speaking" state
function SpeakBar({ delay, accent }: { delay: number; accent: string }) {
  const height = useSharedValue(0.3);

  useEffect(() => {
    height.value = withRepeat(
      withSequence(
        withTiming(1,   { duration: 300 + delay, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.3, { duration: 300 + delay, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    height: `${height.value * 100}%` as any,
    backgroundColor: accent,
  }));

  return <Animated.View style={[styles.bar, style]} />;
}

// Shimmer sweep that crosses the pill
function ShimmerSweep({ isOn }: { isOn: boolean }) {
  const translateX = useSharedValue(-40);

  useEffect(() => {
    if (isOn) {
      translateX.value = withRepeat(
        withSequence(
          withTiming(-40, { duration: 0 }),
          withTiming(120, { duration: 700, easing: Easing.inOut(Easing.ease) }),
          withTiming(120, { duration: 2300 }), // hold before repeating
        ),
        -1,
        false,
      );
    } else {
      translateX.value = -40;
    }
  }, [isOn]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: isOn ? 0.18 : 0,
  }));

  if (!isOn) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.shimmerWrap]}
    >
      <Animated.View style={[styles.shimmerBar, style]} />
    </Animated.View>
  );
}

export function AICoPilotToggle({ state, onToggle, accessibilityLabel }: Props) {
  const { resolvedTheme } = useAppTheme();
  const isOn = state !== 'off';
  const isSpeaking = state === 'speaking';

  const isDark = resolvedTheme.dark;
  const subtle = isDark ? '#7A8FA3' : '#8D9FAE';
  const border = isDark ? '#252D3A' : '#EAECEF';
  const surface = isDark ? '#161B24' : '#FFFFFF';

  // Bg interpolation between off/on
  const onProgress = useSharedValue(isOn ? 1 : 0);
  useEffect(() => {
    onProgress.value = withTiming(isOn ? 1 : 0, { duration: 300 });
  }, [isOn]);

  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      onProgress.value,
      [0, 1],
      [surface, isDark ? '#1E1B38' : '#EDE9FF'],
    ),
    borderColor: interpolateColor(
      onProgress.value,
      [0, 1],
      [border, AI_ACCENT + '70'],
    ),
  }));

  const barsContainerStyle = useAnimatedStyle(() => ({
    width: withTiming(isSpeaking ? 16 : 0, { duration: 300 }),
    opacity: withTiming(isSpeaking ? 1 : 0, { duration: 300 }),
    marginLeft: withTiming(isSpeaking ? 4 : 0, { duration: 300 }),
  }));

  return (
    <TouchableOpacity 
      activeOpacity={0.7} 
      onPress={onToggle}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <Animated.View style={[styles.pill, pillStyle]}>
        <ShimmerSweep isOn={isOn} />

        <Ionicons
          name={isOn ? 'sparkles' : 'sparkles-outline'}
          size={15}
          color={isOn ? AI_ACCENT : subtle}
        />

        <Text style={[styles.label, { color: isOn ? AI_ACCENT : subtle }]}>
          {isOn ? 'AI On' : 'AI Off'}
        </Text>

        {/* Sliding visualizer bars */}
        <Animated.View style={[styles.barsWrap, barsContainerStyle]}>
          <View style={styles.barsInner}>
            <SpeakBar delay={0}   accent={AI_ACCENT} />
            <SpeakBar delay={120} accent={AI_ACCENT} />
            <SpeakBar delay={60}  accent={AI_ACCENT} />
          </View>
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  shimmerWrap: {
    overflow: 'hidden',
    borderRadius: 22,
  },
  shimmerBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 28,
    backgroundColor: '#FFFFFF',
    transform: [{ skewX: '-20deg' }],
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  barsWrap: {
    height: 12,
    overflow: 'hidden',
  },
  barsInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 2,
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
});