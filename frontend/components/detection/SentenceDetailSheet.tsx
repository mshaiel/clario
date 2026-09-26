/**
 * SentenceDetailSheet
 * Location: components/detection/SentenceDetailSheet.tsx
 *
 * A sleek, rounded bottom sheet that displays the full active sentence.
 * Allows playing the full sentence audio, or tapping individual words to play their specific TTS.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ttsService } from '@/lib/ttsService';
import type { Sentence } from '@/lib/types';
import { haptics } from '@/lib/haptics';
import { containsUrduScript } from '@/lib/textDirection';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  sentence: Sentence | null;
  moduleUri: string;
  language: any;
  sentenceAudioPath?: string;
  wordAudioMap: Record<string, string>;
  onClose: () => void;
  isDark: boolean;
  accentColor: string;
  text: string;
  subtle: string;
  surface: string;
  border: string;
}

export function SentenceDetailSheet({
  visible,
  sentence,
  moduleUri,
  language,
  sentenceAudioPath,
  wordAudioMap,
  onClose,
  isDark,
  accentColor,
  text,
  subtle,
  surface,
  border,
}: Props) {
  const insets = useSafeAreaInsets();
  
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  const [activeWordData, setActiveWordData] = useState<{text: string, index: number} | null>(null);
  const [isPlayingSentence, setIsPlayingSentence] = useState(false);
  const [isPlayingWord, setIsPlayingWord] = useState(false);
  const isRTL = containsUrduScript(sentence?.text);

  useEffect(() => {
    if (visible) {
      setActiveWordData(null);
      setIsPlayingSentence(false);
      setIsPlayingWord(false);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 12,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      ttsService.stopPlayback();
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  // Hook into global TTS state to reset play buttons if stopped externally
  useEffect(() => {
    const unsub = ttsService.onPlaybackChange((playing) => {
      if (!playing) {
        setIsPlayingSentence(false);
        setIsPlayingWord(false);
      }
    });
    return unsub;
  }, []);

  if (!visible && slideAnim.setOffset === undefined) return null; // Avoid render if completely hidden

  const handlePlaySentence = async () => {
    if (!sentence) return;
    haptics.selection();
    setIsPlayingSentence(true);
    setIsPlayingWord(false);
    setActiveWordData(null);
    ttsService.stopPlayback();

    try {
      if (sentenceAudioPath) {
        await ttsService.playLocalFile(`${moduleUri}${sentenceAudioPath}`);
      } else {
        await ttsService.synthesizeAndPlay(sentence.text, language);
      }
    } catch (e) {
      console.log('Failed to play sentence audio', e);
    }
    setIsPlayingSentence(false);
  };

  const handleWordPress = async (word: string, index: number) => {
    const cleanW = word.replace(/[.,/#!$%^&*;:{}=\-_`~()?!"']/g, '');
    if (!cleanW || !sentence) return;
    haptics.selection();
    setActiveWordData({ text: cleanW, index });
    setIsPlayingSentence(false);
    setIsPlayingWord(true);
    ttsService.stopPlayback();

    try {
      const localAudioPath = wordAudioMap[`${sentence.sentence_id}:${index}`];
      if (localAudioPath) {
        await ttsService.playLocalFile(`${moduleUri}${localAudioPath}`);
      } else {
        await ttsService.synthesizeAndPlay(cleanW, language);
      }
    } catch (e) {
      console.log('Failed to play word audio', e);
    }
    setIsPlayingWord(false);
  };

  const bg = isDark ? '#11151A' : '#FFFFFF';

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible={visible}>
      {/* Backdrop */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0,0,0,0.6)', opacity: backdropAnim },
          ]}
        />
      </Pressable>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: bg,
            borderColor: border,
            transform: [{ translateY: slideAnim }],
            paddingBottom: Math.max(insets.bottom + 16, 24),
          },
        ]}
      >
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: isDark ? '#2A3441' : '#D1D8E2' }]} />
        </View>

        {sentence && (
          <View style={styles.content}>
            <Text style={[styles.title, { color: subtle }]}>Sentence Audio</Text>
            
            {/* The Sentence (rendered as chips) */}
            <View style={[styles.sentenceChipsBox, isRTL && styles.sentenceChipsBoxRTL]}>
              {sentence.text.split(' ').map((rawWord, idx) => {
                const cleanW = rawWord.replace(/[.,/#!$%^&*;:{}=\-_`~()?!"']/g, '');
                const isActive = activeWordData?.index === idx;
                
                return (
                  <TouchableOpacity
                    key={idx}
                    activeOpacity={0.7}
                    onPress={() => handleWordPress(rawWord, idx)}
                    style={[
                      styles.wordChip,
                      { backgroundColor: isDark ? '#212936' : '#F1F5F9' },
                      isRTL && styles.wordChipRTL,
                      isActive && {
                        backgroundColor: accentColor,
                        shadowColor: accentColor,
                        shadowOpacity: 0.3,
                        shadowRadius: 8,
                        shadowOffset: { width: 0, height: 4 },
                        elevation: 6,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.wordChipText,
                        { color: isDark ? '#E2E8F0' : '#334155' },
                        isRTL && styles.wordChipTextRTL,
                        isActive && { color: '#FFFFFF', fontWeight: '700' },
                      ]}
                    >
                      {rawWord}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Play Sentence Button */}
            <TouchableOpacity
              style={[
                styles.playBtn,
                { backgroundColor: isPlayingSentence ? accentColor + '20' : surface, borderColor: border },
              ]}
              onPress={handlePlaySentence}
              activeOpacity={0.7}
            >
              <View style={[styles.iconCirc, { backgroundColor: accentColor + '15' }]}>
                <Ionicons name="volume-high" size={20} color={accentColor} />
              </View>
              <Text style={[styles.playBtnText, { color: text }]}>
                {isPlayingSentence ? 'Playing...' : 'Play full sentence'}
              </Text>
            </TouchableOpacity>

            {/* Active Word Info (if selected) */}
            {activeWordData && (
              <View style={[styles.wordInfoCard, { backgroundColor: surface, borderColor: border }]}>
                <View style={styles.wordInfoLeft}>
                  <Text style={[styles.wordInfoLabel, { color: subtle }]}>Selected Word</Text>
                  <Text style={[styles.wordInfoText, { color: text }]}>{activeWordData.text}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.playWordBtn, { backgroundColor: accentColor + '15' }]}
                  onPress={() => handleWordPress(activeWordData.text, activeWordData.index)}
                >
                  <Ionicons name="volume-medium" size={18} color={accentColor} />
                  <Text style={[styles.playWordText, { color: accentColor }]}>Play</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    elevation: 20,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 16,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
  },
  content: {
    paddingBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  sentenceChipsBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 32,
  },
  sentenceChipsBoxRTL: { flexDirection: 'row-reverse' },
  wordChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  wordChipRTL: { alignItems: 'flex-end' },
  wordChipText: {
    fontSize: 19,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  wordChipTextRTL: {
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
    marginBottom: 16,
  },
  iconCirc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  wordInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  wordInfoLeft: {
    gap: 4,
  },
  wordInfoLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  wordInfoText: {
    fontSize: 20,
    fontWeight: '600',
  },
  playWordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  playWordText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
