// components/detection/AIFeedbackBubble.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOut,
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/theme-provider';
import { AI_ACCENT } from './AICoPilotToggle';

interface Props {
  message: string;
  isSpeaking: boolean;
  onDismiss: () => void;
  /** Override outer card styles (e.g. marginHorizontal, marginTop) */
  style?: ViewStyle;
}

// Mini waveform bar
function MiniBar({ delay, isSpeaking }: { delay: number; isSpeaking: boolean }) {
  const height = useSharedValue(0.3);

  useEffect(() => {
    if (!isSpeaking) {
      height.value = withTiming(0.3);
      return;
    }
    height.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 250 + delay, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.3, { duration: 250 + delay, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
  }, [isSpeaking]);

  const style = useAnimatedStyle(() => ({
    height: `${height.value * 100}%` as any,
    backgroundColor: AI_ACCENT,
  }));

  return <Animated.View style={[styles.miniBar, style]} />;
}

// Blinking cursor
function BlinkingCursor({ visible }: { visible: boolean }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 450 }),
          withTiming(0, { duration: 450 }),
        ),
        -1,
        true,
      );
    } else {
      opacity.value = withTiming(0, { duration: 300 });
    }
  }, [visible]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.Text style={[styles.cursor, style]}>|</Animated.Text>
  );
}

export function AIFeedbackBubble({ message, isSpeaking, onDismiss, style }: Props) {
  const { resolvedTheme } = useAppTheme();
  const isDark = resolvedTheme.dark;

  const [displayedText, setDisplayedText] = useState('');
  const [typingDone, setTypingDone] = useState(false);

  useEffect(() => {
    let index = 0;
    setDisplayedText('');
    setTypingDone(false);

    // Target: finish typing in ~80% of the estimated audio duration so the
    // text is fully visible slightly before the voice finishes.
    // Estimate: average TTS speaks ~14 chars/sec (≈70wpm × 5 chars/word).
    // We cap between 30ms (fast) and 80ms (slow) per character so short
    // phrases don't race by and long ones don't drag.
    const estimatedAudioMs = (message.length / 14) * 1000;
    const targetMs = estimatedAudioMs * 0.80;
    const speed = Math.min(80, Math.max(30, targetMs / message.length));

    const interval = setInterval(() => {
      index++;
      setDisplayedText(message.slice(0, index));
      if (index >= message.length) {
        clearInterval(interval);
        setTypingDone(true);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [message]);

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(16).stiffness(150)}
      exiting={FadeOut.duration(200)}
      style={[
        styles.card,
        {
          backgroundColor: isDark ? '#16152A' : '#FFFFFF',
          borderColor: isDark ? AI_ACCENT + '30' : '#E2E8F0',
        },
        style,
      ]}
    >
      {/* Speech bubble pointer */}
      <View style={[styles.pointer, { borderBottomColor: isDark ? '#16152A' : '#FFFFFF' }]} />

      <View style={styles.row}>
        {/* AI Avatar */}
        <View style={[styles.avatar, { backgroundColor: AI_ACCENT + '22', borderColor: AI_ACCENT + '40' }]}>
          <Ionicons name="sparkles" size={16} color={AI_ACCENT} />
        </View>

        {/* Bubble content */}
        <View style={styles.bubbleContent}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: AI_ACCENT }]}>Co-Pilot</Text>
              <View style={styles.miniWave}>
                {[0, 150, 75, 200, 100].map((delay, i) => (
                  <MiniBar key={i} delay={delay} isSpeaking={isSpeaking} />
                ))}
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onDismiss}>
              <Ionicons name="close" size={15} color={isDark ? '#FFF' : '#555'} style={{ opacity: 0.45 }} />
            </TouchableOpacity>
          </View>

          <View style={styles.messageWrap}>
            <Text style={[styles.messageText, { color: resolvedTheme.colors.text }]}>
              "{displayedText}"
              <BlinkingCursor visible={!typingDone} />
            </Text>
          </View>

          {typingDone && (
            <Animated.View entering={FadeIn.duration(400)} style={styles.gotItRow}>
              <TouchableOpacity
                style={[styles.gotItBtn, { borderColor: AI_ACCENT + '50' }]}
                onPress={onDismiss}
                activeOpacity={0.7}
              >
                <Text style={[styles.gotItText, { color: AI_ACCENT }]}>Got it</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: AI_ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
  },
  pointer: {
    position: 'absolute',
    top: -10,
    left: 28,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
    marginTop: 2,
  },
  bubbleContent: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  miniWave: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 12,
    gap: 2,
  },
  miniBar: {
    width: 3,
    borderRadius: 2,
  },
  closeBtn: { padding: 2 },
  messageWrap: { paddingRight: 4 },
  messageText: {
    fontSize: 15,
    fontStyle: 'italic',
    fontWeight: '500',
    lineHeight: 23,
  },
  cursor: {
    fontSize: 15,
    fontWeight: '300',
    color: AI_ACCENT,
  },
  gotItRow: {
    marginTop: 10,
    alignItems: 'flex-start',
  },
  gotItBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  gotItText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
