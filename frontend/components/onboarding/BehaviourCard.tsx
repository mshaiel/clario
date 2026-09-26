/**
 * BehaviourCard — Phase C card component
 * Location: components/onboarding/BehaviourCard.tsx
 *
 * Reworked: vertically-stacked answer buttons with equal touch targets,
 * animated selection state, clean modern layout.
 */

import { haptics } from '@/lib/haptics';
import { PhaseCCard } from '@/lib/onboardingData';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// ─── Yes / Sometimes / No answer config ──────────────────────────────────────

interface YesNoOption {
  id: 'yes' | 'sometimes' | 'no';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

const YES_NO_OPTIONS: YesNoOption[] = [
  {
    id: 'yes',
    label: 'Yes',
    icon: 'checkmark-circle-outline',
    description: 'This happens to me',
  },
  {
    id: 'sometimes',
    label: 'Sometimes',
    icon: 'remove-circle-outline',
    description: 'Occasionally or in certain situations',
  },
  {
    id: 'no',
    label: 'No',
    icon: 'close-circle-outline',
    description: "This doesn't happen to me",
  },
];

// ─── Single answer button ─────────────────────────────────────────────────────

function AnswerButton({
  option,
  selected,
  answered,
  onPress,
  index,
}: {
  option: YesNoOption;
  selected: boolean;
  answered: boolean;
  onPress: () => void;
  index: number;
}) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;

