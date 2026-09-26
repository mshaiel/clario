/**
 * Mode Select Bottom Sheet
 * Location: components/dashboard/ModeSelectSheet.tsx
 *
 * Slide-up modal that lets the user choose:
 *   1. (Assessments only) Display mode — Standard (sentence-by-sentence) or Paragraph
 *   2. Analysis mode — Efficient or Clario Assistant
 *
 * When `isAssessment` is false (practice), only step 2 is shown (original behaviour).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/theme-provider';
import { haptics } from '@/lib/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const AI_ACCENT = '#7C6FFF';
const PARA_ACCENT = '#10B981'; // emerald

// ─── Reusable card ────────────────────────────────────────────────────────────

function ModeCard({
  title, subtitle, icon, iconColor, isHighlighted, badgeText, onPress, surface, border, isDark, text, subtle,
}: any) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Reanimated.View style={animStyle}>
      <Pressable
        style={({ pressed }) => [
          styles.modeCard,
          isHighlighted && styles.modeCardAI,
          { backgroundColor: surface, borderColor: isHighlighted ? iconColor + '55' : border },
          !isDark && styles.cardLightShadow,
        ] as any}
        onPressIn={() => { scale.value = withSpring(0.96, { damping: 15, stiffness: 250 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 250 }); }}
        onPress={onPress}
      >
        {badgeText && (
          <View style={[styles.recommendedBadge, { backgroundColor: iconColor }]}>
            <Ionicons name="sparkles" size={9} color="#FFF" />
            <Text style={styles.recommendedText}>{badgeText}</Text>
          </View>
        )}

        <View style={styles.modeTop}>
          <View style={[styles.modeIcon, isHighlighted && styles.modeIconLg, { backgroundColor: iconColor + '15' }]}>
            <Ionicons name={icon} size={isHighlighted ? 24 : 22} color={iconColor} />
          </View>

          <View style={styles.modeTextWrap}>
            <Text style={[styles.modeTitle, { color: text }]}>{title}</Text>
            <Text style={[styles.modeDesc, { color: subtle }]}>{subtitle}</Text>
          </View>

          <Ionicons
            name="chevron-forward"
            size={18}
            color={isHighlighted ? iconColor + '80' : (isDark ? '#3A4A5C' : '#C8CED3')}
          />
        </View>
      </Pressable>
    </Reanimated.View>
  );
}

// ─── Section divider ──────────────────────────────────────────────────────────

function SectionLabel({ label, isDark, subtle }: { label: string; isDark: boolean; subtle: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={[styles.sectionLine, { backgroundColor: isDark ? '#252D3A' : '#D1D8E2' }]} />
      <Text style={[styles.sectionLabelText, { color: subtle }]}>{label}</Text>
      <View style={[styles.sectionLine, { backgroundColor: isDark ? '#252D3A' : '#D1D8E2' }]} />
    </View>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  testTitle: string;
  /** When true, shows an extra "display mode" step (paragraph vs standard) */
  isAssessment?: boolean;
  onSelect: (mode: 'efficient' | 'assistant', paragraphMode?: boolean) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ModeSelectSheet({ visible, testTitle, isAssessment = false, onSelect, onClose }: Props) {
  const { resolvedTheme } = useAppTheme();
  const insets = useSafeAreaInsets();

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#59677A';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const border  = isDark ? '#252D3A' : '#D1D8E2';
  const bg      = isDark ? '#0C0F14' : '#F2F5F9';

  // For assessments we do a two-step flow: display mode → analysis mode
  // paragraphSelected: null = not yet chosen, true = paragraph, false = standard
  const [paragraphSelected, setParagraphSelected] = useState<boolean | null>(null);
  // Reset step when sheet opens
  useEffect(() => {
    if (visible) setParagraphSelected(null);
  }, [visible]);

  const showStep2 = !isAssessment || paragraphSelected !== null;
  const showStep1 = isAssessment && paragraphSelected === null;

  const slideAnim    = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 65, friction: 12, useNativeDriver: true }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
        Animated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  const handleSelectMode = (mode: 'efficient' | 'assistant') => {
    haptics.selection();
    onSelect(mode, isAssessment ? (paragraphSelected ?? false) : undefined);
  };

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible={visible}>
      {/* Backdrop */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropAnim },
          ]}
        />
      </Pressable>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: bg, borderColor: border, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Handle bar */}
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: isDark ? '#2E3A48' : '#D4D9DD' }]} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.sheetTitle, { color: text }]}>
            {showStep1 ? 'Select Display Mode' : 'Select Analysis Mode'}
          </Text>
          <Text style={[styles.sheetSub, { color: subtle }]}>{testTitle}</Text>
        </View>

        {/* ── STEP 1: Display Mode (assessments only) ──────────────────────── */}
        {showStep1 && (
          <>
            <ModeCard
              title="Paragraph Mode"
              subtitle="All sentences shown together. Speak one at a time."
              icon="document-text-outline"
              iconColor={PARA_ACCENT}
              isHighlighted={true}
              badgeText="New"
              onPress={() => {
                haptics.selection();
                setParagraphSelected(true);
                onSelect('efficient', true);
              }}
              surface={surface}
              border={border}
              isDark={isDark}
              text={text}
              subtle={subtle}
            />

            <ModeCard
              title="Standard Mode"
              subtitle="One sentence at a time, with full visual feedback."
              icon="chatbubble-outline"
              iconColor={PRIMARY}
              isHighlighted={false}
              onPress={() => { haptics.selection(); setParagraphSelected(false); }}
              surface={surface}
              border={border}
              isDark={isDark}
              text={text}
              subtle={subtle}
            />
          </>
        )}

        {/* ── STEP 2: Analysis Mode ─────────────────────────────────────────── */}
        {showStep2 && (
          <>
            {/* Back link for assessment step 2 */}
            {isAssessment && (
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => setParagraphSelected(null)}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={14} color={subtle} />
                <Text style={[styles.backText, { color: subtle }]}>
                  {paragraphSelected ? 'Paragraph Mode' : 'Standard Mode'} selected
                </Text>
              </TouchableOpacity>
            )}

            <ModeCard
              title="Efficient Mode"
              subtitle="Visual feedback. Fast & self-paced."
              icon="flash-outline"
              iconColor={PRIMARY}
              isHighlighted={false}
              onPress={() => handleSelectMode('efficient')}
              surface={surface}
              border={border}
              isDark={isDark}
              text={text}
              subtle={subtle}
            />

            <ModeCard
              title="Clario Assistant"
              subtitle="Guided AI voice coaching & error fixes."
              icon="sparkles"
              iconColor={AI_ACCENT}
              isHighlighted={true}
              badgeText="Recommended"
              onPress={() => handleSelectMode('assistant')}
              surface={surface}
              border={border}
              isDark={isDark}
              text={text}
              subtle={subtle}
            />
          </>
        )}

        {/* Cancel */}
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={[styles.cancelText, { color: subtle }]}>Cancel</Text>
        </TouchableOpacity>

        <View style={{ height: insets.bottom + 8 }} />
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 24,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 20,
  },
  handleWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  header: { paddingTop: 8, paddingBottom: 20 },
  sheetTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginBottom: 4 },
  sheetSub: { fontSize: 14, fontWeight: '400' },

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 14,
  },
  backText: { fontSize: 12, fontWeight: '600' },

  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    marginTop: 4,
  },
  sectionLine: { flex: 1, height: 1 },
  sectionLabelText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },

  modeCard: { borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 14 },
  cardLightShadow: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 3 },
  modeCardAI: { borderWidth: 1.5, marginTop: 0 },
  recommendedBadge: {
    position: 'absolute', top: -11, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, zIndex: 10,
  },
  recommendedText: { color: '#FFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  modeIconLg: { width: 50, height: 50, borderRadius: 16 },
  modeTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  modeIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modeTextWrap: { flex: 1 },
  modeTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, marginBottom: 3 },
  modeDesc: { fontSize: 13, fontWeight: '400', lineHeight: 19 },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelText: { fontSize: 15, fontWeight: '500' },
});
