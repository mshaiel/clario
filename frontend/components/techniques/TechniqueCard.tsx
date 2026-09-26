/**
 * TechniqueCard.tsx — Redesigned with review status
 *
 * Changes from V1:
 *   - Description text removed (redundant with detail screen)
 *   - Review status label added (Reviewed / Review Pending) with icon + color
 *   - DIFFICULTY_STYLES imported from shared constant
 *   - accessibilityState on card
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';
import { TechniqueGuide, CATEGORY_MAP, SUBTYPE_LABELS, SUBTYPE_COLORS, DIFFICULTY_STYLES, TURQUOISE } from '@/lib/techniqueData';
import { useLanguage } from '@/context/LanguageContext';
import { haptics } from '@/lib/haptics';

interface Props {
  technique: TechniqueGuide;
  index: number;
  onPress: () => void;
  reviewed?: boolean;
}

export function TechniqueCard({ technique, index, onPress, reviewed = false }: Props) {
  const { resolvedTheme } = useAppTheme();
  const { isRTL } = useLanguage();
  const isDark = resolvedTheme.dark;
  const catMeta = CATEGORY_MAP[technique.category];
  const catColor = catMeta?.color ?? TURQUOISE;

  const surface = isDark ? '#161B24' : '#FFFFFF';
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#8D9FAE';

  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const diff = DIFFICULTY_STYLES[technique.difficulty as keyof typeof DIFFICULTY_STYLES];

  const handlePress = () => {
    haptics.light();
    onPress();
  };

  return (
    <Animated.View entering={FadeInDown.duration(250).delay(Math.min(index * 40, 300))} style={{ paddingHorizontal: 24 }}>
      <Animated.View style={animStyle}>
        <Pressable
          onPress={handlePress}
          onPressIn={() => { scale.value = withTiming(0.97, { duration: 100 }); }}
          onPressOut={() => { scale.value = withTiming(1,    { duration: 100 }); }}
          android_ripple={{ color: catColor + '18' }}
          accessibilityLabel={`Technique: ${technique.title}. ${reviewed ? 'Reviewed' : 'Review pending'}`}
          accessibilityRole="button"
          accessibilityState={{ selected: reviewed }}
          style={[
            styles.card,
            { backgroundColor: surface },
            !isDark && styles.cardLightShadow,
          ]}
        >
          {/* Left accent strip */}
          <View style={[styles.accent, { backgroundColor: catColor }]} />

          {/* Card content */}
          <View style={styles.content}>

            {/* Top row: icon + title */}
            <View style={styles.topRow}>
              <View style={[styles.iconCircle, { backgroundColor: catColor + '22' }]}>
                <Ionicons name={technique.icon as any} size={22} color={catColor} />
              </View>

              <View style={styles.titleBlock}>
                <Text
                  style={[styles.title, { color: text }]}
                  numberOfLines={2}
                >
                  {technique.title}
                </Text>
                {technique.romanizedTitle && (
                  <Text
                    style={[styles.romanized, { color: text }]}
                    numberOfLines={1}
                  >
                    {technique.romanizedTitle}
                  </Text>
                )}
              </View>
            </View>

            {/* Badges: difficulty + category */}
            <View style={styles.badgeRow}>
              <View style={[
                styles.badge,
                { backgroundColor: isDark ? diff.bgDark : diff.bg },
              ]}>
                <Text style={[styles.badgeText, { color: diff.text }]}>
                  {technique.difficulty}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: catColor + '22' }]}>
                <Text style={[styles.badgeText, { color: catColor }]}>
                  {technique.category}
                </Text>
              </View>
            </View>

            {/* Subtype tags */}
            <View style={styles.subtypeRow}>
              {technique.subtypes.map((sub) => {
                const c = SUBTYPE_COLORS[sub] ?? catColor;
                return (
                  <View key={sub} style={[styles.badge, { backgroundColor: c + '1A' }]}>
                    <Text style={[styles.badgeText, { color: c }]}>
                      {SUBTYPE_LABELS[sub] ?? sub}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Review status (replaces description) */}
            <View style={styles.statusRow}>
              <Ionicons
                name={reviewed ? 'checkmark-circle' : 'time-outline'}
                size={15}
                color={reviewed ? '#2CC775' : isDark ? '#FFA726' : '#E6850E'}
              />
              <Text style={[
                styles.statusText,
                { color: reviewed ? '#2CC775' : isDark ? '#FFA726' : '#E6850E' },
              ]}>
                {reviewed ? 'Reviewed' : 'Review Pending'}
              </Text>
            </View>
          </View>

          {/* Arrow button */}
          <View style={[styles.arrow, { backgroundColor: TURQUOISE + '18' }]}>
            <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={TURQUOISE} />
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  cardLightShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E4E8EE',
  },
  accent: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 16,
    paddingRight: 44,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
  },
  romanized: {
    fontSize: 13,
    fontWeight: '400',
    opacity: 0.5,
    marginTop: 2,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  subtypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  arrow: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});