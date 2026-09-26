/**
 * Sub-Error List — V2  (was: Onboarding Assessment Screen)
 * Location: app/onboarding/assessment.tsx
 *
 * Fast path: user selects known subtypes from a compact multi-select list.
 * Bypasses Phase A entirely → routes to Phase B (drill-down).
 *
 * Entry points:
 *   A. From Triage (fluency / phonology / both)  — primary
 *   B. From Phase A with 0 confirmations          — fallback
 *   C. From Phase A "Not sure?" escape hatch      — mid-flow
 *
 * No clinical names. No IPA symbols. Audio-first with per-card TTS.
 */

import React, { useCallback, useMemo, useState } from 'react';
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
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  interpolateColor,
  interpolate,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAppTheme } from '@/theme-provider';
import { FLUENCY_SUBTYPES, PHONOLOGY_SUBTYPES, ClinicalSubtype } from '@/lib/onboardingData';
import { haptics } from '@/lib/haptics';
import { Language } from '@/lib/types';
import { prepareDrillDown } from '@/lib/drillDownStore';
import { GradientGlow } from '@/components/ui/GradientGlow';

// ─── Sub-error card ──────────────────────────────────────────────────────────

function SubErrorCard({ subtype, selected, language, onToggle }: {
  subtype: ClinicalSubtype;
  selected: boolean;
  language: Language;
  onToggle: () => void;
}) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#59677A';

  const scale    = useSharedValue(1);
  const progress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    if (selected) {
      scale.value    = withSequence(withTiming(0.97, { duration: 80 }), withSpring(1, { damping: 12 }));
      progress.value = withTiming(1, { duration: 200 });
    } else {
      scale.value    = withSpring(1, { damping: 12 });
      progress.value = withTiming(0, { duration: 200 });
    }
  }, [selected]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: interpolateColor(progress.value, [0, 1],
      [isDark ? '#252D3A' : '#D1D8E2', PRIMARY]),
    backgroundColor: interpolateColor(progress.value, [0, 1],
      [isDark ? '#161B24' : '#FFFFFF', isDark ? '#1D283A' : '#F4F9FF']),
    shadowColor: selected ? PRIMARY : '#000',
    shadowOpacity: interpolate(progress.value, [0, 1], [0.03, 0.15]),
    shadowRadius: selected ? 14 : 6,
    shadowOffset: { width: 0, height: selected ? 6 : 2 } as any,
    elevation: selected ? 6 : 2,
  }));

  const handlePress = () => { haptics.selection(); onToggle(); };

  return (
    <Animated.View style={[styles.card, cardStyle]}>
      <TouchableOpacity onPress={handlePress} activeOpacity={1} style={styles.cardInner}>
        {/* Title row: name + check */}
        <View style={styles.cardTop}>
          <Text style={[styles.cardTitle, { color: selected ? PRIMARY : text }, selected && { fontWeight: '700' }]}>
            {subtype.clinicalName}
          </Text>
          <View style={[styles.check, {
            backgroundColor: selected ? PRIMARY : 'transparent',
            borderColor: selected ? PRIMARY : isDark ? '#2A3344' : '#D0D8DE',
          }]}>
            {selected && (
              <Animated.View entering={FadeIn.duration(150)}>
                <Ionicons name="checkmark" size={13} color="#FFF" />
              </Animated.View>
            )}
          </View>
        </View>

        {/* Description */}
        <Text style={[styles.cardDesc, { color: subtle }]}>
          {language === 'urdu' ? subtype.descriptionUrdu : subtype.description}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function AssessmentScreen() {
  const router = useRouter();
  const { profile, toggleSubtype } = useOnboarding();
  const { language } = useLanguage();
  const { resolvedTheme } = useAppTheme();

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#59677A';
  const bg      = isDark ? '#0C0F14' : '#F2F5F9';

  const subtypes = useMemo<ClinicalSubtype[]>(() => {
    if (profile.primaryConcern === 'fluency')   return FLUENCY_SUBTYPES;
    if (profile.primaryConcern === 'phonology') return PHONOLOGY_SUBTYPES;
    return [...FLUENCY_SUBTYPES, ...PHONOLOGY_SUBTYPES];
  }, [profile.primaryConcern]);

  const hasSelection = profile.selections.length > 0;

  const handleContinue = useCallback(() => {
    prepareDrillDown(profile.selections.map((s) => s.subtype as string));
    router.push('/onboarding/drill-down');
  }, [router, profile.selections]);

  const handleUnsure = useCallback(() => {
    router.push('/onboarding/phase-a');
  }, [router]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <GradientGlow color={PRIMARY} isDark={isDark} />
      {/* Top progress dots */}
      <View style={styles.topBar}>
        <View style={styles.dotRow}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={[styles.dot, {
              backgroundColor: i < 5 ? PRIMARY : isDark ? '#1E2530' : '#E0E6EA',
              width: i === 4 ? 20 : 8,
            }]} />
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.duration(500).delay(60)} style={styles.header}>
          <Text style={[styles.title, { color: text }]}>Do any of these sound familiar?</Text>
          <Text style={[styles.subtitle, { color: subtle }]}>
            Select the ones that match your speech.
          </Text>
        </Animated.View>

        {/* Cards */}
        <View style={styles.cardList}>
          {subtypes.map((s, idx) => (
            <Animated.View key={s.id} entering={FadeInDown.delay(100 + idx * 60).duration(380)}>
              <SubErrorCard
                subtype={s}
                selected={profile.selections.some((sel) => sel.subtype === s.id)}
                language={language as Language}
                onToggle={() => toggleSubtype(s.id)}
              />
            </Animated.View>
          ))}
        </View>

        {/* "I'm not sure" ghost link */}
        <Animated.View entering={FadeInDown.delay(420).duration(400)} style={styles.unsureWrap}>
          <TouchableOpacity onPress={handleUnsure} activeOpacity={0.7} style={styles.unsureBtn}>
            <Text style={[styles.unsureText, { color: subtle }]}>I'm not sure which one</Text>
            <Ionicons name="arrow-forward" size={14} color={subtle} />
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { backgroundColor: bg + 'EE', borderTopColor: isDark ? '#252D3A' : '#D1D8E2' }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={subtle} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: PRIMARY, opacity: hasSelection ? 1 : 0.35 }]}
          onPress={handleContinue}
          disabled={!hasSelection}
          activeOpacity={0.84}
        >
          <Text style={[styles.nextText, { color: '#FFF' }]}>Continue</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 4 },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { height: 5, borderRadius: 3 },
  backBtn: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 24, paddingBottom: 140 },
  header: { paddingTop: 32, paddingBottom: 28 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginBottom: 10, lineHeight: 38 },
  subtitle: { fontSize: 16, fontWeight: '500', lineHeight: 24 },

  cardList: { gap: 12 },
  card: {
    borderRadius: 18, borderWidth: 1.5,
  },
  cardInner: { padding: 18, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  cardDesc: { fontSize: 14, lineHeight: 21 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  unsureWrap: { marginTop: 20, alignItems: 'flex-start' },
  unsureBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 4 },
  unsureText: { fontSize: 15, fontWeight: '500' },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 36, borderTopWidth: 1,
  },
  skipPlaceholder: { minWidth: 48 },
  stepText: { fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  nextBtn: {
    height: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 24, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 4,
  },
  nextText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
});
