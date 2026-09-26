import { tts } from '@/lib/ttsAdapter';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { haptics } from '@/lib/haptics';

interface DetectedWord {
  word: string;
  correctness: number;
  phonemeErrors?: string[];
  errorType?: string;
  wordIndex?: number;
}

interface Props {
  visible: boolean;
  word: DetectedWord;
  sentenceId: string;
  onClose: () => void;
  // New props for validation
  wordIndex: number; 
  onMarkRealError: () => void;   // Tick (Confirm)
  onMarkSystemError: () => void; // Cross (Discard False Positive)
}

export function PhonemeErrorModal({
  visible,
  word,
  sentenceId,
  onClose,
  wordIndex,
  onMarkRealError,
  onMarkSystemError,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);

  useEffect(() => {
    if (!visible) setIsPlayingTTS(false);
  }, [visible]);

  const handlePlayWord = async () => {
    try {
      setIsPlayingTTS(true);
      // TODO: swap tts.playWord for a direct backend call
      // when the pronunciation API is ready — change only lib/ttsAdapter.ts
      await tts.playWord(word.word);
    } catch (error) {
      Alert.alert('Playback Error', 'Could not play audio');
    } finally {
      setIsPlayingTTS(false);
    }
  };

  const isDark = resolvedTheme.dark;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.screenWrap}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[styles.modal, { backgroundColor: resolvedTheme.colors.card, borderColor: isDark ? '#252D3A' : '#EAECEF' }]}>

        {/* Drag handle */}
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: isDark ? '#2E3A4A' : '#D1D9E0' }]} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: resolvedTheme.colors.text }]}>Word Analysis</Text>
          <TouchableOpacity onPress={onClose} style={[styles.closeButton, { backgroundColor: isDark ? '#1E2530' : '#F1F4F6' }]}>
            <Ionicons name="close" size={18} color={resolvedTheme.colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Word Title */}
          <View style={styles.wordSection}>
            <Text style={[styles.wordText, { color: resolvedTheme.colors.primary }]}>
              {word.word}
            </Text>
          </View>

          {/* DETAILED ERROR LIST */}
          <View style={styles.errorsSection}>
            <Text style={[styles.sectionLabel, { color: resolvedTheme.colors.text }]}>Detected Issues</Text>

            {word.phonemeErrors && word.phonemeErrors.length > 0 ? (
              word.phonemeErrors.map((errorMsg, index) => (
                <View
                  key={index}
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: isDark ? '#2D1B1B' : '#FFEBEE',
                      borderColor: isDark ? '#5C2626' : '#FFCDD2',
                    },
                  ]}
                >
                  <Ionicons name="alert-circle" size={18} color="#EF4444" />
                  <Text style={[styles.errorText, { color: isDark ? '#FF8A80' : '#C62828' }]}>{errorMsg}</Text>
                </View>
              ))
            ) : (
              <Text style={{ color: resolvedTheme.colors.text, opacity: 0.5, fontSize: 14 }}>
                No specific errors detected.
              </Text>
            )}
          </View>

          {/* TTS Button */}
          <TouchableOpacity
            style={[styles.ttsButton, { backgroundColor: resolvedTheme.colors.primary + '16', borderColor: resolvedTheme.colors.primary + '30' }]}
            onPress={handlePlayWord}
            disabled={isPlayingTTS}
          >
            <Ionicons name={isPlayingTTS ? 'volume-high' : 'volume-medium-outline'} size={18} color={resolvedTheme.colors.primary} />
            <Text style={[styles.ttsButtonText, { color: resolvedTheme.colors.primary }]}>
              Hear Correct Pronunciation
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Validation Footer */}
        <View style={[styles.footer, { borderTopColor: isDark ? '#252D3A' : '#EAECEF' }]}>
          <Text style={[styles.footerLabel, { color: isDark ? '#7A8FA3' : '#8D9FAE' }]}>
            Was this actually an error?
          </Text>
          <View style={styles.actionButtons}>
            {/* Discard — outlined */}
            <TouchableOpacity
              style={[styles.actionBtn, styles.discardBtn, { borderColor: isDark ? '#2E3A4A' : '#D1D9E0', backgroundColor: isDark ? '#1A2030' : '#F4F6F8' }]}
              onPress={() => { haptics.light(); onMarkSystemError(); }}
            >
              <Ionicons name="close" size={20} color={isDark ? '#7A8FA3' : '#8D9FAE'} />
              <Text style={[styles.discardText, { color: isDark ? '#7A8FA3' : '#6B7280' }]}>Not an error</Text>
            </TouchableOpacity>

            {/* Confirm — solid green */}
            <TouchableOpacity
              style={[styles.actionBtn, styles.confirmBtn]}
              onPress={() => { haptics.medium(); onMarkRealError(); }}
            >
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={styles.confirmText}>Confirm Error</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screenWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modal: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 16,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 20, paddingBottom: 8 },

  wordSection: { alignItems: 'center', marginBottom: 20 },
  wordText: { fontSize: 38, fontWeight: '800', letterSpacing: -1 },

  errorsSection: { marginBottom: 20 },
  sectionLabel: { fontSize: 13, fontWeight: '700', marginBottom: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 10,
    borderWidth: 1,
  },
  errorText: { fontSize: 14, flex: 1, fontWeight: '500', lineHeight: 20 },

  ttsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  ttsButtonText: { fontSize: 14, fontWeight: '600' },

  footer: { padding: 20, borderTopWidth: 1, alignItems: 'center' },
  footerLabel: { fontSize: 13, marginBottom: 14, fontWeight: '500' },
  actionButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  discardBtn: { borderWidth: 1 },
  discardText: { fontWeight: '600', fontSize: 13 },
  confirmBtn: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  confirmText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});