/**
 * SoundCard — Phase A full-screen card component
 * Location: components/onboarding/SoundCard.tsx
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';

const { width: screenWidth } = Dimensions.get('window');
export const CARD_WIDTH  = screenWidth - 48;
export const CARD_HEIGHT = 480;
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';
import { ClinicalSubtype } from '@/lib/onboardingData';
import { ttsService } from '@/lib/ttsService';
import { haptics } from '@/lib/haptics';
import { Language } from '@/lib/types';

// Minimal waveform — 3 bars, clean
function WaveformIcon({ color }: { color: string }) {
  return (
    <View style={waveStyles.row}>
      {[10, 18, 13, 20, 10].map((h, i) => (
        <View
          key={i}
          style={[waveStyles.bar, { backgroundColor: color, height: h }]}
        />
      ))}
    </View>
  );
}
const waveStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22 },
  bar: { width: 3, borderRadius: 2, opacity: 0.9 },
});

interface Props {
  subtype: ClinicalSubtype;
  language: Language;
}

export const SoundCard = React.memo(function SoundCard({
  subtype, language,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#8D9FAE';
  const cardBg  = isDark ? '#1A2030' : '#FAFBFF';

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);

  React.useEffect(() => {
    return () => {
      ttsService.stopPlayback();
    };
  }, []);

  const example = subtype.examples[language];

  const playScale = useSharedValue(1);
  const playStyle = useAnimatedStyle(() => ({ transform: [{ scale: playScale.value }] }));

  const handlePlay = async () => {
    if (isPlaying) return;
    haptics.selection();
    playScale.value = withSequence(withTiming(0.93, { duration: 90 }), withSpring(1, { damping: 10 }));
    try {
      setIsPlaying(true);
      await ttsService.synthesizeAndPlay(subtype.ttsPrompt[language], language, 'f');
    } catch (_) {}
    finally {
      setIsPlaying(false);
      setHasPlayed(true);
    }
  };

  const playLabel = isPlaying ? 'Playing…' : hasPlayed ? 'Hear again' : 'Tap for explanation';

  return (
    <View style={[styles.root, {
      backgroundColor: cardBg,
      borderColor: isDark ? '#2A3B5A' : '#DDE8F4',
    }]}>

      {/* ── Clinical name badge ── */}
      <View style={[styles.nameBadge, { backgroundColor: isDark ? '#222E40' : '#EDF3F8', borderColor: isDark ? '#2A3B50' : '#C8DAEA' }]}>
        <Text style={[styles.nameBadgeText, { color: PRIMARY }]}>{subtype.clinicalName}</Text>
      </View>

      {/* ── Framing label ── */}
      <Text style={[styles.framing, { color: subtle }]}>DO YOU EVER DO THIS?</Text>

      {/* ── Example label ── */}
      <Animated.Text
        entering={FadeInDown.delay(60).duration(320)}
        style={[styles.exampleLabel, { color: text }]}
      >
        {example.label}
      </Animated.Text>

      {/* ── Divider ── */}
      <View style={[styles.divider, { backgroundColor: isDark ? '#1E2530' : '#EDF1F4' }]} />

      {/* ── Description ── */}
      <Text style={[styles.descText, { color: subtle }]}>
        {language === 'urdu' ? subtype.phaseADescriptionUrdu : subtype.phaseADescription}
      </Text>

      <View style={styles.spacer} />

      {/* ── Explanation audio button ── */}
      <Animated.View entering={FadeInDown.delay(180).duration(360)} style={styles.audioWrap}>
        <Animated.View style={playStyle}>
          <TouchableOpacity
            onPress={handlePlay}
            disabled={isPlaying}
            activeOpacity={0.8}
            style={[styles.playBtn, {
              backgroundColor: isPlaying ? PRIMARY + '18' : isDark ? '#1A2333' : '#F0F7FF',
              borderColor: isPlaying ? PRIMARY + '50' : isDark ? '#25354D' : '#D0E4FC',
            }]}
          >
            <View style={[styles.playIconWrap, { backgroundColor: PRIMARY + (isPlaying ? '40' : '20') }]}>
              {isPlaying
                ? <WaveformIcon color={PRIMARY} />
                : <Ionicons name="volume-medium" size={20} color={PRIMARY} />
              }
            </View>
            <Text style={[styles.playLabel, { color: isPlaying ? PRIMARY : subtle }]}>
              {playLabel}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>

      {/* ── Swipe hints ── */}
      <View style={styles.swipeHintRow}>
        <View style={styles.swipeHintLeft}>
          <Ionicons name="arrow-back-outline" size={15} color="#FF453A" />
          <Text style={[styles.swipeHintText, { color: '#FF453A' }]}>Skip</Text>
        </View>
        <View style={[styles.swipeHintDot, { backgroundColor: isDark ? '#2A3444' : '#D8E4EC' }]} />
        <View style={styles.swipeHintRight}>
          <Text style={[styles.swipeHintText, { color: '#2CC775' }]}>Yes</Text>
          <Ionicons name="arrow-forward-outline" size={15} color="#2CC775" />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 28,
    borderWidth: 1.5,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 32,
    elevation: 12,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 28,
    alignItems: 'center',
  },

  nameBadge: {
    flexDirection: 'row',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  nameBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  framing: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 20,
  },
  exampleLabel: {
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -1.2,
    textAlign: 'center',
    lineHeight: 50,
    marginBottom: 18,
  },
  divider: {
    width: 40,
    height: 1.5,
    borderRadius: 1,
    marginBottom: 16,
  },
  descText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '400',
    textAlign: 'center',
  },
  spacer: { flex: 1 },

  audioWrap: { alignItems: 'center', marginBottom: 20 },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 40,
    borderWidth: 1.5,
  },
  playIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playLabel: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  swipeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
  },
  swipeHintLeft:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swipeHintRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swipeHintText:  { fontSize: 13, fontWeight: '600' },
  swipeHintDot:   { width: 4, height: 4, borderRadius: 2 },
});
