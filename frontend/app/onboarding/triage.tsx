/**
 * Triage Screen — V2
 * Location: app/onboarding/triage.tsx
 *
 * Establishes primary concern category and routes accordingly:
 *   fluency / phonology / both  →  Sub-Error List (assessment.tsx)
 *   unsure                      →  Phase A (phase-a.tsx)
 *
 * "I'm not sure" is rendered as a ghost text link, not a card.
 * The UAB bypass (submitQuestionnaire with empty selections) is removed entirely.
 */

import { useLanguage } from '@/context/LanguageContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { haptics } from '@/lib/haptics';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

interface TriageOption {
  id: 'fluency' | 'phonology' | 'both';
  title: string;
  titleUrdu: string;
  description: string;
  descriptionUrdu: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const TRIAGE_OPTIONS: TriageOption[] = [
  {
    id: 'fluency',
    title: 'Fluency',
    titleUrdu: 'Rawani',
    description: 'Treating speech blocks, sound stretching & repetition',
    descriptionUrdu: 'Speech blocks, awaaz kheenchna aur dohrana theek karna',
    icon: 'mic-outline',
  },
  {
    id: 'phonology',
    title: 'Phonology',
    titleUrdu: 'Awaazein',
    description: 'Swapping sounds or unclear speech',
    descriptionUrdu: 'Awazein badalna ya ghair wazeh baat karna',
    icon: 'chatbubble-ellipses-outline',
  },
  {
    id: 'both',
    title: 'A mix of both',
    titleUrdu: 'Dono ka milaap',
    description: 'Work on fluency and phonology together',
    descriptionUrdu: 'Rawani aur awazein dono par kaam karna',
    icon: 'layers-outline',
  },
];

// ----- Animated Option Card -----
function TriageCard({ option, selected, onPress, language }: {
  option: TriageOption;
  selected: boolean;
  onPress: () => void;
  language: string;
}) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#8D9FAE';

  const scale      = useSharedValue(1);
  const progress   = useSharedValue(selected ? 1 : 0);
  const innerPadV  = useSharedValue(selected ? 20 : 16);

  useEffect(() => {
    if (selected) {
      scale.value     = withSequence(withTiming(0.96, { duration: 80 }), withSpring(1, { damping: 30, stiffness: 200 }));
      progress.value  = withTiming(1, { duration: 200 });
      innerPadV.value = withTiming(20, { duration: 180 });
    } else {
      scale.value     = withSpring(1, { damping: 30, stiffness: 200 });
      progress.value  = withTiming(0, { duration: 200 });
      innerPadV.value = withTiming(16, { duration: 180 });
    }
  }, [selected]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: interpolateColor(progress.value, [0, 1],
      [isDark ? '#2A3448' : '#E8ECF2', PRIMARY]),
    backgroundColor: interpolateColor(progress.value, [0, 1],
      [isDark ? '#1A2030' : '#FAFBFF', isDark ? '#1B2640' : '#F0F3FF']),
  }));

  const innerStyle = useAnimatedStyle(() => ({
    paddingVertical: innerPadV.value,
  }));

  const iconBg = selected ? PRIMARY + '20' : isDark ? '#242E3C' : '#EEF1F5';

  const handlePress = () => { haptics.selection(); onPress(); };

  return (
    <Animated.View style={[styles.card, cardStyle]}>
      <TouchableOpacity onPress={handlePress} activeOpacity={1}>
        <Animated.View style={[styles.cardInner, innerStyle]}>
          <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
            <Ionicons name={option.icon} size={24} color={selected ? PRIMARY : subtle} />
          </View>
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: selected ? PRIMARY : text }, selected && { fontWeight: '700' }]}>
              {language === 'urdu' ? option.titleUrdu : option.title}
            </Text>
            <Text style={[styles.cardDesc, { color: subtle }]}>
              {language === 'urdu' ? option.descriptionUrdu : option.description}
            </Text>
          </View>
          <View style={[styles.radio, {
            borderColor: selected ? PRIMARY : isDark ? '#4A5A6E' : '#9BADB8',
            backgroundColor: selected ? PRIMARY : 'transparent',
          }]}>
            {selected && <Ionicons name="checkmark" size={14} color="#FFF" />}
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ----- Screen -----
export default function TriageScreen() {
  const router = useRouter();
  const { profile, setPrimaryConcern } = useOnboarding();
  const { language } = useLanguage();
  const { resolvedTheme } = useAppTheme();

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#8D9FAE';
  const bg      = isDark ? '#0C0F14' : '#F5F7FA';

  const [selected, setSelected] = useState<TriageOption['id'] | null>(
    (profile.primaryConcern !== 'unsure' ? profile.primaryConcern : null) as TriageOption['id'] | null
  );

  const handleSelect = (id: TriageOption['id']) => {
    setSelected(id);
    setPrimaryConcern(id);
  };

  const handleContinue = () => {
    if (!selected) return;
    router.push('/onboarding/assessment');
  };

  const handleUnsure = () => {
    setPrimaryConcern('unsure');
    router.push('/onboarding/phase-a');
  };

  const displayTitle = language === 'urdu' ? 'آپ کیا بہتر کرنا چاہتے ہیں؟' : "What would you like to work on?";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      {/* ── Top progress dots ── */}
      <View style={styles.topBar}>
        <View style={styles.dotRow}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={[styles.dot, {
              backgroundColor: i < 3 ? PRIMARY + 'AA' : i === 3 ? PRIMARY : isDark ? '#1E2530' : '#E0E6EA',
              width: i === 3 ? 20 : 8,
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
          <Text style={[styles.title, { color: text }]}>{displayTitle}</Text>
          <Text style={[styles.subtitle, { color: subtle }]}>
            Pick the option that feels closest — you can always refine this.
          </Text>
        </Animated.View>

        {/* Option cards */}
        <View style={styles.cards}>
          {TRIAGE_OPTIONS.map((option, idx) => (
            <Animated.View key={option.id} entering={FadeInDown.delay(120 + idx * 80).duration(400)}>
              <TriageCard
                option={option}
                selected={selected === option.id}
                onPress={() => handleSelect(option.id)}
                language={language}
              />
            </Animated.View>
          ))}
        </View>

        {/* "I'm not sure" ghost link */}
        <Animated.View entering={FadeInDown.delay(420).duration(400)} style={styles.unsureWrap}>
          <TouchableOpacity onPress={handleUnsure} activeOpacity={0.7} style={styles.unsureBtn}>
            <Text style={[styles.unsureText, { color: subtle }]}>I'm not sure</Text>
            <Ionicons name="arrow-forward" size={14} color={subtle} />
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      {/* ── Footer ── */}
      <View style={[styles.footer, { backgroundColor: bg, borderTopColor: isDark ? '#2A3448' : '#E8ECF2' }]}>
        <TouchableOpacity
          onPress={() => router.replace('/onboarding/persona')}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={subtle} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: PRIMARY, opacity: selected ? 1 : 0.35 }]}
          onPress={handleContinue}
          disabled={!selected}
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
  header: { paddingTop: 28, paddingBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, marginBottom: 8 },
  subtitle: { fontSize: 16, fontWeight: '400', lineHeight: 24 },

  cards: { gap: 12 },
  card: {
    borderRadius: 18,
    borderWidth: 1.5,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  cardInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 14 },
  iconBox: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, marginBottom: 3 },
  cardDesc: { fontSize: 13, lineHeight: 18 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  unsureWrap: { marginTop: 16, alignItems: 'flex-start' },
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

