/**
 * Sound Check Screen
 * Location: app/onboarding/sound-check.tsx
 *
 * Step 2 of 7.
 * After passing (or skipping) the check the user goes to persona selection.
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  FadeIn,
  FadeInDown,
  interpolate,
} from 'react-native-reanimated';

import { useAppTheme } from '@/theme-provider';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { QuestionLayout } from '@/components/onboarding/QuestionLayout';
import { useOnboardingActions } from '@/context/OnboardingContext';

const DURATION_MS = 3000;
const THRESHOLD_PERFECT = -50;
const THRESHOLD_PASS = -35;

type CheckStatus = 'idle' | 'listening' | 'calculating' | 'complete';
type NoiseVerdict = 'perfect' | 'good' | 'bad';

function RippleRing({
  delay,
  isListening,
  color,
}: {
  delay: number;
  isListening: boolean;
  color: string;
}) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (isListening) {
      scale.value = withDelay(
        delay,
        withRepeat(withTiming(2.8, { duration: 2200, easing: Easing.out(Easing.ease) }), -1, false)
      );
      opacity.value = withDelay(
        delay,
        withRepeat(withTiming(0, { duration: 2200, easing: Easing.out(Easing.ease) }), -1, false)
      );
    } else {
      scale.value = withTiming(0, { duration: 300 });
      opacity.value = withTiming(0, { duration: 300 });
    }
  }, [isListening]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: interpolate(scale.value, [0, 2.8], [0.55, 0]),
    borderColor: color,
  }));

  return <Animated.View style={[styles.ripple, style]} />;
}

export default function SoundCheckScreen() {
  const { resolvedTheme } = useAppTheme();
  const router = useRouter();
  const { startRecording, stopRecording, metering } = useAudioRecorder();
  const { goBackToLanguage } = useOnboardingActions();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#7A8FA3' : '#8D9FAE';
  const bg = isDark ? '#0C0F14' : '#F8FAFB';

  const [status, setStatus] = useState<CheckStatus>('idle');
  const [avgNoise, setAvgNoise] = useState(-160);

  const samplesRef = useRef<number[]>([]);
  const timerRef = useRef<any>(null);
  const micPulse = useSharedValue(1);

  useEffect(() => {
    startCheck();
    return () => {
      stopRecording();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status === 'listening') {
      micPulse.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      micPulse.value = withTiming(1, { duration: 200 });
    }
  }, [status]);

  useEffect(() => {
    if (status === 'listening' && metering > -160) {
      samplesRef.current.push(metering);
    }
  }, [metering, status]);

  const startCheck = async () => {
    try {
      setStatus('idle');
      samplesRef.current = [];
      await startRecording();
      setStatus('listening');
      timerRef.current = setTimeout(async () => {
        setStatus('calculating');
        await stopRecording();
        calculateResult();
      }, DURATION_MS);
    } catch (e) {
      Alert.alert('Microphone Error', 'Please allow microphone access and try again.');
      setStatus('idle');
    }
  };

  const calculateResult = () => {
    const s = samplesRef.current;
    const avg = s.length > 0 ? s.reduce((a, b) => a + b, 0) / s.length : -100;
    setAvgNoise(avg);
    setStatus('complete');
  };

  const verdict: NoiseVerdict = useMemo(() => {
    if (avgNoise < THRESHOLD_PERFECT) return 'perfect';
    if (avgNoise < THRESHOLD_PASS) return 'good';
    return 'bad';
  }, [avgNoise]);

  const verdictConfig = useMemo(() => {
    switch (verdict) {
      case 'perfect':
      case 'good':
        return {
          icon: 'checkmark-circle' as const,
          color: '#34C759',
          label: verdict === 'perfect' ? 'Crystal clear' : 'Good to go',
          body: 'Your environment is quiet enough for accurate speech analysis.',
        };
      case 'bad':
        return {
          icon: 'warning' as const,
          color: '#FF3B30',
          label: 'Too noisy',
          body: 'We detected background noise. Your results may be less accurate.',
        };
    }
  }, [verdict]);

  const micStyle = useAnimatedStyle(() => ({
    transform: [{ scale: micPulse.value }],
  }));

  const isFail = verdict === 'bad';
  const isListening = status === 'listening';
  const circleBg =
    status === 'complete' ? verdictConfig.color + '18' : isDark ? '#161B24' : '#FFFFFF';
  const circleBorder =
    status === 'complete' ? verdictConfig.color + '35' : isDark ? '#252D3A' : '#E5EAED';

  return (
    <QuestionLayout
      title="Environment check"
      subtitle="We need a quiet space to accurately analyse your speech."
      progress={2 / 6} // Step 2 of 6
      onBack={() => { goBackToLanguage(); router.replace('/onboarding'); }}
      onNext={() => router.push('/onboarding/persona')}
      nextLabel={isFail ? 'Continue anyway' : 'Looks good'}
      nextDisabled={status !== 'complete'}
    >
      <View style={styles.centreArea}>
        <View style={styles.visualiserWrap}>
          {isListening && (
            <>
              <RippleRing delay={0} isListening={isListening} color={PRIMARY} />
              <RippleRing delay={700} isListening={isListening} color={PRIMARY} />
              <RippleRing delay={1400} isListening={isListening} color={PRIMARY} />
            </>
          )}
          <Animated.View
            style={[
              styles.circle,
              { backgroundColor: circleBg, borderColor: circleBorder },
              isListening && micStyle,
            ]}
          >
            {status === 'listening' && (
              <Ionicons name="mic" size={36} color={PRIMARY} />
            )}
            {status === 'calculating' && (
              <ActivityIndicator size="large" color={PRIMARY} />
            )}
            {status === 'complete' && (
              <Animated.View entering={FadeIn.duration(300)}>
                <Ionicons name={verdictConfig.icon} size={44} color={verdictConfig.color} />
              </Animated.View>
            )}
            {status === 'idle' && (
              <Ionicons name="mic-outline" size={36} color={subtle} />
            )}
          </Animated.View>
        </View>

        <View style={styles.textArea}>
          {status === 'listening' && (
            <Animated.View entering={FadeIn} style={styles.statusBlock}>
              <Text style={[styles.statusLabel, { color: PRIMARY }]}>Listening…</Text>
              <Text style={[styles.statusBody, { color: subtle }]}>Stay quiet for a moment</Text>
            </Animated.View>
          )}
          {status === 'calculating' && (
            <Animated.View entering={FadeIn} style={styles.statusBlock}>
              <Text style={[styles.statusLabel, { color: text }]}>Analysing…</Text>
            </Animated.View>
          )}
          {status === 'complete' && (
            <Animated.View entering={FadeInDown.springify()} style={styles.statusBlock}>
              <Text style={[styles.verdictLabel, { color: verdictConfig.color }]}>
                {verdictConfig.label}
              </Text>
              <Text style={[styles.verdictBody, { color: subtle }]}>{verdictConfig.body}</Text>
              <TouchableOpacity onPress={startCheck} style={styles.retryBtn}>
                <Ionicons name="refresh" size={14} color={subtle} />
                <Text style={[styles.retryText, { color: subtle }]}>Check again</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>
      </View>
    </QuestionLayout>
  );
}

const styles = StyleSheet.create({
  centreArea: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 40,
    minHeight: 360,
    justifyContent: 'center',
  },
  visualiserWrap: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  ripple: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1.5,
  },
  circle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  textArea: { alignItems: 'center', paddingHorizontal: 16, minHeight: 100 },
  statusBlock: { alignItems: 'center', gap: 8 },
  statusLabel: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  statusBody: { fontSize: 14, fontWeight: '400' },
  verdictLabel: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, marginBottom: 6 },
  verdictBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    fontWeight: '400',
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  retryText: { fontSize: 13, fontWeight: '500' },
});
