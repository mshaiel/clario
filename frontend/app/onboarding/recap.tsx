/**
 * Recap Screen — V2
 * Location: app/onboarding/recap.tsx
 *
 * Final step. Submits questionnaire payload to UAB and marks onboarding complete.
 *
 * V2 changes:
 *   - Empty-selections bypass path removed (Phase C guarantees ≥1 selection).
 *   - auth.currentUser null check preserved — logs warning and still completes.
 */

import { useLanguage } from '@/context/LanguageContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { auth } from '@/firebase';
import { UAB_API } from '@/lib/api';
import { Language, TargetPersona } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const CHECKLIST = [
  { label: 'Language preference saved',   icon: 'checkmark-circle' as const },
  { label: 'Speech patterns identified',  icon: 'checkmark-circle' as const },
  { label: 'Personalising your exercises', icon: 'checkmark-circle' as const },
];

function PulseBar({ color }: { color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as any,
    backgroundColor: color,
  }));

  return (
    <View style={[pulseStyles.track, { backgroundColor: color + '20' }]}>
      <Animated.View style={[pulseStyles.fill, style]} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  track: { height: 3, borderRadius: 2, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: 2 },
});

function CheckRow({ label, delay }: { label: string; delay: number }) {
  const { resolvedTheme } = useAppTheme();
  const PRIMARY = resolvedTheme.colors.primary;
  const subtle = resolvedTheme.dark ? '#7A8FA3' : '#8D9FAE';

  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(400).springify()}
      style={checkStyles.row}
    >
      <View style={[checkStyles.iconWrap, { backgroundColor: PRIMARY + '15' }]}>
        <Ionicons name="checkmark" size={13} color={PRIMARY} />
      </View>
      <Text style={[checkStyles.label, { color: subtle }]}>{label}</Text>
    </Animated.View>
  );
}

const checkStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '500' },
});

export default function RecapScreen() {
  const { resolvedTheme } = useAppTheme();
  const { profile, completeOnboarding } = useOnboarding();
  const { language } = useLanguage();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#7A8FA3' : '#8D9FAE';
  const bg = isDark ? '#0C0F14' : '#F5F7FA';
  const surface = isDark ? '#1A2030' : '#FAFBFF';
  const border = isDark ? '#2A3448' : '#E8ECF2';

  const [revealed, setRevealed] = useState(0);
  const [done, setDone] = useState(false);

  const langLabel = profile.targetLanguage === 'urdu' ? 'Urdu' : 'English';
  const concernLabel =
    profile.primaryConcern === 'fluency'
      ? 'fluency'
      : profile.primaryConcern === 'phonology'
      ? 'pronunciation'
      : 'speech clarity';

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    CHECKLIST.forEach((_, i) => {
      timers.push(setTimeout(() => setRevealed(i + 1), 600 + i * 900));
    });

    const generatePlan = async () => {
      const user = auth.currentUser;
      if (!user) {
        console.warn('[Recap] generatePlan called with no authenticated user — skipping API submission');
        setDone(true);
        setTimeout(() => completeOnboarding(), 1200);
        return;
      }

      try {
        // Guard against corrupted profile state from stale AsyncStorage data.
        const VALID_LANGUAGES = ['english', 'urdu'];
        const VALID_PERSONAS = ['child', 'teen', 'adult'];
        const safeLanguage: Language = VALID_LANGUAGES.includes(profile.targetLanguage as string)
          ? profile.targetLanguage
          : language; // fall back to live context language
        const safePersona: TargetPersona = VALID_PERSONAS.includes(profile.target_persona as string)
          ? (profile.target_persona as TargetPersona)
          : 'adult';
        await UAB_API.submitQuestionnaire(
          user.uid,
          safeLanguage,
          safePersona,
          profile.selections
        );
      } catch (error) {
        console.error('UAB Submission failed:', error);
        // Non-fatal: completeOnboarding() in the finally block will still persist
        // completion to the correct per-language AsyncStorage key.
      } finally {
        setTimeout(() => {
          setDone(true);
          setTimeout(() => completeOnboarding(), 1200);
        }, 3200);
      }
    };

    generatePlan();
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <Animated.View entering={FadeIn.duration(500)} style={styles.brandRow}>
        <View style={styles.logoWrap}>
          <View style={[styles.pillL, { backgroundColor: PRIMARY }]} />
          <View style={[styles.pillR, { backgroundColor: PRIMARY, opacity: 0.38 }]} />
        </View>
        <Text style={[styles.wordmark, { color: text }]}>clario</Text>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(200).duration(500).springify()}
        style={[styles.card, { backgroundColor: surface, borderColor: border }]}
      >
        {!done ? (
          <>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: text }]}>Building your plan</Text>
              <Text style={[styles.cardSub, { color: subtle }]}>
                Personalised for {langLabel} · {concernLabel}
              </Text>
            </View>

            <View style={{ marginBottom: 28 }}>
              <PulseBar color={PRIMARY} />
            </View>

            <View>
              {CHECKLIST.map((item, i) =>
                i < revealed ? (
                  <CheckRow key={i} label={item.label} delay={0} />
                ) : null
              )}
            </View>
          </>
        ) : (
          <Animated.View entering={FadeIn.duration(400)} style={styles.doneBlock}>
            <View
              style={[
                styles.doneIcon,
                { backgroundColor: PRIMARY + '15', borderColor: PRIMARY + '30' },
              ]}
            >
              <Ionicons name="sparkles" size={28} color={PRIMARY} />
            </View>
            <Text style={[styles.doneTitle, { color: text }]}>Your plan is ready</Text>
            <Text style={[styles.doneSub, { color: subtle }]}>
              Taking you to your dashboard…
            </Text>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  brandRow: { alignItems: 'center', marginBottom: 40, gap: 10 },
  logoWrap: { width: 44, height: 26, position: 'relative' },
  pillL: { position: 'absolute', left: 0, top: 0, width: 28, height: 26, borderRadius: 13 },
  pillR: { position: 'absolute', right: 0, top: 0, width: 28, height: 26, borderRadius: 13 },
  wordmark: { fontSize: 32, fontWeight: '700', letterSpacing: -1.5 },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 28,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  cardHeader: { marginBottom: 20 },
  cardTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, marginBottom: 4 },
  cardSub: { fontSize: 13, fontWeight: '400' },
  doneBlock: { alignItems: 'center', paddingVertical: 12, gap: 12 },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginBottom: 8,
  },
  doneTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  doneSub: { fontSize: 14, fontWeight: '400' },
});
