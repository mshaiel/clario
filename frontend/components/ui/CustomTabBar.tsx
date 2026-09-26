/**
 * Custom Premium Tab Bar
 * Location: components/ui/CustomTabBar.tsx
 *
 * A premium frosted-glass tab bar with an animated active pill indicator,
 * smooth icon+label transitions, and haptic feedback (already wired via
 * the Tabs screenListeners).
 *
 * Design language:
 * - Translucent background with subtle blur effect
 * - Floating pill that slides between active tabs (Reanimated)
 * - Active tab: primary-tinted icon + bold label
 * - Inactive tabs: muted icon, no label (cleaner look)
 * - Elevated with soft shadow for depth
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Icon map — matches the Tabs.Screen names to their icons ──────────────────
const TAB_ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  home:             { active: 'home',            inactive: 'home-outline' },
  index:            { active: 'map',             inactive: 'map-outline' },
  practice:         { active: 'barbell',         inactive: 'barbell-outline' },
  'progress-report':{ active: 'stats-chart',     inactive: 'stats-chart-outline' },
  techniques:       { active: 'bulb',            inactive: 'bulb-outline' },
  settings:         { active: 'settings',        inactive: 'settings-outline' },
};

const SPRING_CONFIG = { damping: 18, stiffness: 160, mass: 0.8 };

export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { resolvedTheme } = useAppTheme();
  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const { bottom: bottomInset } = useSafeAreaInsets();

  const tabCount = state.routes.length;
  const TAB_BAR_HORIZONTAL_PADDING = 12;
  const usableWidth = SCREEN_WIDTH - TAB_BAR_HORIZONTAL_PADDING * 2;
  const tabWidth = usableWidth / tabCount;
  const PILL_WIDTH = tabWidth - 8;

  // Shared value for pill position
  const pillX = useSharedValue(state.index * tabWidth + (tabWidth - PILL_WIDTH) / 2);

  useEffect(() => {
    pillX.value = withSpring(
      state.index * tabWidth + (tabWidth - PILL_WIDTH) / 2,
      SPRING_CONFIG,
    );
  }, [state.index]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: PILL_WIDTH,
  }));

  // Colors
  const barBg = isDark ? 'rgba(12, 15, 20, 0.92)' : 'rgba(255, 255, 255, 0.94)';
  const barBorder = isDark ? '#1E2530' : '#E8EAED';
  const inactiveColor = isDark ? '#5A6B7D' : '#9CA8B4';
  const pillBg = PRIMARY + '14';

  return (
    <View style={[styles.barOuter, { borderTopColor: barBorder }]}>
      <View
        style={[
          styles.barInner,
          {
            backgroundColor: barBg,
            paddingHorizontal: TAB_BAR_HORIZONTAL_PADDING,
            paddingBottom: bottomInset > 0 ? bottomInset : (Platform.OS === 'ios' ? 28 : 10),
          },
        ]}
      >
        {/* Animated pill background */}
        <Animated.View
          style={[
            styles.pill,
            { backgroundColor: pillBg },
            pillStyle,
          ]}
        />

        {/* Tab buttons */}
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const isFocused = state.index === index;

          const iconConfig = TAB_ICONS[route.name] || { active: 'ellipse-outline' as const, inactive: 'ellipse-outline' as const };

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <TabItem
              key={route.key}
              label={label}
              iconName={isFocused ? iconConfig.active : iconConfig.inactive}
              isFocused={isFocused}
              primaryColor={PRIMARY}
              inactiveColor={inactiveColor}
              onPress={onPress}
              onLongPress={onLongPress}
              width={tabWidth}
            />
          );
        })}
      </View>
    </View>
  );
}

// ── Individual Tab Item (animated) ───────────────────────────────────────────
interface TabItemProps {
  label: string;
  iconName: keyof typeof Ionicons.glyphMap;
  isFocused: boolean;
  primaryColor: string;
  inactiveColor: string;
  onPress: () => void;
  onLongPress: () => void;
  width: number;
}

function TabItem({
  label,
  iconName,
  isFocused,
  primaryColor,
  inactiveColor,
  onPress,
  onLongPress,
  width,
}: TabItemProps) {
  const focusProgress = useSharedValue(isFocused ? 1 : 0);

  useEffect(() => {
    focusProgress.value = withTiming(isFocused ? 1 : 0, { duration: 220 });
  }, [isFocused]);

  const iconAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + focusProgress.value * 0.08 },
    ],
  }));

  const color = isFocused ? primaryColor : inactiveColor;

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      style={[styles.tabItem, { width }]}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={label}
    >
      <Animated.View style={iconAnimStyle}>
        <Ionicons name={iconName} size={22} color={color} />
      </Animated.View>
      <Text
        style={[
          styles.tabLabel,
          {
            color,
            fontWeight: isFocused ? '700' : '500',
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  barOuter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  barInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    top: 4,
    left: 12,  // must match TAB_BAR_HORIZONTAL_PADDING
    height: 44,
    borderRadius: 14,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    zIndex: 1,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.2,
    marginTop: 3,
  },
});
