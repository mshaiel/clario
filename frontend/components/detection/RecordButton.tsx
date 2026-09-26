// components/detection/RecordButton.tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/theme-provider';
import { VoiceVisualizer } from './VoiceVisualizer';
import { AI_ACCENT } from './AICoPilotToggle';
import { haptics } from '@/lib/haptics';

interface Props {
  isRecording: boolean;
  metering?: number;
  hasRecording: boolean;
  onStart: () => void;
  onStop: () => void;
  onAnalyze: () => void;
  onRetry: () => void;
  disabled?: boolean;
  aiSpeaking?: boolean;
  onInterrupt?: () => void;
  isAIMode?: boolean;
}

// Reanimated ring for recording / barge-in states
function RecordingRing({ color, delay = 0 }: { color: string; delay?: number }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1, { duration: delay }),
        withTiming(1.7, { duration: 900, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.45, { duration: delay }),
        withTiming(0, { duration: 900, easing: Easing.out(Easing.ease) }),
        withTiming(0.45, { duration: 0 }),
      ),
      -1,
      false,
    );
  }, [delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
    backgroundColor: color,
    borderRadius: 100,
    ...StyleSheet.absoluteFillObject,
  }));

  return <Animated.View style={style} />;
}

export function RecordButton({
  isRecording,
  metering = -160,
  hasRecording,
  onStart,
  onStop,
  onAnalyze,
  onRetry,
  disabled,
  aiSpeaking,
  onInterrupt,
  isAIMode = false,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const PRIMARY = resolvedTheme.colors.primary;
  const isDark = resolvedTheme.dark;
  const border = isDark ? '#252D3A' : '#D1D8E2';
  const accentColor = isAIMode ? AI_ACCENT : PRIMARY;

  // Track whether a press-in was registered so we only call onStop when the
  // finger was actually pressed down on this button (not a cancelled/moved press).
  const pressInActiveRef = useRef(false);

  // Has-recording state: slides up smoothly from below, no bounce
  const slideY = useSharedValue(28);
  const slideOpacity = useSharedValue(0);

  React.useEffect(() => {
    if (hasRecording) {
      slideY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
      slideOpacity.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.ease) });
    } else {
      slideY.value = 28;
      slideOpacity.value = 0;
    }
  }, [hasRecording]);

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideY.value }],
    opacity: slideOpacity.value,
  }));

  if (hasRecording) {
    return (
      <Animated.View style={[styles.actionRow, slideStyle]}>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: isDark ? '#1A2030' : '#E8EDF2', borderColor: border }]}
          onPress={() => { haptics.light(); onRetry(); }}
        >
          <Ionicons name="refresh" size={22} color={resolvedTheme.colors.text} />
          <Text style={[styles.retryText, { color: resolvedTheme.colors.text }]}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.analyzeBtn,
            {
              backgroundColor: accentColor,
              shadowColor: accentColor,
            },
          ]}
          onPress={() => { haptics.medium(); onAnalyze(); }}
        >
          <Ionicons name="sparkles-outline" size={18} color="#FFF" />
          <Text style={styles.analyzeBtnText}>Analyse Speech</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // AI barge-in mode
  if (aiSpeaking) {
    return (
      <View style={styles.centerCol}>
        <TouchableOpacity
          style={[styles.micWrap, { opacity: disabled ? 0.5 : 1 }]}
          onPress={() => { haptics.medium(); onInterrupt?.(); }}
          disabled={disabled}
        >
          <RecordingRing color={AI_ACCENT} />
          <RecordingRing color={AI_ACCENT} delay={450} />
          <View style={[styles.micBtn, { backgroundColor: AI_ACCENT, width: 88, height: 88, borderRadius: 44 }]}>
            <Ionicons name="hand-left" size={34} color="#FFF" />
          </View>
        </TouchableOpacity>
        <Text style={[styles.interruptText, { color: AI_ACCENT, marginTop: 14 }]}>
          Tap to interrupt
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.centerCol}>
      <VoiceVisualizer metering={metering} isRecording={isRecording} isAIMode={isAIMode} />

      <Pressable
        style={[styles.micWrap, { marginTop: 12, opacity: disabled ? 0.5 : 1 }]}
        onPressIn={disabled ? undefined : () => {
          pressInActiveRef.current = true;
          haptics.medium();
          onStart();
        }}
        onPressOut={disabled ? undefined : () => {
          // Only fire onStop if we got a valid press-in on this element.
          // This prevents spurious stops from cancelled or scroll-conflicted presses.
          if (!pressInActiveRef.current) return;
          pressInActiveRef.current = false;
          haptics.light();
          onStop();
        }}
        // Prevent the Android ripple from consuming the touch before onPressIn fires
        android_ripple={null}
        // hitSlop gives a generous tap target without affecting the visual size
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        disabled={disabled}
      >
        {isRecording && (
          <>
            <RecordingRing color="#EF4444" />
            <RecordingRing color="#EF4444" delay={400} />
          </>
        )}
        <View
          style={[
            styles.micBtn,
            {
              backgroundColor: isRecording ? '#EF4444' : accentColor,
              shadowColor: isRecording ? '#EF4444' : accentColor,
              shadowOffset: { width: 0, height: isRecording ? 12 : 8 },
              shadowOpacity: isRecording ? 0.5 : 0.35,
              shadowRadius: isRecording ? 24 : 18,
              elevation: isRecording ? 14 : 10,
            },
          ]}
        >
          <Ionicons name={isRecording ? 'stop' : 'mic'} size={34} color="#FFF" />
        </View>
      </Pressable>

      {!isRecording && !hasRecording && (
        <Text style={[styles.holdHint, { color: isDark ? '#3D4A5C' : '#59677A' }]}>
          Hold to record
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centerCol: {
    alignItems: 'center',
    width: '100%',
  },
  micWrap: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdHint: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 10,
    letterSpacing: 0.2,
  },
  interruptText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: 90,
    height: 58,
    borderRadius: 18,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 58,
    borderRadius: 18,
    paddingHorizontal: 28,
    gap: 10,
    flex: 1,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  analyzeBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});