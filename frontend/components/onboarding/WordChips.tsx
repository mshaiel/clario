/**
 * WordChips — Phase B Section 2
 * Location: components/onboarding/WordChips.tsx
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';
import { haptics } from '@/lib/haptics';
import { Language } from '@/lib/types';

interface Props {
  seedWords: string[];
  selectedWords: string[];
  onAdd: (word: string) => void;
  onRemove: (word: string) => void;
  language: Language;
  subtypeType: 'fluency' | 'phonology';
}

export const WordChips = React.memo(function WordChips({
  seedWords, selectedWords, onAdd, onRemove, language, subtypeType,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#5E7487' : '#9AABB8';
  const inputBg = isDark ? '#131820' : '#FFFFFF';
  const border  = isDark ? '#1E2938' : '#DDE5EA';

  const [inputValue, setInputValue] = useState('');
  const shakeOffset = useSharedValue(0);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeOffset.value }],
  }));

  const triggerShake = () => {
    shakeOffset.value = withSequence(
      withTiming(-7, { duration: 55 }),
      withTiming(7,  { duration: 55 }),
      withTiming(-4, { duration: 45 }),
      withTiming(4,  { duration: 45 }),
      withTiming(0,  { duration: 35 }),
    );
  };

  const handleAddWord = useCallback(() => {
    const word = inputValue.trim().toLowerCase();
    if (!word || selectedWords.includes(word)) { triggerShake(); return; }
    haptics.selection();
    onAdd(word);
    setInputValue('');
  }, [inputValue, selectedWords, onAdd]);

  const handleChipToggle = useCallback((word: string) => {
    haptics.selection();
    if (selectedWords.includes(word)) onRemove(word);
    else onAdd(word);
  }, [selectedWords, onAdd, onRemove]);

  // Use the exact phrasing requested
  const sectionTitle = 'Which words do you tend to avoid?';

  const placeholder = language === 'urdu' ? 'یا اپنا لفظ لکھیں...' : 'Type a custom word...';

  const customWords = selectedWords.filter(
    (w) => !seedWords.map((s) => s.toLowerCase()).includes(w)
  );

  return (
    <View style={styles.root}>
      <Text style={[styles.sectionTitle, { color: subtle }]}>{sectionTitle.toUpperCase()}</Text>

      {/* Suggestion chips - Changed to flexWrap View instead of ScrollView */}
      <View style={styles.chipsRow}>
        {seedWords.map((word) => {
          const isSelected = selectedWords.includes(word.toLowerCase());
          return (
            <TouchableOpacity
              key={word}
              onPress={() => handleChipToggle(word.toLowerCase())}
              activeOpacity={0.75}
              style={[
                styles.chip,
                {
                  backgroundColor: isSelected ? PRIMARY + '15' : isDark ? '#131820' : '#F5F8FA',
                  borderColor: isSelected ? PRIMARY + '60' : border,
                },
              ]}
            >
              {isSelected && (
                <Animated.View entering={FadeIn.duration(120)}>
                  <Ionicons name="checkmark" size={12} color={PRIMARY} />
                </Animated.View>
              )}
              <Text style={[styles.chipText, { color: isSelected ? PRIMARY : subtle }]}>
                {word}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Free text input */}
      <Animated.View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: border }, shakeStyle]}>
        <TextInput
          style={[styles.input, { color: text }]}
          placeholder={placeholder}
          placeholderTextColor={subtle}
          value={inputValue}
          onChangeText={setInputValue}
          onSubmitEditing={handleAddWord}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          onPress={handleAddWord}
          style={[styles.addBtn, { backgroundColor: PRIMARY }]}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#FFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* Custom word tags */}
      {customWords.length > 0 && (
        <View style={styles.tagsRow}>
          {customWords.map((word) => (
            <TouchableOpacity
              key={word}
              onPress={() => { haptics.selection(); onRemove(word); }}
              style={[styles.tag, {
                backgroundColor: isDark ? '#101C26' : '#EBF8F9',
                borderColor: PRIMARY + '35',
              }]}
              activeOpacity={0.75}
            >
              <Text style={[styles.tagText, { color: PRIMARY }]}>{word}</Text>
              <Ionicons name="close" size={14} color={PRIMARY} style={{ opacity: 0.7 }} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%', gap: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 4,
  },

  // Changed to wrap
  chipsRow: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    gap: 8, 
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: '600' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 52,
    paddingLeft: 16,
    paddingRight: 6,
    gap: 8,
    marginTop: 6,
  },
  input: { flex: 1, fontSize: 15, fontWeight: '500' },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  tagText: { fontSize: 14, fontWeight: '600' },
});