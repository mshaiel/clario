/**
 * Option Card Component
 * Location: components/onboarding/OptionCard.tsx
 * * Phase 8 Update:
 * - Refined Reanimated interactions for selection feedback.
 * - Standardized prop interface for Thin Client onboarding flows.
 */

import React, { useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  FadeIn,
  interpolateColor,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';
import { haptics } from '@/lib/haptics';

interface Props {
  id?: string;
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: (id?: string) => void;
}

export const OptionCard = React.memo(function OptionCard({
  id,
  title,
  description,
  icon,
  selected,
  onPress,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;

  const scale = useSharedValue(1);
  const progress = useSharedValue(selected ? 1 : 0);

  // Sync animation progress with selection state
  useEffect(() => {
    if (selected) {
      scale.value = withSequence(
        withTiming(0.96, { duration: 80 }),
        withSpring(1, { damping: 12, stiffness: 100 })
      );
      progress.value = withTiming(1, { duration: 200 });
    } else {
      scale.value = withSpring(1, { damping: 12 });
      progress.value = withTiming(0, { duration: 200 });
    }
  }, [selected]);

  // Interpolated styles for background and border
  const cardStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      progress.value,
      [0, 1],
      [isDark ? '#2A3448' : '#E8ECF2', PRIMARY]
    );
    const bgColor = interpolateColor(
      progress.value,
      [0, 1],
      [isDark ? '#1A2030' : '#FAFBFF', isDark ? '#1B2640' : '#F0F3FF']
    );

    return {
      transform: [{ scale: scale.value }],
      borderColor,
      backgroundColor: bgColor,
    };
  });

  const handlePress = () => {
    haptics.selection();
    onPress(id);
  };

  const iconBg = selected
    ? PRIMARY + '20'
    : isDark ? '#242E3C' : '#EEF1F5';

  return (
    <Animated.View
      style={[
        styles.card,
        {
          shadowColor: '#000',
        },
        cardStyle,
      ]}
    >
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={1}
        style={styles.inner}
      >
        {/* Icon block */}
        {icon && (
          <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
            <Ionicons
              name={icon}
              size={22}
              color={selected ? PRIMARY : (isDark ? '#7A8FA3' : '#8D9FAE')}
            />
          </View>
        )}

        {/* Label and Description */}
        <View style={styles.textWrap}>
          <Text
            style={[
              styles.title,
              { color: selected ? PRIMARY : resolvedTheme.colors.text },
              selected && { fontWeight: '700' }
            ]}
          >
            {title}
          </Text>
          {description && (
            <Text
              style={[
                styles.desc,
                { color: isDark ? '#7A8FA3' : '#8D9FAE' },
              ]}
              numberOfLines={2}
            >
              {description}
            </Text>
          )}
        </View>

        {/* Animated Radio/Check Indicator */}
        <View
          style={[
            styles.check,
            {
              backgroundColor: selected ? PRIMARY : 'transparent',
              borderColor: selected ? PRIMARY : (isDark ? '#2A3344' : '#D0D8DE'),
            },
          ]}
        >
          {selected && (
            <Animated.View entering={FadeIn.duration(150)}>
              <Ionicons name="checkmark" size={13} color="#FFF" />
            </Animated.View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1.5,
    marginBottom: 12,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 14,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  desc: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});