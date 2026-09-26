import { BrandWaveform } from '@/components/ui/BrandWaveform';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme-provider';

export default function LoadingScreen() {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#0C0F14' : '#F8FAFB';
  const text    = resolvedTheme.colors.text;

  // Subtle fade-in on mount
  const fadeAnim = useRef(new Animated.Value(0)).current;
  // Waveform pulse — breathes in and out
  const pulseAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>

        {/* Logo mark — identical to auth screens */}
        <View style={styles.logoWrap}>
          <View style={[styles.pillL, { backgroundColor: PRIMARY }]} />
          <View style={[styles.pillR, { backgroundColor: PRIMARY, opacity: 0.38 }]} />
        </View>

        {/* Wordmark */}
        <Text style={[styles.wordmark, { color: text }]}>Clario</Text>

        {/* Waveform — breathing pulse animation */}
        <BrandWaveform size="lg" animated />

      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    alignItems: 'center',
    gap: 16,
  },
  logoWrap: {
    width: 48,
    height: 28,
    position: 'relative',
    marginBottom: 4,
  },
  pillL: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 32,
    height: 28,
    borderRadius: 14,
  },
  pillR: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 32,
    height: 28,
    borderRadius: 14,
  },
  wordmark: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -1.5,
  },

});
