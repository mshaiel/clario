/**
 * SoundTile â€” Phase B Section 1
 * Location: components/onboarding/SoundTile.tsx
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  interpolateColor,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { useAppTheme } from '@/theme-provider';
import { PhonemeOption } from '@/lib/onboardingData';
import { ttsService } from '@/lib/ttsService';
import { haptics } from '@/lib/haptics';
import { Language } from '@/lib/types';

interface Props {
  option: PhonemeOption;
  selected: boolean;
  language: Language;
  onToggle: (ipa: string) => void;
}

export const SoundTile = React.memo(function SoundTile({
  option, selected, language, onToggle,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#5E7487' : '#9AABB8';

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasHeard, setHasHeard]   = useState(false);

  useEffect(() => {
    return () => {
      ttsService.stopPlayback();
    };
  }, []);

  const scale    = useSharedValue(1);
  const progress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, { duration: 180 });
    if (selected) {
      scale.value = withSequence(withTiming(0.94, { duration: 80 }), withSpring(1, { damping: 12 }));
    }
  }, [selected]);

  const tileStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: interpolateColor(progress.value, [0, 1],
      [isDark ? '#1E2938' : '#DDE5EA', PRIMARY]),
    backgroundColor: interpolateColor(progress.value, [0, 1],
      [isDark ? '#111720' : '#FAFCFD', isDark ? '#0E1C26' : '#EBF8F9']),
  }));

  const handlePlay = async () => {
    if (isPlaying) return;
    haptics.selection();
    const word = language === 'urdu' 
      ? (option.ttsWord?.urdu ?? option.exampleWords.urdu) 
      : (option.ttsWord?.english ?? option.exampleWords.english);
    try {
      setIsPlaying(true);
      await ttsService.synthesizeAndPlay(word, language);
    } catch (_) {}
    finally {
      setIsPlaying(false);
      setHasHeard(true);
    }
  };

  const handleTilePress = () => {
    haptics.selection();
    onToggle(option.ipa);
  };

  const exampleWords = language === 'urdu' ? option.exampleWords.urdu : option.exampleWords.english;

  return (
    <Animated.View style={[styles.tile, tileStyle]}>
      <TouchableOpacity onPress={handleTilePress} activeOpacity={0.85} style={styles.inner}>

        {/* Letter label */}
        <Text style={[styles.label, { color: selected ? PRIMARY : text }]}>
          {option.displayLabel}
        </Text>

        {/* Example word(s) */}
        <Text style={[styles.example, { color: subtle }]} numberOfLines={2}>
          {exampleWords}
        </Text>

        {/* State indicator: speaker / replay / playing */}
        <TouchableOpacity
          onPress={handlePlay}
          disabled={isPlaying}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.speakerBtn, {
            backgroundColor: isPlaying
              ? PRIMARY + '20'
              : selected
              ? PRIMARY + '15'
              : isDark ? '#1A2430' : '#EEF3F6',
          }]}
        >
          <Ionicons
            name={isPlaying ? 'volume-high' : hasHeard ? 'reload' : 'volume-medium-outline'}
            size={13}
            color={isPlaying || selected ? PRIMARY : subtle}
          />
        </TouchableOpacity>

        {/* Selected checkmark badge */}
        {selected && (
          <Animated.View
            entering={FadeIn.duration(130)}
            style={[styles.checkBadge, { backgroundColor: PRIMARY }]}
          >
            <Ionicons name="checkmark" size={10} color="#FFF" />
          </Animated.View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  tile: {
    width: '47%',
    borderRadius: 16,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 6,
  },
  label: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  example: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 15,
  },
  speakerBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
