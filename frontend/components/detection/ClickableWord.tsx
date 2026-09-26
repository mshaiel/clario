/**
 * ClickableWord
 * Location: components/detection/ClickableWord.tsx
 *
 * Premium redesign:
 * - No more border-chip style — words look like natural flowing text
 * - Reanimated tap feedback: scale spring + background flash
 * - "Playing" indicator: small speaker icon animates while audio plays
 * - isAIMode prop: flash uses AI_ACCENT tint instead of PRIMARY
 */

import React, { useState } from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';
import { ttsService } from '@/lib/ttsService';
import { useLanguage } from '@/context/LanguageContext';
import { AI_ACCENT } from './AICoPilotToggle';

interface Props {
  word: string;
  audioPath?: string;
  moduleUri?: string;
  isHighlighted?: boolean;
  color?: string;
  onPress?: () => void;
  scale?: number;
  isAIMode?: boolean;
  isRTL?: boolean;
}

export function ClickableWord({
  word,
  audioPath,
  moduleUri,
  isHighlighted,
  color,
  onPress,
  scale = 1.0,
  isAIMode = false,
  isRTL = false,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const { language } = useLanguage();
  const PRIMARY = resolvedTheme.colors.primary;
  const tapColor = isAIMode ? AI_ACCENT : PRIMARY;

  const [isPlaying, setIsPlaying] = useState(false);

  const scaleAnim = useSharedValue(1);
  const bgOpacity = useSharedValue(0);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: isAIMode
      ? `rgba(124,111,255,${bgOpacity.value})`
      : `rgba(31,183,188,${bgOpacity.value})`,
    borderBottomColor: isAIMode ? 'rgba(124,111,255,0.30)' : 'rgba(31,183,188,0.30)',
  }));

  const handlePress = async () => {
    // Subtle background flash only — no scale/bounce to keep layout stable
    bgOpacity.value = withSequence(
      withTiming(0.2, { duration: 70 }),
      withTiming(0, { duration: 300 }),
    );

    if (onPress) {
      onPress();
      return;
    }

    if (audioPath && moduleUri) {
      try {
        setIsPlaying(true);
        await ttsService.playLocalFile(`${moduleUri}${audioPath}`);
      } catch {
        // Local word audio missing from zip — fall back to on-demand TTS
        try {
          await ttsService.synthesizeAndPlay(word, language);
        } catch (e2) {
          console.warn('[ClickableWord] TTS fallback failed:', e2);
        }
      } finally {
        setIsPlaying(false);
      }
    } else if (!audioPath) {
      // No audio path at all — synthesize directly
      try {
        setIsPlaying(true);
        await ttsService.synthesizeAndPlay(word, language);
      } catch (e) {
        console.warn('[ClickableWord] TTS synthesis failed:', e);
      } finally {
        setIsPlaying(false);
      }
    }
  };

  const baseFontSize = 22 * scale;
  const textColor = color ?? resolvedTheme.colors.text;

  return (
    <Pressable onPress={handlePress}>
      {/* row-reverse for RTL so text flows correctly */}
      <Animated.View style={[styles.container, isRTL && styles.containerRTL, containerStyle]}>
        <Text
          style={[
            styles.word,
            {
              fontSize: baseFontSize,
              lineHeight: baseFontSize * 1.4,
              color: isHighlighted ? tapColor : textColor,
              fontWeight: isHighlighted ? '700' : '500',
              // Arabic/Urdu is a connected script — letter-spacing breaks glyph joins
              letterSpacing: isRTL ? 0 : 0.2,
              writingDirection: isRTL ? 'rtl' : 'ltr',
            },
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 3,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
    borderStyle: 'dashed',
  },
  containerRTL: {
    flexDirection: 'row-reverse',
  },
  word: {
    letterSpacing: 0.2,
  },
});