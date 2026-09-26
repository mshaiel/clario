/**
 * Word Phoneme Modal
 * Location: components/detection/WordPhonemeModal.tsx
 *
 * Premium redesign:
 * - Bottom sheet style (slides up from bottom)
 * - Drag handle bar at top
 * - Word in 36px bold, phonemes as individual rounded pill chips
 * - Full-width "Listen" button
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { tts } from '@/lib/ttsAdapter';
import { useAppTheme } from '@/theme-provider';
import { useLanguage } from '../../context/LanguageContext';

interface Props {
  visible: boolean;
  word: string;
  phonemes: string[];
  audioPath?: string;
  moduleUri?: string;
  onClose: () => void;
}

export function WordPhonemeModal({ visible, word, phonemes, audioPath, moduleUri, onClose }: Props) {
  const { resolvedTheme } = useAppTheme();
  const { language } = useLanguage();

  const [isPlaying, setIsPlaying] = useState(false);

  const handlePracticePlay = async () => {
    if (isPlaying) {
      tts.stopPlayback();
      return;
    }
    try {
      setIsPlaying(true);
      if (audioPath && moduleUri) {
        await tts.playLocalFile(`${moduleUri}${audioPath}`);
      } else {
        await tts.playWord(word, language);
      }
    } catch (e) {
      console.warn('[WordModal] Playback failed', e);
    } finally {
      setIsPlaying(false);
    }
  };

  const isDark = resolvedTheme.dark;
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const border = isDark ? '#252D3A' : '#EAECEF';
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#7A8FA3' : '#8D9FAE';
  const PRIMARY = resolvedTheme.colors.primary;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Tap outside to close */}
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      />

      <View style={[styles.sheet, { backgroundColor: surface, borderColor: border }]}>
        {/* Drag handle */}
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: isDark ? '#2E3A4A' : '#D1D9E0' }]} />
        </View>

        {/* Word */}
        <Text style={[styles.wordText, { color: text }]}>{word}</Text>

        {/* Phoneme pills */}
        {phonemes.length > 0 && (
          <View style={styles.phonemeRow}>
            {phonemes.map((ph, i) => (
              <View key={i} style={[styles.phonemePill, { backgroundColor: PRIMARY + '14', borderColor: PRIMARY + '35' }]}>
                <Text style={[styles.phonemeText, { color: PRIMARY }]}>/{ph}/</Text>
              </View>
            ))}
          </View>
        )}

        {phonemes.length === 0 && (
          <Text style={[styles.noPhonemes, { color: subtle }]}>Tap listen to hear this word</Text>
        )}

        {/* Listen button */}
        <TouchableOpacity
          style={[styles.listenBtn, { backgroundColor: PRIMARY }]}
          onPress={handlePracticePlay}
          disabled={isPlaying}
          activeOpacity={0.82}
        >
          {isPlaying ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Ionicons name="volume-medium" size={20} color="#FFF" />
          )}
          <Text style={styles.listenBtnText}>
            {isPlaying ? 'Playing…' : 'Listen to Pronunciation'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onClose} style={styles.doneBtn}>
          <Text style={[styles.doneBtnText, { color: subtle }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 16,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  wordText: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  phonemeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  phonemePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  phonemeText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.5,
    fontStyle: 'italic',
  },
  noPhonemes: {
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 28,
  },
  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 17,
    borderRadius: 18,
    shadowColor: '#1FB7BC',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  listenBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  doneBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 6,
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});