  const progress = useSharedValue(selected ? 1 : 0);
  const scale    = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, { duration: 200 });
    if (selected) {
      scale.value = withSequence(
        withTiming(0.97, { duration: 60 }),
        withSpring(1, { damping: 14, stiffness: 200 })
      );
    }
  }, [selected]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: interpolateColor(
      progress.value,
      [0, 1],
      [isDark ? '#1E2938' : '#E2E8ED', PRIMARY]
    ),
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [isDark ? '#111720' : '#FFFFFF', isDark ? '#0D1C26' : '#EFF9FA']
    ),
    opacity: answered && !selected ? 0.4 : 1,
  }));

  const iconColor  = selected ? PRIMARY : isDark ? '#5E7487' : '#9AABB8';
  const labelColor = selected ? PRIMARY : text;

  return (
    <Animated.View
      entering={FadeInUp.delay(100 + index * 70).duration(340)}
      style={[abStyles.wrap, animStyle]}
    >
      <TouchableOpacity
        onPress={onPress}
        disabled={answered}
        activeOpacity={0.88}
        style={abStyles.inner}
      >
        {/* Left icon badge */}
        <View style={[abStyles.iconWrap, {
          backgroundColor: selected
            ? PRIMARY + '1A'
            : isDark ? '#192130' : '#F0F5F8',
        }]}>
          <Ionicons name={option.icon} size={22} color={iconColor} />
        </View>

        {/* Label + description */}
        <View style={abStyles.textWrap}>
          <Text style={[abStyles.label, { color: labelColor }]}>
            {option.label}
          </Text>
          <Text style={[abStyles.desc, { color: isDark ? '#5E7487' : '#9AABB8' }]}>
            {option.description}
          </Text>
        </View>

        {/* Radio indicator */}
        <View style={[abStyles.radio, {
          borderColor: selected ? PRIMARY : isDark ? '#283444' : '#C8D4DC',
          backgroundColor: selected ? PRIMARY : 'transparent',
        }]}>
          {selected && (
            <Animated.View entering={FadeIn.duration(120)}>
              <Ionicons name="checkmark" size={12} color="#FFF" />
            </Animated.View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const abStyles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 16,
    gap: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: { flex: 1 },
  label: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  desc: {
    fontSize: 12,
    lineHeight: 17,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});

// ─── Multi-select option row ──────────────────────────────────────────────────

const OPTION_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  swap:   'shuffle-outline',
  hard:   'mic-off-outline',
  unsure: 'help-circle-outline',
};

function MultiOption({
  option,
  selected,
  onToggle,
  language,
}: {
  option: NonNullable<PhaseCCard['options']>[number];
  selected: boolean;
  onToggle: () => void;
  language: string;
}) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#5E7487' : '#9AABB8';

  const progress = useSharedValue(selected ? 1 : 0);
  const scale    = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, { duration: 160 });
    if (selected) {
      scale.value = withSequence(
        withTiming(0.97, { duration: 70 }),
        withSpring(1, { damping: 12 })
      );
    }
  }, [selected]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: interpolateColor(progress.value, [0, 1],
      [isDark ? '#1E2938' : '#E2E8ED', PRIMARY]),
    backgroundColor: interpolateColor(progress.value, [0, 1],
      [isDark ? '#111720' : '#FFFFFF', isDark ? '#0D1C26' : '#EFF9FA']),
  }));

  const iconName = OPTION_ICONS[option.id] ?? 'ellipse-outline';

  return (
    <Animated.View style={[moStyles.row, rowStyle]}>
      <TouchableOpacity
        onPress={() => { haptics.selection(); onToggle(); }}
        activeOpacity={0.9}
        style={moStyles.inner}
      >
        <View style={[moStyles.iconWrap, {
          backgroundColor: selected ? PRIMARY + '1A' : isDark ? '#192130' : '#EEF3F6',
        }]}>
          <Ionicons name={iconName} size={18} color={selected ? PRIMARY : subtle} />
        </View>

        <View style={moStyles.textWrap}>
          <Text style={[moStyles.label, { color: selected ? PRIMARY : text }]}>
            {language === 'urdu' ? option.labelUrdu : option.label}
          </Text>
          {(language === 'urdu' ? option.sublabelUrdu : option.sublabel) ? (
            <Text style={[moStyles.sublabel, { color: subtle }]}>{language === 'urdu' ? option.sublabelUrdu : option.sublabel}</Text>
          ) : null}
        </View>

        <View style={[moStyles.check, {
          borderColor: selected ? PRIMARY : isDark ? '#283444' : '#C8D4DC',
          backgroundColor: selected ? PRIMARY : 'transparent',
        }]}>
          {selected && (
            <Animated.View entering={FadeIn.duration(100)}>
              <Ionicons name="checkmark" size={11} color="#FFF" />
            </Animated.View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const moStyles = StyleSheet.create({
  row: {
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  inner: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: { flex: 1 },
  label: { fontSize: 14, fontWeight: '600', letterSpacing: -0.1 },
  sublabel: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});

// ─── Main BehaviourCard ───────────────────────────────────────────────────────

interface Props {
  card: PhaseCCard;
  onAnswer: (answer: string | string[]) => void;
  language?: string;
}

export const BehaviourCard = React.memo(function BehaviourCard({ card, onAnswer, language = 'english' }: Props) {
  const { resolvedTheme } = useAppTheme();
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#5E7487' : '#9AABB8';
  const surface = isDark ? '#131820' : '#FFFFFF';

  const [yesNoAnswer, setYesNoAnswer] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);

  const handleYesNo = (answer: string) => {
    if (yesNoAnswer) return;
    haptics.selection();
    setYesNoAnswer(answer);
    setTimeout(() => onAnswer(answer), 380);
  };

  const toggleMulti = (id: string) => {
    setMultiSelected((prev: string[]) =>
      prev.includes(id) ? prev.filter((x: string) => x !== id) : [...prev, id]
    );
  };

  const handleMultiContinue = () => {
    haptics.selection();
    onAnswer(multiSelected);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Question card ── */}
      <Animated.View
        entering={FadeInDown.delay(40).duration(400)}
        style={[styles.questionCard, { backgroundColor: surface }]}
      >
        <Text style={[styles.question, { color: text }]}>{language === 'urdu' ? card.questionUrdu : card.question}</Text>

        {(language === 'urdu' ? (card.noteUrdu ?? card.note) : card.note) ? (
          <View style={[styles.noteBadge, {
            backgroundColor: isDark ? '#1A2533' : '#EEF5FA',
            borderColor:     isDark ? '#243040' : '#D6E5EF',
          }]}>
            <Ionicons
              name="information-circle-outline"
              size={14}
              color={subtle}
              style={{ marginTop: 1 }}
            />
            <Text style={[styles.noteText, { color: subtle }]}>{language === 'urdu' ? (card.noteUrdu ?? card.note) : card.note}</Text>
          </View>
        ) : null}
      </Animated.View>

      {/* ── Example pills ── */}
      {card.examplePills && card.examplePills.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(100).duration(340)} style={styles.pillsRow}>
          {card.examplePills.map((p: string) => (
            <View key={p} style={[styles.pill, {
              backgroundColor: isDark ? '#192130' : '#EEF3F7',
              borderColor:     isDark ? '#1E2B38' : '#D8E4EA',
            }]}>
              <Text style={[styles.pillText, { color: subtle }]}>{p}</Text>
            </View>
          ))}
        </Animated.View>
      ) : null}

      {/* ── Yes / Sometimes / No (vertical stack) ── */}
      {card.type === 'yes-no' ? (
        <View style={styles.answersWrap}>
          {YES_NO_OPTIONS.map((opt, i) => (
            <AnswerButton
              key={String(opt.id)}
              option={opt}
              selected={yesNoAnswer === opt.id}
              answered={!!yesNoAnswer}
              onPress={() => handleYesNo(opt.id)}
              index={i}
            />
          ))}
        </View>
      ) : null}

      {/* ── Multi-select options ── */}
      {card.type === 'multi-select' && card.options ? (
        <Animated.View entering={FadeInDown.delay(120).duration(360)} style={styles.multiWrap}>
          {card.options.map((opt: NonNullable<PhaseCCard['options']>[number]) => (
            <MultiOption
              key={String(opt.id)}
              option={opt}
              selected={multiSelected.includes(opt.id)}
              onToggle={() => toggleMulti(opt.id)}
              language={language}
            />
          ))}

          <Animated.View entering={FadeInUp.delay(260).duration(340)} style={{ marginTop: 6 }}>
            <TouchableOpacity
              onPress={handleMultiContinue}
              activeOpacity={0.84}
              style={[styles.continueBtn, { backgroundColor: PRIMARY }]}
            >
              <Text style={styles.continueTxt}>Continue</Text>
              <Ionicons name="arrow-forward" size={17} color="#FFF" />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      ) : null}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 14,
  },

  // Question card
  questionCard: {
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 26,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 5,
  },
  question: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 31,
  },
  noteBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  noteText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    fontStyle: 'italic',
  },

  // Pills
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  pill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.1 },

  // Answer stack
  answersWrap: {},

  // Multi-select
  multiWrap: {},

  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 26,
    gap: 8,
    shadowColor: '#1FB7BC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 5,
  },
  continueTxt: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});
