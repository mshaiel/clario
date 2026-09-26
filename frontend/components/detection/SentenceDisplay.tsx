/**
 * SentenceDisplay
 * Location: components/detection/SentenceDisplay.tsx
 *
 * Premium redesign:
 * - Floating card with accent left-stripe (PRIMARY or AI_ACCENT)
 * - TTS "Listen" button below sentence text
 * - "Tap any word to hear it" hint text
 * - Upgraded AITargetWrapper with purple background highlight
 * - FadeInDown entrance for targeting pill
 * - Larger targeting hint pill with flag icon
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/theme-provider';
import type { Sentence } from '@/lib/types';
import type { Language } from '@/lib/types';
import { ttsService } from '@/lib/ttsService';
import { useLanguage } from '@/context/LanguageContext';
import { containsUrduScript } from '@/lib/textDirection';
import { ClickableWord } from './ClickableWord';
import { WordPhonemeModal } from './WordPhonemeModal';
import { AI_ACCENT } from './AICoPilotToggle';

interface Props {
  sentence: Sentence;
  moduleUri?: string;
  wordAudioPaths?: Record<number, string>;
  /** Full-sentence audio path (for Listen button) */
  fullSentenceAudioPath?: string;
  aiTargetWordIndex?: number | null;
  ambientAI?: boolean;
  isResultPhase?: boolean;
  /** Pass the current app language so Urdu renders RTL */
  language?: Language;
}

// Wraps a target word with a glowing purple highlight (AI mode)
function AITargetWrapper({
  children,
  active,
}: {
  children: React.ReactNode;
  active: boolean;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (active) {
      progress.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 800 }),
          withTiming(0.4, { duration: 800 })
        ),
        -1,
        true
      );
    } else {
      progress.value = withTiming(0);
    }
  }, [active]);

  const style = useAnimatedStyle(() => ({
    backgroundColor: active
      ? interpolateColor(progress.value, [0, 1], ['transparent', AI_ACCENT + '28'])
      : 'transparent',
    borderRadius: 8,
    paddingHorizontal: active ? 2 : 0,
  }));

  return (
    <Animated.View style={style}>
      {children}
    </Animated.View>
  );
}

