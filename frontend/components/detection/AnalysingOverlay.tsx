/**
 * AnalysingOverlay
 * Location: components/detection/AnalysingOverlay.tsx
 *
 * Full-screen overlay shown while audio is being analysed.
 * Clean animated bar-wave with staggered bars, soft pulse ring, AI-aware messaging.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AI_ACCENT } from './AICoPilotToggle';

interface Props {
  accentColor: string;
  surface: string;
  border: string;
  text: string;
  subtle: string;
  isDark: boolean;
  isAIMode?: boolean;
  /** When provided (AI mode), shows a speech bubble below the card with this text */
  waitingMessage?: string | null;
}

const BAR_HEIGHTS = [0.35, 0.6, 0.9, 1, 0.75, 0.5, 0.8, 0.55, 0.35];
const MAX_BAR_H = 36;
const BAR_W = 4;
const BAR_GAP = 5;

function AnimatedBar({ height, delay, color }: { height: number; delay: number; color: string }) {
  const anim = useSharedValue(height * 0.4);

  useEffect(() => {
    anim.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(height, { duration: 420, easing: Easing.inOut(Easing.ease) }),
          withTiming(height * 0.25, { duration: 420, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({ height: anim.value * MAX_BAR_H }));

  return (
    <Animated.View
      style={[
        {
          width: BAR_W,
          borderRadius: BAR_W / 2,
          backgroundColor: color,
          marginHorizontal: BAR_GAP / 2,
        },
        style,
      ]}
    />
  );
}

/** A single expanding ring that fades out as it grows — like a ripple */
function RippleRing({ color, delay }: { color: string; delay: number }) {
  const scale = useSharedValue(0.6);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.6, { duration: 0 }),
          withTiming(1.5, { duration: 1600, easing: Easing.out(Easing.cubic) }),
        ),
        -1,
        false,
      ),
    );
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.35, { duration: 0 }),
          withTiming(0, { duration: 1600, easing: Easing.out(Easing.cubic) }),
        ),
        -1,
        false,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.rippleRing,
        { borderColor: color },
        style,
      ]}
    />
  );
}

function AnimatedDots() {
  const [dotCount, setDotCount] = useState(1);
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev: number) => (prev >= 3 ? 1 : prev + 1));
    }, 500);
    return () => clearInterval(interval);
  }, []);
  return <Text style={{ letterSpacing: 2 }}>{'.'.repeat(dotCount)}</Text>;
}

/** Animated typewriter text for the waiting bubble */
function WaitingBubble({ message, isDark }: { message: string; isDark: boolean }) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    let i = 0;
    setDisplayed('');
    const speed = Math.min(70, Math.max(28, (message.length / 14) * 800 * 0.8 / message.length));
    const interval = setInterval(() => {
      i++;
      setDisplayed(message.slice(0, i));
      if (i >= message.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [message]);

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(18).stiffness(160)}
      exiting={FadeOut.duration(180)}
      style={[
        styles.waitingBubble,
        { backgroundColor: isDark ? 'rgba(22,21,42,0.82)' : 'rgba(246,245,255,0.90)', borderColor: AI_ACCENT + '30' },
      ]}
    >
      {/* pointer cap */}
      <View style={[styles.waitingPointer, { borderBottomColor: isDark ? 'rgba(22,21,42,0.82)' : 'rgba(246,245,255,0.90)' }]} />
      <View style={styles.waitingRow}>
        <View style={[styles.waitingAvatar, { backgroundColor: AI_ACCENT + '20', borderColor: AI_ACCENT + '35' }]}>
          <Ionicons name="sparkles" size={13} color={AI_ACCENT} />
        </View>
        <Text style={[styles.waitingText, { color: isDark ? '#D4D0F5' : '#3B3575' }]}>
          {displayed}
        </Text>
      </View>
    </Animated.View>
  );
}

export function AnalysingOverlay({
  accentColor,
  surface,
  border,
  text,
  subtle,
  isDark,
  isAIMode = false,
  waitingMessage,
}: Props) {
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(200)} style={styles.wrap}>
      {/* Backdrop */}
      <View
        style={[
          styles.backdrop,
          { backgroundColor: isDark ? 'rgba(8,10,16,0.84)' : 'rgba(235,239,245,0.92)' },
        ]}
      />

      {/* Card */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: surface,
            borderColor: isAIMode ? AI_ACCENT + '28' : border,
            shadowColor: isAIMode ? AI_ACCENT : '#000',
          },
        ]}
      >
        {/* Ripple rings — stroke only, no solid blob */}
        <View style={styles.rippleWrap} pointerEvents="none">
          <RippleRing color={accentColor} delay={0} />
          <RippleRing color={accentColor} delay={800} />
        </View>

        {/* Bar wave */}
        <View style={styles.barsRow}>
          {BAR_HEIGHTS.map((h, i) => (
            <AnimatedBar key={i} height={h} delay={i * 55} color={accentColor} />
          ))}
        </View>

        {/* Text */}
        <Text style={[styles.title, { color: text }]}>
          {isAIMode ? 'AI is analysing' : 'Analysing speech'}
          <AnimatedDots />
        </Text>
        <Text style={[styles.sub, { color: subtle }]}>
          {isAIMode
            ? 'Co-pilot is comparing your phonemes'
            : 'Comparing against phoneme model'}
        </Text>
      </View>

      {/* Waiting speech bubble — only in AI mode when a message is available */}
      {isAIMode && waitingMessage ? (
        <WaitingBubble message={waitingMessage} isDark={isDark} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: 280,
    borderRadius: 28,
    borderWidth: 1,
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 16,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 40,
    elevation: 20,
    // No overflow:hidden — ripple rings need to bleed outside
  },
  rippleWrap: {
    position: 'absolute',
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    // vertically centred behind the bars area
    top: 24,
  },
  rippleRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_BAR_H + 4,
    zIndex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginTop: 4,
  },
  sub: {
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 19,
  },
  // Waiting speech bubble
  waitingBubble: {
    marginTop: 16,
    marginHorizontal: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  waitingPointer: {
    position: 'absolute',
    top: -8,
    left: 24,
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waitingAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
  },
  waitingText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    fontStyle: 'italic',
    lineHeight: 20,
  },
});

