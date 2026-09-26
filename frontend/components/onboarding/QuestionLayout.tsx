/**
 * Question Layout Component
 * Location: components/onboarding/QuestionLayout.tsx
 * * Phase 2 Rework:
 * - Replaces the fragmented OnboardingHeader.
 * - Standardizes the premium "Continue" button shadow and layout.
 * - Perfectly supports both ScrollView (standard) and FlatList (Assessment Grid).
 */

import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import {
  FlatList,
  FlatListProps,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  children?: React.ReactNode;
  title: string;
  subtitle?: string;
  onNext: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  progress: number; // 0.0 - 1.0
  flatListProps?: Omit<FlatListProps<any>, 'ListHeaderComponent' | 'ListFooterComponent'>;
}

export function QuestionLayout({
  children,
  title,
  subtitle,
  onNext,
  onBack,
  onSkip,
  nextDisabled = false,
  nextLabel = 'Continue',
  progress,
  flatListProps,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const isDark   = resolvedTheme.dark;
  const PRIMARY  = resolvedTheme.colors.primary;
  const text     = resolvedTheme.colors.text;
  const bg       = isDark ? '#0C0F14' : '#F5F7FA';
  const subtle   = isDark ? '#7A8FA3' : '#8D9FAE';
  const footerBg = isDark ? '#0C0F14' : '#F5F7FA';
  const border   = isDark ? '#2A3448' : '#E8ECF2';

  // Step label derived from progress value
  const stepNum    = Math.max(1, Math.round(progress * 6)); // 6 onboarding steps total
  const totalSteps = 6;

  const HeaderContent = (
    <Animated.View
      entering={FadeInDown.duration(500).delay(80)}
      layout={Layout.springify()}
      style={styles.header}
    >
      <Text style={[styles.title, { color: text }]}>{title}</Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: subtle }]}>{subtitle}</Text>
      )}
    </Animated.View>
  );

  const FooterContent = (
    <View
      style={[
        styles.footer,
        { backgroundColor: footerBg, borderTopColor: border },
      ]}
    >
      {/* Left side: back > skip > placeholder */}
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color={subtle} />
        </TouchableOpacity>
      ) : onSkip ? (
        <TouchableOpacity onPress={onSkip} style={styles.skipBtn} activeOpacity={0.7}>
          <Text style={[styles.skipText, { color: subtle }]}>Skip</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.skipPlaceholder} />
      )}

      {/* Step counter — center */}
      <Text style={[styles.stepText, { color: subtle }]}>
        {stepNum} / {totalSteps}
      </Text>

      {/* Next button — right (Standardized Premium Style) */}
      <TouchableOpacity
        style={[
          styles.nextBtn,
          {
            backgroundColor: nextDisabled ? (isDark ? '#1E2530' : '#E5EAED') : PRIMARY,
          },
        ]}
        onPress={onNext}
        disabled={nextDisabled}
        activeOpacity={0.84}
      >
        <Text
          style={[
            styles.nextText,
            { color: nextDisabled ? subtle : '#FFFFFF' },
          ]}
        >
          {nextLabel}
        </Text>
        <Ionicons name="arrow-forward" size={18} color={nextDisabled ? subtle : "#FFF"} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>

      {/* ── TOP BAR: step dots ─────── */}
      <View style={styles.topBar}>
        <View style={styles.stepDots}>
          {Array.from({ length: totalSteps }).map((_, i) => {
            const filled = i < stepNum;
            const active = i === stepNum - 1;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: filled
                      ? active ? PRIMARY : PRIMARY + 'AA'
                      : (isDark ? '#242E3C' : '#DDE2E8'),
                    width: active ? 24 : 8,
                    opacity: filled ? 1 : 0.7,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* ── CONTENT ──────────────────────────────────── */}
      {flatListProps ? (
        <FlatList
          {...flatListProps}
          contentContainerStyle={[styles.scroll, { paddingBottom: 140 }, flatListProps.contentContainerStyle]}
          ListHeaderComponent={HeaderContent}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<View style={{ height: 20 }} />}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: 140, flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {HeaderContent}
          <View style={styles.contentWrap}>{children}</View>
        </ScrollView>
      )}

      {/* ── FOOTER ───────────────────────────────────── */}
      {FooterContent}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  topBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 10,
  },
  stepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    height: 5,
    borderRadius: 3,
  },

  scroll: {
    paddingHorizontal: 24,
  },
  header: {
    paddingTop: 28,
    paddingBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  contentWrap: {
    width: '100%',
    gap: 0,
  },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 36,
    borderTopWidth: 1,
  },
  skipBtn: { minWidth: 48, paddingVertical: 10 },
  skipText: { fontSize: 15, fontWeight: '600' },
  skipPlaceholder: { minWidth: 48 },
  backBtn: { width: 48, height: 52, alignItems: 'center', justifyContent: 'center' },
  stepText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
  },
  nextBtn: {
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 8,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  nextText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});