export function SentenceDisplay({
  sentence,
  moduleUri,
  wordAudioPaths,
  fullSentenceAudioPath,
  aiTargetWordIndex,
  ambientAI,
  isResultPhase = false,
  language: languageProp,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const { language: contextLanguage } = useLanguage();
  const language = languageProp ?? contextLanguage;
  const isRTL = containsUrduScript(sentence.text);
  const [showWordModal, setShowWordModal] = useState(false);
  const [selectedWord, setSelectedWord] = useState('');
  const [selectedPhonemes, setSelectedPhonemes] = useState<string[]>([]);
  const [selectedWordAudioPath, setSelectedWordAudioPath] = useState<string | undefined>();
  const [isPlayingFull, setIsPlayingFull] = useState(false);

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const accentColor = ambientAI ? AI_ACCENT : PRIMARY;

  const listenOpacity = useSharedValue(1);
  const listenStyle = useAnimatedStyle(() => ({ opacity: listenOpacity.value }));

  const rawWords = sentence.text.split(' ');

  const getWordPhonemes = (word: string): string[] => {
    if (!word) return [];
    const clean = word.replace(/[^\w\u0600-\u06FF]/g, '').toLowerCase();
    if (sentence.targets && sentence.targets.length > 0) {
      const match = sentence.targets.find(
        (t: { word: string; expected_ipa: string[] }) =>
          t.word.replace(/[^\w\u0600-\u06FF]/g, '').toLowerCase() === clean
      );
      if (match) return match.expected_ipa;
    }
    return [];
  };

  const handleWordClick = (word: string, phonemes: string[], audioPath?: string) => {
    setSelectedWord(word);
    setSelectedPhonemes(phonemes);
    setSelectedWordAudioPath(audioPath);
    setShowWordModal(true);
  };

  const handleListenPress = async () => {
    listenOpacity.value = withSequence(
      withTiming(0.6, { duration: 80 }),
      withTiming(1, { duration: 160 }),
    );
    if (isPlayingFull) {
      ttsService.stopPlayback();
      return;
    }
    try {
      setIsPlayingFull(true);
      if (fullSentenceAudioPath && moduleUri) {
        try {
          await ttsService.playLocalFile(`${moduleUri}${fullSentenceAudioPath}`);
        } catch {
          await ttsService.synthesizeAndPlay(sentence.text, language);
        }
      } else {
        await ttsService.synthesizeAndPlay(sentence.text, language);
      }
    } catch (e) {
      console.warn('[SentenceDisplay] Listen failed:', e);
    } finally {
      setIsPlayingFull(false);
    }
  };

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.sentenceCard,
          {
            backgroundColor: ambientAI
              ? isDark ? '#13112A' : '#FFFFFF'
              : isDark ? '#161B24' : '#FFFFFF',
            borderColor: ambientAI ? AI_ACCENT + '40' : isDark ? '#252D3A' : '#D1D8E2',
            shadowColor: ambientAI ? AI_ACCENT : '#000',
            shadowOpacity: ambientAI ? 0.1 : 0.07,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 24,
            elevation: 6,
          },
        ]}
      >
        {/* Left accent stripe */}
        <View style={[styles.accentStripe, { backgroundColor: accentColor }]} />

        <View style={styles.cardInner}>
          {/* Clickable words — same chip layout for both LTR and RTL.
              RTL uses flexDirection:'row-reverse' + justifyContent:'center'
              so chips wrap and center just like English but flow right-to-left. */}
          <View style={[styles.wordsRow, isRTL && styles.wordsRowRTL]}>
            {rawWords.map((word, idx) => {
              const isTarget = idx === aiTargetWordIndex;
              const audioPath = wordAudioPaths?.[idx];
              const wordPhonemes = getWordPhonemes(word);

              return (
                <AITargetWrapper key={idx} active={!!isTarget}>
                  <ClickableWord
                    word={word}
                    audioPath={audioPath}
                    moduleUri={moduleUri}
                    isAIMode={ambientAI}
                    isRTL={isRTL}
                    onPress={() => handleWordClick(word, wordPhonemes, audioPath)}
                  />
                </AITargetWrapper>
              );
            })}
          </View>

          {/* Romanized transliteration — Urdu only */}
          {isRTL && !!sentence.romanized && (
            <View style={styles.romanizedRow}>
              <View style={[styles.romanizedDivider, { backgroundColor: accentColor + '30' }]} />
              <View style={styles.romanizedInner}>
                <Ionicons
                  name="text-outline"
                  size={11}
                  color={accentColor}
                  style={{ opacity: 0.7 }}
                />
                <Text
                  style={[
                    styles.romanized,
                    { color: isDark ? '#A89FC8' : '#7B6FA0' },
                  ]}
                >
                  {sentence.romanized}
                </Text>
              </View>
              <View style={[styles.romanizedDivider, { backgroundColor: accentColor + '30' }]} />
            </View>
          )}

          {/* Listen button — fixed dimensions so state changes never cause layout reflow */}
          <Animated.View style={listenStyle}>
            <TouchableOpacity
              style={[
                styles.listenBtn,
                {
                  backgroundColor: accentColor + '12',
                  borderColor: accentColor + '30',
                },
              ]}
              onPress={handleListenPress}
              activeOpacity={0.75}
            >
              {/* Always render both; only one is visible — prevents width/height shifts */}
              <ActivityIndicator
                size="small"
                color={accentColor}
                style={{ opacity: isPlayingFull ? 1 : 0, position: 'absolute', left: 16 }}
              />
              <Ionicons
                name="volume-medium-outline"
                size={16}
                color={accentColor}
                style={{ opacity: isPlayingFull ? 0 : 1 }}
              />
              <Text style={[styles.listenText, { color: accentColor }]}>
                Listen to sentence
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>

      <WordPhonemeModal
        visible={showWordModal}
        word={selectedWord}
        phonemes={selectedPhonemes}
        audioPath={selectedWordAudioPath}
        moduleUri={moduleUri}
        onClose={() => setShowWordModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  sentenceCard: {
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 14,
    flexDirection: 'row',
    overflow: 'hidden',
    minHeight: 160,
  },
  accentStripe: {
    width: 4,
    flexShrink: 0,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
  },
  cardInner: {
    flex: 1,
    padding: 24,
    paddingLeft: 20,
    gap: 0,
  },
  wordsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    rowGap: 12,
    marginBottom: 20,
  },
  wordsRowRTL: {
    flexDirection: 'row-reverse',
  },
  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    alignSelf: 'center',
    minWidth: 190,
  },
  listenText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  romanizedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  romanizedDivider: {
    flex: 1,
    height: 1,
    borderRadius: 1,
  },
  romanizedInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  romanized: {
    fontSize: 13,
    fontStyle: 'italic',
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
});
