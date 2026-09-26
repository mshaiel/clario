/**
 * Phase B — Drill-Down Personalisation
 * Location: app/onboarding/drill-down.tsx
 *
 * One screen per confirmed subtype.
 * Section 1: Tricky Sounds (SoundTile grid) — conditional per PINPOINTER_MAP
 * Section 2: Words You Avoid (WordChips) — shown for all subtypes
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  FadeInDown,
  SlideInRight,
  SlideOutLeft,
} from 'react-native-reanimated';
import { useOnboarding } from '@/context/OnboardingContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAppTheme } from '@/theme-provider';
import { ttsService } from '@/lib/ttsService';
import { ALL_SUBTYPES, PINPOINTER_MAP } from '@/lib/onboardingData';
import { SoundTile } from '@/components/onboarding/SoundTile';
import { WordChips } from '@/components/onboarding/WordChips';
import { Language } from '@/lib/types';
import { haptics } from '@/lib/haptics';
import { consumeDrillDown } from '@/lib/drillDownStore';

export default function DrillDownScreen() {
  const router = useRouter();
  const { profile, togglePhonemeConstraint, addAvoidanceWord, removeAvoidanceWord } = useOnboarding();
  const { language } = useLanguage();
  const { resolvedTheme } = useAppTheme();

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#5E7487' : '#9AABB8';
  const bg      = isDark ? '#0F1318' : '#F7FAFC';
  const border  = isDark ? '#1E2736' : '#E8EDF1';

  const [screenIndex, setScreenIndex] = useState(0);

  const [subtypeIds] = useState<string[]>(() => consumeDrillDown());

  useEffect(() => {
    return () => {
      ttsService.stopPlayback();
    };
  }, []);

  useEffect(() => {
    if (subtypeIds.length === 0) {
      router.replace('/onboarding/recap');
    }
  }, [subtypeIds, router]);

  const totalScreens = subtypeIds.length;
  const currentSubtypeId = subtypeIds[screenIndex];

  const currentSubtype = useMemo(
    () => ALL_SUBTYPES.find((s) => s.id === currentSubtypeId),
    [currentSubtypeId]
  );

  const currentSelection = useMemo(
    () => profile.selections.find((s) => s.subtype === currentSubtypeId),
    [profile.selections, currentSubtypeId]
  );

  const phonemeOptions = PINPOINTER_MAP[currentSubtypeId] ?? null;
  const selectedPhonemes = currentSelection?.focus_phonemes ?? [];
  const selectedWords    = currentSelection?.danger_words ?? [];

  const isFirstScreen = screenIndex === 0;

  const advance = useCallback(() => {
    haptics.selection();
    if (screenIndex < totalScreens - 1) {
      setScreenIndex((i) => i + 1);
    } else {
      router.push('/onboarding/recap');
    }
  }, [screenIndex, totalScreens, router]);

  const handleSkipAll = useCallback(() => {
    haptics.selection();
    router.push('/onboarding/recap');
  }, [router]);

  const handleBack = useCallback(() => {
    haptics.selection();
    if (screenIndex > 0) {
      setScreenIndex((i) => i - 1);
    }
  }, [screenIndex]);

  if (subtypeIds.length === 0 || !currentSubtype) {
    return null; 
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View 
          key={currentSubtypeId} 
          entering={SlideInRight.duration(300)} 
          exiting={SlideOutLeft.duration(200)}
          style={{ flex: 1 }}
        >

          {/* ── Header ── */}
          <Animated.View entering={FadeInDown.delay(60).duration(400)} style={styles.header}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: PRIMARY + '15', borderColor: PRIMARY + '28' }]}>
                <Text style={[styles.badgeText, { color: PRIMARY }]}>{currentSubtype.clinicalName}</Text>
              </View>
              <Text style={[styles.screenCounter, { color: subtle }]}>
                {screenIndex + 1} / {totalScreens}
              </Text>
            </View>
            <Text style={[styles.title, { color: text }]}>Tell me more about your {currentSubtype.title} problem.</Text>
          </Animated.View>

          {/* ── Section 1: Tricky Sounds ── */}
          {phonemeOptions && phonemeOptions.length > 0 && (
            <Animated.View entering={FadeInDown.delay(120).duration(400)} style={styles.section}>
              <Text style={[styles.sectionLabel, { color: subtle }]}>WHICH SOUNDS DO YOU TEND TO AVOID?</Text>
              <View style={styles.tileGrid}>
                {phonemeOptions.map((opt) => (
                  <SoundTile
                    key={opt.ipa}
                    option={opt}
                    selected={selectedPhonemes.includes(opt.ipa)}
                    language={language as Language}
                    onToggle={(ipa) => togglePhonemeConstraint(currentSubtypeId, ipa)}
                  />
                ))}
              </View>
            </Animated.View>
          )}

          {/* ── Section 2: Words You Avoid ── */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
            <WordChips
              seedWords={currentSubtype.seedWords[language as 'english' | 'urdu']}
              selectedWords={selectedWords}
              onAdd={(word) => addAvoidanceWord(currentSubtypeId, word)}
              onRemove={(word) => removeAvoidanceWord(currentSubtypeId, word)}
              language={language as Language}
              subtypeType={currentSubtype.category}
            />
          </Animated.View>

          {/* Spacer for footer */}
          <View style={{ height: 100 }} />
        </Animated.View>
      </ScrollView>

      {/* ── Footer ── */}
      <View style={[styles.footer, { backgroundColor: bg, borderTopColor: border }]}>
        
        {/* Left Side: Skip All (if first) or Back */}
        {isFirstScreen ? (
          <TouchableOpacity
            onPress={handleSkipAll}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
            style={styles.skipAllBtn}
          >
            <Text style={[styles.skipAllText, { color: subtle }]}>Skip All</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color={subtle} />
          </TouchableOpacity>
        )}

        {/* Right Side: Continue */}
        <View style={styles.footerRight}>
          <TouchableOpacity
            style={[styles.nextBtn, { backgroundColor: PRIMARY }]}
            onPress={advance}
            activeOpacity={0.84}
          >
            <Text style={styles.nextText}>
              {screenIndex < totalScreens - 1 ? 'Continue' : 'Finish'}
            </Text>
            <Ionicons name="arrow-forward" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: 8 },

  header: { paddingTop: 16, paddingBottom: 32 },
  badgeRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  badge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
  },
  badgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  screenCounter: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 36 },

  section: { marginBottom: 32 },
  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, marginBottom: 16 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 36, borderTopWidth: 1,
  },
  skipAllBtn: { paddingVertical: 10 },
  skipAllText: { fontSize: 15, fontWeight: '600' },
  backBtn: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  nextBtn: {
    height: 50, borderRadius: 25, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 22, gap: 8,
    shadowColor: '#1FB7BC', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
  },
  nextText: { fontSize: 15, fontWeight: '700', color: '#FFF', letterSpacing: 0.1 },
});