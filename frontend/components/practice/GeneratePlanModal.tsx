/**
 * GeneratePlanModal
 * Location: components/practice/GeneratePlanModal.tsx
 *
 * Premium full-screen modal that collects all four training plan
 * hyperparameters before calling the generate endpoint:
 *
 *   fatigue  — How tired the user is right now (0.1 / 0.4 / 0.8)
 *   severity — Difficulty override relative to auto-detected severity
 *              (easier / auto / harder → multiplier on auto severity)
 *   ageGroup — Maps to the `age` stat expected by CTM
 *              (child=0.2 / teen=0.35 / adult=0.55 / elderly=0.75)
 *   delta    — Self-reported trend since last session
 *              (regressing=-0.2 / stable=0.0 / improving=0.2)
 *
 * The modal is rendered over a dark overlay using React Native's
 * built-in <Modal> so it works on both iOS and Android without
 * any additional libraries.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { haptics } from '@/lib/haptics';
import { useAppTheme } from '@/theme-provider';
import { BrandWaveform } from '@/components/ui/BrandWaveform';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanParams {
  fatigue: number;
  severityMultiplier: number; // 0.7 / 1.0 / 1.3
  age: number;
  delta: number;
}

interface Props {
  visible: boolean;
  autoSeverity: number; // 0–1, computed from gamification stats
  onConfirm: (params: PlanParams) => void;
  onClose: () => void;
}

// ─── Option row helpers ───────────────────────────────────────────────────────

interface Option<T> {
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: T;
  accent: string;
}

const FATIGUE_OPTIONS: Option<number>[] = [
  { label: 'Fresh',        sub: 'Ready to work hard',       icon: 'flash-outline',      value: 0.1, accent: '#10B981' },
  { label: 'Somewhat',     sub: 'A bit tired today',        icon: 'battery-half-outline', value: 0.4, accent: '#F59E0B' },
  { label: 'Very Tired',   sub: 'Low energy right now',     icon: 'moon-outline',        value: 0.8, accent: '#EF4444' },
];

const SEVERITY_OPTIONS: Option<number>[] = [
  { label: 'Easier',       sub: 'Simpler exercises',        icon: 'leaf-outline',        value: 0.7,  accent: '#10B981' },
  { label: 'Auto',         sub: 'Match my skill level',     icon: 'sparkles-outline',    value: 1.0,  accent: '#6366F1' },
  { label: 'Harder',       sub: 'Push me further',          icon: 'flame-outline',       value: 1.3,  accent: '#EF4444' },
];

const AGE_OPTIONS: Option<number>[] = [
  { label: 'Child',        sub: 'Under 12',                 icon: 'happy-outline',       value: 0.2,  accent: '#A78BFA' },
  { label: 'Teen',         sub: '12 – 17',                  icon: 'person-outline',      value: 0.35, accent: '#60A5FA' },
  { label: 'Adult',        sub: '18 – 55',                  icon: 'briefcase-outline',   value: 0.55, accent: '#34D399' },
  { label: 'Elderly',      sub: '55+',                      icon: 'walk-outline',        value: 0.75, accent: '#FBBF24' },
];

const DELTA_OPTIONS: Option<number>[] = [
  { label: 'Regressing',   sub: 'Getting worse lately',     icon: 'trending-down-outline', value: -0.2, accent: '#EF4444' },
  { label: 'Stable',       sub: 'About the same',           icon: 'remove-outline',        value:  0.0, accent: '#6B7280' },
  { label: 'Improving',    sub: 'Noticeably better',        icon: 'trending-up-outline',   value:  0.2, accent: '#10B981' },
];

// ─── OptionPicker sub-component ───────────────────────────────────────────────

function OptionPicker<T extends number>({
  title,
  hint,
  options,
  value,
  onChange,
  text,
  subtle,
  surface,
  border,
}: {
  title: string;
  hint?: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  text: string;
  subtle: string;
  surface: string;
  border: string;
}) {
  return (
    <View style={pickerStyles.section}>
      <View style={pickerStyles.sectionHeader}>
        <Text style={[pickerStyles.sectionTitle, { color: text }]}>{title}</Text>
        {hint ? (
          <Text style={[pickerStyles.sectionHint, { color: subtle }]}>{hint}</Text>
        ) : null}
      </View>

      <View style={[
        pickerStyles.optionsGrid,
        options.length === 4 && pickerStyles.optionsGrid4,
      ]}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <TouchableOpacity
              key={String(opt.value)}
              style={[
                pickerStyles.optionCard,
                { borderColor: selected ? opt.accent : border, backgroundColor: surface },
                selected && { backgroundColor: opt.accent + '18' },
                options.length === 4 && pickerStyles.optionCard4,
              ]}
              onPress={() => { haptics.light(); onChange(opt.value as T); }}
              activeOpacity={0.75}
            >
              <View style={[
                pickerStyles.optionIconWrap,
                { backgroundColor: selected ? opt.accent + '28' : (border + '80') },
              ]}>
                <Ionicons name={opt.icon} size={20} color={selected ? opt.accent : subtle} />
              </View>
              <Text style={[pickerStyles.optionLabel, { color: selected ? opt.accent : text }]} numberOfLines={1}>
                {opt.label}
              </Text>
              <Text style={[pickerStyles.optionSub, { color: subtle }]} numberOfLines={1}>
                {opt.sub}
              </Text>
              {selected && (
                <View style={[pickerStyles.selectedDot, { backgroundColor: opt.accent }]} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function GeneratePlanModal({ visible, autoSeverity, onConfirm, onClose }: Props) {
  const { resolvedTheme } = useAppTheme();

  const isDark   = resolvedTheme.dark;
  const PRIMARY  = resolvedTheme.colors.primary;
  const bg       = isDark ? '#0C0F14' : '#F8FAFB';
  const surface  = isDark ? '#161B24' : '#FFFFFF';
  const border   = isDark ? '#252D3A' : '#EDF0F3';
  const subtle   = isDark ? '#7A8FA3' : '#8D9FAE';
  const text     = resolvedTheme.colors.text;
  const overlay  = isDark ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.45)';

  // ── State ─────────────────────────────────────────────────────────────────
  const [fatigue,     setFatigue]     = useState<number>(0.1);
  const [severityMul, setSeverityMul] = useState<number>(1.0);
  const [age,         setAge]         = useState<number>(0.35);
  const [delta,       setDelta]       = useState<number>(0.0);

  // Reset to defaults every time the modal opens
  useEffect(() => {
    if (visible) {
      setFatigue(0.1);
      setSeverityMul(1.0);
      setAge(0.35);
      setDelta(0.0);
    }
  }, [visible]);

  // ── Entrance animation ────────────────────────────────────────────────────
  const slideAnim = useRef(new Animated.Value(60)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(60);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 14, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  // ── Derived label for severity ────────────────────────────────────────────
  const effectiveSeverity = Math.min(1, Math.max(0, autoSeverity * severityMul));
  const severityPct = Math.round(effectiveSeverity * 100);
  const severityHint = autoSeverity > 0
    ? `Auto-detected: ${Math.round(autoSeverity * 100)}% → Effective: ${severityPct}%`
    : undefined;

  // ── Confirm ───────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    haptics.medium();
    onConfirm({
      fatigue,
      severityMultiplier: severityMul,
      age,
      delta,
    });
  }, [fatigue, severityMul, age, delta, onConfirm]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Dimmed overlay */}
      <Pressable style={[styles.overlay, { backgroundColor: overlay }]} onPress={onClose} />

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: bg, opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
        pointerEvents="box-none"
      >
        {/* Handle */}
        <View style={[styles.handle, { backgroundColor: border }]} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <BrandWaveform size="sm" animated />
            <View>
              <Text style={[styles.headerTitle, { color: text }]}>Personalise Your Plan</Text>
              <Text style={[styles.headerSub, { color: subtle }]}>
                We'll tune the difficulty to fit you right now.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: border }]}
            onPress={onClose}
          >
            <Ionicons name="close" size={18} color={subtle} />
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: border }]} />

        {/* Scrollable content */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <OptionPicker
            title="Energy Level"
            hint="How do you feel right now?"
            options={FATIGUE_OPTIONS}
            value={fatigue as any}
            onChange={setFatigue}
            text={text} subtle={subtle} surface={surface} border={border}
          />

          <OptionPicker
            title="Difficulty"
            hint={severityHint}
            options={SEVERITY_OPTIONS}
            value={severityMul as any}
            onChange={setSeverityMul}
            text={text} subtle={subtle} surface={surface} border={border}
          />

          <OptionPicker
            title="Age Group"
            hint="Helps calibrate exercise pacing"
            options={AGE_OPTIONS}
            value={age as any}
            onChange={setAge}
            text={text} subtle={subtle} surface={surface} border={border}
          />

          <OptionPicker
            title="Recent Progress"
            hint="How has your speech been lately?"
            options={DELTA_OPTIONS}
            value={delta as any}
            onChange={setDelta}
            text={text} subtle={subtle} surface={surface} border={border}
          />

          {/* Summary card */}
          <View style={[styles.summaryCard, { backgroundColor: PRIMARY + '10', borderColor: PRIMARY + '25' }]}>
            <Ionicons name="information-circle-outline" size={16} color={PRIMARY} />
            <Text style={[styles.summaryText, { color: PRIMARY }]}>
              These settings tune your plan for today only. Your long-term learning profile is updated automatically after each session.
            </Text>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: border }]}>
          <TouchableOpacity
            style={[styles.cancelBtn, { borderColor: border }]}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={[styles.cancelBtnText, { color: subtle }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmBtn, { backgroundColor: PRIMARY }]}
            onPress={handleConfirm}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={16} color="#FFF" />
            <Text style={styles.confirmBtnText}>Generate Plan</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '92%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 20,
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  divider: {
    height: 1,
    marginHorizontal: 0,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    gap: 24,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 4,
  },
  summaryText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 2,
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  confirmBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});

const pickerStyles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  sectionHint: {
    fontSize: 11,
    fontWeight: '500',
  },
  optionsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  optionsGrid4: {
    flexWrap: 'wrap',
  },
  optionCard: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
    minWidth: '22%',
  },
  optionCard4: {
    flexBasis: '45%',
    flex: 0,
  },
  optionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  optionSub: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 13,
  },
  selectedDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
